import { useEffect, useState } from "react";
import { Globe, Laptop, Monitor, Smartphone, TabletSmartphone, X } from "lucide-react";
import { clsx } from "clsx";
import {
  PLATFORMS,
  canPromptInstall,
  detectPlatform,
  isStandalone,
  promptInstall,
  subscribeInstall,
  type PlatformId,
} from "@/lib/studio/platforms";

const ICONS = {
  web: Globe,
  mac: Laptop,
  windows: Monitor,
  android: Smartphone,
  iphone: TabletSmartphone,
} as const;

export function RunSheet({ onClose }: { onClose: () => void }) {
  const [here, setHere] = useState<PlatformId>("web");
  const [standalone, setStandalone] = useState(false);
  const [installable, setInstallable] = useState(false);

  useEffect(() => {
    setHere(detectPlatform());
    setStandalone(isStandalone());
    setInstallable(canPromptInstall());
    return subscribeInstall(() => setInstallable(canPromptInstall()));
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = PLATFORMS.find((item) => item.id === here) ?? PLATFORMS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-title"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-paper p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h2 id="run-title" className="text-lg font-semibold">
              Run FrameShift
            </h2>
            <p className="mt-1 text-sm text-muted">Web, Mac, Windows, Android, and iPhone. One workspace. A clip made on one device is on the others.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-chip"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="mt-4 rounded-lg bg-chip px-3 py-3 text-sm text-ink">
          {standalone
            ? `Running as an app on ${current.label}.`
            : here === "web"
              ? "Running in the browser."
              : `This device looks like ${current.label}.`}
        </p>

        <ul className="mt-4 space-y-2">
          {PLATFORMS.map((item) => {
            const Icon = ICONS[item.id];
            const active = item.id === here;
            return (
              <li key={item.id} className={clsx("rounded-lg border px-3 py-3", active ? "border-transparent bg-blue text-paper" : "border-line")}>
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-paper text-ink">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {item.label}
                      {active ? <span className="ml-2 text-xs font-medium">This device</span> : null}
                    </p>
                    <p className={clsx("mt-1 text-sm", active ? "text-paper" : "text-muted")}>{item.detail}</p>
                    <div className="mt-2">
                      {item.id === "iphone" ? (
                        <a
                          href="/?install=1&platform=ios"
                          className={clsx(
                            "inline-flex min-h-11 items-center text-sm font-medium",
                            active ? "text-paper underline" : "text-blue",
                          )}
                        >
                          Show iPhone steps
                        </a>
                      ) : null}
                      {item.id !== "web" && item.id !== "iphone" && active && installable ? (
                        <button
                          type="button"
                          onClick={() => void promptInstall()}
                          className="inline-flex min-h-11 items-center rounded-md bg-paper px-4 text-sm font-medium text-ink"
                        >
                          Install
                        </button>
                      ) : null}
                      {item.id === "web" && active && !standalone ? (
                        <span className="text-xs font-medium text-paper">Open now</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
