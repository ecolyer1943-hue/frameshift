import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 80_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function allowedVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.hostname !== "vidgen.x.ai" && !url.hostname.endsWith(".x.ai")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (host.includes(":")) return false;
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const a = parts[0] ?? 0;
      const b = parts[1] ?? 0;
      if (a === 0 || a === 10 || a === 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/clip")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url);
        const id = query.searchParams.get("id") ?? "";
        if (UUID.test(id)) {
          const dir = path.resolve("public/renders");
          const file = path.resolve(dir, `${id}.mp4`);
          if (file !== path.join(dir, `${id}.mp4`)) return new Response("Not found", { status: 404 });
          try {
            const info = await stat(file);
            const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
            return new Response(stream, {
              status: 200,
              headers: {
                "content-type": "video/mp4",
                "content-length": String(info.size),
                "cache-control": "private, max-age=3600",
              },
            });
          } catch {
            return new Response("Not found", { status: 404 });
          }
        }
        const target = allowedVideoUrl(query.searchParams.get("u") ?? "");
        if (!target) return new Response("Not found", { status: 404 });
        let upstream: Response;
        try {
          upstream = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
        } catch {
          return new Response("Could not load that clip.", { status: 502 });
        }
        if (!upstream.ok || !upstream.body || !publicHttps(upstream.url)) {
          return new Response("Could not load that clip.", { status: 502 });
        }
        const length = Number(upstream.headers.get("content-length") ?? "0");
        if (Number.isFinite(length) && length > MAX_BYTES) {
          return new Response("That clip is too large.", { status: 413 });
        }
        let seen = 0;
        const body = upstream.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              seen += chunk.byteLength;
              if (seen > MAX_BYTES) throw new Error("clip too large");
              controller.enqueue(chunk);
            },
          }),
        );
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "video/mp4",
            "cache-control": "private, max-age=60",
          },
        });
      },
    },
  },
});
