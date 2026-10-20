export type LiveGate = "ready" | "slow";

export function onPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod/i.test(ua) || touchMac;
}

export function liveGate(): LiveGate {
  if (typeof navigator === "undefined") return "slow";
  if (onPhone()) return "ready";
  const cores = navigator.hardwareConcurrency || 1;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const fast = cores >= 8 || (cores >= 4 && (memory == null || memory >= 8));
  return fast ? "ready" : "slow";
}

export function isPhoneCamera(label: string): boolean {
  return /iphone|ipad|continuity|android|pixel|galaxy|camo|droidcam|iriun|epoccam/i.test(label);
}
