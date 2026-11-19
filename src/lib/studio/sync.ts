import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import type { Job } from "@/lib/studio/types";
import { isMissingFile, mergePushedState, parseCode, parseDevice, parseWorkspace, serial, touchDevices, type FieldClock, type Tombstone } from "@/lib/studio/sync-merge";
import { storeDataUrl } from "@/lib/studio/blob-store";

const DIR = path.resolve("data/workspaces");

export type SyncDevice = {
  id: string;
  platform: string;
  label: string;
  seen: number;
};

export type SyncState = {
  mode: string;
  prompt: string;
  dialogue: string;
  camera: string;
  duration: number;
  aspect: string;
  resolution: string;
  model: string;
  audio: boolean;
  holdSubject: boolean;
  holdSetting: boolean;
  sampleId: string | null;
  jobs: Job[];
  activeId: string | null;
  hint: boolean;
  removed?: Array<string | Tombstone>;
  restored?: string[];
  clocks?: FieldClock;
  frame?: { name: string; sampleId: string | null; ref: string } | null;
  people?: { name: string; sampleId: string | null; ref: string }[];
};

type Workspace = {
  code: string;
  revision: number;
  updatedAt: number;
  state: SyncState | null;
  devices: SyncDevice[];
};

function empty(): SyncState {
  return {
    mode: "recast",
    prompt: "",
    dialogue: "",
    camera: "drift",
    duration: 6,
    aspect: "16:9",
    resolution: "1080p",
    model: "quality",
    audio: true,
    holdSubject: true,
    holdSetting: true,
    sampleId: "night",
    jobs: [],
    activeId: null,
    hint: true,
    removed: [],
  };
}

function fileFor(code: string): string {
  return path.join(DIR, `${code}.json`);
}

async function load(code: string): Promise<Workspace> {
  let raw: string;
  try {
    raw = await readFile(fileFor(code), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { code, revision: 0, updatedAt: 0, state: null, devices: [] };
    throw error;
  }
  const parsed = parseWorkspace<Workspace>(raw);
  parsed.code = code;
  return parsed;
}

async function save(workspace: Workspace): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const file = fileFor(workspace.code);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(workspace));
  await rename(tmp, file);
}

async function packRef(value: string): Promise<string> {
  if (!value.startsWith("data:") || value.length < 512) return value;
  return storeDataUrl(value);
}

async function packState(state: SyncState): Promise<SyncState> {
  const jobs = [];
  for (const job of state.jobs) {
    const poster = job.poster?.startsWith("data:") ? await packRef(job.poster) : job.poster;
    const videoUrl = job.videoUrl?.startsWith("data:") ? await packRef(job.videoUrl) : job.videoUrl;
    jobs.push({ ...job, poster: poster || null, videoUrl: videoUrl || null });
  }
  let frame = state.frame ?? null;
  if (frame?.ref.startsWith("data:")) {
    const ref = await packRef(frame.ref);
    frame = ref ? { ...frame, ref } : null;
  }
  const people = [];
  for (const person of state.people ?? []) {
    const ref = person.ref.startsWith("data:") ? await packRef(person.ref) : person.ref;
    if (ref) people.push({ ...person, ref });
  }
  return { ...state, jobs, frame, people };
}

export const syncPull = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
    return { code: parseCode(record?.code), device: parseDevice(record?.device) };
  })
  .handler(async ({ data }) => {
    return serial(data.code, async () => {
      const workspace = await load(data.code);
      workspace.devices = touchDevices(workspace.devices, data.device, Date.now());
      await save(workspace);
      return {
        ok: true as const,
        revision: workspace.revision,
        updatedAt: workspace.updatedAt,
        state: workspace.state,
        devices: workspace.devices,
      };
    });
  });

export const syncPush = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
    const state = record?.state && typeof record.state === "object" ? (record.state as SyncState) : null;
    if (!state || !Array.isArray(state.jobs)) throw new Error("Nothing to sync.");
    return { code: parseCode(record?.code), device: parseDevice(record?.device), state };
  })
  .handler(async ({ data }) => {
    const state = await packState(data.state);
    return serial(data.code, async () => {
      const workspace = await load(data.code);
      workspace.state = mergePushedState(workspace.state, state);
      workspace.revision += 1;
      workspace.updatedAt = Date.now();
      workspace.devices = touchDevices(workspace.devices, data.device, Date.now());
      const encoded = JSON.stringify(workspace);
      if (encoded.length > 1_800_000) {
        workspace.state.jobs = workspace.state.jobs.map((job) => ({ ...job, poster: null }));
      }
      await save(workspace);
      return {
        ok: true as const,
        revision: workspace.revision,
        updatedAt: workspace.updatedAt,
        state: workspace.state,
        devices: workspace.devices,
      };
    });
  });
