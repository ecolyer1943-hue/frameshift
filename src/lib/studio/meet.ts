import { createServerFn } from "@tanstack/react-start";

export type MeetRole = "room" | "ears";
export type MeetKind = "offer" | "answer" | "ice" | "bye" | "line" | "say";

type Note = {
  id: number;
  from: MeetRole;
  kind: MeetKind;
  body: string;
};

const boards = new Map<string, Note[]>();
let nextId = 1;
const replyTimes: number[] = [];
const HOUR_MS = 60 * 60 * 1000;

function codeOf(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9]{6,12}$/.test(code)) throw new Error("Open Studio once so this device has a workspace.");
  return code;
}

function roleOf(value: unknown): MeetRole {
  if (value === "room" || value === "ears") return value;
  throw new Error("Choose a seat.");
}

function kindOf(value: unknown): MeetKind {
  if (value === "offer" || value === "answer" || value === "ice" || value === "bye" || value === "line" || value === "say") {
    return value;
  }
  throw new Error("That signal is not valid.");
}

function board(code: string): Note[] {
  const found = boards.get(code);
  if (found) return found;
  const notes: Note[] = [];
  boards.set(code, notes);
  return notes;
}

function apiKey(): string | null {
  const key = process.env.XAI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function takeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function audioFile(dataUrl: string): { bytes: Buffer; mime: string; ext: string } | null {
  const match = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 400 || bytes.length > 1_500_000) return null;
  const mime = match[1].toLowerCase();
  const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "webm";
  return { bytes, mime, ext };
}

function allowReply(): boolean {
  const now = Date.now();
  while (replyTimes.length && now - replyTimes[0] > HOUR_MS) replyTimes.shift();
  if (replyTimes.length >= 30) return false;
  replyTimes.push(now);
  return true;
}

async function speak(text: string, key: string): Promise<string | null> {
  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 280), voice_id: "eve" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 80) return null;
  const mime = response.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export const meetPost = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const body = typeof record?.body === "string" ? record.body.slice(0, 20_000) : "";
    return { code: codeOf(record?.code), role: roleOf(record?.role), kind: kindOf(record?.kind), body };
  })
  .handler(async ({ data }) => {
    const notes = board(data.code);
    const note: Note = { id: nextId++, from: data.role, kind: data.kind, body: data.body };
    notes.push(note);
    if (notes.length > 80) notes.splice(0, notes.length - 80);
    return { ok: true as const, id: note.id };
  });

export const meetPull = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const after = typeof record?.after === "number" && record.after >= 0 ? record.after : 0;
    return { code: codeOf(record?.code), role: roleOf(record?.role), after };
  })
  .handler(async ({ data }) => {
    const notes = board(data.code).filter((note) => note.from !== data.role && note.id > data.after);
    return { ok: true as const, notes };
  });

export const meetReply = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const text = takeString(record?.text)?.slice(0, 280) ?? "";
    const audioDataUrl = takeString(record?.audioDataUrl) ?? "";
    if (!text && !audioFile(audioDataUrl)) throw new Error("Nothing to say.");
    return { text, audioDataUrl };
  })
  .handler(async ({ data }) => {
    const key = apiKey();
    if (!key) return { ok: false as const, error: "The meeting voice is not available in this environment." };
    if (!allowReply()) return { ok: false as const, error: "The meeting voice is resting. Try again in a little while." };

    if (data.text) {
      const audio = await speak(data.text, key);
      if (!audio) return { ok: false as const, error: "That line did not get a voice." };
      return { ok: true as const, heard: "", say: data.text, audio };
    }

    const audio = audioFile(data.audioDataUrl);
    if (!audio) return { ok: false as const, error: "That piece of the meeting could not be read." };
    const form = new FormData();
    form.append("model", "grok-voice-transcribe-2.0");
    form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), `room.${audio.ext}`);
    let heard = "";
    try {
      const response = await fetch("https://api.x.ai/v1/stt", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      heard = (takeString(asRecord(body)?.text) ?? "").slice(0, 500);
    } catch {
      return { ok: false as const, error: "Could not hear the meeting." };
    }
    if (heard.length < 2) return { ok: true as const, heard: "", say: "", audio: "" };

    let say = "";
    try {
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 80,
          messages: [
            {
              role: "user",
              content: `You are sitting in a meeting in place of the user. They are listening live on AirPods and can speak themselves. What was just said:\n"""${heard}"""\nIf nobody is asking them a question or waiting on an answer, reply with exactly SILENT. Otherwise reply with one short spoken sentence they would actually say. No quotes.`,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] };
      say = (body.choices?.[0]?.message?.content ?? "").trim().slice(0, 280);
    } catch {
      return { ok: true as const, heard, say: "", audio: "" };
    }
    if (!say || /^silent\.?$/i.test(say)) return { ok: true as const, heard, say: "", audio: "" };
    const voice = await speak(say, key);
    return { ok: true as const, heard, say, audio: voice ?? "" };
  });
