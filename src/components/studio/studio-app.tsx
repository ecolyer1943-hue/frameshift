import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Clapperboard,
  Columns2,
  Download,
  FastForward,
  Headphones,
  ImagePlus,
  Library,
  LoaderCircle,
  Mic,
  Menu,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  AppWindow,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { CAMERAS, SAMPLES, type CameraId, type SampleId } from "@/lib/studio/presets";
import { fileToJpegDataUrl, apiPath, clipSrc, videoFileFrames, videoFirstFrame, videoUrlFrame } from "@/lib/studio/media";
import { applySample, runDraftStill, runExtend, runRecast, runRegen } from "@/lib/studio/run";
import { suggestionList } from "@/lib/studio/suggest";
import { activeJob, useStudio } from "@/lib/studio/store";
import { joinWorkspace, startSync, subscribeSync, type SyncSnapshot } from "@/lib/studio/sync-client";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { RunSheet } from "@/components/studio/run-sheet";
import { LiveView } from "@/components/studio/live-view";
import { MeetView } from "@/components/studio/meet-view";
import type { AspectRatio, DurationSec, Job } from "@/lib/studio/types";

export function StudioApp() {
  const view = useStudio((state) => state.view);
  const hint = useStudio((state) => state.hint);
  const notice = useStudio((state) => state.notice);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useStudio.persist.rehydrate()).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const current = useStudio.getState().sampleId;
    if (current && !SAMPLES.some((item) => item.id === current)) {
      const fallback = SAMPLES[0];
      useStudio.getState().patch({
        sampleId: fallback.id,
        prompt: fallback.prompt,
        camera: fallback.camera,
        mode: "recast",
      });
    }
    const sample = SAMPLES.find((item) => item.id === useStudio.getState().sampleId);
    if (!sample || useStudio.getState().frame) return;
    let cancelled = false;
    void videoUrlFrame(sample.src)
      .then((dataUrl) => {
        if (cancelled || useStudio.getState().frame) return;
        useStudio.getState().setFrame({ name: sample.title, dataUrl, sampleId: sample.id });
      })
      .catch(() => {
        if (!cancelled) useStudio.getState().patch({ notice: "Could not load that performance." });
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const user = useCurrentUser();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!ready) return;
    startSync(user?.id ?? null);
  }, [ready, user?.id]);

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <Masthead onOpen={() => setMenu(true)} />
      <div className="google-bar" aria-hidden="true" />
      <div className="flex min-h-0 flex-1">
        <SideMenu open={menu} onClose={() => setMenu(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          {notice ? <Notice /> : null}
          <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
            {hint && view === "studio" ? <Hint /> : null}
            {view === "library" ? <LibraryView /> : view === "live" ? <LiveView /> : view === "meet" ? <MeetView /> : <Workspace />}
          </div>
          {view === "studio" ? <Composer /> : null}
        </div>
      </div>
    </div>
  );
}

function Masthead({ onOpen }: { onOpen: () => void }) {
  const mode = useStudio((state) => state.mode);
  return (
    <header className="safe-top relative flex items-center justify-center bg-canvas px-4 pb-3">
      <button
        type="button"
        onClick={onOpen}
        className="absolute left-3 inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-chip md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>
      <div className="text-center">
        <h1 className="text-[1.35rem] leading-none font-medium tracking-normal">FrameShift</h1>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-faint">
          {mode === "recast" ? "Recast" : mode === "prompt" ? "Prompt" : "Regen"}
        </p>
      </div>
      <p className="absolute right-4 hidden font-mono text-[10px] uppercase tracking-[0.14em] text-faint sm:block">4K</p>
    </header>
  );
}

function SideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const view = useStudio((state) => state.view);
  const jobs = useStudio((state) => state.jobs);
  const activeId = useStudio((state) => state.activeId);
  const busy = useStudio((state) => state.busy);
  const setView = useStudio((state) => state.setView);
  const [apps, setApps] = useState(false);
  const [sync, setSync] = useState<SyncSnapshot>({ code: "", devices: [], status: "syncing" });
  const active = jobs.find((job) => job.id === activeId) ?? null;
  const working = jobs.filter((job) => job.status !== "done" && job.status !== "failed").length;
  const [join, setJoin] = useState("");

  useEffect(() => subscribeSync(setSync), []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function go(next: "studio" | "library" | "live" | "meet") {
    setView(next);
    onClose();
  }

  return (
    <>
      {open ? (
        <button type="button" className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-label="Close menu" onClick={onClose} />
      ) : null}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-canvas px-3 py-4",
          "md:static md:z-auto md:w-52 md:shrink-0 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Sections"
      >
        <nav className="flex flex-col gap-1">
          <SideItem active={view === "studio"} busy={busy && view === "studio"} onClick={() => go("studio")} icon={<Clapperboard className="size-4" />}>
            Studio
          </SideItem>
          <SideItem
            active={view === "library"}
            busy={working > 0}
            note={working ? String(working) : jobs.length ? String(jobs.length) : undefined}
            onClick={() => go("library")}
            icon={<Library className="size-4" />}
          >
            Library
          </SideItem>
          <SideItem active={view === "live"} onClick={() => go("live")} icon={<Video className="size-4" />}>
            Live preview
          </SideItem>
          <SideItem active={view === "meet"} onClick={() => go("meet")} icon={<Headphones className="size-4" />}>
            Meetings
          </SideItem>
          <button
            type="button"
            onClick={() => setApps(true)}
            className="inline-flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted hover:bg-chip"
          >
            <AppWindow className="size-4" aria-hidden="true" />
            Apps
          </button>
        </nav>
        <div className="mt-auto rounded-md border border-line px-3 py-3">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            {sync.status === "syncing" ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : null}
            {sync.status === "synced" ? "Synced" : sync.status === "offline" ? "Offline" : "Syncing"}
          </p>
          <p className="mt-2 text-sm leading-5">
            {sync.devices.length ? sync.devices.map((device) => device.label).join(" · ") : "This device"}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="font-mono text-xs tracking-wider text-ink">{sync.code || "····"}</code>
            <button
              type="button"
              className="text-xs font-medium text-muted"
              onClick={() => {
                if (sync.code) void navigator.clipboard?.writeText(sync.code);
              }}
            >
              Copy
            </button>
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!joinWorkspace(join)) return;
              setJoin("");
            }}
          >
            <input
              value={join}
              onChange={(event) => setJoin(event.target.value.toLowerCase())}
              placeholder="Join a workspace"
              aria-label="Workspace code"
              className="min-h-11 w-full rounded-md border border-line bg-canvas px-3 text-sm"
            />
          </form>
          <p className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Working" : "Idle"}
          </p>
          <p className="mt-2 text-sm leading-5">
            {active
              ? `${labelStatus(active)} · ${active.mode === "recast" ? "Recast" : "Regen"}`
              : "Nothing in progress"}
          </p>
        </div>
        {apps ? <RunSheet onClose={() => setApps(false)} /> : null}
      </aside>
    </>
  );
}

function SideItem({
  active,
  busy,
  note,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  busy?: boolean;
  note?: string;
  onClick: () => void;
  icon: ReactNode;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "inline-flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-sm font-medium",
        active ? "bg-chip text-ink" : "text-muted hover:bg-chip",
      )}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      <span className="flex-1">{children}</span>
      {note ? <span className="font-mono text-[10px] text-faint">{note}</span> : null}
    </button>
  );
}

function Hint() {
  const dismissHint = useStudio((state) => state.dismissHint);
  const mode = useStudio((state) => state.mode);
  return (
    <div className="mb-4 flex items-start gap-4 border-b border-line pb-4">
      <p className="max-w-2xl text-sm text-muted">
        {mode === "recast"
          ? "Choose a performance. Then upload the character who should take their place. Change character to use someone else."
          : "Drop a photograph. Describe what moves. Regen keeps the still as frame one and writes the shot from there."}
      </p>
      <button type="button" onClick={dismissHint} className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-chip" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}

function Notice() {
  const notice = useStudio((state) => state.notice);
  if (!notice) return null;
  return (
    <div className="border-b border-danger-soft bg-danger-soft px-4 py-2 text-sm text-danger" role="status">
      <p className="mx-auto max-w-7xl">{notice}</p>
    </div>
  );
}

function Workspace() {
  return (
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-12 xl:items-start xl:gap-4">
      <StartColumn />
      <Stage />
      <ShotColumn />
    </div>
  );
}

function StartColumn() {
  const frame = useStudio((state) => state.frame);
  const endFrame = useStudio((state) => state.endFrame);
  const people = useStudio((state) => state.people);
  const mode = useStudio((state) => state.mode);
  const busy = useStudio((state) => state.busy);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const characterRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLInputElement>(null);
  const recast = mode === "recast";

  async function copyVideo(file: File | undefined) {
    if (!file) return;
    const named = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name);
    if (!named) {
      useStudio.getState().patch({ notice: "Use a video to copy." });
      return;
    }
    if (file.size > 250_000_000) {
      useStudio.getState().patch({ notice: "Keep a copied video under 250 MB." });
      return;
    }
    useStudio.getState().patch({ busy: true, notice: "Copying the video into 15 second pieces." });
    let poster: string | null = null;
    try {
      poster = await videoFirstFrame(file);
    } catch {
      poster = null;
    }
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(apiPath("/api/copy"), { method: "POST", body });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        id?: string;
        url?: string;
        pieces?: string[];
        seconds?: number;
      };
      if (!response.ok || !data.ok || !data.id || !data.url || !data.pieces?.length || !data.seconds) {
        useStudio.getState().patch({ busy: false, notice: data.error || "That video could not be copied." });
        return;
      }
      const seconds = data.seconds;
      const duration = (seconds >= 15 ? 15 : seconds >= 10 ? 10 : seconds >= 8 ? 8 : seconds >= 6 ? 6 : 4) as DurationSec;
      const job: Job = {
        id: data.id,
        createdAt: Date.now(),
        kind: "regen",
        mode: "animate",
        prompt: `Copied ${file.name}`,
        dialogue: "",
        camera: useStudio.getState().camera,
        duration,
        aspect: useStudio.getState().aspect,
        resolution: "1080p",
        model: "quality",
        audio: true,
        poster,
        videoUrl: data.url,
        upscale: null,
        status: "done",
        error: null,
        requestId: null,
        sampleId: null,
        parts: data.pieces.length,
        seconds,
        pieceUrls: data.pieces,
        source: "copy",
      };
      useStudio.getState().upsertJob(job);
      if (!recast && poster) useStudio.getState().setFrame({ name: file.name, dataUrl: poster, sampleId: null });
      useStudio.getState().patch({ busy: false, notice: null, view: "studio", mode: recast ? "recast" : "animate" });
    } catch {
      useStudio.getState().patch({ busy: false, notice: "That video could not be copied." });
    }
  }

  async function onFile(file: File | undefined, target: "start" | "end" | "character") {
    if (!file) return;
    if (target === "start" && recast && file.type.startsWith("video/")) {
      try {
        const dataUrl = await videoFirstFrame(file);
        useStudio.getState().setFrame({ name: file.name, dataUrl, sampleId: null });
        useStudio.getState().patch({ notice: null });
      } catch {
        useStudio.getState().patch({ notice: "Could not read that clip. Use its first moment as a photograph instead." });
      }
      return;
    }
    if (!file.type.startsWith("image/")) {
      useStudio.getState().patch({ notice: "Use a JPG, PNG, or WebP photograph." });
      return;
    }
    try {
      const dataUrl = await fileToJpegDataUrl(file);
      const next = { name: file.name, dataUrl, sampleId: null };
      if (target === "end") useStudio.getState().setEndFrame(next);
      else if (target === "character") useStudio.getState().setCharacter(next);
      else {
        useStudio.getState().setFrame(next);
        if (!recast) useStudio.getState().patch({ mode: "animate", notice: null });
        else useStudio.getState().patch({ notice: null });
      }
    } catch {
      useStudio.getState().patch({ notice: "Could not read that photograph." });
    }
  }

  async function onPeople(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    const video = list.find((file) => file.type.startsWith("video/"));
    try {
      if (video) {
        const frames = await videoFileFrames(video);
        const replacing = useStudio.getState().people.length > 0;
        useStudio.getState().setPeople(
          frames.map((dataUrl, index) => ({ name: `${video.name} ${index + 1}`, dataUrl, sampleId: null })),
        );
        useStudio.getState().patch({ mode: "recast", notice: replacing ? "Character changed." : null });
        return;
      }
      const images = list.filter((file) => file.type.startsWith("image/")).slice(0, 3);
      if (!images.length) {
        useStudio.getState().patch({ notice: "Use photos, or one video, of the character." });
        return;
      }
      const replacing = useStudio.getState().people.length > 0;
      const next = [];
      for (const file of images) {
        next.push({ name: file.name, dataUrl: await fileToJpegDataUrl(file), sampleId: null as null });
      }
      useStudio.getState().setPeople(next);
      useStudio.getState().patch({ mode: "recast", notice: replacing ? "Character changed." : null });
    } catch {
      useStudio.getState().patch({ notice: "Could not read that person." });
    }
  }

  return (
    <section className="order-2 rounded-lg border border-line bg-paper p-4 xl:order-1 xl:col-span-3" aria-labelledby="start-frame-label">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="start-frame-label" className="text-sm font-medium">
          {recast ? "Performance" : "Start frame"}
        </h2>
        {frame ? (
          <button
            type="button"
            className="text-xs font-medium text-muted hover:text-ink"
            aria-label={recast ? "Clear performance" : "Clear start frame"}
            onClick={() => useStudio.getState().setFrame(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file?.type.startsWith("video/")) void copyVideo(file);
          else void onFile(file, "start");
        }}
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-line bg-chip text-muted"
      >
        {(() => {
          const sample = SAMPLES.find((item) => item.id === frame?.sampleId);
          if (sample) {
            return (
              <video
                key={sample.id}
                src={sample.src}
                poster={sample.poster}
                className="h-full w-full object-cover"
                muted
                loop
                autoPlay
                playsInline
              />
            );
          }
          if (frame) return <img src={frame.dataUrl} alt="" className="h-full w-full object-cover" />;
          return (
            <span className="flex flex-col items-center gap-2 px-4 text-center text-sm">
              <ImagePlus className="size-5" aria-hidden="true" />
              {recast ? "Choose a performance" : "Drop a photo"}
            </span>
          );
        })()}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={recast ? "video/mp4,video/webm,video/quicktime" : "image/jpeg,image/png,image/webp"}
        className="sr-only"
        onChange={(event) => {
          void onFile(event.target.files?.[0], "start");
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium"
      >
        {recast ? "Upload a performance" : "Upload photograph"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => copyRef.current?.click()}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium disabled:opacity-40"
      >
        Copy a video
      </button>
      <input
        ref={copyRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.m4v"
        className="sr-only"
        onChange={(event) => {
          void copyVideo(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="mt-2 text-xs leading-5 text-faint">Any length up to 15 minutes. The copy is split into 15 second pieces.</p>
      {recast ? (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">Character</p>
            {people.length ? (
              <button
                type="button"
                className="text-xs font-medium text-muted"
                aria-label="Clear character"
                onClick={() => useStudio.getState().setPeople([])}
              >
                Clear
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => characterRef.current?.click()}
            className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-md border border-dashed border-line bg-chip px-3 text-left text-sm text-muted"
          >
            {people.length ? (
              <span className="flex gap-1">
                {people.map((person, index) => (
                  <img key={`${index}-${person.name}`} src={person.dataUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                ))}
              </span>
            ) : (
              <ImagePlus className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>{people.length ? people.map((person) => person.name).join(", ") : "Upload the person who takes their place."}</span>
          </button>
          <input
            ref={characterRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            multiple
            className="sr-only"
            onChange={(event) => {
              void onPeople(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => characterRef.current?.click()}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium"
          >
            {people.length ? "Change character" : "Upload character"}
          </button>
          <p className="mt-2 text-xs leading-5 text-faint">
            {people.length ? "Uploading again replaces this person." : "Use photos, or one video, of someone you have permission to portray."}
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">End frame</p>
            <div className="flex items-center gap-2">
              {frame ? (
                <button
                  type="button"
                  className="text-xs font-medium text-blue"
                  onClick={() =>
                    useStudio.getState().setEndFrame({ name: "Loop", dataUrl: frame.dataUrl, sampleId: null })
                  }
                >
                  Loop
                </button>
              ) : null}
              {endFrame ? (
                <button
                  type="button"
                  className="text-xs font-medium text-muted"
                  aria-label="Clear end frame"
                  onClick={() => useStudio.getState().setEndFrame(null)}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => endRef.current?.click()}
            className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-lg border border-dashed border-line bg-chip px-3 text-left text-sm text-muted"
          >
            {endFrame ? (
              <img src={endFrame.dataUrl} alt="" className="h-12 w-20 rounded-md object-cover" />
            ) : (
              <ImagePlus className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>{endFrame ? endFrame.name : "Optional. The shot arrives here."}</span>
          </button>
          <input
            ref={endRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              void onFile(event.target.files?.[0], "end");
              event.target.value = "";
            }}
          />
        </>
      )}
      <p className="mt-4 text-xs font-medium text-muted">Performances</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {SAMPLES.map((sample) => (
          <SampleButton
            key={sample.id}
            id={sample.id}
            title={sample.title}
            style={sample.style}
            prompt={sample.prompt}
            src={sample.src}
            poster={sample.poster}
            selected={frame?.sampleId === sample.id}
          />
        ))}
      </div>
      {recast ? null : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runDraftStill()}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium text-ink disabled:opacity-50"
        >
          Draft a still from the prompt
        </button>
      )}
      <p className="mt-3 text-xs leading-5 text-faint">
        {recast
          ? "The performance is the clip. Change character to put a different person in it."
          : "The photograph is frame one. Motion, camera, and any spoken line are written on top of it."}
      </p>
    </section>
  );
}

function SampleButton({
  id,
  title,
  style,
  prompt,
  src,
  poster,
  selected,
}: {
  id: SampleId;
  title: string;
  style: string;
  prompt: string;
  src: string;
  poster: string;
  selected: boolean;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${title}, ${style}`}
      aria-pressed={selected}
      disabled={loading}
      onClick={() => {
        setLoading(true);
        applySample(id);
        void videoUrlFrame(src)
          .then((dataUrl) => {
            useStudio.getState().setFrame({ name: title, dataUrl, sampleId: id });
          })
          .catch(() => useStudio.getState().patch({ notice: "Could not load that character." }))
          .finally(() => setLoading(false));
      }}
      className={clsx(
        "overflow-hidden rounded-md border text-left",
        selected ? "google-rainbow border-transparent" : "border-line",
      )}
    >
      <video src={src} poster={poster} muted loop autoPlay playsInline className="aspect-video w-full object-cover" />
      <span className="block px-2 py-2">
        <span className="block text-xs font-medium">{title}</span>
        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{style}</span>
        <span className="mt-1 line-clamp-3 block text-[11px] leading-4 text-muted">{prompt}</span>
      </span>
    </button>
  );
}

async function ensurePlay(video: HTMLVideoElement) {
  try {
    await video.play();
  } catch {
    video.muted = true;
    await video.play();
  }
}

function Stage() {
  const job = useStudio((state) => activeJob(state));
  const jobs = useStudio((state) => state.jobs);
  const activeId = useStudio((state) => state.activeId);
  const frame = useStudio((state) => state.frame);
  const mode = useStudio((state) => state.mode);
  const busy = useStudio((state) => state.busy);
  const [hold, setHold] = useState(false);
  const [compare, setCompare] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pieceAt, setPieceAt] = useState(0);
  const [piecesOn, setPiecesOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poster = job?.poster || frame?.dataUrl || null;
  const still = hold ? frame?.dataUrl || poster : poster;
  const canPreview = Boolean(job?.status === "done" && job.videoUrl);
  const pieces = job?.pieceUrls ?? [];
  const shown = piecesOn && pieces[pieceAt] ? pieces[pieceAt] : job?.videoUrl;

  useEffect(() => {
    setPlaying(false);
    setCompare(false);
    setPiecesOn(false);
    setPieceAt(0);
  }, [job?.id]);

  function play() {
    setCompare(false);
    setPiecesOn(false);
    const video = videoRef.current;
    if (!video) {
      setPlaying(true);
      return;
    }
    setPlaying(true);
    video.currentTime = 0;
    void ensurePlay(video).catch(() => setPlaying(false));
  }

  function playPieces() {
    setCompare(false);
    setPieceAt(0);
    setPiecesOn(true);
    setPlaying(true);
  }

  function holdStill(next: boolean) {
    setHold(next);
    const video = videoRef.current;
    if (!video) return;
    if (next) video.pause();
    else if (playing) void ensurePlay(video).catch(() => setPlaying(false));
  }

  const showPoster = !canPreview || !playing || hold;

  useEffect(() => {
    if (!playing || compare) return;
    const video = videoRef.current;
    if (!video || !video.paused) return;
    void ensurePlay(video).catch(() => setPlaying(false));
  }, [playing, compare, job?.videoUrl, pieceAt, piecesOn]);

  return (
    <section className="order-1 flex min-h-0 flex-col xl:order-2 xl:col-span-6" aria-label="Stage">
      <div className="google-rainbow relative flex min-h-64 flex-1 items-center justify-center overflow-hidden rounded-lg border border-transparent bg-stage">
        {compare && canPreview && job?.videoUrl ? (
          <div className="grid w-full gap-px sm:grid-cols-2">
            <figure className="bg-stage">
              {still ? <img src={still} alt="" className="max-h-stage w-full object-contain" /> : null}
              <figcaption className="px-3 py-2 text-xs text-stage-fg">Frame one</figcaption>
            </figure>
            <figure className="relative bg-stage">
              <video
                key={job.videoUrl}
                src={job.videoUrl}
                poster={job.poster ?? undefined}
                controls
                playsInline
                className="max-h-stage w-full object-contain"
              />
              <figcaption className="px-3 py-2 text-xs text-stage-fg">Clip</figcaption>
            </figure>
          </div>
        ) : (
          <>
            {canPreview && job?.videoUrl ? (
              <video
                ref={videoRef}
                key={shown ?? job.videoUrl}
                src={shown ?? job.videoUrl}
                poster={job.poster ?? undefined}
                controls={playing && !hold}
                playsInline
                onEnded={() => {
                  if (piecesOn && pieceAt < pieces.length - 1) {
                    setPieceAt((value) => value + 1);
                    return;
                  }
                  setPlaying(false);
                  setPiecesOn(false);
                }}
                className={clsx("max-h-stage w-full object-contain", showPoster && "hidden")}
              />
            ) : null}
            {showPoster && still ? <img src={still} alt="" className="max-h-stage w-full object-contain" /> : null}
            {showPoster && !still ? (
              <div className="max-w-sm px-6 text-center">
                <p className="text-lg font-semibold text-stage-fg">
                  {mode === "recast" ? "Choose a character." : mode === "prompt" ? "Write the shot." : "Start with a photograph."}
                </p>
                <p className="mt-2 text-sm text-faint">
                  {mode === "recast"
                    ? "Pick a performance, then change the character who takes their place."
                    : mode === "prompt"
                      ? "No still. The frame, length, and camera you set are the shot."
                      : "That photograph stays frame one. Motion is written on top of it."}
                </p>
              </div>
            ) : null}
            {canPreview && !playing && !hold && !compare ? (
              <PlayButton onClick={play} />
            ) : null}
          </>
        )}
        {busy && job && job.status !== "done" ? <RenderStatus job={job} /> : null}
        {job?.status === "failed" ? (
          <p className="absolute inset-x-4 bottom-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{job.error}</p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPreview && job?.videoUrl ? (
          <>
            <button
              type="button"
              onClick={play}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-blue px-4 text-sm font-medium text-paper"
            >
              <Play className="size-4 fill-current" aria-hidden="true" />
              Play
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void (mode === "recast" ? runRecast() : runRegen())}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-chip px-4 text-sm font-medium disabled:opacity-40"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Another take
            </button>
            <button
              type="button"
              onClick={() => void saveClip(job.videoUrl!)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-chip px-4 text-sm font-medium"
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runExtend()}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-chip px-4 text-sm font-medium disabled:opacity-40"
            >
              <FastForward className="size-4" aria-hidden="true" />
              Next 15s
            </button>
            {pieces.length > 1 ? (
              <button
                type="button"
                onClick={playPieces}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-chip px-4 text-sm font-medium"
              >
                <Play className="size-4 fill-current" aria-hidden="true" />
                {piecesOn ? `Piece ${pieceAt + 1} of ${pieces.length}` : "Play pieces"}
              </button>
            ) : null}
            {poster ? (
            <button
              type="button"
              aria-pressed={compare}
              onClick={() => {
                setPlaying(false);
                videoRef.current?.pause();
                setCompare((value) => !value);
              }}
              className={clsx(
                "inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium",
                compare ? "border-transparent bg-blue text-paper" : "border-line bg-chip",
              )}
            >
              <Columns2 className="size-4" aria-hidden="true" />
              Compare
            </button>
            ) : null}
            {poster ? (
            <button
              type="button"
              onPointerDown={() => holdStill(true)}
              onPointerUp={() => holdStill(false)}
              onPointerLeave={() => holdStill(false)}
              onKeyDown={(event) => {
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                holdStill(true);
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") holdStill(false);
              }}
              onBlur={() => holdStill(false)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-chip px-4 text-sm font-medium"
            >
              Hold still
            </button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">
            {mode === "prompt" ? "Prompt only" : frame ? frame.name : "No start frame yet"}
          </p>
        )}
        {job?.status === "done" ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ok">
            <Check className="size-3.5" aria-hidden="true" />
            {job.source === "copy"
              ? `${job.seconds ?? job.duration}s`
              : job.upscale === "working" && pieces.length > 1
              ? "Joining"
              : job.upscale === "working"
                ? "Making 4K"
                : (job.seconds ?? 0) > job.duration
                  ? `${job.seconds}s`
                  : job.upscale === "done"
                    ? "4K"
                    : "1080"}
          </span>
        ) : null}
      </div>
      {jobs.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto" aria-label="Takes">
          {jobs.map((take, index) => (
            <button
              key={take.id}
              type="button"
              aria-pressed={take.id === activeId}
              aria-label={`Take ${index + 1}`}
              onClick={() => useStudio.getState().patch({ activeId: take.id })}
              className={clsx(
                "relative w-24 shrink-0 overflow-hidden rounded-md border",
                take.id === activeId ? "border-blue" : "border-line",
              )}
            >
              {take.poster ? (
                <img src={take.poster} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <span className="block aspect-video bg-chip" />
              )}
              {take.status === "done" && take.videoUrl ? (
                <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-stage-fg text-stage">
                  <Play className="size-3 fill-current" aria-hidden="true" />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PlayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Play clip"
      onClick={onClick}
      className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-stage-fg text-stage"
    >
      <Play className="ml-0.5 size-6 fill-current" aria-hidden="true" />
    </button>
  );
}

function RenderStatus({ job }: { job: Job }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [job.id]);
  const label =
    job.kind === "extend"
      ? job.status === "queued" || job.status === "submitting"
        ? "Queued"
        : "Extending the clip"
      : job.status === "queued" || job.status === "submitting"
        ? "Queued"
        : "Rendering the motion";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-end bg-stage/70 p-6 text-stage-fg">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        <span>
          {label}
          <span className="tabular-nums"> · {elapsed}s</span>
        </span>
      </div>
      <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-chip/30">
        <div className="h-full w-1/3 animate-pulse rounded-md bg-blue-soft" />
      </div>
    </div>
  );
}

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  return "audio/webm";
}

function VoiceField() {
  const voice = useStudio((state) => state.voice);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      window.clearTimeout(stopTimer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function keep(blob: Blob, name: string) {
    if (blob.size < 80 || blob.size > 4_000_000) {
      setError(blob.size > 4_000_000 ? "Keep the recording under about four megabytes." : "That recording was empty.");
      return;
    }
    const typed = blob.type.startsWith("audio/")
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: mimeFor(name) });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(typed);
    });
    if (!dataUrl.startsWith("data:audio/")) {
      setError("Use an audio recording.");
      return;
    }
    useStudio.getState().setVoice({ name, dataUrl });
    useStudio.getState().patch({ audio: true, notice: null });
    setError(null);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        void keep(blob, "Recording").catch(() => setError("Could not keep that recording."));
      };
      recorder.current = media;
      media.start();
      setRecording(true);
      stopTimer.current = window.setTimeout(() => stopRecording(), 15_000);
    } catch {
      setError("The microphone did not open. Allow it, or upload a file.");
    }
  }

  function stopRecording() {
    window.clearTimeout(stopTimer.current);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    setRecording(false);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => (recording ? stopRecording() : void startRecording())}
        aria-pressed={recording}
        className={clsx(
          "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium",
          recording ? "bg-danger-soft text-danger" : "border border-line bg-chip",
        )}
      >
        <Mic className="size-4" aria-hidden="true" />
        {recording ? "Stop" : "Mic"}
      </button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-line bg-chip px-4 text-sm font-medium"
        aria-label="Upload audio"
      >
        <Upload className="size-4" aria-hidden="true" />
        Upload audio
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const named = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(file.name);
          if (!named) {
            setError("Use an audio file.");
            return;
          }
          void keep(file, file.name).catch(() => setError("Could not read that audio."));
        }}
      />
      {voice ? (
        <audio src={voice.dataUrl} controls className="h-11 min-w-0 flex-1" />
      ) : (
        <p className="min-w-0 flex-1 text-xs leading-5 text-faint">
          {recording ? "Recording. It stops at 15 seconds." : "Record with the mic, or upload a voice. It plays on the clip."}
        </p>
      )}
      {voice ? (
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-muted"
          aria-label="Clear voice"
          onClick={() => useStudio.getState().setVoice(null)}
        >
          Clear
        </button>
      ) : null}
      {error ? <p className="w-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function ShotColumn() {
  const camera = useStudio((state) => state.camera);
  const duration = useStudio((state) => state.duration);
  const aspect = useStudio((state) => state.aspect);
  const audio = useStudio((state) => state.audio);
  const dialogue = useStudio((state) => state.dialogue);
  const voice = useStudio((state) => state.voice);
  const holdSubject = useStudio((state) => state.holdSubject);
  const holdSetting = useStudio((state) => state.holdSetting);
  const mode = useStudio((state) => state.mode);
  const voiced = Boolean(dialogue.trim() || voice);

  return (
    <section className="order-3 rounded-lg border border-line bg-paper p-4 xl:col-span-3" aria-labelledby="shot-label">
      <h2 id="shot-label" className="text-sm font-medium">
        Shot
      </h2>
      <div className="mt-4 space-y-4">
        <p className="text-xs text-faint">1080 render, then a fast upscale to 4K.</p>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Length</legend>
          <div className="grid grid-cols-5 gap-1 rounded-md bg-chip p-1">
            {([4, 6, 8, 10, 15] as const).map((seconds) => (
              <button
                key={seconds}
                type="button"
                aria-pressed={duration === seconds}
                onClick={() => useStudio.getState().patch({ duration: seconds })}
                className={clsx(
                  "min-h-11 rounded-md text-sm font-medium",
                  duration === seconds ? "bg-blue text-paper" : "text-muted",
                )}
              >
                {seconds}s
              </button>
            ))}
          </div>
          {duration === 15 ? (
            <p className="mt-2 text-xs text-faint">Fifteen seconds is one piece. Next 15s joins another piece onto a finished video.</p>
          ) : null}
        </fieldset>
        <Segment
          label="Frame"
          value={aspect}
          onChange={(value) => useStudio.getState().patch({ aspect: value })}
          options={[
            { value: "16:9" as AspectRatio, label: "16:9" },
            { value: "9:16" as AspectRatio, label: "9:16" },
            { value: "1:1" as AspectRatio, label: "1:1" },
          ]}
        />
        {mode === "prompt" ? (
          <p className="-mt-2 text-xs text-faint">Frame sets the shape of a prompt-only shot.</p>
        ) : (
          <p className="-mt-2 text-xs text-faint">A still or a performance keeps its own shape.</p>
        )}
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Camera</p>
          <div className="grid grid-cols-3 gap-2">
            {CAMERAS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={camera === item.id}
                onClick={() => useStudio.getState().patch({ camera: item.id })}
                className={clsx(
                  "min-h-11 rounded-md px-2 text-sm font-medium",
                  camera === item.id ? "bg-blue text-paper" : "bg-chip text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={holdSubject}
            onClick={() => useStudio.getState().patch({ holdSubject: !holdSubject })}
            className={clsx(
              "min-h-11 rounded-md px-2 text-sm font-medium",
              holdSubject ? "bg-blue text-paper" : "bg-chip text-ink",
            )}
          >
            Lock subject
          </button>
          <button
            type="button"
            aria-pressed={holdSetting}
            onClick={() => useStudio.getState().patch({ holdSetting: !holdSetting })}
            className={clsx(
              "min-h-11 rounded-md px-2 text-sm font-medium",
              holdSetting ? "bg-blue text-paper" : "bg-chip text-ink",
            )}
          >
            Lock setting
          </button>
        </div>
        <label className="block">
          <span className="mb-2 block text-xs font-medium text-muted">Spoken line</span>
          <input
            value={dialogue}
            onChange={(event) => {
              const dialogue = event.target.value.slice(0, 240);
              useStudio.getState().patch(dialogue.trim() ? { dialogue, audio: true } : { dialogue });
            }}
            placeholder="Said in the room, not read like a voiceover."
            className="w-full rounded-md border border-line bg-canvas px-3 py-3 text-sm text-ink placeholder:text-faint"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (voiced) return;
            useStudio.getState().patch({ audio: !audio });
          }}
          disabled={voiced}
          title={voiced ? "A spoken line keeps the sound on." : undefined}
          className={clsx(
            "inline-flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-sm font-medium",
            audio || voiced ? "border-transparent bg-blue text-paper" : "border-line bg-chip",
          )}
          aria-pressed={audio || voiced}
        >
          <span className="inline-flex items-center gap-2">
            {audio || voiced ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            Sound
          </span>
          <span className={audio || voiced ? "text-paper" : "text-muted"}>{audio || voiced ? "On" : "Off"}</span>
        </button>
      </div>
    </section>
  );
}

function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-muted">{label}</legend>
      <div className="flex rounded-md bg-chip p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={clsx(
              "min-h-11 flex-1 rounded-md px-2 text-sm font-medium",
              value === option.value ? "bg-blue text-paper" : "text-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Composer() {
  const prompt = useStudio((state) => state.prompt);
  const mode = useStudio((state) => state.mode);
  const busy = useStudio((state) => state.busy);
  const frame = useStudio((state) => state.frame);
  const duration = useStudio((state) => state.duration);
  const people = useStudio((state) => state.people);
  const sampleId = useStudio((state) => state.sampleId);
  const [idea, setIdea] = useState(0);
  const hasCharacter = people.length > 0;
  const custom = Boolean(frame && !frame.sampleId);
  const options = suggestionList(mode, prompt, sampleId, hasCharacter, custom);
  const active = options.length ? ((idea % options.length) + options.length) % options.length : 0;
  const remainder = options[active] ?? "";
  const visible = options.length
    ? Array.from({ length: Math.min(4, options.length) }, (_, offset) => {
        const index = (active + offset) % options.length;
        return { line: options[index] ?? "", index };
      })
    : [];
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setIdea(0);
  }, [mode, sampleId, hasCharacter, custom]);
  const blocked =
    busy || prompt.trim().length < 8 || (mode === "animate" && !frame) || (mode === "recast" && (!frame || people.length === 0));

  useEffect(() => {
    if (!remainder) {
      setShown(0);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(remainder.length);
      return;
    }
    let count = 0;
    setShown(0);
    const timer = window.setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= remainder.length) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
  }, [remainder]);

  function acceptLine(line: string) {
    const current = useStudio.getState().prompt;
    const cleaned = line.replace(/^\s+/, "");
    const value = !current.trim() ? cleaned : line.startsWith(" ") ? `${current}${line}` : `${current} ${cleaned}`;
    useStudio.getState().patch({ prompt: value.slice(0, 1800) });
  }

  return (
    <form
      className="safe-bottom shrink-0 border-t border-line bg-canvas px-4 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (mode === "recast") void runRecast();
        else void runRegen();
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3">
        <div className="flex items-center gap-2">
          <ModeChip id="animate" label="Animate" />
          <ModeChip id="recast" label="Recast" />
          <ModeChip id="prompt" label="From prompt" />
          <p className="ml-auto hidden text-xs text-faint sm:block">
            {mode === "recast" ? "Recast · 4K" : `${duration}s · 4K`}
          </p>
        </div>
        <VoiceField />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="sr-only">Motion</span>
            <div className="google-rainbow relative rounded-[28px] bg-paper p-px">
              <div className="relative">
                <div aria-hidden="true" className="pointer-events-none min-h-20 whitespace-pre-wrap px-4 py-3 text-sm leading-6">
                  <span className="text-transparent">{prompt}</span>
                  {remainder ? (
                    <span className="suggest-dots">
                      <span className="suggest-rainbow">{remainder.slice(0, shown)}</span>
                    </span>
                  ) : null}
                </div>
                <textarea
                  value={prompt}
                  onChange={(event) => useStudio.getState().patch({ prompt: event.target.value.slice(0, 1800) })}
                  onKeyDown={(event) => {
                    if (event.key === "Tab" && remainder) {
                      event.preventDefault();
                      acceptLine(remainder);
                      return;
                    }
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void (mode === "recast" ? runRecast() : runRegen());
                    }
                  }}
                  rows={2}
                  aria-describedby="prompt-suggestion"
                  placeholder=""
                  className="absolute inset-0 h-full w-full resize-none rounded-[27px] bg-transparent px-4 py-3 text-sm leading-6 text-ink caret-ink outline-none"
                />
              </div>
            </div>
          </label>
          <button
            type="submit"
            disabled={blocked}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-blue px-6 text-sm font-medium text-paper disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            {mode === "recast" ? "Recast" : "Regen"}
          </button>
        </div>
        <div id="prompt-suggestion" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {visible.length ? (
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                {visible.map((item) => (
                  <button
                    key={item.line}
                    type="button"
                    aria-pressed={item.index === active}
                    onClick={() => acceptLine(item.line)}
                    className={clsx(
                      "inline-flex h-11 shrink-0 items-center rounded-md px-3 text-left text-sm font-medium",
                      item.index === active ? "bg-blue text-paper" : "border border-line bg-chip text-ink",
                    )}
                  >
                    <span className="whitespace-nowrap">{item.line.trim()}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {options.length > 1 ? (
              <button
                type="button"
                onClick={() => setIdea((value) => value + 1)}
                className="inline-flex h-11 shrink-0 items-center rounded-md border border-line bg-chip px-3 text-sm font-medium text-ink"
              >
                Another
              </button>
            ) : null}
          </div>
          <p className="text-xs text-faint">
            {options.length > 1 ? `${active + 1} of ${options.length}. Tab adds the blue line. ` : ""}
            One clip at a time. Next 15s continues a finished video and joins that piece onto it.
          </p>
        </div>
      </div>
    </form>
  );
}

function ModeChip({ id, label }: { id: "animate" | "prompt" | "recast"; label: string }) {
  const mode = useStudio((state) => state.mode);
  return (
    <button
      type="button"
      aria-pressed={mode === id}
      onClick={() => useStudio.getState().patch({ mode: id })}
      className={clsx(
        "min-h-11 rounded-md px-4 text-sm font-medium",
        mode === id ? "bg-blue text-paper" : "bg-chip text-muted",
      )}
    >
      {label}
    </button>
  );
}

function LibraryView() {
  const jobs = useStudio((state) => state.jobs);
  if (jobs.length === 0) {
    return (
      <div className="grid flex-1 place-items-center rounded-lg border border-line bg-paper px-6 py-16 text-center">
        <div>
          <h2 className="text-lg font-semibold">Library is empty</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">Takes stay in this workspace, on every device that has joined it.</p>
          <button
            type="button"
            onClick={() => useStudio.getState().setView("studio")}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue px-5 text-sm font-medium text-paper"
          >
            Back to studio
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Library</h2>
          <p className="text-sm text-muted">Open a take on any device in this workspace.</p>
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => (
          <LibraryCard key={job.id} job={job} />
        ))}
      </ul>
    </div>
  );
}

function LibraryCard({ job }: { job: Job }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ready = job.status === "done" && Boolean(job.videoUrl);

  function open() {
    useStudio.getState().patch({
      activeId: job.id,
      view: "studio",
      prompt: job.prompt,
      dialogue: job.dialogue,
      camera: job.camera as CameraId,
      duration: job.duration,
      aspect: job.aspect,
      resolution: job.resolution,
      model: job.model,
      audio: job.audio,
      mode: job.mode,
    });
  }

  function play() {
    setPlaying(true);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void ensurePlay(video).catch(() => setPlaying(false));
  }

  return (
    <li className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="relative aspect-video bg-stage">
        {ready && job.videoUrl ? (
          <video
            ref={videoRef}
            src={job.videoUrl}
            poster={job.poster ?? undefined}
            controls={playing}
            playsInline
            onEnded={() => setPlaying(false)}
            className={clsx("h-full w-full object-contain", !playing && "hidden")}
          />
        ) : null}
        {!playing && job.poster ? <img src={job.poster} alt="" className="h-full w-full object-cover" /> : null}
        {ready && !playing ? <PlayButton onClick={play} /> : null}
      </div>
      <button type="button" onClick={open} className="block w-full px-3 py-3 text-left">
        <p className="line-clamp-2 text-sm font-medium">{job.prompt}</p>
        <p className="mt-1 text-xs text-muted">
          {labelStatus(job)} · {job.source === "copy" ? "Copy" : job.kind === "extend" ? "Piece" : job.mode === "recast" ? "Recast" : "Regen"} · {(job.seconds ?? job.duration)}s ·{" "}
          {job.upscale === "done" ? "4K" : job.upscale === "working" ? "Making 4K" : "1080"}
        </p>
      </button>
      <div className="flex items-center gap-2 px-3 pb-3">
        {ready ? (
          <button type="button" onClick={play} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-blue">
            <Play className="size-4 fill-current" aria-hidden="true" />
            Play
          </button>
        ) : null}
        {job.videoUrl ? (
          <button type="button" onClick={() => void saveClip(job.videoUrl as string)} className="text-xs font-medium text-muted">
            Download
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => useStudio.getState().removeJob(job.id)}
          className="ml-auto inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-chip"
          aria-label="Remove from library"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  );
}

function labelStatus(job: Job): string {
  if (job.status === "done") return "Ready";
  if (job.status === "failed") return "Failed";
  if (job.status === "rendering") return "Rendering";
  if (job.status === "queued" || job.status === "submitting") return "Queued";
  return job.status;
}

async function saveClip(url: string) {
  const src = clipSrc(url);
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("fetch");
    const blob = await response.blob();
    const object = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = object;
    link.download = "frameshift.mp4";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(object);
  } catch {
    window.open(src, "_blank", "noopener,noreferrer");
  }
}
