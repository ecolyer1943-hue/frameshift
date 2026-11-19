# FrameShift handoff

Studio for recasting a person into a performance, animating a still, or shooting from a prompt. Shared workspace across Studio, Library, Rehearsal (code still calls the view `live`), and Meetings.

Written 2026-11-16 after the refresh fix. The next ask that did not get built is optimistic UI.

## What just shipped

Refresh no longer blanks the shot and then saves the sample over it.

- `studio-app.tsx` reads `frameshift-v1` from localStorage inside `useLayoutEffect`, applies it, then marks ready. The sample frame is not loaded until sync has settled, and only if the workspace still has no frame. An unknown sample id is cleared. It no longer replaces the prompt, camera, or mode.
- Sync waits for auth (`isPending`) before `startSync`, so a refresh does not mint a guest workspace and then jump.
- `sync-client.ts` boots with a generation id. The first pull is not pushed over. If local field clocks are newer, the local state is pushed and merged. Otherwise the server state is applied. Subscribe only marks dirty when a sync field actually changed. Clocks are stored at `frameshift-clocks:<code>`.
- `store.ts` persists frame, end frame, people, character, and voice when the payload is a short URL or a data URL under 48 KB. Oversized posters and videos are dropped from the local save. A full localStorage no longer throws and wipes the key.

`npx tsc --noEmit` passed after these edits. No browser smoke was run on this pass.

## Optimistic UI — investigated, not built

The take card is already optimistic. Everything around it is not.

| Path | Today | Gap |
|---|---|---|
| Regen / Recast / Extend | `upsertJob` with `status: "submitting"` before the start call | Poster shrink and, for a voice clip, transcription run before the card appears |
| Recast still | Card shows the scene poster, then swaps when the edit returns | No local "editing the face" state; the card sits on Submitting |
| Prompt / camera / dialogue | Store updates immediately, push is debounced 400 ms | Fine. No rollback if the push fails; dirty is retried |
| Second shot | `busy` blocks it | Cannot queue. A click during a render does nothing |
| Upscale | Starts after the clip is done | No progress on the card beyond `upscale: "working"` |
| Large upload | In memory at once | A refresh loses it until sync returns the `media:` ref. The 48 KB local cap is why |
| Failure | `fail()` sets status and a notice. The take stays | Good. Do not remove the card on error |

Recommended next pass, in order:

1. Upsert the take before shrink and before transcription. Shrink and speech can patch the same job.
2. Add a `preparing` or keep `submitting`, and a one-line status: "Reading the voice", "Matching the face", "Starting the shot".
3. Allow a second take to queue while `busy` is true, or drop `busy` and let `status !== "done"` on the active job be the lock. Today `busy` and job status both gate the button.
4. On push failure, keep the local field. Already true. Surface "offline, kept here" instead of a silent retry.
5. Do not apply a remote snapshot over a job that is `submitting` or `queued` on this device.

## Architecture

```
StudioApp
  store.ts          zustand + persist, name frameshift-v1, version 4, skipHydration
  sync-client.ts    boot, clocks, dirty, 400 ms push, 4 s pull
  sync.ts           workspace JSON in data/workspaces/<code>.json
                    packState stores data URLs as media:<sha256>
  sync-merge.ts     jobs by timestamp, tombstones, field clocks, serial queue
  run.ts            regen / recast / extend / draft still
  generate.ts       xAI image edit + grok-imagine-video-1.5, composePrompt
  blob-store.ts     sha256 blobs, 8 MB cap
  routes/api/media.ts   GET /api/media?id=
  upscale.ts        ffmpeg: denoise, deband, lanczos to 3840 long edge, cas, crf 16
```

Modes: `animate` (Regen in the masthead), `prompt`, `recast`.
Cameras: hold, push, orbit, drift, rise, rack.
Durations: 4, 6, 8, 10, 15. Aspects: 16:9, 9:16, 1:1. Resolution forced to 1080p.
Samples: night, ink, ivory, field.

## Sync rules that must not regress

- `mergePushedState` filters tombstones before the 16-job slice.
- A deleted job stays deleted unless it is in `restored` and its time is newer than the tombstone.
- Field clocks: the newer clock wins. Empty clocks lose to any server clock. That is why a refresh must not push before the first pull.
- `acceptRemote` requires same code, not dirty, not pushing, same `localRev`, and a state payload.
- `withMedia` keeps a poster or video URL if the winning job lost it.
- Writes are atomic (tmp + rename). A damaged JSON throws; it is not treated as empty.
- Pack replaces `data:` refs with `media:<hash>`. Client `showMedia` turns that into `/api/media?id=`.

## Generation

- Recast: image edit (`grok-imagine-image-2.0`) then image-to-video. Prompt tells the edit to take face, hair, age, and clothes from the later images and the pose from the first.
- Animate: the still is frame one. Optional `last_frame`.
- Prompt: no image, `aspect_ratio` is sent.
- Continuation: last frame plus the continue line in `composePrompt`.
- Audio off sends `generate_audio: false`. Dialogue is spoken on set, not narrated.
- 403 with credit / subscription / quota / billing now says "Generation credits are used up." Other 403s stay generic.
- Server start limit is 8 per hour. Direct script calls bypass it.

## What the last test run proved

Three longer clips finished in the studio generator, then the account ran out of credits.

| Person | Prompt style | Feature | Result |
|---|---|---|---|
| Soren | One sentence | Recast, Hold, room sound, locks on, 10s, 1080p | Done. He sets the can down and wipes his hand |
| Mara | Numbered shot list + spoken line | Recast, Push, 15s, 1080p, audio | Done. She is at the kettle |
| Kenji | Negatives first + end frame | Animate, Orbit, square, silent, 10s | Done at 720 after 1080 was refused. Book closes. No audio track. Upscaled locally to 3840 |

Not rendered (credits): Priya (text only, Rise, 9:16, 15s), Wes (two photos, Linen, Drift, setting unlocked), Lila (ink style, Hold, silent), Jonah (director notes, Ivory, Rack, 15s), Noor (10s then 15s continuation). Prompts are in `scripts/cast-features.mjs` and `public/casts/deep/manifest.json`.

Earlier round: 10 recast clips at 6s in `public/casts/` (Ada, Leo, Nia, Omar, June, Ruth, Eli, Hana, Mateo, Iris). Omar kept the original jacket; the edit prompt was tightened after that.

## Open

- Optimistic UI, above. Not started.
- Side menu still says "Live preview". Product name is Rehearsal.
- Credits are exhausted. In-app generation will fail until they are added.
- Kenji's 1080 square + last frame was refused; 720 worked. Worth a retry when credits return.
- Meeting tab share is still sensitive in headless runs.
- Large uploads survive sync via `media:` refs, not localStorage. First paint after refresh can miss the picture until the boot pull applies.
- `scripts/cast-features.mjs` and `scripts/cast-round.mjs` are test harnesses, not app code.

## How to pick up

1. Read `src/lib/studio/sync-client.ts` `startSync`, `pull`, `finishBoot` before touching refresh again.
2. Optimistic work starts in `src/lib/studio/run.ts` (`runRegen`, `runRecast`, `runExtend`) and the take card in `studio-app.tsx`.
3. Do not push during `booting`. Do not load the sample frame before `settled`.
4. Tests: `node --experimental-strip-types --test src/lib/studio/sync-merge.test.ts src/lib/studio/suggest.test.ts src/lib/studio/blob-store.test.ts`.
5. Typecheck: `npx tsc --noEmit`. Persist version is 4. Do not bump it unless the saved shape breaks; extra fields are fine.

## File map

| Path | Owns |
|---|---|
| `src/components/studio/studio-app.tsx` | Shell, composer, library, take card, ready/settled gates |
| `src/components/studio/scene-bench.tsx` | Rehearsal dual panes |
| `src/components/studio/meet-view.tsx` | Meetings |
| `src/lib/studio/store.ts` | State, persist, media cap |
| `src/lib/studio/sync-client.ts` | Boot, clocks, push/pull |
| `src/lib/studio/sync.ts` | Workspace file, pack/unpack |
| `src/lib/studio/sync-merge.ts` | Merge, tombstones, clocks |
| `src/lib/studio/generate.ts` | Prompts, start, poll, recast, draft still |
| `src/lib/studio/run.ts` | Shot lifecycle |
| `src/lib/studio/blob-store.ts` | Media hashes |
| `src/lib/studio/upscale.ts` | 4K ffmpeg |
| `public/samples/` | night, ink, ivory, field, walk |
| `public/casts/` | Last test portraits and videos |
| `data/workspaces/` | Live workspace JSON, one file per code |
