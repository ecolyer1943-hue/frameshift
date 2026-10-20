import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, MicOff } from "lucide-react";
import { clsx } from "clsx";
import { onPhone } from "@/lib/studio/live";
import { meetPost, meetPull, meetReply, type MeetKind, type MeetRole } from "@/lib/studio/meet";
import { subscribeSync } from "@/lib/studio/sync-client";

type Line = { id: number; heard: string; say: string };

const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

export function MeetView() {
  const [code, setCode] = useState("");
  const [role, setRole] = useState<MeetRole>("room");
  const [live, setLive] = useState(false);
  const [linked, setLinked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [attending, setAttending] = useState(false);
  const [status, setStatus] = useState("Choose a seat, then open the other one on your AirPods.");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [phone, setPhone] = useState(false);
  const roomAudio = useRef<HTMLAudioElement>(null);
  const earsAudio = useRef<HTMLAudioElement>(null);
  const keepVideo = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteSet = useRef(false);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const afterRef = useRef(0);
  const liveRef = useRef(false);
  const roleRef = useRef<MeetRole>("room");
  const attendRef = useRef(false);
  const heardRef = useRef<MediaStream | null>(null);
  const lineId = useRef(1);

  useEffect(() => subscribeSync((snapshot) => setCode(snapshot.code)), []);

  useEffect(() => {
    const phoneNow = onPhone();
    setPhone(phoneNow);
    setRole(phoneNow ? "ears" : "room");
  }, []);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    attendRef.current = attending;
  }, [attending]);

  function addLine(heard: string, say: string) {
    const line = { id: lineId.current++, heard, say };
    setLines((current) => [line, ...current].slice(0, 12));
  }

  async function post(kind: MeetKind, body: string) {
    if (!code) return;
    await meetPost({ data: { code, role: roleRef.current, kind, body } });
  }

  async function playVoice(src: string) {
    const audio = new Audio(src);
    audio.setAttribute("playsinline", "true");
    await audio.play().catch(() => setError("The spoken line could not play into the meeting."));
  }

  async function sayText(text: string) {
    const clean = text.trim().slice(0, 280);
    if (!clean) return;
    setStatus("Speaking into the meeting.");
    const result = await meetReply({ data: { text: clean, audioDataUrl: "" } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.audio) await playVoice(result.audio);
    addLine("", result.say);
    await post("line", JSON.stringify({ heard: "", say: result.say }));
    setStatus(linked ? "Live. The other seat can hear you." : "Waiting for the other seat.");
  }

  async function flushIce() {
    const pc = pcRef.current;
    if (!pc || !remoteSet.current) return;
    const queued = iceQueue.current.splice(0);
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  function makePeer() {
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;
    remoteSet.current = false;
    iceQueue.current = [];
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void post("ice", JSON.stringify(event.candidate.toJSON()));
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        setLinked(true);
        setStatus("Live. You can talk, and the meeting can hear this computer.");
      }
      if (state === "failed" || state === "disconnected") setStatus("The link dropped. Stop, then start again.");
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const audio = roleRef.current === "ears" ? earsAudio.current : roomAudio.current;
      if (!audio || !stream) return;
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      setLinked(true);
    };
    return pc;
  }

  async function onNote(kind: MeetKind, body: string) {
    const pc = pcRef.current;
    if (kind === "bye") {
      setLinked(false);
      setStatus("The other seat left. You can keep listening here.");
      return;
    }
    if (kind === "line" || kind === "say") {
      if (kind === "say" && roleRef.current === "room") {
        await sayText(body);
        return;
      }
      try {
        const parsed = JSON.parse(body) as { heard?: string; say?: string };
        if (parsed.heard || parsed.say) addLine(parsed.heard ?? "", parsed.say ?? "");
      } catch {
        if (body) addLine("", body);
      }
      return;
    }
    if (!pc) return;
    if (kind === "offer" && roleRef.current === "ears") {
      await pc.setRemoteDescription({ type: "offer", sdp: body });
      remoteSet.current = true;
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await post("answer", answer.sdp ?? "");
      return;
    }
    if (kind === "answer" && roleRef.current === "room") {
      await pc.setRemoteDescription({ type: "answer", sdp: body });
      remoteSet.current = true;
      await flushIce();
      return;
    }
    if (kind === "ice") {
      const candidate = JSON.parse(body) as RTCIceCandidateInit;
      if (!remoteSet.current) iceQueue.current.push(candidate);
      else await pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  useEffect(() => {
    if (!live || !code) return;
    let stop = false;
    async function poll() {
      while (!stop && liveRef.current) {
        try {
          const result = await meetPull({ data: { code, role: roleRef.current, after: afterRef.current } });
          if (result.ok) {
            for (const note of result.notes) {
              afterRef.current = note.id;
              await onNote(note.kind, note.body);
            }
          }
        } catch {
          setError("The two seats lost the workspace for a moment.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
    }
    void poll();
    return () => {
      stop = true;
    };
    // The poll reads the peer through refs. Restarting it on every render would drop signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, code]);

  useEffect(() => {
    if (!attending || role !== "room") return;
    let stop = false;
    let used = 0;
    async function listen() {
      while (!stop && attendRef.current && used < 20) {
        const stream = heardRef.current;
        if (!stream || stream.getAudioTracks().length === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          continue;
        }
        const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.start();
        await new Promise((resolve) => window.setTimeout(resolve, 12_000));
        if (recorder.state !== "inactive") {
          recorder.stop();
          await new Promise((resolve) => {
            recorder.onstop = () => resolve(null);
          });
        }
        if (stop || !attendRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 800) continue;
        used += 1;
        const audioDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("read"));
          reader.readAsDataURL(blob);
        });
        const result = await meetReply({ data: { text: "", audioDataUrl } }).catch(() => null);
        if (!result || !result.ok) continue;
        if (result.heard || result.say) {
          addLine(result.heard, result.say);
          await post("line", JSON.stringify({ heard: result.heard, say: result.say }));
        }
        if (result.audio) await playVoice(result.audio);
      }
      if (used >= 20) setStatus("The AI has held the seat for this stretch. You can still talk.");
    }
    void listen();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attending, role]);

  async function start(source: "tab" | "mic") {
    setError(null);
    if (!code) {
      setError("Open Studio once so this device joins the workspace, then come back.");
      return;
    }
    stop(false);
    afterRef.current = 0;
    const pc = makePeer();
    try {
      const stream =
        source === "tab"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localRef.current = stream;
      if (roleRef.current === "room") heardRef.current = new MediaStream(stream.getAudioTracks());
      for (const track of stream.getAudioTracks()) {
        if (roleRef.current === "ears") track.enabled = !muted;
        pc.addTrack(track, stream);
      }
      if (source === "tab" && keepVideo.current) {
        keepVideo.current.srcObject = stream;
        void keepVideo.current.play().catch(() => undefined);
      }
      if (source === "tab" && stream.getAudioTracks().length === 0) {
        setError("Turn on Share audio for the meeting tab, or use the microphone.");
      }
      liveRef.current = true;
      setLive(true);
      setStatus(
        roleRef.current === "room"
          ? "In the meeting. Open Meetings on your AirPods and choose that seat."
          : "Waiting for the computer that is in the meeting. Talk once it connects.",
      );
      if (roleRef.current === "room") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await post("offer", offer.sdp ?? "");
      }
    } catch {
      stop(false);
      setError(source === "tab" ? "The meeting tab was not shared." : "The microphone did not open.");
    }
  }

  function stop(sendBye = true) {
    liveRef.current = false;
    setLive(false);
    setLinked(false);
    setAttending(false);
    if (sendBye) void post("bye", "");
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    heardRef.current = null;
    if (roomAudio.current) roomAudio.current.srcObject = null;
    if (earsAudio.current) earsAudio.current.srcObject = null;
    if (keepVideo.current) keepVideo.current.srcObject = null;
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-12 xl:items-start">
      <section className="order-2 rounded-lg border border-line bg-paper p-4 xl:order-1 xl:col-span-3">
        <h2 className="text-sm font-medium">Seat</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          {phone
            ? "This phone is the AirPods seat. The computer stays in the meeting."
            : "This computer sits in the meeting. Your AirPods join from the phone."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-md bg-chip p-1">
          {([
            ["room", "In the meeting"],
            ["ears", "AirPods"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={live}
              aria-pressed={role === id}
              onClick={() => setRole(id)}
              className={clsx("min-h-11 rounded-md px-2 text-sm font-medium disabled:opacity-40", role === id ? "bg-blue text-paper" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>
        {role === "room" ? (
          <>
            <button
              type="button"
              onClick={() => (live ? stop() : void start("tab"))}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-blue text-sm font-medium text-paper"
            >
              {live ? "Leave the seat" : "Hear the meeting tab"}
            </button>
            <button
              type="button"
              onClick={() => void start("mic")}
              disabled={live}
              className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-chip text-sm font-medium disabled:opacity-40"
            >
              Use this microphone
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => (live ? stop() : void start("mic"))}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-blue text-sm font-medium text-paper"
          >
            <Headphones className="size-4" aria-hidden="true" />
            {live ? "Hang up" : "Listen with AirPods"}
          </button>
        )}
        <button
          type="button"
          onClick={toggleMute}
          disabled={!live}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-chip text-sm font-medium disabled:opacity-40"
        >
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          {muted ? "Unmute" : "Mute"}
        </button>
        {role === "room" ? (
          <button
            type="button"
            aria-pressed={attending}
            disabled={!live}
            onClick={() => setAttending((value) => !value)}
            className={clsx(
              "mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md text-sm font-medium disabled:opacity-40",
              attending ? "bg-blue text-paper" : "border border-line bg-chip",
            )}
          >
            {attending ? "AI is attending" : "Let the AI attend"}
          </button>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      <section className="google-rainbow order-1 rounded-lg border border-transparent bg-stage p-4 xl:order-2 xl:col-span-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{linked ? "Live" : live ? "Connecting" : "Idle"}</p>
        <h2 className="mt-3 text-lg font-medium text-stage-fg">Meetings</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{status}</p>
        <audio ref={roomAudio} autoPlay playsInline className="hidden" />
        <audio ref={earsAudio} autoPlay playsInline className="hidden" />
        <video ref={keepVideo} muted playsInline className="hidden" />
        <ul className="mt-4 space-y-3">
          {lines.length === 0 ? <li className="text-sm text-faint">Nothing said yet.</li> : null}
          {lines.map((line) => (
            <li key={line.id} className="text-sm leading-6">
              {line.heard ? <p className="text-muted">{line.heard}</p> : null}
              {line.say ? <p className="text-stage-fg">{line.say}</p> : null}
            </li>
          ))}
        </ul>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            setDraft("");
            if (!text) return;
            if (role === "ears") void post("say", text);
            else void sayText(text);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 280))}
            placeholder={role === "ears" ? "Say this into the meeting" : "Speak this line"}
            className="min-h-11 w-full rounded-md border border-line bg-canvas px-3 text-sm"
          />
          <button type="submit" className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-blue px-4 text-sm font-medium text-paper">
            Say
          </button>
        </form>
      </section>

      <section className="order-3 rounded-lg border border-line bg-paper p-4 xl:col-span-3">
        <h2 className="text-sm font-medium">How the seats work</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Put the computer in the meeting and share that tab with audio. Open this same workspace on the phone, choose AirPods, and listen.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Your voice comes out of the computer. Point the meeting microphone at that, or at a virtual cable, so the room hears you and the AI.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          The AI speaks only when the room is waiting on you. Mute it and talk yourself whenever you want.
        </p>
      </section>
    </div>
  );
}
