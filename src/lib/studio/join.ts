import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAMPLE = /^\/samples\/(night|ink|ivory|field)\.mp4$/;

function ownedVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "vidgen.x.ai" || url.hostname.endsWith(".x.ai"));
  } catch {
    return false;
  }
}

function renderFile(value: string): string | null {
  const id = /(?:^|\/)api\/clip\?id=([0-9a-f-]{36})$/i.exec(value)?.[1];
  if (!id || !UUID.test(id)) return null;
  const dir = path.resolve("public/renders");
  const file = path.resolve(dir, `${id}.mp4`);
  return file === path.join(dir, `${id}.mp4`) ? file : null;
}

function sampleFile(value: string): string | null {
  const name = SAMPLE.exec(value)?.[1];
  return name ? path.resolve("public/samples", `${name}.mp4`) : null;
}

async function materialize(value: string, dest: string): Promise<boolean> {
  const local = renderFile(value) ?? sampleFile(value);
  if (local) {
    try {
      await writeFile(dest, await readFile(local));
      return true;
    } catch {
      return false;
    }
  }
  if (!ownedVideoUrl(value)) return false;
  try {
    const response = await fetch(value, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 1000 || bytes.byteLength > 80_000_000) return false;
    await writeFile(dest, bytes);
    return true;
  } catch {
    return false;
  }
}

function ffmpeg(args: string[], ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("slow"));
    }, ms);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(String(code)));
    });
  });
}

export const joinVideos = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
    const id = typeof record?.id === "string" ? record.id : "";
    const urls = Array.isArray(record?.urls) ? record.urls.filter((item): item is string => typeof item === "string") : [];
    if (!UUID.test(id)) throw new Error("Those pieces cannot be joined.");
    if (urls.length !== 2 || urls.some((url) => url.length > 2000)) throw new Error("Those pieces cannot be joined.");
    return { id, urls };
  })
  .handler(async ({ data }) => {
    const dir = path.resolve("public/renders");
    const output = path.resolve(dir, `${data.id}.mp4`);
    const left = path.resolve("/tmp", `frameshift-join-${data.id}-a.mp4`);
    const right = path.resolve("/tmp", `frameshift-join-${data.id}-b.mp4`);
    const list = path.resolve("/tmp", `frameshift-join-${data.id}.txt`);
    if (output !== path.join(dir, `${data.id}.mp4`)) {
      return { ok: false as const, error: "Those pieces cannot be joined." };
    }
    try {
      const ready = await Promise.all([materialize(data.urls[0], left), materialize(data.urls[1], right)]);
      if (ready.some((item) => !item)) return { ok: false as const, error: "A piece could not be read." };
      await mkdir(dir, { recursive: true });
      await writeFile(list, `file '${left}'\nfile '${right}'\n`);
      try {
        await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output], 30_000);
      } catch {
        await ffmpeg(
          [
            "-y",
            "-i",
            left,
            "-i",
            right,
            "-filter_complex",
            "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]",
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            output,
          ],
          90_000,
        );
      }
      const info = await stat(output);
      if (info.size < 1000) throw new Error("empty");
      return { ok: true as const, url: `/api/clip?id=${data.id}` };
    } catch {
      await rm(output, { force: true });
      return { ok: false as const, error: "The pieces could not be joined." };
    } finally {
      await rm(left, { force: true });
      await rm(right, { force: true });
      await rm(list, { force: true });
    }
  });
