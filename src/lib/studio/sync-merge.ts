export type MergeJob = { id: string; updatedAt?: number; createdAt?: number };

export type MergeDevice = { id: string; platform: string; label: string; seen: number };

export type Tombstone = { id: string; at: number };

export const SYNC_FIELDS = [
  "mode",
  "prompt",
  "dialogue",
  "camera",
  "duration",
  "aspect",
  "resolution",
  "model",
  "audio",
  "holdSubject",
  "holdSetting",
  "sampleId",
  "activeId",
  "hint",
  "frame",
  "people",
] as const;

export type SyncField = (typeof SYNC_FIELDS)[number];
export type FieldClock = Partial<Record<SyncField, number>>;

export const DEVICE_TTL_MS = 180_000;
export const REMOVED_CAP = 64;

function withMedia<T extends MergeJob>(winner: T, other?: T): T {
  if (!other) return winner;
  const kept = winner as T & { poster?: string | null; videoUrl?: string | null };
  const spare = other as T & { poster?: string | null; videoUrl?: string | null };
  const poster = kept.poster ? kept.poster : spare.poster;
  const videoUrl = kept.videoUrl ? kept.videoUrl : spare.videoUrl;
  if (poster === kept.poster && videoUrl === kept.videoUrl) return winner;
  return { ...winner, poster, videoUrl };
}

export function jobTime(job: MergeJob): number {
  return Math.max(job.updatedAt ?? 0, job.createdAt ?? 0);
}

export function mergeJobs<T extends MergeJob>(local: T[], remote: T[]): T[] {
  const map = new Map<string, T>();
  for (const job of remote) if (job?.id) map.set(job.id, withMedia(job, map.get(job.id)));
  for (const job of local) {
    if (!job?.id) continue;
    const existing = map.get(job.id);
    if (!existing || jobTime(job) >= jobTime(existing)) map.set(job.id, withMedia(job, existing));
    else map.set(job.id, withMedia(existing, job));
  }
  return [...map.values()].sort((a, b) => jobTime(b) - jobTime(a) || a.id.localeCompare(b.id));
}

export function tombstones(value: unknown): Tombstone[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, number>();
  for (const item of value) {
    if (typeof item === "string") {
      if (!item) continue;
      if (!map.has(item)) map.set(item, 0);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !id) continue;
    const atRaw = (item as { at?: unknown }).at;
    const at = typeof atRaw === "number" && Number.isFinite(atRaw) ? atRaw : 0;
    const prev = map.get(id);
    if (prev === undefined || at >= prev) map.set(id, at);
  }
  return [...map.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .slice(0, REMOVED_CAP);
}

export function mergeRemoved(previous?: unknown, incoming?: unknown): Tombstone[] {
  return tombstones([...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

export function mergeClocks(previous?: FieldClock | null, incoming?: FieldClock | null): FieldClock {
  const clocks: FieldClock = {};
  for (const field of SYNC_FIELDS) {
    const at = Math.max(previous?.[field] ?? 0, incoming?.[field] ?? 0);
    if (at > 0) clocks[field] = at;
  }
  return clocks;
}

export function mergePushedState<
  T extends MergeJob,
  S extends {
    jobs: T[];
    removed?: unknown;
    clocks?: FieldClock;
    restored?: string[];
    activeId?: string | null;
  },
>(previous: S | null, incoming: S): S & { removed: Tombstone[]; clocks: FieldClock; restored: string[] } {
  const removed = mergeRemoved(previous?.removed, incoming.removed);
  const tomb = new Map(removed.map((item) => [item.id, item.at]));
  const restored = new Set((incoming.restored ?? []).filter((id) => typeof id === "string" && id));
  const jobs = mergeJobs(incoming.jobs ?? [], previous?.jobs ?? [])
    .filter((job) => {
      const at = tomb.get(job.id);
      if (at === undefined) return true;
      return jobTime(job) > at && restored.has(job.id);
    })
    .slice(0, 16);
  const keptRemoved = removed.filter((item) => !jobs.some((job) => job.id === item.id));
  const clocks = mergeClocks(previous?.clocks, incoming.clocks);
  const next = { ...incoming, jobs, removed: keptRemoved, clocks, restored: [] as string[] };
  if (previous) {
    const prior = previous as Record<string, unknown>;
    const chosen = next as Record<string, unknown>;
    for (const field of SYNC_FIELDS) {
      if ((incoming.clocks?.[field] ?? 0) < (previous.clocks?.[field] ?? 0)) chosen[field] = prior[field];
    }
  }
  if (next.activeId && !jobs.some((job) => job.id === next.activeId)) next.activeId = jobs[0]?.id ?? null;
  return next;
}

export function freshDevices<T extends { seen: number }>(devices: T[], now: number, limit = 8): T[] {
  return devices.filter((device) => now - device.seen < DEVICE_TTL_MS).slice(0, limit);
}

export function touchDevices<T extends MergeDevice>(devices: T[], device: T, now: number): T[] {
  const next = devices.filter((item) => item.id !== device.id);
  next.unshift({ ...device, seen: now });
  return freshDevices(next, now);
}

export function parseCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9]{6,12}$/.test(code)) throw new Error("That workspace code is not valid.");
  return code;
}

export function parseDevice(value: unknown, now = Date.now()): MergeDevice {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const id = typeof record?.id === "string" ? record.id.slice(0, 40) : "";
  if (!id) throw new Error("This device has no id.");
  return {
    id,
    platform: typeof record?.platform === "string" ? record.platform.slice(0, 16) : "web",
    label: typeof record?.label === "string" ? record.label.slice(0, 24) : "Web",
    seen: now,
  };
}

export function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

export function parseWorkspace<T>(raw: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Workspace file is damaged.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { devices?: unknown }).devices)) {
    throw new Error("Workspace file is damaged.");
  }
  return parsed as T;
}

export function acceptRemote(input: {
  code: string;
  pullCode: string;
  dirty: boolean;
  pushing: boolean;
  revAtStart: number;
  localRev: number;
  hasState: boolean;
}): boolean {
  return Boolean(
    input.pullCode &&
      input.code === input.pullCode &&
      !input.dirty &&
      !input.pushing &&
      input.localRev === input.revAtStart &&
      input.hasState,
  );
}

const chains = new Map<string, Promise<void>>();

export function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(job, job);
  chains.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
