import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 250_000_000;
const MAX_SECONDS = 15 * 60;

function run(args: string[], ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("slow"));
    }, ms);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(String(code)));
    });
  });
}

function probe(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let text = "";
    child.stderr.on("data", (chunk: Buffer) => {
      text += chunk.toString();
    });
    child.on("close", () => {
      if (!/Video:/.test(text)) {
        reject(new Error("novideo"));
        return;
      }
      const match = /Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
      if (!match) {
        reject(new Error("noduration"));
        return;
      }
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
}

async function split(input: string, dir: string, seconds: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  const pattern = path.join(dir, "%03d.mp4");
  const needed = Math.max(1, Math.ceil(seconds / 15 - 0.04));
  const attempts = [
    ["-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-f", "segment", "-segment_time", "15", "-reset_timestamps", "1", pattern],
    ["-y", "-i", input, "-map", "0:v:0", "-c", "copy", "-f", "segment", "-segment_time", "15", "-reset_timestamps", "1", pattern],
    [
      "-y",
      "-i",
      input,
      "-map", "0:v:0",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-force_key_frames", "expr:gte(t,n_forced*15)",
      "-an",
      "-f", "segment",
      "-segment_time", "15",
      "-reset_timestamps", "1",
      pattern,
    ],
  ];
  let last: unknown;
  for (const args of attempts) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    try {
      await run(args, 90_000);
      const names = (await readdir(dir)).filter((name) => name.endsWith(".mp4") && !name.startsWith("."));
      if (names.length < needed) throw new Error("unsplit");
      return;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("split");
}

export const Route = createFileRoute("/api/copy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return fail(400, "That video could not be read.");
        }
        const file = form.get("file");
        if (!(file instanceof File)) return fail(400, "Choose a video to copy.");
        if (file.size < 1000) return fail(400, "That video is empty.");
        if (file.size > MAX_BYTES) return fail(413, "Keep a copied video under 250 MB.");

        const id = crypto.randomUUID();
        const scratch = path.resolve("/tmp", `frameshift-copy-${id}`);
        const partsDir = path.resolve("/tmp", `frameshift-copy-${id}-parts`);
        const renders = path.resolve("public/renders");
        const full = path.resolve(renders, `${id}.mp4`);
        try {
          await writeFile(scratch, Buffer.from(await file.arrayBuffer()));
          const duration = await probe(scratch);
          if (duration > MAX_SECONDS) return fail(413, "A copy can be up to 15 minutes. Split a longer video first.");
          await mkdir(renders, { recursive: true });
          try {
            await run(["-y", "-i", scratch, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "+faststart", full], 60_000);
          } catch {
            try {
              await run(["-y", "-i", scratch, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", full], 60_000);
            } catch {
              await run(
                ["-y", "-i", scratch, "-map", "0:v:0", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", full],
                120_000,
              );
            }
          }
          await split(full, partsDir, duration);
          const names = (await readdir(partsDir)).filter((name) => name.endsWith(".mp4")).sort();
          const pieces: string[] = [];
          for (const name of names) {
            const piece = path.resolve(partsDir, name);
            const info = await stat(piece);
            if (info.size < 1000) continue;
            const pieceId = crypto.randomUUID();
            const dest = path.resolve(renders, `${pieceId}.mp4`);
            await writeFile(dest, await readFile(piece));
            pieces.push(`/api/clip?id=${pieceId}`);
          }
          if (!pieces.length) {
            await rm(full, { force: true });
            return fail(400, "That video could not be copied.");
          }
          return Response.json({
            ok: true,
            id,
            url: `/api/clip?id=${id}`,
            pieces,
            seconds: Math.max(1, Math.round(duration)),
          });
        } catch (error) {
          await rm(full, { force: true });
          const message = error instanceof Error && error.message === "novideo" ? "That file has no picture." : "That video could not be copied.";
          return fail(400, message);
        } finally {
          await rm(scratch, { force: true });
          await rm(partsDir, { recursive: true, force: true });
        }
      },
    },
  },
});
