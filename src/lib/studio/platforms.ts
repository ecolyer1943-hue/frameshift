export type PlatformId = "web" | "mac" | "windows" | "android" | "iphone";

export const PLATFORMS: { id: PlatformId; label: string; detail: string }[] = [
  {
    id: "web",
    label: "Web",
    detail: "Use FrameShift in the browser. Nothing to install.",
  },
  {
    id: "mac",
    label: "Mac",
    detail: "Install from Chrome, or in Safari choose File, then Add to Dock.",
  },
  {
    id: "windows",
    label: "Windows",
    detail: "Install from Edge or Chrome. It then opens from the Start menu.",
  },
  {
    id: "android",
    label: "Android",
    detail: "Install from Chrome, or open the browser menu and choose Add to Home screen.",
  },
  {
    id: "iphone",
    label: "iPhone",
    detail: "Add it to the Home Screen. It opens full screen, like an app.",
  },
];

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  notify();
  return choice.outcome === "accepted";
}

export function detectPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return "iphone";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS/i.test(ua)) return "mac";
  return "web";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}
