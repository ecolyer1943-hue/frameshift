import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (host.includes(":")) return false;
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const a = parts[0] ?? 0;
      const b = parts[1] ?? 0;
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ownedVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "vidgen.x.ai" || url.hostname.endsWith(".x.ai"));
  } catch {
    return false;
  }
}

function voiceFile(dataUrl: string, id: string): { path: string; bytes: Buffer } | null {
  if (!dataUrl) return null;
  const match = /^data:audio\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 80 || bytes.length > 4_000_000) return null;
  const kind = match[1].toLowerCase();
  const ext = kind.includes("mpeg") || kind.includes("mp3") ? "mp3" : kind.includes("wav") ? "wav" : kind.includes("mp4") || kind.includes("m4a") ? "m4a" : kind.includes("ogg") ? "ogg" : "webm";
  return { path: path.resolve("/tmp", `frameshift-${id}-voice.${ext}`), bytes };
}

function runFfmpeg(input: string, output: string, audio: string | null, polish = true): Promise<void> {
  const scale = "scale=if(gte(iw\\,ih)\\,3840\\,-2):if(gte(iw\\,ih)\\,-2\\,3840):flags=lanczos";
  const args = audio
    ? [
        "-y",
        "-i",
        input,
        "-i",
        audio,
        "-filter_complex",
        "[1:a]highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=20[a]",
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-vf",
        scale,
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
        "-shortest",
        "-movflags",
        "+faststart",
        output,
      ]
    : polish
      ? [
          "-y",
          "-i",
          input,
          "-vf",
          scale,
          "-af",
          "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo",
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
        ]
      : [
          "-y",
          "-i",
          input,
          "-vf",
          scale,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          output,
        ];
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("slow"));
    }, 55_000);
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

export const upscaleVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
    const id = typeof record?.id === "string" ? record.id : "";
    const videoUrl = typeof record?.videoUrl === "string" ? record.videoUrl : "";
    const audioDataUrl = typeof record?.audioDataUrl === "string" ? record.audioDataUrl : "";
    if (!UUID.test(id)) throw new Error("That clip cannot be upscaled.");
    if (!ownedVideoUrl(videoUrl)) throw new Error("That clip cannot be upscaled.");
    if (audioDataUrl && !/^data:audio\/[a-z0-9.+-]+;base64,/i.test(audioDataUrl)) {
      throw new Error("That recording could not be read.");
    }
    return { id, videoUrl, audioDataUrl };
  })
  .handler(async ({ data }) => {
    const dir = path.resolve("public/renders");
    const output = path.resolve(dir, `${data.id}.mp4`);
    const source = path.resolve("/tmp", `frameshift-${data.id}.mp4`);
    if (output !== path.join(dir, `${data.id}.mp4`)) {
      return { ok: false as const, error: "That clip cannot be upscaled." };
    }
    try {
      const response = await fetch(data.videoUrl, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!response.ok || !publicHttps(response.url)) return { ok: false as const, error: "Could not fetch the clip." };
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength < 1000 || bytes.byteLength > 80_000_000) {
        return { ok: false as const, error: "That clip is the wrong size to upscale." };
      }
      await writeFile(source, bytes);
      await mkdir(dir, { recursive: true });
      const voice = voiceFile(data.audioDataUrl, data.id);
      if (voice) await writeFile(voice.path, voice.bytes);
      try {
        await runFfmpeg(source, output, voice?.path ?? null);
      } catch {
        if (voice) {
          try {
            await runFfmpeg(source, output, null);
          } catch {
            await runFfmpeg(source, output, null, false);
          }
        } else {
          await runFfmpeg(source, output, null, false);
        }
      } finally {
        if (voice) await rm(voice.path, { force: true });
      }
      const info = await stat(output);
      if (info.size < 1000) throw new Error("empty");
      return { ok: true as const, url: `/api/clip?id=${data.id}` };
    } catch {
      await rm(output, { force: true });
      return { ok: false as const, error: "4K upscale did not finish. The 1080 clip is ready." };
    } finally {
      await rm(source, { force: true });
    }
  });
