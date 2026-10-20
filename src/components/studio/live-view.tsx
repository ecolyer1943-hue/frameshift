import { useEffect, useRef, useState } from "react";
import { isPhoneCamera, liveGate, onPhone, type LiveGate } from "@/lib/studio/live";

type CameraOption = { id: string; label: string; phone: boolean };
type Facing = "user" | "environment";

export function LiveView() {
  const [ready, setReady] = useState(false);
  const [gate, setGate] = useState<LiveGate>("ready");
  const [phone, setPhone] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [live, setLive] = useState(false);
  const [mic, setMic] = useState<"on" | "off" | "blocked">("off");
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micWanted = useRef(true);

  useEffect(() => {
    setPhone(onPhone());
    setGate(liveGate());
    setReady(true);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function refreshCameras(currentId: string) {
    const listed = await navigator.mediaDevices.enumerateDevices();
    const next = listed
      .filter((item) => item.kind === "videoinput")
      .map((item, index) => ({
        id: item.deviceId,
        label: item.label || `Camera ${index + 1}`,
        phone: isPhoneCamera(item.label),
      }));
    setCameras(next);
    if (currentId && next.some((item) => item.id === currentId)) return currentId;
    const attached = next.find((item) => item.phone);
    return attached?.id || next[0]?.id || "";
  }

  async function start(id = deviceId, face = facing) {
    setError(null);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const here = onPhone();
    const wantMic = micWanted.current;
    const videoConstraints = here
      ? {
          facingMode: face,
          width: { ideal: 720 },
          height: { ideal: 1280 },
          frameRate: { ideal: 30, max: 30 },
        }
      : {
          deviceId: id ? { exact: id } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        };
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: wantMic ? { echoCancellation: true, noiseSuppression: true } : false,
          video: videoConstraints,
        });
      } catch {
        if (!wantMic) throw new Error("camera");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
        setMic("blocked");
      }
      streamRef.current = stream;
      const chosen = (await refreshCameras(id)) || id;
      if (!here) setDeviceId(chosen);
      setMic(stream.getAudioTracks().length ? "on" : wantMic ? "blocked" : "off");
      setLive(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        await video.play();
      }
    } catch {
      setLive(false);
      setError("The camera did not open. Allow it for this site, then try again.");
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setMic("off");
    setFps(0);
  }

  function toggleMic() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) {
      micWanted.current = true;
      if (live) void start();
      return;
    }
    track.enabled = !track.enabled;
    micWanted.current = track.enabled;
    setMic(track.enabled ? "on" : "off");
  }

  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    }) | null;
    if (!live || !video?.requestVideoFrameCallback || phone) return;
    let frames = 0;
    let last = performance.now();
    let low = 0;
    let handle = 0;
    const sample = (now: number) => {
      frames += 1;
      if (now - last >= 1000) {
        const rate = frames;
        frames = 0;
        last = now;
        setFps(rate);
        if (rate < 12) low += 1;
        else low = 0;
        if (low >= 4) {
          stop();
          setError("This computer fell behind. Live stopped so the picture would not stutter.");
          return;
        }
      }
      handle = video.requestVideoFrameCallback?.(sample) ?? 0;
    };
    handle = video.requestVideoFrameCallback(sample);
    return () => video.cancelVideoFrameCallback?.(handle);
  }, [live, phone]);

  if (!ready) return <section className="min-h-64 flex-1" />;

  if (gate === "slow") {
    return (
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-12 xl:items-start">
        <section className="order-2 rounded-lg border border-line bg-paper p-4 xl:order-1 xl:col-span-3">
          <h2 className="text-sm font-medium">Camera</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Live stays off on a computer that cannot hold a steady picture.</p>
          <button type="button" disabled className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-blue text-sm font-medium text-paper opacity-40">
            Start camera
          </button>
        </section>
        <section className="google-rainbow order-1 flex min-h-64 items-center justify-center rounded-lg border border-transparent bg-stage p-6 text-center xl:order-2 xl:col-span-6">
          <div className="max-w-md">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Live</p>
            <h2 className="mt-3 text-lg font-medium text-stage-fg">This computer is not fast enough</h2>
            <p className="mt-3 text-sm leading-6 text-muted">The preview can still run on a phone. A call that needs a system camera still uses a computer.</p>
          </div>
        </section>
        <section className="order-3 rounded-lg border border-line bg-paper p-4 xl:col-span-3">
          <h2 className="text-sm font-medium">On a call</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Zoom, Meet, and Teams can share this window once a faster computer is running the preview. The picture stays here.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">
            FaceTime only accepts a system camera. Connect the phone to a computer and choose it there when the call needs that camera.
          </p>
        </section>
      </div>
    );
  }

  const selected = cameras.find((item) => item.id === deviceId);
  const phoneConnected = cameras.some((item) => item.phone);

  return (
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-12 xl:items-start">
      <section className="order-2 rounded-lg border border-line bg-paper p-4 xl:order-1 xl:col-span-3">
        <h2 className="text-sm font-medium">Camera</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {phone
            ? "Preview is on this phone. A call that needs a system camera still uses a computer."
            : phoneConnected
              ? "A phone camera is connected. Processing stays on this computer."
              : "No phone camera is connected."}
        </p>
        {phone ? null : (
          <>
            <label className="mt-4 block text-xs text-faint" htmlFor="live-camera">
              Source
            </label>
            <select
              id="live-camera"
              value={deviceId}
              disabled={!live || cameras.length === 0}
              onChange={(event) => {
                const next = event.target.value;
                setDeviceId(next);
                void start(next);
              }}
              className="mt-2 w-full rounded-md border border-line bg-canvas px-3 py-3 text-sm text-ink disabled:opacity-50"
            >
              {cameras.length === 0 ? <option value="">Open the camera first</option> : null}
              {cameras.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.phone ? `${item.label} · phone` : item.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          onClick={() => (live ? stop() : void start())}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-blue text-sm font-medium text-paper"
        >
          {live ? "Stop" : "Start camera"}
        </button>
        {phone ? (
          <button
            type="button"
            onClick={() => {
              const next = facing === "user" ? "environment" : "user";
              setFacing(next);
              if (live) void start("", next);
            }}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium"
          >
            {facing === "user" ? "Use the back camera" : "Use the front camera"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={toggleMic}
          disabled={!live && mic !== "blocked"}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium disabled:opacity-40"
        >
          {mic === "on" ? "Mute mic" : "Unmute mic"}
        </button>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          {phone ? (live ? "Live" : "Idle") : live ? `${fps} fps` : "Idle"}
          {mic === "on" ? " · mic" : mic === "blocked" ? " · mic blocked" : ""}
          {!phone && selected?.phone ? " · phone" : ""}
        </p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      <section className="order-1 xl:order-2 xl:col-span-6" aria-label="Live picture">
        <div
          className={
            phone
              ? "google-rainbow relative flex min-h-80 items-center justify-center overflow-hidden rounded-lg border border-transparent bg-stage aspect-[3/4]"
              : "google-rainbow relative flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-transparent bg-stage aspect-video"
          }
        >
          <video
            ref={videoRef}
            className={phone && facing === "user" ? "h-full w-full -scale-x-100 object-cover" : "h-full w-full object-cover"}
            playsInline
            muted
            autoPlay
          />
          {live ? null : <p className="absolute text-sm text-faint">Camera is off</p>}
        </div>
      </section>

      <section className="order-3 rounded-lg border border-line bg-paper p-4 xl:col-span-3">
        <h2 className="text-sm font-medium">On a call</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {phone
            ? "This preview stays on the phone. Zoom, Meet, and FaceTime cannot take a picture from the browser."
            : "Zoom, Meet, and Teams can share this window. The picture stays here."}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          FaceTime only accepts a system camera. Connect the phone to a computer and choose it there when the call needs that camera.
        </p>
      </section>
    </div>
  );
}