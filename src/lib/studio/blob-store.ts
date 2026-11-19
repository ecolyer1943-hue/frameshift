import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve("data/media");
const MAX_BYTES = 8_000_000;

export function mediaId(value: string): string | null {
  const match = /^media:([a-f0-9]{64})$/.exec(value.trim());
  return match?.[1] ?? null;
}

export function mediaIdFromSrc(value: string): string | null {
  try {
    const url = new URL(value, "http://studio.local");
    if (url.pathname !== "/api/media") return null;
    const id = url.searchParams.get("id") ?? "";
    return /^[a-f0-9]{64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function storeDataUrl(value: string): Promise<string> {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return value;
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 32) return value;
  if (bytes.length > MAX_BYTES) return "";
  const hash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, hash);
  try {
    await readFile(file);
  } catch {
    await writeFile(file, bytes);
    await writeFile(`${file}.mime`, match[1].toLowerCase());
  }
  return `media:${hash}`;
}

export async function readStored(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const file = path.join(DIR, id);
  try {
    const bytes = await readFile(file);
    const mime = (await readFile(`${file}.mime`, "utf8")).trim() || "application/octet-stream";
    return { mime, bytes };
  } catch {
    return null;
  }
}

export function showMedia(ref: string): string {
  const id = mediaId(ref);
  return id ? `/api/media?id=${id}` : ref;
}
