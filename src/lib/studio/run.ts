import { draftStill, pollVideo, recastVideo, startVideo, transcribeVoice } from "@/lib/studio/generate";
import { joinVideos } from "@/lib/studio/join";
import { shrinkDataUrl, videoLastFrame } from "@/lib/studio/media";
import { SAMPLES } from "@/lib/studio/presets";
import { upscaleVideo } from "@/lib/studio/upscale";
import { activeJob, useStudio } from "@/lib/studio/store";
import type { Job } from "@/lib/studio/types";

async function finishUpscale(id: string, videoUrl: string, voice: string | null) {
  let piece = videoUrl;
  let upscale: Job["upscale"] = "failed";
  try {
    const result = await upscaleVideo({ data: { id, videoUrl, audioDataUrl: voice } });
    if (result.ok) {
      piece = result.url;
      upscale = "done";
    }
  } catch {
    upscale = "failed";
  }

  const job = useStudio.getState().jobs.find((item) => item.id === id);
  const parent = job?.parentId ? useStudio.getState().jobs.find((item) => item.id === job.parentId) : null;
  if (!parent?.videoUrl) {
    useStudio.getState().patchJob(id, { upscale, videoUrl: piece });
    return;
  }

  const pieceUrls = [...(parent.pieceUrls?.length ? parent.pieceUrls : [parent.videoUrl]), piece];
  useStudio.getState().patchJob(id, { upscale: "working", pieceUrls });
  useStudio.getState().patch({ notice: "Joining the next 15 seconds onto the video." });
  try {
    const joined = await joinVideos({ data: { id: crypto.randomUUID(), urls: [parent.videoUrl, piece] } });
    if (!joined.ok) {
      useStudio.getState().patchJob(id, { upscale, videoUrl: piece, pieceUrls });
      useStudio.getState().patch({ notice: "The next piece is ready, but it stayed separate. Play the pieces in order." });
      return;
    }
    useStudio.getState().patchJob(id, { upscale: "done", videoUrl: joined.url, pieceUrls });
    useStudio.getState().patch({ notice: null });
  } catch {
    useStudio.getState().patchJob(id, { upscale, videoUrl: piece, pieceUrls });
    useStudio.getState().patch({ notice: "The next piece is ready, but it stayed separate. Play the pieces in order." });
  }
}

function fail(id: string, error: string) {
  useStudio.getState().patchJob(id, { status: "failed", error });
  useStudio.getState().patch({ busy: false, notice: error });
}

async function watch(id: string, requestId: string, voice: string | null) {
  useStudio.getState().patchJob(id, { requestId, status: "queued" });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(attempt === 0 ? 2500 : 5000);
    let polled: Awaited<ReturnType<typeof pollVideo>> | null = null;
    try {
      polled = await pollVideo({ data: { requestId } });
    } catch {
      polled = null;
    }
    if (!polled) continue;
    if (!polled.ok) {
      fail(id, polled.error);
      return;
    }
    if (polled.status === "done" && polled.videoUrl) {
      useStudio.getState().patchJob(id, { status: "done", videoUrl: polled.videoUrl, error: null, upscale: "working" });
      useStudio.getState().patch({ busy: false, notice: null });
      void finishUpscale(id, polled.videoUrl, voice);
      return;
    }
    useStudio.getState().patchJob(id, { status: polled.status === "queued" ? "queued" : "rendering" });
  }
  fail(id, "This render is taking longer than expected. Try that shot again.");
}

async function spokenLine(): Promise<{ dialogue: string; voice: string | null }> {
  const state = useStudio.getState();
  const voice = state.voice?.dataUrl ?? null;
  const typed = state.dialogue.trim();
  if (typed || !voice) return { dialogue: typed, voice };
  try {
    const heard = await transcribeVoice({ data: { audioDataUrl: voice } });
    if (heard.ok && heard.text) {
      useStudio.getState().patch({ dialogue: heard.text, audio: true });
      return { dialogue: heard.text, voice };
    }
  } catch {
    return { dialogue: "", voice };
  }
  return { dialogue: "", voice };
}

export async function runRegen() {
  const state = useStudio.getState();
  if (state.busy) return;
  const prompt = state.prompt.trim();
  if (prompt.length < 8) {
    useStudio.getState().patch({ notice: "Describe the motion in a sentence or two." });
    return;
  }
  if (state.mode === "animate" && !state.frame) {
    useStudio.getState().patch({ notice: "Add a start frame. Regen keeps that photograph as frame one." });
    return;
  }

  useStudio.getState().patch({ busy: true, notice: null });
  const speech = await spokenLine();
  const id = crypto.randomUUID();
  let poster: string | null = null;
  if (state.frame) {
    try {
      poster = await shrinkDataUrl(state.frame.dataUrl, 480, 0.62);
    } catch {
      poster = null;
    }
  }

  const job: Job = {
    id,
    createdAt: Date.now(),
    kind: "regen",
    mode: state.mode,
    prompt,
    dialogue: speech.dialogue,
    camera: state.camera,
    duration: state.duration,
    aspect: state.aspect,
    resolution: "1080p",
    model: "quality",
    audio: state.audio || Boolean(speech.dialogue || speech.voice),
    poster,
    videoUrl: null,
    upscale: null,
    status: "submitting",
    error: null,
    requestId: null,
    sampleId: state.frame?.sampleId ?? null,
  };

  useStudio.getState().upsertJob(job);
  useStudio.getState().patch({ busy: true, notice: null, view: "studio" });

  let started: Awaited<ReturnType<typeof startVideo>>;
  try {
    started = await startVideo({
      data: {
        prompt,
        dialogue: speech.dialogue,
        camera: state.camera,
        duration: state.duration,
        aspectRatio: state.aspect,
        resolution: "1080p",
        model: "quality",
        audio: state.audio || Boolean(speech.dialogue || speech.voice),
        imageDataUrl: state.mode === "animate" ? (state.frame?.dataUrl ?? null) : null,
        endImageDataUrl: state.mode === "animate" ? (state.endFrame?.dataUrl ?? null) : null,
        holdSubject: state.holdSubject,
        holdSetting: state.holdSetting,
      },
    });
  } catch (error) {
    fail(id, error instanceof Error ? error.message : "Could not start that shot.");
    return;
  }

  if (!started.ok) {
    fail(id, started.error);
    return;
  }

  await watch(id, started.requestId, speech.voice);
}

export async function runRecast() {
  const state = useStudio.getState();
  if (state.busy) return;
  const prompt = state.prompt.trim();
  if (!state.frame) {
    useStudio.getState().patch({ notice: "Add a scene that already shows the person to replace." });
    return;
  }
  if (!state.people.length) {
    useStudio.getState().patch({ notice: "Add photos, or a video, of the person to swap in." });
    return;
  }
  if (prompt.length < 8) {
    useStudio.getState().patch({ notice: "Describe how the character should move." });
    return;
  }

  useStudio.getState().patch({ busy: true, notice: null });
  const speech = await spokenLine();
  const id = crypto.randomUUID();
  let poster: string | null = null;
  try {
    poster = await shrinkDataUrl(state.frame.dataUrl, 480, 0.62);
  } catch {
    poster = null;
  }
  const job: Job = {
    id,
    createdAt: Date.now(),
    kind: "regen",
    mode: "recast",
    prompt,
    dialogue: speech.dialogue,
    camera: state.camera,
    duration: state.duration,
    aspect: state.aspect,
    resolution: "1080p",
    model: "quality",
    audio: state.audio || Boolean(speech.dialogue || speech.voice),
    poster,
    videoUrl: null,
    upscale: null,
    status: "submitting",
    error: null,
    requestId: null,
    sampleId: state.frame.sampleId,
  };
  useStudio.getState().upsertJob(job);
  useStudio.getState().patch({ busy: true, notice: null, view: "studio" });

  let started: Awaited<ReturnType<typeof recastVideo>>;
  try {
    started = await recastVideo({
      data: {
        prompt,
        dialogue: speech.dialogue,
        camera: state.camera,
        duration: state.duration,
        sceneDataUrl: state.frame.dataUrl,
        characterDataUrls: state.people.map((person) => person.dataUrl),
        resolution: "1080p",
        holdSubject: state.holdSubject,
        holdSetting: state.holdSetting,
        audio: state.audio || Boolean(speech.dialogue || speech.voice),
      },
    });
  } catch (error) {
    fail(id, error instanceof Error ? error.message : "Could not recast that scene.");
    return;
  }
  if (!started.ok) {
    fail(id, started.error);
    return;
  }
  if (started.poster) {
    try {
      const small = await shrinkDataUrl(started.poster, 480, 0.62);
      useStudio.getState().patchJob(id, { poster: small });
    } catch {
      useStudio.getState().patchJob(id, { poster: started.poster });
    }
  }
  await watch(id, started.requestId, speech.voice);
}

export async function runExtend() {
  const state = useStudio.getState();
  if (state.busy) return;
  const current = activeJob(state);
  if (!current?.videoUrl || current.status !== "done") {
    useStudio.getState().patch({ notice: "Finish a clip before extending it." });
    return;
  }
  if ((current.parts ?? 1) >= 8) {
    useStudio.getState().patch({ notice: "Eight pieces is the longest cut. That is two minutes." });
    return;
  }
  const prompt = state.prompt.trim();
  if (prompt.length < 8) {
    useStudio.getState().patch({ notice: "Describe what happens in the next 15 seconds." });
    return;
  }

  useStudio.getState().patch({ busy: true, notice: null });
  const speech = await spokenLine();
  const id = crypto.randomUUID();
  const job: Job = {
    id,
    createdAt: Date.now(),
    kind: "extend",
    mode: "animate",
    prompt,
    dialogue: speech.dialogue,
    camera: state.camera,
    duration: 15,
    aspect: state.aspect,
    resolution: "1080p",
    model: "quality",
    audio: state.audio || Boolean(speech.dialogue || speech.voice),
    poster: current.poster,
    videoUrl: null,
    upscale: null,
    status: "submitting",
    error: null,
    requestId: null,
    sampleId: current.sampleId,
    parentId: current.id,
    parts: (current.parts ?? 1) + 1,
    seconds: (current.seconds ?? current.duration) + 15,
  };
  useStudio.getState().upsertJob(job);
  useStudio.getState().patch({ busy: true, notice: null, view: "studio" });

  let started: Awaited<ReturnType<typeof startVideo>>;
  try {
    const frame = await videoLastFrame(current.videoUrl);
    useStudio.getState().patchJob(id, { poster: frame });
    started = await startVideo({
      data: {
        prompt,
        dialogue: speech.dialogue,
        camera: state.camera,
        duration: 15,
        aspectRatio: state.aspect,
        resolution: "1080p",
        model: "quality",
        audio: state.audio || Boolean(speech.dialogue || speech.voice),
        imageDataUrl: frame,
        endImageDataUrl: null,
        holdSubject: true,
        holdSetting: true,
        continuation: true,
      },
    });
  } catch (error) {
    fail(id, error instanceof Error ? error.message : "Could not extend that clip.");
    return;
  }
  if (!started.ok) {
    fail(id, started.error);
    return;
  }
  await watch(id, started.requestId, speech.voice);
}

export async function runDraftStill() {
  const state = useStudio.getState();
  if (state.busy) return;
  const prompt = state.prompt.trim();
  if (prompt.length < 8) {
    useStudio.getState().patch({ notice: "Describe the picture first, then draft the still." });
    return;
  }
  useStudio.getState().patch({ busy: true, notice: null, mode: "animate" });
  try {
    const drafted = await draftStill({ data: { prompt, aspectRatio: state.aspect } });
    if (!drafted.ok) {
      useStudio.getState().patch({ busy: false, notice: drafted.error });
      return;
    }
    const dataUrl = await shrinkDataUrl(drafted.dataUrl, 1024, 0.84);
    useStudio.getState().setFrame({ name: "Drafted still", dataUrl, sampleId: null });
    useStudio.getState().patch({ busy: false, notice: "Still is ready. Regen when the motion feels right." });
  } catch (error) {
    useStudio.getState().patch({
      busy: false,
      notice: error instanceof Error ? error.message : "Could not draft the still.",
    });
  }
}

export function applySample(sampleId: (typeof SAMPLES)[number]["id"]) {
  const sample = SAMPLES.find((item) => item.id === sampleId);
  if (!sample) return;
  useStudio.getState().patch({
    mode: "recast",
    prompt: sample.prompt,
    camera: sample.camera,
    sampleId: sample.id,
    notice: null,
    view: "studio",
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
