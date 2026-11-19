import { useSyncExternalStore } from "react";

export type Grade = {
  contrast: number;
  saturate: number;
  brightness: number;
  warmth: number;
  vignette: number;
  grain: number;
  tint: string | null;
  tintAlpha: number;
};

export type LookId = "clean" | "night" | "ivory" | "field" | "ink" | "custom";

type SceneSnapshot = {
  live: boolean;
  mic: "on" | "off" | "blocked";
  error: string | null;
  fps: number;
  prompt: string;
  lookId: LookId;
  clipName: string;
  stillName: string;
  mirror: boolean;
};

const CLEAN: Grade = {
  contrast: 1.03,
  saturate: 1,
  brightness: 1,
  warmth: 0,
  vignette: 0.16,
  grain: 0.03,
  tint: null,
  tintAlpha: 0,
};

export const LOOKS: { id: Exclude<LookId, "custom">; label: string; grade: Grade }[] = [
  { id: "clean", label: "Clean", grade: CLEAN },
  {
    id: "night",
    label: "Night",
    grade: { contrast: 1.16, saturate: 0.82, brightness: 0.92, warmth: -0.46, vignette: 0.4, grain: 0.055, tint: "#8ab4f8", tintAlpha: 0.16 },
  },
  {
    id: "ivory",
    label: "Ivory",
    grade: { contrast: 1.06, saturate: 0.7, brightness: 1.1, warmth: 0.06, vignette: 0.1, grain: 0.02, tint: "#efe8d8", tintAlpha: 0.12 },
  },
  {
    id: "field",
    label: "Field",
    grade: { contrast: 1.05, saturate: 1.04, brightness: 1.03, warmth: 0.4, vignette: 0.2, grain: 0.04, tint: "#e2a23a", tintAlpha: 0.12 },
  },
  {
    id: "ink",
    label: "Ink",
    grade: { contrast: 1.5, saturate: 0.06, brightness: 1.02, warmth: 0, vignette: 0.34, grain: 0.07, tint: null, tintAlpha: 0 },
  },
];

let grade: Grade = CLEAN;
let snapshot: SceneSnapshot = {
  live: false,
  mic: "off",
  error: null,
  fps: 0,
  prompt: "",
  lookId: "clean",
  clipName: "",
  stillName: "",
  mirror: true,
};

const listeners = new Set<() => void>();
let stream: MediaStream | null = null;
let cameraEl: HTMLVideoElement | null = null;
let clipEl: HTMLVideoElement | null = null;
let clipUrl: string | null = null;
let noise: HTMLCanvasElement | null = null;
let mirror = true;
let loop = 0;
let frames = 0;
let lastFps = 0;
const canvases = new Set<HTMLCanvasElement>();
const raws = new Set<HTMLVideoElement>();

function emit(partial: Partial<SceneSnapshot>) {
  snapshot = { ...snapshot, ...partial };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScene(): SceneSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function currentGrade(): Grade {
  return grade;
}

function ensureCamera(): HTMLVideoElement | null {
  if (cameraEl) return cameraEl;
  if (typeof document === "undefined") return null;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  cameraEl = video;
  return video;
}

function ensureNoise(): HTMLCanvasElement | null {
  if (noise) return noise;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dots = ctx.createImageData(160, 90);
  for (let i = 0; i < dots.data.length; i += 4) {
    const v = 80 + Math.random() * 175;
    dots.data[i] = v;
    dots.data[i + 1] = v;
    dots.data[i + 2] = v;
    dots.data[i + 3] = 255;
  }
  ctx.putImageData(dots, 0, 0);
  noise = canvas;
  return canvas;
}

function paint(ctx: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number) {
  const look = grade;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (mirror && source === cameraEl) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.filter = `contrast(${look.contrast}) saturate(${look.saturate}) brightness(${look.brightness})`;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
  ctx.filter = "none";
  if (look.warmth) {
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = look.warmth > 0 ? `rgba(232, 162, 74, ${Math.min(0.55, look.warmth)})` : `rgba(120, 160, 230, ${Math.min(0.55, -look.warmth)})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (look.tint && look.tintAlpha > 0) {
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = look.tintAlpha;
    ctx.fillStyle = look.tint;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
  if (look.vignette > 0) {
    const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.28, width / 2, height / 2, width * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, `rgba(0,0,0,${look.vignette})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
  const grain = ensureNoise();
  if (grain && look.grain > 0) {
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = look.grain;
    ctx.drawImage(grain, 0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function tick(now: number) {
  const source = clipEl && clipEl.readyState >= 2 ? clipEl : cameraEl;
  if (source && source.readyState >= 2) {
    const ratio = source.videoWidth && source.videoHeight ? source.videoWidth / source.videoHeight : 16 / 9;
    const width = 960;
    const height = Math.max(2, Math.round(width / ratio / 2) * 2);
    for (const canvas of canvases) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d", { alpha: false });
      if (ctx) paint(ctx, source, width, height);
    }
    frames += 1;
  }
  if (now - lastFps >= 1000) {
    emit({ fps: frames });
    frames = 0;
    lastFps = now;
  }
  loop = requestAnimationFrame(tick);
}

function startLoop() {
  if (loop || typeof requestAnimationFrame === "undefined") return;
  lastFps = performance.now();
  loop = requestAnimationFrame(tick);
}

function stopLoop() {
  if (loop) cancelAnimationFrame(loop);
  loop = 0;
}

function bindStream(next: MediaStream) {
  stream = next;
  const video = ensureCamera();
  if (!video) return;
  video.srcObject = next;
  void video.play().catch(() => undefined);
  for (const node of raws) {
    node.srcObject = next;
    void node.play().catch(() => undefined);
  }
  startLoop();
}

export function bindRaw(node: HTMLVideoElement) {
  raws.add(node);
  if (stream) {
    node.srcObject = stream;
    void node.play().catch(() => undefined);
  }
}

export function unbindRaw(node: HTMLVideoElement) {
  raws.delete(node);
}

export function bindCanvas(node: HTMLCanvasElement) {
  canvases.add(node);
  startLoop();
}

export function unbindCanvas(node: HTMLCanvasElement) {
  canvases.delete(node);
}

export async function openCamera(options: { deviceId?: string; facing?: "user" | "environment"; phone: boolean; mic: boolean }) {
  emit({ error: null });
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  mirror = options.facing !== "environment";
  const videoConstraints: MediaTrackConstraints = options.phone
    ? { facingMode: options.facing ?? "user", width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } }
    : {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      };
  try {
    let next: MediaStream;
    try {
      next = await navigator.mediaDevices.getUserMedia({
        audio: options.mic ? { echoCancellation: true, noiseSuppression: true } : false,
        video: videoConstraints,
      });
    } catch {
      if (!options.mic) throw new Error("camera");
      next = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      emit({ mic: "blocked" });
    }
    bindStream(next);
    emit({
      live: true,
      mic: next.getAudioTracks().length ? "on" : options.mic ? "blocked" : "off",
      error: null,
      mirror,
    });
  } catch {
    emit({ live: false, error: "The camera did not open. Allow it, then try again." });
  }
}

export function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (cameraEl) cameraEl.srcObject = null;
  for (const node of raws) node.srcObject = null;
  if (!clipEl) stopLoop();
  emit({ live: false, mic: "off", fps: 0 });
}

export function toggleMic() {
  const track = stream?.getAudioTracks()[0];
  if (!track) return false;
  track.enabled = !track.enabled;
  emit({ mic: track.enabled ? "on" : "off" });
  return track.enabled;
}

export function cameraStream(): MediaStream | null {
  return stream;
}

export function applyLook(id: Exclude<LookId, "custom">) {
  const look = LOOKS.find((item) => item.id === id) ?? LOOKS[0];
  grade = look.grade;
  emit({ lookId: look.id, stillName: "" });
}

export function applyPrompt(text: string) {
  const clean = text.trim().slice(0, 280);
  grade = gradeFromPrompt(clean);
  emit({ prompt: clean, lookId: "custom", stillName: "" });
}

export function gradeFromPrompt(text: string): Grade {
  const value = text.toLowerCase();
  const named = LOOKS.find((item) => value.includes(item.label.toLowerCase()));
  if (named && value.length < 24) return named.grade;
  let next: Grade = { ...CLEAN };
  if (/warm|sun|gold|field|linen|afternoon/.test(value)) next = { ...LOOKS[3].grade };
  else if (/night|neon|rain|blue|street/.test(value)) next = { ...LOOKS[1].grade };
  else if (/ivory|studio|white|editorial/.test(value)) next = { ...LOOKS[2].grade };
  else if (/ink|noir|drawn|flat|mono/.test(value)) next = { ...LOOKS[4].grade };
  if (/soft|dream|haze|gentle/.test(value)) next = { ...next, contrast: 0.94, grain: 0.02, vignette: 0.12 };
  if (/harsh|hard|contrast/.test(value)) next = { ...next, contrast: Math.max(next.contrast, 1.28) };
  if (/clean|natural|none/.test(value) && !/night|ink|field|ivory/.test(value)) next = { ...CLEAN };
  return next;
}

export async function applyStill(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = 8;
    sample.height = 8;
    const ctx = sample.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const count = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    const warmth = Math.max(-0.6, Math.min(0.6, (r - b) / 280));
    grade = {
      ...CLEAN,
      contrast: 1.06,
      saturate: 0.92,
      warmth,
      tint: `rgb(${r}, ${g}, ${b})`,
      tintAlpha: 0.34,
      vignette: 0.18,
    };
    emit({ lookId: "custom", stillName: file.name, prompt: "" });
  } catch {
    emit({ error: "That picture could not set a look." });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function applyClip(file: File) {
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipEl?.pause();
  clipUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = clipUrl;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  void video.play().catch(() => undefined);
  clipEl = video;
  startLoop();
  emit({ clipName: file.name, error: null });
}

export function clearClip() {
  clipEl?.pause();
  clipEl = null;
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = null;
  if (!stream) stopLoop();
  emit({ clipName: "" });
}
