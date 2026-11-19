import { syncPull, syncPush, type SyncDevice, type SyncState } from "@/lib/studio/sync";
import { acceptRemote, SYNC_FIELDS, tombstones, type FieldClock } from "@/lib/studio/sync-merge";
import { detectPlatform, PLATFORMS } from "@/lib/studio/platforms";
import { useStudio } from "@/lib/studio/store";

const CODE_KEY = "frameshift-workspace";
const DEVICE_KEY = "frameshift-device";

export type SyncSnapshot = {
  code: string;
  devices: SyncDevice[];
  status: "syncing" | "synced" | "offline";
  settled: boolean;
};

type Listener = (snapshot: SyncSnapshot) => void;

const listeners = new Set<Listener>();
let snapshot: SyncSnapshot = { code: "", devices: [], status: "syncing", settled: false };
let started = false;
let dirty = false;
let applying = false;
let pushing = false;
let booting = true;
let bootId = 0;
let localRev = 0;
let timer: number | null = null;
let clocks: FieldClock = {};
let echoed: SyncState | null = null;

function emit() {
  for (const listener of listeners) listener(snapshot);
}

function setSnapshot(next: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

function device(): SyncDevice {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  const platform = detectPlatform();
  const label = PLATFORMS.find((item) => item.id === platform)?.label ?? "Web";
  return { id, platform, label, seen: Date.now() };
}

function codeFor(userId: string | null): string {
  if (userId && userId !== "dev-user") {
    let hash = 0;
    for (const char of userId) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
    const code = hash.toString(36).padStart(8, "0").slice(0, 8);
    localStorage.setItem(CODE_KEY, code);
    return code;
  }
  const saved = localStorage.getItem(CODE_KEY);
  if (saved && /^[a-z0-9]{6,12}$/.test(saved)) return saved;
  let hash = 0;
  for (const char of crypto.randomUUID()) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const code = hash.toString(36).padStart(8, "0").slice(0, 8);
  localStorage.setItem(CODE_KEY, code);
  return code;
}

function clockKey(code: string): string {
  return `frameshift-clocks:${code}`;
}

function loadClocks(code: string) {
  clocks = {};
  if (!code) return;
  try {
    const raw = localStorage.getItem(clockKey(code));
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (!parsed || typeof parsed !== "object") return;
    for (const field of SYNC_FIELDS) {
      const at = parsed[field];
      if (typeof at === "number" && Number.isFinite(at)) clocks[field] = at;
    }
  } catch {
    clocks = {};
  }
}

function saveClocks() {
  if (!snapshot.code) return;
  try {
    localStorage.setItem(clockKey(snapshot.code), JSON.stringify(clocks));
  } catch {
    /* The picture still syncs. A full disk must not throw. */
  }
}

function localIsNewer(server?: FieldClock | null): boolean {
  for (const field of SYNC_FIELDS) {
    if ((clocks[field] ?? 0) > (server?.[field] ?? 0)) return true;
  }
  return false;
}

function showMedia(ref: string): string {
  const match = /^media:([a-f0-9]{64})$/.exec(ref);
  return match ? `/api/media?id=${match[1]}` : ref;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, item) => {
    if (typeof item === "string" && item.length > 180) return `${item.slice(0, 48)}:${item.length}:${item.slice(-24)}`;
    return item;
  });
}

function snapshotState(): SyncState {
  const state = useStudio.getState();
  return {
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
    removed: state.removed ?? [],
    restored: state.restored ?? [],
    clocks: { ...clocks },
    frame: state.frame
      ? { name: state.frame.name, sampleId: state.frame.sampleId, ref: state.frame.dataUrl }
      : null,
    people: state.people.map((person) => ({ name: person.name, sampleId: person.sampleId, ref: person.dataUrl })),
  };
}

function apply(state: SyncState | null) {
  if (!state) return;
  applying = true;
  useStudio.getState().patch({
    mode: state.mode as "animate" | "prompt" | "recast",
    prompt: state.prompt,
    dialogue: state.dialogue,
    camera: state.camera as "hold" | "push" | "orbit" | "drift" | "rise" | "rack",
    duration: state.duration as 4 | 6 | 8 | 10 | 15,
    aspect: state.aspect as "16:9" | "9:16" | "1:1",
    resolution: "1080p",
    model: "quality",
    audio: state.audio,
    holdSubject: state.holdSubject,
    holdSetting: state.holdSetting,
    sampleId: (state.sampleId as "night" | "ink" | "ivory" | "field" | null) ?? null,
    jobs: jobsWithLive(state.jobs),
    activeId: state.activeId,
    hint: state.hint,
    removed: tombstones(state.removed),
    restored: [],
    ...(state.frame !== undefined
      ? {
          frame: state.frame?.ref
            ? {
                name: state.frame.name,
                dataUrl: showMedia(state.frame.ref),
                sampleId: (state.frame.sampleId as "night" | "ink" | "ivory" | "field" | null) ?? null,
              }
            : null,
        }
      : {}),
    ...(state.people
      ? {
          people: state.people.map((person) => ({
            name: person.name,
            dataUrl: showMedia(person.ref),
            sampleId: (person.sampleId as "night" | "ink" | "ivory" | "field" | null) ?? null,
          })),
          character: state.people[0]
            ? {
                name: state.people[0].name,
                dataUrl: showMedia(state.people[0].ref),
                sampleId: (state.people[0].sampleId as "night" | "ink" | "ivory" | "field" | null) ?? null,
              }
            : null,
        }
      : {}),
  });
  applying = false;
  clocks = { ...(state.clocks ?? {}) };
  echoed = snapshotState();
  saveClocks();
}

function jobsWithLive<T extends { id: string; status?: string }>(remote: T[]): T[] {
  const live = useStudio
    .getState()
    .jobs.filter((job) => job.status === "submitting" || job.status === "queued" || job.status === "rendering");
  if (!live.length) return remote;
  const kept = new Map(live.map((job) => [job.id, job as unknown as T]));
  const merged = remote.map((job) => kept.get(job.id) ?? job);
  for (const job of live) {
    if (!remote.some((item) => item.id === job.id)) merged.unshift(job as unknown as T);
  }
  return merged.slice(0, 16);
}

function finishBoot(state: SyncState | null, code: string, generation: number) {
  if (snapshot.code !== code || bootId !== generation || !booting) return;
  booting = false;
  const newer = state ? localIsNewer(state.clocks) : false;
  if (state && !dirty && !newer) apply(state);
  else if (dirty || newer) {
    dirty = true;
    schedulePush();
  }
  setSnapshot({ settled: true, status: snapshot.status === "offline" ? "offline" : "synced" });
}

async function pull() {
  const code = snapshot.code;
  const generation = bootId;
  const wasBooting = booting;
  if (!code || pushing) return;
  if (!wasBooting && dirty) return;
  const rev = localRev;
  try {
    const result = await syncPull({ data: { code, device: device() } });
    if (!result.ok) {
      if (wasBooting) finishBoot(null, code, generation);
      return;
    }
    if (snapshot.code !== code || bootId !== generation) return;
    setSnapshot({ devices: result.devices, status: "synced" });
    if (wasBooting) {
      finishBoot(result.state, code, generation);
      return;
    }
    if (
      !acceptRemote({
        code: snapshot.code,
        pullCode: code,
        dirty,
        pushing,
        revAtStart: rev,
        localRev,
        hasState: Boolean(result.state),
      })
    ) {
      return;
    }
    apply(result.state);
  } catch {
    if (snapshot.code !== code) return;
    setSnapshot({ status: "offline" });
    if (wasBooting) finishBoot(null, code, generation);
  }
}

function schedulePush() {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => void push(), 400);
}

async function push() {
  if (!snapshot.code || !dirty || pushing) return;
  pushing = true;
  const rev = localRev;
  dirty = false;
  setSnapshot({ status: "syncing" });
  try {
    const result = await syncPush({ data: { code: snapshot.code, device: device(), state: snapshotState() } });
    if (!result.ok) {
      dirty = true;
      return;
    }
    setSnapshot({ devices: result.devices, status: "synced" });
    if (localRev !== rev) {
      dirty = true;
      return;
    }
    if (result.state) apply(result.state);
  } catch {
    dirty = true;
    setSnapshot({ status: "offline" });
    if (!useStudio.getState().notice) {
      useStudio.getState().patch({ notice: "Offline. This device kept your last change." });
    }
  } finally {
    pushing = false;
    if (dirty) schedulePush();
  }
}

export function joinWorkspace(code: string) {
  const next = code.trim().toLowerCase();
  if (!/^[a-z0-9]{6,12}$/.test(next)) return false;
  localStorage.setItem(CODE_KEY, next);
  bootId += 1;
  booting = true;
  dirty = false;
  localRev += 1;
  if (timer) window.clearTimeout(timer);
  loadClocks(next);
  snapshot = { ...snapshot, code: next, status: "syncing", settled: false };
  emit();
  echoed = snapshotState();
  void pull();
  return true;
}

export function startSync(userId: string | null) {
  const code = codeFor(userId);
  const changed = snapshot.code !== code;
  if (changed) {
    bootId += 1;
    booting = true;
    dirty = false;
    if (timer) window.clearTimeout(timer);
    loadClocks(code);
    setSnapshot({ code, status: "syncing", settled: false });
  }
  if ((useStudio.getState().restored ?? []).length) dirty = true;
  if (started) {
    if (changed || booting) void pull();
    return;
  }
  started = true;
  if (!changed) loadClocks(code);
  echoed = snapshotState();
  useStudio.subscribe(() => {
    if (applying) return;
    const next = snapshotState();
    if (!echoed) {
      echoed = next;
      return;
    }
    const now = Date.now();
    let changedField = false;
    for (const field of SYNC_FIELDS) {
      if (fingerprint(echoed[field]) !== fingerprint(next[field])) {
        clocks[field] = now;
        changedField = true;
      }
    }
    if (!changedField) return;
    echoed = next;
    saveClocks();
    localRev += 1;
    dirty = true;
    if (!booting) schedulePush();
  });
  void pull();
  window.setInterval(() => void pull(), 4000);
}
