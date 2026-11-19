import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createFileRoute } from "@tanstack/react-router";

const ID = /^[a-f0-9]{64}$/;

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!ID.test(id)) return new Response("Not found", { status: 404 });
        const dir = path.resolve("data/media");
        const file = path.join(dir, id);
        if (path.dirname(file) !== dir) return new Response("Not found", { status: 404 });
        try {
          const info = await stat(file);
          const mime = await readFile(`${file}.mime`, "utf8").catch(() => "application/octet-stream");
          const type = mime.trim() || "application/octet-stream";
          const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
          return new Response(stream, {
            status: 200,
            headers: {
              "content-type": type,
              "content-length": String(info.size),
              "cache-control": "private, max-age=86400",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
