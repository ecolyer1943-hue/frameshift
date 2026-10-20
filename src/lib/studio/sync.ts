import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServerFn } from "@tanstack/react-start";
import type { Job } from "@/lib/studio/types";

const DIR = path.resolve("data/workspaces");
const CODE = /^[a-z0-9]{6,12}$/;
const STALE = 45_000;

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
  };
}

function fileFor(code: string): string {
  return path.join(DIR, `${code}.json`);
}

async function load(code: string): Promise<Workspace> {
  try {
    const raw = await readFile(fileFor(code), "utf8");
    const parsed = JSON.parse(raw) as Workspace;
    if (!parsed || typeof parsed !== "object") throw new Error("bad");
    return parsed;
  } catch {
    return { code, revision: 0, updatedAt: 0, state: null, devices: [] };
  }
}

async function save(workspace: Workspace): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(fileFor(workspace.code), JSON.stringify(workspace));
}

function fresh(devices: SyncDevice[]): SyncDevice[] {
  const now = Date.now();
  return devices.filter((device) => now - device.seen < STALE * 4).slice(0, 8);
}

function touch(devices: SyncDevice[], device: SyncDevice): SyncDevice[] {
  const next = devices.filter((item) => item.id !== device.id);
  next.unshift({ ...device, seen: Date.now() });
  return fresh(next);
}

function jobTime(job: Job): number {
  return Math.max(job.updatedAt ?? 0, job.createdAt ?? 0);
}

function mergeJobs(local: Job[], remote: Job[]) {
  const map = new Map<string, Job>();
  for (const job of remote) map.set(job.id, job);
  for (const job of local) {
    const existing = map.get(job.id);
    if (!existing || jobTime(job) >= jobTime(existing)) map.set(job.id, job);
  }
  return [...map.values()].sort((a, b) => jobTime(b) - jobTime(a)).slice(0, 16);
}

function parseCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!CODE.test(code)) throw new Error("That workspace code is not valid.");
  return code;
}

function parseDevice(value: unknown): SyncDevice {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const id = typeof record?.id === "string" ? record.id.slice(0, 40) : "";
  if (!id) throw new Error("This device has no id.");
  return {
    id,
    platform: typeof record?.platform === "string" ? record.platform.slice(0, 16) : "web",
    label: typeof record?.label === "string" ? record.label.slice(0, 24) : "Web",
    seen: Date.now(),
  };
}

function slim(state: SyncState): SyncState {
  const jobs = state.jobs.map((job) => (job.poster && job.poster.length > 120_000 ? { ...job, poster: null } : job));
  return { ...state, jobs };
}

export const syncPull = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
    return { code: parseCode(record?.code), device: parseDevice(record?.device) };
  })
  .handler(async ({ data }) => {
    const workspace = await load(data.code);
    workspace.devices = touch(workspace.devices, data.device);
    await save(workspace);
    return {
      ok: true as const,
      revision: workspace.revision,
      updatedAt: workspace.updatedAt,
      state: workspace.state,
      devices: fresh(workspace.devices),
    };
  });

export const syncPush = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
    const state = record?.state && typeof record.state === "object" ? (record.state as SyncState) : null;
    if (!state || !Array.isArray(state.jobs)) throw new Error("Nothing to sync.");
    return { code: parseCode(record?.code), device: parseDevice(record?.device), state: slim(state) };
  })
  .handler(async ({ data }) => {
    const workspace = await load(data.code);
    const merged = mergeJobs(data.state.jobs, workspace.state?.jobs ?? []);
    workspace.state = { ...data.state, jobs: merged };
    workspace.revision += 1;
    workspace.updatedAt = Date.now();
    workspace.devices = touch(workspace.devices, data.device);
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
      devices: fresh(workspace.devices),
    };
  });
