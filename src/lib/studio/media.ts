import { previewPathPrefix } from "@/lib/preview-path-prefix";

export async function fileToJpegDataUrl(file: File, maxEdge = 1024, quality = 0.84): Promise<string> {
  const bitmap = await createImageBitmap(file);
  return bitmapToJpeg(bitmap, maxEdge, quality);
}

export async function shrinkDataUrl(dataUrl: string, maxEdge: number, quality: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  return bitmapToJpeg(bitmap, maxEdge, quality);
}

function bitmapToJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare that image.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export function apiPath(path: string): string {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}

export function clipSrc(videoUrl: string): string {
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  if (videoUrl.startsWith("/") && !videoUrl.startsWith("//")) {
    return videoUrl.startsWith(`${prefix}/`) || videoUrl === prefix ? videoUrl : `${prefix}${videoUrl}`;
  }
  return `${prefix}/api/clip?u=${encodeURIComponent(videoUrl)}`;
}

export async function videoFirstFrame(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await loadVideo(video, url);
    return drawVideo(video);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function drawVideo(video: HTMLVideoElement): string {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1024 / Math.max(video.videoWidth || 2, video.videoHeight || 2));
  canvas.width = Math.max(2, Math.round((video.videoWidth || 2) * scale));
  canvas.height = Math.max(2, Math.round((video.videoHeight || 2) * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read that clip.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function loadVideo(video: HTMLVideoElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 15_000);
    const ready = () => {
      if (video.videoWidth < 2) return;
      window.clearTimeout(timer);
      video.onloadeddata = null;
      video.onseeked = null;
      resolve();
    };
    video.onloadeddata = () => {
      if (video.videoWidth >= 2) ready();
      else video.currentTime = Math.min(0.05, Number.isFinite(video.duration) ? video.duration / 2 : 0.05);
    };
    video.onseeked = ready;
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("load"));
    };
    video.src = src;
  });
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 10_000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("seek"));
    };
    video.currentTime = time;
  });
}

export async function videoUrlFrame(src: string): Promise<string> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await loadVideo(video, src);
    return drawVideo(video);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export async function videoFileFrames(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await loadVideo(video, url);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const times = duration > 0.4 ? [duration * 0.12, duration * 0.5, Math.max(duration - 0.12, 0)] : [0];
    const frames: string[] = [];
    for (const time of times) {
      if (time > 0) await seekVideo(video, time);
      frames.push(drawVideo(video));
    }
    return frames.slice(0, 3);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function videoLastFrame(videoUrl: string): Promise<string> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await loadVideo(video, clipSrc(videoUrl));
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.08) : 0;
    if (end > 0) await seekVideo(video, end);
    return drawVideo(video);
  } catch {
    throw new Error("Could not read the end of that clip.");
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
