import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { onPhone } from "@/lib/studio/live";
import {
  LOOKS,
  applyClip,
  applyLook,
  applyPrompt,
  applyStill,
  bindCanvas,
  bindRaw,
  clearClip,
  openCamera,
  stopCamera,
  toggleMic,
  unbindCanvas,
  unbindRaw,
  useScene,
} from "@/lib/studio/scene-session";

type Facing = "user" | "environment";

export function SceneBench({ compact = false }: { compact?: boolean }) {
  const scene = useScene();
  const rawRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phone, setPhone] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");
  const [draft, setDraft] = useState(scene.prompt);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => setPhone(onPhone()), []);

  useEffect(() => {
    const node = rawRef.current;
    if (!node) return;
    bindRaw(node);
    return () => unbindRaw(node);
  }, []);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    bindCanvas(node);
    return () => unbindCanvas(node);
  }, []);

  async function listCameras(current: string) {
    const listed = await navigator.mediaDevices.enumerateDevices();
    const next = listed
      .filter((item) => item.kind === "videoinput")
      .map((item, index) => ({ id: item.deviceId, label: item.label || `Camera ${index + 1}` }));
    setCameras(next);
    const keep = next.some((item) => item.id === current) ? current : next[0]?.id || "";
    setDeviceId(keep);
    return keep;
  }

  async function start(id = deviceId, face = facing) {
    await openCamera({ deviceId: id, facing: face, phone, mic: true });
    if (!phone) await listCameras(id);
  }

  return (
    <div className={clsx("flex min-h-0 flex-col gap-3", compact ? "" : "flex-1")}>
      <div className={clsx("grid gap-3", compact ? "sm:grid-cols-2" : "min-h-0 flex-1 lg:grid-cols-2")}>
        <figure className="flex min-h-0 flex-col gap-2">
          <figcaption className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Camera · untouched</figcaption>
          <div className="relative flex min-h-36 flex-1 items-center justify-center overflow-hidden rounded-lg border border-line bg-stage aspect-video">
            <video
              ref={rawRef}
              className={scene.mirror ? "h-full w-full -scale-x-100 object-cover" : "h-full w-full object-cover"}
              playsInline
              muted
              autoPlay
            />
            {scene.live ? null : <p className="absolute text-sm font-light text-faint">Camera is off</p>}
          </div>
        </figure>
        <figure className="flex min-h-0 flex-col gap-2">
          <figcaption className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Scene{scene.live || scene.clipName ? " · live" : ""}
            {scene.clipName ? ` · ${scene.clipName}` : scene.stillName ? " · still" : ""}
          </figcaption>
          <div className="google-rainbow relative flex min-h-36 flex-1 items-center justify-center overflow-hidden rounded-lg border border-transparent bg-stage aspect-video">
            <canvas ref={canvasRef} className="h-full w-full object-cover" />
            {scene.live || scene.clipName ? null : <p className="absolute text-sm font-light text-faint">The look lands here</p>}
          </div>
        </figure>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          applyPrompt(draft);
        }}
      >
        <label className="sr-only" htmlFor="scene-prompt">
          Scene prompt
        </label>
        <input
          id="scene-prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 280))}
          placeholder="Describe the look. Night street, ivory studio, warm field."
          className="min-h-11 w-full rounded-md border border-line bg-canvas px-3 text-sm font-light text-ink"
        />
        <button type="submit" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-blue px-4 text-sm text-paper">
          Apply look
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        {LOOKS.map((look) => (
          <button
            key={look.id}
            type="button"
            aria-pressed={scene.lookId === look.id}
            onClick={() => {
              applyLook(look.id);
              setDraft("");
            }}
            className={clsx(
              "min-h-11 rounded-md px-3 text-sm",
              scene.lookId === look.id ? "bg-blue text-paper" : "border border-line bg-chip text-muted",
            )}
          >
            {look.label}
          </button>
        ))}
        {scene.lookId === "custom" ? <span className="inline-flex min-h-11 items-center px-2 text-sm font-light text-faint">Custom</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (scene.live ? stopCamera() : void start())}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue px-4 text-sm text-paper"
        >
          {scene.live ? "Stop camera" : "Start camera"}
        </button>
        {phone ? (
          <button
            type="button"
            onClick={() => {
              const next = facing === "user" ? "environment" : "user";
              setFacing(next);
              if (scene.live) void start(deviceId, next);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-chip px-4 text-sm"
          >
            {facing === "user" ? "Back camera" : "Front camera"}
          </button>
        ) : (
          <select
            aria-label="Camera source"
            value={deviceId}
            disabled={!scene.live || cameras.length === 0}
            onChange={(event) => {
              const next = event.target.value;
              setDeviceId(next);
              void start(next);
            }}
            className="min-h-11 rounded-md border border-line bg-canvas px-3 text-sm text-ink disabled:opacity-50"
          >
            {cameras.length === 0 ? <option value="">Open the camera first</option> : null}
            {cameras.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => toggleMic()}
          disabled={!scene.live}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-chip px-4 text-sm disabled:opacity-40"
        >
          {scene.mic === "on" ? "Mute" : "Unmute"}
        </button>
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line bg-chip px-4 text-sm">
          Upload
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.type.startsWith("video/")) applyClip(file);
              else void applyStill(file);
            }}
          />
        </label>
        {scene.clipName ? (
          <button type="button" onClick={clearClip} className="inline-flex min-h-11 items-center px-2 text-sm text-muted">
            Camera again
          </button>
        ) : null}
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {scene.live ? `${scene.fps} fps` : "Idle"}
          {scene.mic === "on" ? " · mic" : scene.mic === "blocked" ? " · mic blocked" : ""}
        </p>
      </div>
      {scene.error ? <p className="text-sm text-danger">{scene.error}</p> : null}
    </div>
  );
}
