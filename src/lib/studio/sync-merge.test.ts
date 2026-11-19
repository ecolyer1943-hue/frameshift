import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEVICE_TTL_MS,
  REMOVED_CAP,
  acceptRemote,
  freshDevices,
  mergeJobs,
  mergePushedState,
  mergeRemoved,
  parseCode,
  parseDevice,
  parseWorkspace,
  isMissingFile,
  serial,
  touchDevices,
  type FieldClock,
  type MergeDevice,
  type MergeJob,
  type Tombstone,
} from "./sync-merge.ts";

function job(id: string, at: number, extra: Record<string, unknown> = {}): MergeJob & Record<string, unknown> {
  return { id, createdAt: at, updatedAt: at, ...extra };
}

function device(id: string, seen: number): MergeDevice {
  return { id, platform: "web", label: id, seen };
}

test("newer take wins, and a tie keeps the incoming copy", () => {
  const remote = [job("a", 10, { prompt: "remote" })];
  const older = mergeJobs([job("a", 5, { prompt: "old" })], remote);
  assert.equal(older[0]?.prompt, "remote");
  const newer = mergeJobs([job("a", 15, { prompt: "new" })], remote);
  assert.equal(newer[0]?.prompt, "new");
  const tie = mergeJobs([job("a", 10, { prompt: "incoming" })], remote);
  assert.equal(tie[0]?.prompt, "incoming");
});

test("a take that exists on only one side is kept", () => {
  const merged = mergeJobs([job("local", 2)], [job("remote", 9)]);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["remote", "local"],
  );
});

test("missing timestamps count as zero, and blank ids are dropped", () => {
  const merged = mergeJobs([{ id: "" }, { id: "bare" }], [job("dated", 3)]);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["dated", "bare"],
  );
});

test("only the sixteen newest takes are kept", () => {
  const local = Array.from({ length: 20 }, (_, index) => job(`j${index}`, index + 1));
  const merged = mergePushedState(null, { jobs: local, removed: [], clocks: {}, restored: [] });
  assert.equal(merged.jobs.length, 16);
  assert.equal(merged.jobs[0]?.id, "j19");
  assert.equal(merged.jobs.at(-1)?.id, "j4");
});

test("a deleted take does not come back from the other device", () => {
  const previous = {
    jobs: [job("keep", 5), job("extra", 4)],
    removed: [] as Tombstone[],
    clocks: {} as FieldClock,
    restored: [] as string[],
    prompt: "old",
  };
  const deleted = mergePushedState(previous, {
    jobs: [job("keep", 5)],
    removed: [{ id: "keep", at: 0 }],
    clocks: {} as FieldClock,
    restored: [] as string[],
    prompt: "still here",
  });
  assert.deepEqual(
    deleted.jobs.map((item) => item.id),
    ["extra"],
  );
  assert.equal(deleted.prompt, "still here");

  const otherSideStillHasIt = mergePushedState(deleted, {
    jobs: [job("keep", 9), job("extra", 4), job("fresh", 8)],
    removed: [] as Tombstone[],
    clocks: {} as FieldClock,
    restored: [] as string[],
    prompt: "from the phone",
  });
  assert.deepEqual(
    otherSideStillHasIt.jobs.map((item) => item.id),
    ["fresh", "extra"],
  );
  assert.ok(otherSideStillHasIt.removed.some((item) => item.id === "keep"));
});

test("removing a take and adding another survive either order", async () => {
  const key = `order-${Date.now()}`;
  const box: { jobs: MergeJob[]; removed: Tombstone[]; prompt: string } = {
    jobs: [job("keep", 5)],
    removed: [],
    prompt: "start",
  };
  const write = (incoming: { jobs: MergeJob[]; removed: Array<string | Tombstone>; prompt: string }, wait: number) =>
    serial(key, async () => {
      const previous = box;
      await new Promise((resolve) => setTimeout(resolve, wait));
      const next = mergePushedState(previous, incoming);
      box.jobs = next.jobs;
      box.removed = next.removed;
      box.prompt = next.prompt;
    });
  await Promise.all([
    write({ jobs: [], removed: ["keep"], prompt: "deleted on the computer" }, 30),
    write({ jobs: [job("keep", 5), job("fresh", 8)], removed: [], prompt: "added on the phone" }, 10),
  ]);
  assert.deepEqual(
    box.jobs.map((item) => item.id),
    ["fresh"],
  );
  assert.ok(box.removed.some((item) => item.id === "keep"));
});

test("two overlapping saves both keep their new takes", async () => {
  const key = `both-${Date.now()}`;
  const box: { jobs: MergeJob[]; removed: Tombstone[]; prompt: string } = { jobs: [job("base", 1)], removed: [], prompt: "base" };
  const write = (incoming: { jobs: MergeJob[]; removed: Array<string | Tombstone>; prompt: string }) =>
    serial(key, async () => {
      const previous = { ...box, jobs: [...box.jobs] };
      await new Promise((resolve) => setTimeout(resolve, 20));
      const next = mergePushedState(previous, incoming);
      box.jobs = next.jobs;
      box.removed = next.removed;
      box.prompt = next.prompt;
    });
  await Promise.all([
    write({ jobs: [job("base", 1), job("from-a", 3)], removed: [], prompt: "from a" }),
    write({ jobs: [job("base", 1), job("from-b", 4)], removed: [], prompt: "from b" }),
  ]);
  assert.deepEqual(
    box.jobs.map((item) => item.id).sort(),
    ["base", "from-a", "from-b"],
  );
  assert.equal(box.prompt, "from b");
});

test("the same workspace cannot interleave two saves", async () => {
  const key = `lock-${Date.now()}`;
  let value = 0;
  await Promise.all([
    serial(key, async () => {
      const seen = value;
      await new Promise((resolve) => setTimeout(resolve, 30));
      value = seen + 1;
    }),
    serial(key, async () => {
      const seen = value;
      await new Promise((resolve) => setTimeout(resolve, 10));
      value = seen + 1;
    }),
  ]);
  assert.equal(value, 2);
});

test("different workspaces do not block each other", async () => {
  const started = Date.now();
  await Promise.all([
    serial(`left-${started}`, () => new Promise((resolve) => setTimeout(resolve, 40))),
    serial(`right-${started}`, () => new Promise((resolve) => setTimeout(resolve, 40))),
  ]);
  assert.ok(Date.now() - started < 80);
});

test("removed ids stay unique and cap", () => {
  const first = mergeRemoved(["a"], ["b", "a", "", "b"]);
  assert.deepEqual(
    first.map((item) => item.id),
    ["a", "b"],
  );
  const many = mergeRemoved(
    [],
    Array.from({ length: REMOVED_CAP + 10 }, (_, index) => ({ id: `id-${index}`, at: index + 1 })),
  );
  assert.equal(many.length, REMOVED_CAP);
  assert.equal(many[0]?.id, `id-${REMOVED_CAP + 9}`);
  assert.equal(many.at(-1)?.at, 11);
});

test("an empty workspace accepts the first push", () => {
  const next = mergePushedState(null, { jobs: [job("only", 2)], removed: [], prompt: "first" });
  assert.equal(next.jobs[0]?.id, "only");
  assert.equal(next.prompt, "first");
});

test("scalars follow the latest push", () => {
  const next = mergePushedState(
    { jobs: [] as MergeJob[], removed: [] as string[], prompt: "computer", camera: "push" },
    { jobs: [] as MergeJob[], removed: [] as string[], prompt: "phone", camera: "hold" },
  );
  assert.equal(next.prompt, "phone");
  assert.equal(next.camera, "hold");
});

test("device list drops stale seats, caps at eight, and refreshes the same id", () => {
  const now = 1_000_000;
  const stale = device("old", now - DEVICE_TTL_MS);
  const barely = device("barely", now - DEVICE_TTL_MS + 1);
  assert.deepEqual(
    freshDevices([stale, barely], now).map((item) => item.id),
    ["barely"],
  );
  const crowded = Array.from({ length: 9 }, (_, index) => device(`d${index}`, now - index));
  const touched = touchDevices(crowded, device("d8", now - 50), now + 5);
  assert.equal(touched.length, 8);
  assert.equal(touched[0]?.id, "d8");
  assert.equal(touched[0]?.seen, now + 5);
  assert.equal(
    touched.some((item) => item.id === "d7"),
    false,
  );
});

test("workspace codes and device ids are bounded", () => {
  assert.equal(parseCode("  AbC123 "), "abc123");
  assert.equal(parseCode("a".repeat(12)), "a".repeat(12));
  for (const bad of ["", "abc12", "a".repeat(13), "abc-123", null, 12]) {
    assert.throws(() => parseCode(bad), /not valid/);
  }
  assert.throws(() => parseDevice({ id: "" }), /no id/);
  assert.throws(() => parseDevice(null), /no id/);
  const parsed = parseDevice({ id: "x".repeat(50), platform: "p".repeat(20), label: "l".repeat(30), seen: 1 }, 50);
  assert.equal(parsed.id.length, 40);
  assert.equal(parsed.platform.length, 16);
  assert.equal(parsed.label.length, 24);
  assert.equal(parsed.seen, 50);
  const fallback = parseDevice({ id: "phone-1" }, 9);
  assert.equal(fallback.platform, "web");
  assert.equal(fallback.label, "Web");
});

test("a pull is ignored when it would overwrite newer local work", () => {
  const clean = {
    code: "abc123",
    pullCode: "abc123",
    dirty: false,
    pushing: false,
    revAtStart: 4,
    localRev: 4,
    hasState: true,
  };
  assert.equal(acceptRemote(clean), true);
  assert.equal(acceptRemote({ ...clean, dirty: true }), false);
  assert.equal(acceptRemote({ ...clean, pushing: true }), false);
  assert.equal(acceptRemote({ ...clean, localRev: 5 }), false);
  assert.equal(acceptRemote({ ...clean, code: "other1" }), false);
  assert.equal(acceptRemote({ ...clean, pullCode: "" }), false);
  assert.equal(acceptRemote({ ...clean, hasState: false }), false);
});

test("prompt and camera edits from two devices are both kept", () => {
  const next = mergePushedState(
    {
      jobs: [] as MergeJob[],
      removed: [],
      clocks: { prompt: 20, camera: 5 } as FieldClock,
      prompt: "He crosses the room",
      camera: "drift",
      restored: [] as string[],
    },
    {
      jobs: [] as MergeJob[],
      removed: [],
      clocks: { prompt: 8, camera: 30 } as FieldClock,
      prompt: "A different line",
      camera: "push",
      restored: [] as string[],
    },
  );
  assert.equal(next.prompt, "He crosses the room");
  assert.equal(next.camera, "push");
  assert.equal(next.clocks.prompt, 20);
  assert.equal(next.clocks.camera, 30);
});

test("a render finishing does not bring a deleted take back", () => {
  const next = mergePushedState(
    { jobs: [] as MergeJob[], removed: [{ id: "walk", at: 50 }], clocks: {}, restored: [] as string[] },
    {
      jobs: [job("walk", 80, { status: "done", poster: null, videoUrl: "/samples/walk.mp4" })],
      removed: [],
      clocks: {},
      restored: [] as string[],
    },
  );
  assert.equal(next.jobs.length, 0);
  assert.equal(next.removed[0]?.id, "walk");
});

test("putting a take back on purpose returns it", () => {
  type Take = MergeJob & { poster?: string | null; videoUrl?: string | null };
  const next = mergePushedState(
    { jobs: [] as Take[], removed: [{ id: "walk", at: 50 }], clocks: {}, restored: [] as string[] },
    {
      jobs: [job("walk", 80, { poster: "/samples/walk.jpg", videoUrl: "/samples/walk.mp4" }) as Take],
      removed: [],
      clocks: {},
      restored: ["walk"],
    },
  );
  assert.equal(next.jobs[0]?.poster, "/samples/walk.jpg");
  assert.equal(next.jobs[0]?.videoUrl, "/samples/walk.mp4");
  assert.equal(next.removed.length, 0);
  assert.deepEqual(next.restored, []);
});

test("a deleted take does not consume one of the sixteen library slots", () => {
  const jobs = Array.from({ length: 17 }, (_, index) => job(`j${index}`, index + 1));
  const next = mergePushedState(null, {
    jobs,
    removed: [{ id: "j16", at: 100 }],
    clocks: {},
    restored: [] as string[],
    activeId: "j16",
  });
  assert.equal(next.jobs.length, 16);
  assert.equal(
    next.jobs.some((item) => item.id === "j16"),
    false,
  );
  assert.equal(
    next.jobs.some((item) => item.id === "j0"),
    true,
  );
  assert.equal(next.activeId, "j15");
});

test("a damaged workspace file is refused instead of wiped", () => {
  assert.throws(() => parseWorkspace("{"), /damaged/);
  assert.throws(() => parseWorkspace("null"), /damaged/);
  assert.throws(() => parseWorkspace(JSON.stringify({ code: "abc123" })), /damaged/);
  const parsed = parseWorkspace<{ code: string; devices: [] }>(JSON.stringify({ code: "abc123", devices: [] }));
  assert.equal(parsed.code, "abc123");
  assert.equal(isMissingFile({ code: "ENOENT" }), true);
  assert.equal(isMissingFile(new Error("no")), false);
});

test("the walk photo and performance video both survive a split save", () => {
  const photoPath = "public/samples/walk.jpg";
  const videoPath = "public/samples/walk.mp4";
  const photo = readFileSync(photoPath);
  const video = readFileSync(videoPath);
  assert.equal(photo[0], 0xff);
  assert.equal(photo[1], 0xd8);
  assert.ok(photo.length > 10_000);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(video.length > 500_000);
  execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-f", "null", "-"], {
    stdio: "pipe",
  });

  const computer = {
    jobs: [job("walk", 10, { poster: photoPath, videoUrl: null })],
    removed: [] as Tombstone[],
    clocks: { prompt: 40, camera: 10 } as FieldClock,
    prompt: "He walks across the concrete room and looks back.",
    camera: "drift",
    activeId: "walk",
    restored: [] as string[],
  };
  const phone = {
    jobs: [job("walk", 18, { poster: null, videoUrl: videoPath })],
    removed: [] as Tombstone[],
    clocks: { prompt: 12, camera: 44 } as FieldClock,
    prompt: "Different line from the phone",
    camera: "push",
    activeId: "walk",
    restored: [] as string[],
  };
  const next = mergePushedState(computer, phone);
  assert.equal(next.jobs.length, 1);
  assert.equal(next.jobs[0]?.poster, photoPath);
  assert.equal(next.jobs[0]?.videoUrl, videoPath);
  assert.equal(next.prompt, "He walks across the concrete room and looks back.");
  assert.equal(next.camera, "push");
  assert.equal(next.activeId, "walk");
});
