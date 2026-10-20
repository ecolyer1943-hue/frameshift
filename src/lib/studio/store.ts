import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CameraId, SampleId } from "@/lib/studio/presets";
import type {
  AspectRatio,
  DurationSec,
  FrameSource,
  Job,
  ModelTier,
  Resolution,
  StudioMode,
} from "@/lib/studio/types";

type StudioState = {
  view: "studio" | "library" | "live" | "meet";
  mode: StudioMode;
  prompt: string;
  dialogue: string;
  camera: CameraId;
  duration: DurationSec;
  aspect: AspectRatio;
  resolution: Resolution;
  model: ModelTier;
  audio: boolean;
  holdSubject: boolean;
  holdSetting: boolean;
  voice: { name: string; dataUrl: string } | null;
  frame: FrameSource | null;
  endFrame: FrameSource | null;
  character: FrameSource | null;
  people: FrameSource[];
  sampleId: SampleId | null;
  jobs: Job[];
  activeId: string | null;
  busy: boolean;
  hint: boolean;
  notice: string | null;
  setView: (view: "studio" | "library" | "live" | "meet") => void;
  patch: (partial: Partial<StudioState>) => void;
  setFrame: (frame: FrameSource | null) => void;
  setEndFrame: (frame: FrameSource | null) => void;
  setVoice: (voice: { name: string; dataUrl: string } | null) => void;
  setCharacter: (frame: FrameSource | null) => void;
  setPeople: (people: FrameSource[]) => void;
  upsertJob: (job: Job) => void;
  patchJob: (id: string, partial: Partial<Job>) => void;
  removeJob: (id: string) => void;
  dismissHint: () => void;
};

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      view: "studio",
      mode: "recast",
      prompt:
        "She walks two steps toward the camera, stops, and looks back over her shoulder. Wet night street, one blue neon sign, long black coat.",
      dialogue: "",
      camera: "push",
      duration: 6,
      aspect: "16:9",
      resolution: "1080p",
      model: "quality",
      audio: true,
      holdSubject: true,
      holdSetting: true,
      voice: null,
      frame: null,
      endFrame: null,
      character: null,
      people: [],
      sampleId: "night",
      jobs: [],
      activeId: null,
      busy: false,
      hint: true,
      notice: null,
      setView: (view) => set({ view }),
      patch: (partial) => set(partial),
      setFrame: (frame) => set({ frame, sampleId: frame?.sampleId ?? null }),
      setEndFrame: (endFrame) => set({ endFrame }),
      setVoice: (voice) => set({ voice }),
      setCharacter: (character) => set({ character, people: character ? [character] : [] }),
      setPeople: (people) => set({ people: people.slice(0, 3), character: people[0] ?? null }),
      upsertJob: (job) =>
        set((state) => ({
          jobs: [{ ...job, updatedAt: Date.now() }, ...state.jobs.filter((item) => item.id !== job.id)].slice(0, 16),
          activeId: job.id,
        })),
      patchJob: (id, partial) =>
        set((state) => ({
          jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...partial, updatedAt: Date.now() } : job)),
        })),
      removeJob: (id) =>
        set((state) => {
          const jobs = state.jobs.filter((job) => job.id !== id);
          return {
            jobs,
            activeId: state.activeId === id ? (jobs[0]?.id ?? null) : state.activeId,
          };
        }),
      dismissHint: () => set({ hint: false }),
    }),
    {
      name: "frameshift-v1",
      version: 4,
      skipHydration: true,
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") return persisted as StudioState;
        const state = persisted as {
          model?: string;
          resolution?: string;
          jobs?: { upscale?: string | null }[];
        };
        state.model = "quality";
        state.resolution = "1080p";
        if (Array.isArray(state.jobs)) {
          for (const job of state.jobs) {
            if (job.upscale !== "working" && job.upscale !== "done" && job.upscale !== "failed") job.upscale = null;
          }
        }
        return persisted as StudioState;
      },
      partialize: (state) => ({
        view: state.view,
        mode: state.mode,
        prompt: state.prompt,
        dialogue: state.dialogue,
        camera: state.camera,
        duration: state.duration,
        aspect: state.aspect,
        resolution: state.resolution,
        model: state.model,
        audio: state.audio,
        holdSubject: state.holdSubject,
        holdSetting: state.holdSetting,
        sampleId: state.sampleId,
        jobs: state.jobs,
        activeId: state.activeId,
        hint: state.hint,
      }),
    },
  ),
);

export function activeJob(state: Pick<StudioState, "jobs" | "activeId">): Job | null {
  return state.jobs.find((job) => job.id === state.activeId) ?? state.jobs[0] ?? null;
}
