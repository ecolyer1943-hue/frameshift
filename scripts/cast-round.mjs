import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const round = process.argv[2] === "2" ? 2 : 1;
const key = process.env.XAI_API_KEY;
if (!key) throw new Error("missing key");

const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
const out = path.resolve("public/casts");
await mkdir(out, { recursive: true });

const sceneFile = round === 1 ? "public/samples/walk.jpg" : "public/samples/night.jpg";
const sceneName = round === 1 ? "Concrete room" : "Night street";
const editPrompt =
  "Replace only the person. The later image is the person who must appear: match their face, hair, age, and clothing. Keep the first image's pose, camera, lighting, and room. Remove every trace of the original face and clothes. One person only. No text, logos, or extra people.";

const people =
  round === 1
    ? [
        ["ada", "Ada", "Photographed portrait of a fictional woman in her sixties, silver hair pinned back, navy wool coat, pale wall, window light, head and shoulders, no text."],
        ["leo", "Leo", "Photographed portrait of a fictional young man with round glasses and a rumpled linen shirt, soft daylight, head and shoulders, no text."],
        ["nia", "Nia", "Photographed portrait of a fictional woman with short dark curls and a red scarf, grey studio wall, soft light, head and shoulders, no text."],
        ["omar", "Omar", "Photographed portrait of a fictional man in his forties with a short beard and a charcoal sweater, warm indoor light, head and shoulders, no text."],
        ["june", "June", "Photographed portrait of a fictional teenage girl with a single braid and a denim jacket, afternoon light, head and shoulders, no text."],
      ]
    : [
        ["ruth", "Ruth", "Photographed portrait of a fictional woman with a shaved head and one gold hoop earring, grey wall, soft light, head and shoulders, no text."],
        ["eli", "Eli", "Photographed portrait of a fictional older man with a grey beard and a wool cap, overcast daylight, head and shoulders, no text."],
        ["hana", "Hana", "Photographed portrait of a fictional woman with long black hair and a cream coat, pale background, soft light, head and shoulders, no text."],
        ["mateo", "Mateo", "Photographed portrait of a fictional man with freckles and a green field jacket, open sky behind him, head and shoulders, no text."],
        ["iris", "Iris", "Photographed portrait of a fictional woman with a pixie cut and round glasses, bookstore light, head and shoulders, no text."],
      ];

const motion =
  round === 1
    ? "They walk across the concrete room, slow down, and look back over one shoulder. Keep this person's face. Natural room light. No extra people and no text."
    : "They take two steps on the wet street and look back. Keep this person's face and their own clothes. Blue neon, no extra people and no text.";

function keysOf(body) {
  if (!body || typeof body !== "object") return typeof body;
  return Object.keys(body).join(",");
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 240) };
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.message || response.status;
    throw new Error(`${response.status} ${String(message).slice(0, 240)} keys=${keysOf(body)}`);
  }
  return body;
}

async function imageOf(body) {
  const first = Array.isArray(body?.data) ? body.data[0] : null;
  const b64 = first?.b64_json || body?.image?.base64 || body?.b64_json;
  if (typeof b64 === "string" && b64.length > 80) {
    const clean = b64.replace(/\s/g, "");
    const raw = clean.startsWith("data:") ? clean.split(",")[1] : clean;
    return Buffer.from(raw, "base64");
  }
  const url = first?.url || body?.image?.url || body?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error(`no image keys=${keysOf(body)} data=${keysOf(first)}`);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`image download ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function portrait(id, prompt) {
  const file = path.join(out, `${id}.jpg`);
  try {
    await readFile(file);
    return file;
  } catch {
    /* make it */
  }
  const body = await post("https://api.x.ai/v1/images/generations", {
    model: "grok-imagine-image-2.0",
    prompt: `${prompt} Photographic still, natural light, no text, no logos, no watermark.`,
    aspect_ratio: "3:4",
    resolution: "1k",
    response_format: "url",
    n: 1,
  });
  const bytes = await imageOf(body);
  await writeFile(file, bytes);
  return file;
}

async function recastStill(id, personFile) {
  const file = path.join(out, `${id}-still.jpg`);
  try {
    await readFile(file);
    return file;
  } catch {
    /* make it */
  }
  const scene = await readFile(sceneFile);
  const person = await readFile(personFile);
  const body = await post("https://api.x.ai/v1/images/edits", {
    model: "grok-imagine-image-2.0",
    prompt: editPrompt,
    images: [
      { type: "image_url", url: `data:image/jpeg;base64,${scene.toString("base64")}` },
      { type: "image_url", url: `data:image/jpeg;base64,${person.toString("base64")}` },
    ],
    response_format: "url",
  });
  const bytes = await imageOf(body);
  await writeFile(file, bytes);
  return file;
}

async function clip(id, stillFile) {
  const file = path.join(out, `${id}.mp4`);
  try {
    const existing = await readFile(file);
    if (existing.length > 50_000) return file;
  } catch {
    /* make it */
  }
  const still = await readFile(stillFile);
  const started = await post("https://api.x.ai/v1/videos/generations", {
    model: "grok-imagine-video-1.5",
    prompt: `${motion} Camera: a slow, subtle drift. The person in the image is the character.`,
    image: { url: `data:image/jpeg;base64,${still.toString("base64")}` },
    duration: 6,
    resolution: "720p",
  });
  const requestId = started.request_id || started.id;
  if (!requestId) throw new Error(`no request keys=${keysOf(started)}`);
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`poll ${response.status} ${body?.error?.message || ""}`);
    const status = String(body?.status || "").toLowerCase();
    const url = body?.video?.url || body?.url;
    if (url && (status === "done" || status === "completed" || status === "succeeded" || status === "")) {
      const video = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!video.ok) throw new Error(`video download ${video.status}`);
      const bytes = Buffer.from(await video.arrayBuffer());
      await writeFile(file, bytes);
      return file;
    }
    if (status === "failed" || status === "expired" || status === "error") {
      throw new Error(body?.error?.message || status || "failed");
    }
  }
  throw new Error("timed out");
}

const manifest = [];
for (const [id, name, prompt] of people) {
  const row = { round, id, name, scene: sceneName, portraitPrompt: prompt, editPrompt, motion, photo: "", still: "", video: "", error: "" };
  try {
    console.log(`portrait ${id}`);
    const photo = await portrait(id, prompt);
    row.photo = path.relative("public", photo);
    console.log(`still ${id}`);
    const still = await recastStill(id, photo);
    row.still = path.relative("public", still);
    console.log(`video ${id}`);
    const video = await clip(id, still);
    row.video = path.relative("public", video);
    console.log(`done ${id}`);
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
    console.log(`fail ${id}: ${row.error}`);
  }
  manifest.push(row);
  await writeFile(path.join(out, `round-${round}.json`), JSON.stringify(manifest, null, 2));
}
console.log(JSON.stringify(manifest.map((row) => ({ id: row.id, error: row.error, video: row.video }))));
