import type { CameraId, SampleId } from "@/lib/studio/presets";

export type StudioMode = "animate" | "prompt" | "recast";
export type ModelTier = "lite" | "quality";
export type DurationSec = 4 | 6 | 8 | 10 | 15;
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Resolution = "480p" | "720p" | "1080p";
export type JobStatus = "submitting" | "queued" | "rendering" | "done" | "failed";

export type FrameSource = {
  name: string;
  dataUrl: string;
  sampleId: SampleId | null;
};

export type JobKind = "regen" | "extend";

export type Job = {
  id: string;
  createdAt: number;
  kind: JobKind;
  mode: StudioMode;
  prompt: string;
  dialogue: string;
  camera: CameraId;
  duration: DurationSec;
  aspect: AspectRatio;
  resolution: Resolution;
  model: ModelTier;
  audio: boolean;
  poster: string | null;
  videoUrl: string | null;
  upscale: "working" | "done" | "failed" | null;
  status: JobStatus;
  error: string | null;
  requestId: string | null;
  sampleId: SampleId | null;
  parentId?: string | null;
  parts?: number;
  seconds?: number;
  pieceUrls?: string[];
  source?: "copy";
  updatedAt?: number;
};

export type StartPayload = {
  prompt: string;
  dialogue: string;
  camera: CameraId;
  duration: DurationSec;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  model: ModelTier;
  audio: boolean;
  imageDataUrl: string | null;
  endImageDataUrl: string | null;
  holdSubject: boolean;
  holdSetting: boolean;
  continuation?: boolean;
};
