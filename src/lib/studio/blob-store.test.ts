import assert from "node:assert/strict";
import test from "node:test";
import { mediaId, mediaIdFromSrc, readStored, showMedia, storeDataUrl } from "./blob-store.ts";

test("a photo is stored once and can be shown without the original bytes", async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
  const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  const ref = await storeDataUrl(dataUrl);
  const again = await storeDataUrl(dataUrl);
  assert.equal(ref, again);
  assert.match(ref, /^media:[a-f0-9]{64}$/);
  const id = mediaId(ref);
  assert.ok(id);
  const stored = await readStored(id!);
  assert.equal(stored?.mime, "image/jpeg");
  assert.equal(stored?.bytes.length, bytes.length);
  assert.equal(showMedia(ref), `/api/media?id=${id}`);
  assert.equal(mediaIdFromSrc(showMedia(ref)), id);
  assert.equal(await storeDataUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});
