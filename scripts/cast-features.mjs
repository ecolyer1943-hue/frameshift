import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const key = process.env.XAI_API_KEY;
if (!key) throw new Error("missing key");
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
const out = path.resolve("public/casts/deep");
await mkdir(out, { recursive: true });

const CAMERAS = {
  hold: "The camera stays locked off, almost still.",
  push: "A slow, steady dolly push toward the subject.",
  orbit: "A gentle orbit around the subject, smooth and unhurried.",
  drift: "Subtle handheld drift, natural and quiet.",
  rise: "A slow crane rise, revealing a little more of the scene.",
  rack: "A slow rack of focus from the subject into the background.",
};

function sound(dialogue, audio) {
  if (!dialogue && !audio) return "Silent picture. No dialogue, no music, no voiceover.";
  if (!dialogue) return "Sound as if a microphone was in the room: footsteps, cloth, breath, and the place itself. No music, no voiceover, no announcer.";
  return `The person speaks on set, close and human, with real breaths and the pace of the moment. Their mouth matches the words. Not a narrator, not a commercial read, and no music under the line. They say: "${dialogue}".`;
}

function compose({ prompt, camera, image, continuation, holdSubject, holdSetting, end, dialogue, audio }) {
  const parts = [prompt.trim(), `Camera: ${CAMERAS[camera]}`];
  if (image) {
    if (continuation) {
      parts.push("This image is the last frame of the previous shot. Continue the same subject, setting, lighting, and image quality. Do not restart, restyle, or add text, logos, or new people.");
    } else {
      const locks = [
        holdSubject ? "Preserve the subject and identity." : "The subject may change if the motion asks for it.",
        holdSetting ? "Preserve the setting, materials, and lighting." : "The setting may shift with the motion.",
      ];
      if (end) locks.push("The second image is the last frame. Arrive there smoothly, without a cut.");
      parts.push(`The provided image is frame one. ${locks.join(" ")} Add only the described motion. Do not add text, logos, or new people.`);
    }
  }
  parts.push(sound(dialogue, audio));
  return parts.filter(Boolean).join(" ");
}

const swap =
  "Replace only the person. The later images are the person who must appear: match their face, hair, age, and clothing. Keep the first image's pose, camera, lighting, and room. Remove every trace of the original face and clothes. One person only. No text, logos, or extra people.";

function keysOf(body) {
  if (!body || typeof body !== "object") return typeof body;
  return Object.keys(body).join(",");
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
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
    throw new Error(`${response.status} ${String(message).slice(0, 280)}`);
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
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error(`no image keys=${keysOf(body)}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(40_000) });
  if (!response.ok) throw new Error(`image download ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function cached(file, make) {
  try {
    const existing = await readFile(file);
    if (existing.length > 8_000) return existing;
  } catch {
    /* missing */
  }
  const bytes = await make();
  await writeFile(file, bytes);
  return bytes;
}

function dataUrl(bytes) {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function still(file, prompt, aspect = "3:4") {
  return cached(file, async () => {
    const body = await post("https://api.x.ai/v1/images/generations", {
      model: "grok-imagine-image-2.0",
      prompt: `${prompt} Photographic still, natural light, no text, no logos, no watermark.`,
      aspect_ratio: aspect,
      resolution: "1k",
      response_format: "url",
      n: 1,
    });
    return imageOf(body);
  });
}

async function edit(file, sceneBytes, people, prompt = swap) {
  return cached(file, async () => {
    const body = await post("https://api.x.ai/v1/images/edits", {
      model: "grok-imagine-image-2.0",
      prompt,
      images: [sceneBytes, ...people].map((bytes) => ({ type: "image_url", url: dataUrl(bytes) })),
      response_format: "url",
    });
    return imageOf(body);
  });
}

async function video(file, { prompt, image, end, duration, aspect, audio, resolution = "1080p" }) {
  try {
    const existing = await readFile(file);
    if (existing.length > 80_000) return existing;
  } catch {
    /* missing */
  }
  const payload = { model: "grok-imagine-video-1.5", prompt, duration, resolution };
  if (image) {
    payload.image = { url: dataUrl(image) };
    if (end) payload.last_frame = { url: dataUrl(end) };
  } else payload.aspect_ratio = aspect;
  if (!audio) payload.generate_audio = false;
  let started;
  try {
    started = await post("https://api.x.ai/v1/videos/generations", payload);
  } catch (error) {
    if (resolution === "1080p") return video(file, { prompt, image, end, duration, aspect, audio, resolution: "720p" });
    throw error;
  }
  const requestId = started.request_id || started.id;
  if (!requestId) throw new Error(`no request keys=${keysOf(started)}`);
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const response = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`poll ${response.status} ${body?.error?.message || ""}`);
    const status = String(body?.status || "").toLowerCase();
    const url = body?.video?.url || body?.url;
    if (url && (status === "done" || status === "completed" || status === "succeeded" || status === "")) {
      const clip = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!clip.ok) throw new Error(`video download ${clip.status}`);
      const bytes = Buffer.from(await clip.arrayBuffer());
      await writeFile(file, bytes);
      return bytes;
    }
    if (status === "failed" || status === "expired" || status === "error") throw new Error(body?.error?.message || status);
  }
  throw new Error("timed out");
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
}

async function lastFrame(videoFile, imageFile) {
  try {
    return await readFile(imageFile);
  } catch {
    await ffmpeg(["-y", "-sseof", "-0.2", "-i", videoFile, "-frames:v", "1", imageFile]);
    return readFile(imageFile);
  }
}

const rows = [];
async function note(row) {
  rows.push(row);
  await writeFile(path.join(out, "manifest.json"), JSON.stringify(rows, null, 2));
  console.log(row.error ? `fail ${row.id}: ${row.error}` : `done ${row.id}`);
}

async function run(id, work) {
  const row = { id, error: "" };
  try {
    Object.assign(row, await work(row));
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  }
  await note(row);
}

await run("soren", async () => {
  const prompt = "He sets a watering can down, wipes one hand on his shirt, and looks at the plants.";
  const full = compose({ prompt, camera: "hold", image: true, holdSubject: true, holdSetting: true, dialogue: "", audio: true });
  const scene = await still(path.join(out, "soren-room.jpg"), "Empty glass greenhouse, wet concrete path, late morning, no people, no text.", "16:9");
  const person = await still(path.join(out, "soren.jpg"), "Fictional man about thirty, short blond hair, rust work shirt, dirt on one cuff, head and shoulders.");
  const frame = await edit(path.join(out, "soren-still.jpg"), scene, [person]);
  await video(path.join(out, "soren.mp4"), { prompt: full, image: frame, duration: 10, audio: true });
  return { name: "Soren", method: "One sentence", feature: "Recast, Hold camera, room sound, locks on", seconds: 10, prompt, composed: full, photo: "casts/deep/soren.jpg", video: "casts/deep/soren.mp4" };
});

await run("mara", async () => {
  const prompt = "1. She is at the stove, not looking up. 2. She turns the burner off. 3. She looks toward the doorway and speaks. 4. She waits, one hand still on the kettle.";
  const dialogue = "I left the kettle on. Give me one minute.";
  const full = compose({ prompt, camera: "push", image: true, holdSubject: true, holdSetting: true, dialogue, audio: true });
  const scene = await still(path.join(out, "mara-room.jpg"), "Small morning kitchen, one wooden chair, a steel kettle, window light, no people, no text.", "16:9");
  const person = await still(path.join(out, "mara.jpg"), "Fictional woman with a silver buzz cut and a mustard cardigan, about fifty, head and shoulders, morning light.");
  const frame = await edit(path.join(out, "mara-still.jpg"), scene, [person]);
  await video(path.join(out, "mara.mp4"), { prompt: full, image: frame, duration: 15, audio: true });
  return { name: "Mara", method: "Numbered shot list plus a spoken line", feature: "Recast, Push in, dialogue, 15 seconds", seconds: 15, prompt, dialogue, composed: full, photo: "casts/deep/mara.jpg", video: "casts/deep/mara.mp4" };
});

await run("kenji", async () => {
  const prompt = "Do not add anyone. Do not change the room. Do not cut. He only closes the book and looks down.";
  const full = compose({ prompt, camera: "orbit", image: true, holdSubject: true, holdSetting: true, end: true, dialogue: "", audio: false });
  const open = await still(path.join(out, "kenji.jpg"), "Fictional man in his seventies, grey cardigan, reading glasses on a cord, holding an open book, seated, square frame, no text.", "1:1");
  const shut = await still(path.join(out, "kenji-end.jpg"), "Same fictional man in his seventies, grey cardigan, glasses on a cord, the book now closed on his lap, he looks down, square frame, no text.", "1:1");
  await video(path.join(out, "kenji.mp4"), { prompt: full, image: open, end: shut, duration: 10, audio: false });
  return { name: "Kenji", method: "Negatives first, then the only action", feature: "Animate, end frame, Orbit, silent, square", seconds: 10, prompt, composed: full, photo: "casts/deep/kenji.jpg", video: "casts/deep/kenji.mp4" };
});

await run("priya", async () => {
  const prompt = "One woman in a cobalt headscarf waits on an empty train platform. She checks the board, takes two steps, and stops at the yellow line. Fluorescent light. No one else.";
  const dialogue = "This is my stop. Don't wait up.";
  const full = compose({ prompt, camera: "rise", image: false, dialogue, audio: true });
  await video(path.join(out, "priya.mp4"), { prompt: full, duration: 15, aspect: "9:16", audio: true });
  return { name: "Priya", method: "Text only. No photograph.", feature: "From prompt, Rise, 9:16, dialogue, 15 seconds", seconds: 15, prompt, dialogue, composed: full, video: "casts/deep/priya.mp4" };
});

await run("wes", async () => {
  const prompt = "He walks through the grass, raises one hand against the sun, and keeps going. Let the field breathe.";
  const full = compose({ prompt, camera: "drift", image: true, holdSubject: true, holdSetting: false, dialogue: "", audio: true });
  const field = await readFile(path.resolve("public/samples/field.jpg"));
  const front = await still(path.join(out, "wes.jpg"), "Fictional man with a sunburn and a faded green baseball cap, linen shirt, facing camera, head and shoulders.");
  const side = await still(path.join(out, "wes-side.jpg"), "The same fictional man with a sunburn and a faded green baseball cap, linen shirt, three-quarter view, head and shoulders.");
  const frame = await edit(path.join(out, "wes-still.jpg"), field, [front, side]);
  await video(path.join(out, "wes.mp4"), { prompt: full, image: frame, duration: 10, audio: true });
  return { name: "Wes", method: "Two photographs, front and three-quarter", feature: "Recast onto Linen, Drift, setting lock off", seconds: 10, prompt, composed: full, photo: "casts/deep/wes.jpg", video: "casts/deep/wes.mp4" };
});

await run("lila", async () => {
  const prompt = "Keep the drawing. The figure turns their head, then takes one step. Ink line, flat color, cream paper. Do not turn it into a photograph.";
  const full = compose({ prompt, camera: "hold", image: true, holdSubject: true, holdSetting: true, dialogue: "", audio: false });
  const ink = await readFile(path.resolve("public/samples/ink.jpg"));
  const person = await still(path.join(out, "lila.jpg"), "Fictional woman with cropped black hair and a paint-stained grey shirt, head and shoulders, plain wall.");
  const frame = await edit(path.join(out, "lila-still.jpg"), ink, [person], "Redraw the figure as the person in the later image, in the same ink-line style, flat red kept only if it suits them, cream paper, same pose. No text, no extra people, do not make it a photograph.");
  await video(path.join(out, "lila.mp4"), { prompt: full, image: frame, duration: 10, audio: false });
  return { name: "Lila", method: "Style note. Stay a drawing.", feature: "Recast onto Red coat, Hold, silent", seconds: 10, prompt, composed: full, photo: "casts/deep/lila.jpg", video: "casts/deep/lila.mp4" };
});

await run("jonah", async () => {
  const prompt = "Lens: 85mm. Light: one hard source from the left. Blocking: they lift their chin, turn left, and hold. The focus then slips off them onto the empty studio behind.";
  const dialogue = "Hold still. The light is almost right.";
  const full = compose({ prompt, camera: "rack", image: true, holdSubject: true, holdSetting: true, dialogue, audio: true });
  const ivory = await readFile(path.resolve("public/samples/ivory.jpg"));
  const person = await still(path.join(out, "jonah.jpg"), "Fictional person with a sharp black bob and a pale blue shirt, pearl stud, about forty, head and shoulders, soft daylight.");
  const frame = await edit(path.join(out, "jonah-still.jpg"), ivory, [person]);
  await video(path.join(out, "jonah.mp4"), { prompt: full, image: frame, duration: 15, audio: true });
  return { name: "Jonah", method: "Director's notes: lens, light, blocking", feature: "Recast onto Ivory suit, Rack, dialogue, 15 seconds", seconds: 15, prompt, dialogue, composed: full, photo: "casts/deep/jonah.jpg", video: "casts/deep/jonah.mp4" };
});

await run("noor", async () => {
  const prompt = "She stands by the window of an empty train car. The car rocks once. She looks at her reflection, then back to the window.";
  const full = compose({ prompt, camera: "drift", image: true, holdSubject: true, holdSetting: true, dialogue: "", audio: true });
  const scene = await still(path.join(out, "noor-room.jpg"), "Empty train car interior, dusk outside the window, one seat, no people, no text.", "16:9");
  const person = await still(path.join(out, "noor.jpg"), "Fictional woman with shoulder-length locs and a brown leather jacket, about thirty-five, head and shoulders.");
  const frame = await edit(path.join(out, "noor-still.jpg"), scene, [person]);
  const clip = path.join(out, "noor.mp4");
  await video(clip, { prompt: full, image: frame, duration: 10, audio: true });
  const end = await lastFrame(clip, path.join(out, "noor-last.jpg"));
  const next = "She sits, sets the bag on the next seat, and looks out as the lights outside start to move.";
  const extended = compose({ prompt: next, camera: "hold", image: true, continuation: true, dialogue: "", audio: true });
  await video(path.join(out, "noor-extended.mp4"), { prompt: extended, image: end, duration: 15, audio: true });
  return { name: "Noor", method: "A second prompt that continues the last frame", feature: "Animate, then Extend to 25 seconds, Drift then Hold", seconds: 25, prompt, next, composed: full, extended, photo: "casts/deep/noor.jpg", video: "casts/deep/noor-extended.mp4" };
});

console.log(JSON.stringify(rows.map((row) => ({ id: row.id, error: row.error, video: row.video }))));
