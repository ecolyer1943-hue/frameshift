import { syncPull, syncPush, type SyncDevice, type SyncState } from "@/lib/studio/sync";
import { detectPlatform, PLATFORMS } from "@/lib/studio/platforms";
import { useStudio } from "@/lib/studio/store";

const CODE_KEY = "frameshift-workspace";
const DEVICE_KEY = "frameshift-device";

export type SyncSnapshot = {
  code: string;
  devices: SyncDevice[];
  status: "syncing" | "synced" | "offline";
};

type Listener = (snapshot: SyncSnapshot) => void;

const listeners = new Set<Listener>();
let snapshot: SyncSnapshot = { code: "", devices: [], status: "syncing" };
let started = false;
let dirty = false;
let applying = false;
let timer: number | null = null;

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
    jobs: state.jobs,
    activeId: state.activeId,
    hint: state.hint,
  });
  applying = false;
}

async function pull() {
  if (!snapshot.code) return;
  try {
    const result = await syncPull({ data: { code: snapshot.code, device: device() } });
    if (!result.ok) return;
    setSnapshot({ devices: result.devices, status: "synced" });
    if (!dirty && result.state) apply(result.state);
  } catch {
    setSnapshot({ status: "offline" });
  }
}

async function push() {
  if (!snapshot.code || !dirty) return;
  dirty = false;
  setSnapshot({ status: "syncing" });
  try {
    const result = await syncPush({ data: { code: snapshot.code, device: device(), state: snapshotState() } });
    if (result.ok) {
      setSnapshot({ devices: result.devices, status: "synced" });
      if (result.state) apply(result.state);
    }
  } catch {
    dirty = true;
    setSnapshot({ status: "offline" });
  }
}

export function joinWorkspace(code: string) {
  const next = code.trim().toLowerCase();
  if (!/^[a-z0-9]{6,12}$/.test(next)) return false;
  localStorage.setItem(CODE_KEY, next);
  snapshot = { ...snapshot, code: next, status: "syncing" };
  emit();
  dirty = false;
  void pull();
  return true;
}

export function startSync(userId: string | null) {
  const code = codeFor(userId);
  setSnapshot({ code, status: "syncing" });
  if (started) {
    void pull();
    return;
  }
  started = true;
  useStudio.subscribe(() => {
    if (applying) return;
    dirty = true;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void push(), 700);
  });
  void pull();
  window.setInterval(() => void pull(), 4000);
}
