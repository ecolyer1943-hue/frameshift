import { createServerFn } from "@tanstack/react-start";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CAMERAS, type CameraId } from "@/lib/studio/presets";
import { mediaId, mediaIdFromSrc, readStored } from "@/lib/studio/blob-store";
import type { DurationSec } from "@/lib/studio/types";

const MODEL_IDS = {
  quality: "grok-imagine-video-1.5",
} as const;

const IMAGE_MODEL = "grok-imagine-image-2.0";
const HOUR_MS = 60 * 60 * 1000;
const startTimes: number[] = [];
const stillTimes: number[] = [];

type StartInput = {
  prompt: string;
  dialogue: string;
  camera: CameraId;
  duration: DurationSec;
  aspectRatio: "16:9" | "9:16" | "1:1";
  resolution: "480p" | "720p" | "1080p";
  model: "lite" | "quality";
  audio: boolean;
  imageDataUrl: string | null;
  endImageDataUrl: string | null;
  holdSubject: boolean;
  holdSetting: boolean;
  continuation: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function takeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseStart(input: unknown): StartInput {
  const record = asRecord(input);
  if (!record) throw new Error("Check the shot settings.");
  const prompt = takeString(record.prompt) ?? "";
  if (prompt.length < 8 || prompt.length > 1800) {
    throw new Error("Describe the motion in a sentence or two.");
  }
  const duration = record.duration;
  if (duration !== 4 && duration !== 6 && duration !== 8 && duration !== 10 && duration !== 15) {
    throw new Error("Pick a 4, 6, 8, 10, or 15 second shot.");
  }
  const aspectRatio = record.aspectRatio;
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16" && aspectRatio !== "1:1") {
    throw new Error("Pick a frame shape.");
  }
  const camera = CAMERAS.some((item) => item.id === record.camera) ? (record.camera as CameraId) : "hold";
  const dialogue = (takeString(record.dialogue) ?? "").slice(0, 240);
  const imageDataUrl = takeString(record.imageDataUrl);
  if (imageDataUrl && !isImageDataUrl(imageDataUrl)) {
    throw new Error("That still could not be read. Try a JPG or PNG.");
  }
  const endImageDataUrl = takeString(record.endImageDataUrl);
  if (endImageDataUrl && !isImageDataUrl(endImageDataUrl)) {
    throw new Error("That end frame could not be read. Try a JPG or PNG.");
  }
  return {
    prompt,
    dialogue,
    camera,
    duration,
    aspectRatio,
    resolution: "1080p",
    model: "quality",
    audio: Boolean(dialogue) || record.audio !== false,
    imageDataUrl,
    endImageDataUrl: imageDataUrl ? endImageDataUrl : null,
    holdSubject: record.holdSubject !== false,
    holdSetting: record.holdSetting !== false,
    continuation: record.continuation === true,
  };
}

function isImageDataUrl(value: string): boolean {
  if (value.length > 4_000_000) return false;
  return /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function isCastSource(value: string): boolean {
  if (isImageDataUrl(value)) return true;
  if (/^media:[a-f0-9]{64}$/.test(value)) return true;
  if (/^\/api\/media\?id=[a-f0-9]{64}$/.test(value)) return true;
  if (/^\/samples\/[a-z0-9]+\.(?:jpg|jpeg|png|webp|mp4)$/.test(value)) return true;
  return /^data:video\/(?:mp4|webm|quicktime);base64,[a-z0-9+/=\s]+$/i.test(value) && value.length < 12_000_000;
}

function allow(bucket: number[], limit: number): boolean {
  const cutoff = Date.now() - HOUR_MS;
  while (bucket.length && bucket[0]! < cutoff) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(Date.now());
  return true;
}

function apiKey(): string | null {
  const key = process.env.XAI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function messageFrom(body: unknown, status: number): string {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const raw =
    takeString(error?.message) ||
    takeString(record?.error) ||
    takeString(record?.message) ||
    takeString(record?.detail) ||
    "";
  const lower = raw.toLowerCase();
  if (lower.includes("safety") || lower.includes("moderat") || lower.includes("violat")) {
    return "This shot was blocked by safety checks. Try another still or a simpler motion.";
  }
  if (status === 401 || status === 403) {
    if (lower.includes("credit") || lower.includes("subscription") || lower.includes("quota") || lower.includes("billing")) {
      return "Generation credits are used up. Add credits, then try the shot again.";
    }
    return "Generation is not available right now.";
  }
  if (status === 429) return "Too many generations at once. Wait a moment and try again.";
  if (status >= 500) return "The video service had a problem. Try once more.";
  if (raw && raw.length < 180 && !raw.includes("<")) return raw;
  return "The shot could not be started. Adjust the still or the motion and try again.";
}

function soundDirection(dialogue: string, audio: boolean): string {
  if (!dialogue && !audio) return "Silent picture. No dialogue, no music, no voiceover.";
  if (!dialogue) {
    return "Sound as if a microphone was in the room: footsteps, cloth, breath, and the place itself. No music, no voiceover, no announcer.";
  }
  return `The person speaks on set, close and human, with real breaths and the pace of the moment. Their mouth matches the words. Not a narrator, not a commercial read, and no music under the line. They say: "${dialogue}".`;
}

function composePrompt(input: StartInput): string {
  const camera = CAMERAS.find((item) => item.id === input.camera);
  const parts = [input.prompt.trim(), camera ? `Camera: ${camera.line}` : ""];
  if (input.imageDataUrl) {
    if (input.continuation) {
      parts.push(
        "This image is the last frame of the previous shot. Continue the same subject, setting, lighting, and image quality. Do not restart, restyle, or add text, logos, or new people.",
      );
    } else {
      const locks = [
        input.holdSubject ? "Preserve the subject and identity." : "The subject may change if the motion asks for it.",
        input.holdSetting ? "Preserve the setting, materials, and lighting." : "The setting may shift with the motion.",
      ];
      if (input.endImageDataUrl) {
        locks.push("The second image is the last frame. Arrive there smoothly, without a cut.");
      }
      parts.push(
        `The provided image is frame one. ${locks.join(" ")} Add only the described motion. Do not add text, logos, or new people.`,
      );
    }
  }
  parts.push(soundDirection(input.dialogue, input.audio));
  return parts.filter(Boolean).join(" ");
}

export const startVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseStart(input))
  .handler(async ({ data }) => {
    const key = apiKey();
    if (!key) return { ok: false as const, error: "Generation is not available in this environment." };
    if (!allow(startTimes, 8)) {
      return { ok: false as const, error: "Hourly generation limit reached. Try again later." };
    }

    const payload: Record<string, unknown> = {
      model: MODEL_IDS.quality,
      prompt: composePrompt(data),
      duration: data.duration,
      resolution: data.resolution,
    };
    if (data.imageDataUrl) {
      payload.image = { url: data.imageDataUrl };
      if (data.endImageDataUrl) payload.last_frame = { url: data.endImageDataUrl };
    } else {
      payload.aspect_ratio = data.aspectRatio;
    }
    if (!data.audio) payload.generate_audio = false;

    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/videos/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      return { ok: false as const, error: "Could not reach the video service. Try again." };
    }

    const body = await readBody(response);
    if (!response.ok) return { ok: false as const, error: messageFrom(body, response.status) };
    const record = asRecord(body);
    const requestId = takeString(record?.request_id) || takeString(record?.id);
    if (!requestId) return { ok: false as const, error: "The video service did not accept the shot." };
    return { ok: true as const, requestId };
  });

export const pollVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const requestId = takeString(record?.requestId) ?? "";
    if (!/^[\w-]{8,80}$/.test(requestId)) throw new Error("Missing generation.");
    return { requestId };
  })
  .handler(async ({ data }) => {
    const key = apiKey();
    if (!key) return { ok: false as const, error: "Generation is not available in this environment." };
    let response: Response;
    try {
      response = await fetch(`https://api.x.ai/v1/videos/${data.requestId}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { ok: true as const, status: "rendering" as const, videoUrl: null };
    }
    const body = await readBody(response);
    if (!response.ok) return { ok: false as const, error: messageFrom(body, response.status) };
    const record = asRecord(body);
    const video = asRecord(record?.video);
    const videoUrl = takeString(video?.url) || takeString(record?.url);
    const status = (takeString(record?.status) ?? "").toLowerCase();
    if (videoUrl && (status === "done" || status === "completed" || status === "succeeded" || status === "")) {
      return { ok: true as const, status: "done" as const, videoUrl };
    }
    if (status === "failed" || status === "expired" || status === "error" || status === "cancelled") {
      return {
        ok: false as const,
        error: status === "expired" ? "That render expired before it finished. Regen it." : messageFrom(body, 400),
      };
    }
    return { ok: true as const, status: status === "queued" || status === "pending" ? ("queued" as const) : ("rendering" as const), videoUrl: null };
  });

export const recastVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    if (!record) throw new Error("Check the recast.");
    const prompt = takeString(record.prompt) ?? "";
    if (prompt.length < 8 || prompt.length > 1800) throw new Error("Describe how the character should move.");
    const scene = takeString(record.sceneDataUrl);
    const listed = Array.isArray(record.characterDataUrls) ? record.characterDataUrls : [];
    const fromList = listed
      .map((item) => takeString(item))
      .filter((item): item is string => Boolean(item && isCastSource(item)))
      .slice(0, 3);
    const single = takeString(record.characterDataUrl);
    const characters = fromList.length ? fromList : single && isCastSource(single) ? [single] : [];
    if (!scene || !isCastSource(scene)) throw new Error("Choose a performance first.");
    if (!characters.length) throw new Error("Add a photo or video of the person to swap in.");
    const duration = record.duration;
    if (duration !== 4 && duration !== 6 && duration !== 8 && duration !== 10 && duration !== 15) {
      throw new Error("Pick a shot length.");
    }
    const camera = CAMERAS.some((item) => item.id === record.camera) ? (record.camera as CameraId) : "hold";
    const dialogue = (takeString(record.dialogue) ?? "").slice(0, 240);
    const resolution = record.resolution === "480p" ? "480p" : record.resolution === "1080p" ? "1080p" : "720p";
    return {
      prompt,
      scene,
      characters,
      duration,
      camera,
      resolution,
      holdSubject: record.holdSubject !== false,
      holdSetting: record.holdSetting !== false,
      audio: Boolean(dialogue) || record.audio !== false,
      dialogue,
    };
  })
  .handler(async ({ data }) => {
    const key = apiKey();
    if (!key) return { ok: false as const, error: "Generation is not available in this environment." };
    const scene = await resolveStill(data.scene);
    const characters = (await Promise.all(data.characters.map((item) => resolveStill(item)))).filter((item): item is string => Boolean(item));
    if (!scene || !characters.length) return { ok: false as const, error: "That photo or video could not be read." };
    if (!allow(startTimes, 8)) {
      return { ok: false as const, error: "Hourly generation limit reached. Try again later." };
    }

    let edited: Response;
    try {
      edited = await fetch("https://api.x.ai/v1/images/edits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt:
            "Replace only the person. The later images are the person who must appear: match their face, hair, age, and clothing. Keep the first image's pose, camera, lighting, and room. Remove every trace of the original face and clothes. One person only. No text, logos, or extra people.",
          images: [{ type: "image_url", url: scene }, ...characters.map((url) => ({ type: "image_url", url }))],
          response_format: "b64_json",
          n: 1,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return { ok: false as const, error: "Could not recast the scene. Try again." };
    }
    const editBody = await readBody(edited);
    if (!edited.ok) return { ok: false as const, error: messageFrom(editBody, edited.status) };
    const still = await stillDataUrl(editBody);
    if (!still) return { ok: false as const, error: "The recast still did not come back. Try again." };

    const camera = CAMERAS.find((item) => item.id === data.camera);
    const spoken = soundDirection(data.dialogue, data.audio);
    const locks = [
      data.holdSubject
        ? "Keep this person's identity for the whole shot."
        : "Expression and pose may change with the motion.",
      data.holdSetting ? "Keep the setting, light, and background." : "The setting may shift with the motion.",
    ];
    const prompt = [
      data.prompt.trim(),
      camera ? `Camera: ${camera.line}` : "",
      "The person in the image is the character. Do not add text, logos, or new people.",
      locks.join(" "),
      spoken,
    ]
      .filter(Boolean)
      .join(" ");

    const payload: Record<string, unknown> = {
      model: MODEL_IDS.quality,
      prompt,
      duration: data.duration,
      resolution: "1080p",
      image: { url: still },
    };
    if (!data.audio) payload.generate_audio = false;

    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/videos/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      return { ok: false as const, error: "Could not start the recast. Try again." };
    }
    const body = await readBody(response);
    if (!response.ok) return { ok: false as const, error: messageFrom(body, response.status) };
    const record = asRecord(body);
    const requestId = takeString(record?.request_id) || takeString(record?.id);
    if (!requestId) return { ok: false as const, error: "The video service did not accept the recast." };
    return { ok: true as const, requestId, poster: still };
  });

async function jpegFromVideo(bytes: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", "pipe:0", "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null));
    child.stdin.on("error", () => undefined);
    child.stdin.write(bytes);
    child.stdin.end();
  });
}

async function resolveStill(value: string): Promise<string | null> {
  if (isImageDataUrl(value)) return value;
  if (/^data:video\//i.test(value)) {
    const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if (!match) return null;
    const frame = await jpegFromVideo(Buffer.from(match[1].replace(/\s/g, ""), "base64"));
    return frame ? `data:image/jpeg;base64,${frame.toString("base64")}` : null;
  }
  const id = mediaId(value) || mediaIdFromSrc(value);
  if (id) {
    const stored = await readStored(id);
    if (!stored) return null;
    if (stored.mime.startsWith("video/")) {
      const frame = await jpegFromVideo(stored.bytes);
      return frame ? `data:image/jpeg;base64,${frame.toString("base64")}` : null;
    }
    if (!stored.mime.startsWith("image/")) return null;
    return `data:${stored.mime};base64,${stored.bytes.toString("base64")}`;
  }
  const sample = /^\/samples\/([a-z0-9]+)\.(jpg|jpeg|png|webp|mp4)$/.exec(value);
  if (!sample) return null;
  try {
    const bytes = await readFile(path.resolve("public/samples", `${sample[1]}.${sample[2]}`));
    if (sample[2] === "mp4") {
      const frame = await jpegFromVideo(bytes);
      return frame ? `data:image/jpeg;base64,${frame.toString("base64")}` : null;
    }
    const mime = sample[2] === "png" ? "image/png" : sample[2] === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function stillDataUrl(body: unknown): Promise<string | null> {
  const record = asRecord(body);
  const dataList = Array.isArray(record?.data) ? record.data : [];
  const first = asRecord(dataList[0]);
  const image = asRecord(record?.image);
  const b64 = takeString(first?.b64_json) || takeString(image?.base64) || takeString(record?.b64_json);
  if (b64) {
    const clean = b64.replace(/\s/g, "");
    return clean.startsWith("data:") ? clean : `data:image/jpeg;base64,${clean}`;
  }
  const url = takeString(first?.url) || takeString(image?.url) || takeString(record?.url);
  if (!url?.startsWith("https://")) return null;
  try {
    const imageResponse = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!imageResponse.ok) return null;
    const mime = imageResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.byteLength < 32 || bytes.byteLength > 4_000_000) return null;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export const draftStill = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const prompt = takeString(record?.prompt) ?? "";
    if (prompt.length < 8 || prompt.length > 1200) throw new Error("Describe the still in a sentence.");
    const aspect = record?.aspectRatio;
    const aspectRatio = aspect === "9:16" || aspect === "1:1" || aspect === "16:9" ? aspect : "16:9";
    return { prompt, aspectRatio };
  })
  .handler(async ({ data }) => {
    const key = apiKey();
    if (!key) return { ok: false as const, error: "Generation is not available in this environment." };
    if (!allow(stillTimes, 12)) {
      return { ok: false as const, error: "Hourly still limit reached. Upload a photo instead." };
    }
    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt: `${data.prompt} Photographic still, natural light, no text, no logos, no watermark.`,
          aspect_ratio: data.aspectRatio,
          resolution: "1k",
          quality: "low",
          response_format: "b64_json",
          n: 1,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return { ok: false as const, error: "Could not draft the still. Try again." };
    }
    const body = await readBody(response);
    if (!response.ok) return { ok: false as const, error: messageFrom(body, response.status) };
    const record = asRecord(body);
    const dataList = Array.isArray(record?.data) ? record.data : [];
    const first = asRecord(dataList[0]);
    const b64 = takeString(first?.b64_json);
    if (b64) {
      return { ok: true as const, dataUrl: `data:image/jpeg;base64,${b64}` };
    }
    const url = takeString(first?.url);
    if (!url || !url.startsWith("https://")) {
      return { ok: false as const, error: "The still did not come back. Try again." };
    }
    try {
      const image = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!image.ok) return { ok: false as const, error: "The still did not come back. Try again." };
      const mime = image.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      const bytes = Buffer.from(await image.arrayBuffer());
      if (bytes.byteLength > 1_800_000) {
        return { ok: false as const, error: "That still was too large to use. Try a simpler description." };
      }
      return { ok: true as const, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
    } catch {
      return { ok: false as const, error: "The still did not come back. Try again." };
    }
  });

function audioFile(dataUrl: string): { bytes: Buffer; mime: string; ext: string } | null {
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 80 || bytes.length > 4_000_000) return null;
  const mime = match[1].toLowerCase();
  const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("wav") ? "wav" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  return { bytes, mime, ext };
}

export const transcribeVoice = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const audioDataUrl = takeString(record?.audioDataUrl) ?? "";
    if (!audioFile(audioDataUrl)) throw new Error("That recording could not be read.");
    return { audioDataUrl };
  })
  .handler(async ({ data }) => {
    const key = apiKey();
    if (!key) return { ok: false as const, error: "Generation is not available in this environment." };
    const audio = audioFile(data.audioDataUrl);
    if (!audio) return { ok: false as const, error: "That recording could not be read." };
    const form = new FormData();
    form.append("model", "grok-voice-transcribe-2.0");
    form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), `voice.${audio.ext}`);
    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/stt", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { ok: false as const, error: "Could not hear that recording." };
    }
    const body = await readBody(response);
    if (!response.ok) return { ok: false as const, error: "Could not hear that recording." };
    const text = (takeString(asRecord(body)?.text) ?? "").slice(0, 240);
    if (text.length < 2) return { ok: false as const, error: "No speech in that recording." };
    return { ok: true as const, text };
  });

