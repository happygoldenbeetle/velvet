# Download Pipeline Overhaul — Plan

**Goal:** Make downloads _seamless_ (start from any title without playing it first) and _resumable_
(survive pauses, cancels, and app restarts).

**Status:** Phases 0–2 done (seamless downloads on yt-dlp). Phase 3 (resume UI) next.

---

## TL;DR

- Downloads today require **playing a title first** (to capture the stream), can't **resume**, ignore the
  configured concurrency limit, and ship a large **unused** native HLS pipeline (~700 lines of dead code).
- After research, the right engine is an **external downloader (yt-dlp)**, not a hand-rolled segment stitcher.
- Plan: **swap the opaque `vid-dl.exe` for real `yt-dlp.exe`**, resolve the stream URL on demand (no play-first),
  drive yt-dlp with documented flags for clean progress + resume, add a concurrency queue, and **delete** the
  dead native pipeline.

---

## Why not hand-roll a segment downloader?

Research findings that drove the decision:

1. **Modern HLS commonly separates audio and video into different tracks.** A hand-rolled `.ts` stitcher that
   reads only the video media playlist produces **video with no audio**.
   - <https://www.videosdk.live/developer-hub/hls/hls-stream-m3u8>
   - <https://github.com/video-dev/hls.js/issues/2835>
2. **ffmpeg alone resumes poorly** — restarts from scratch, doesn't retry failed segments.
   - <https://github.com/ytdl-org/youtube-dl/issues/12614>
3. **yt-dlp already handles the hard parts** — merges separate audio+video, decrypts AES-128, and resumes
   interrupted fragment downloads via `--continue` + kept `.part` / `.ytdl` state.
   - <https://github.com/yt-dlp/yt-dlp>
   - <https://deepwiki.com/yt-dlp/yt-dlp/2.4-download-orchestration>

**Conclusion:** rebuilding audio-muxing + AES + resume by hand would reimplement yt-dlp badly. Keep an external
downloader; the problem was never the engine.

---

## Current flaws being fixed

| # | Flaw | Location |
|---|------|----------|
| 1 | Entire native HLS pipeline is dead code (resolver, manifest parser, segment downloader, assembler, state persistence) | `main.js` 1179, 1401, 1546, 2202, 2323+ |
| 2 | Download requires a warmed player session ("play it first") | `src/js/app.js:1387-1398` |
| 3 | Only the **last-played** title can be downloaded (`lastCapturedStream` is a single var) | `src/js/app.js:1130` |
| 4 | Interrupted downloads stay stuck `"downloading"` forever (no startup reconciliation) | `src/js/app.js:1112` |
| 5 | Captured stream URLs expire; live path has no re-resolve/expiry handling | `main.js:1571` (dead path only) |
| 6 | `max_concurrent_downloads` is ignored — unlimited parallel processes | `download_config.ini` |
| 7 | Cancel orphans partial files (`deleteOnCancel` never set from cancel button) | `main.js:1639`, `main.js:1957` |
| 8 | Completed-file detection is a fragile guess | `main.js:862` |
| 9 | Opaque `vid-dl.exe` wrapper with non-standard flags; unreliable for resume + flaky stdout parsing | `main.js:1825`, `main.js:1900` |

---

## Target architecture

```
[Download click]
      |
      v
resolveStream(embedUrl)   <-- existing CDP hidden-window resolver, no visible player
      |  (m3u8 / mp4 URL)
      v
yt-dlp.exe  --continue  -f "bv*+ba/b"  --add-header Referer:...  --concurrent-fragments N
      |     --newline --progress-template ...   (deterministic progress)
      |
      v
ffmpeg (bundled)  <-- yt-dlp uses it to merge audio+video / remux to mp4
      |
      v
output .mp4  (+ .part kept while paused for resume)
```

- **Keep:** `ffmpeg` (merge/remux), `resolveStream` (repurposed for on-demand URL resolution).
- **Replace:** `vid-dl.exe` -> official `yt-dlp.exe`.
- **Delete:** native manifest parser, segment downloader, ffmpeg assembler, per-segment state handlers.

---

## Phased plan

### Phase 0 — Swap the binary  ✅ DONE
- `yt-dlp.exe` (v2026.03.17) dropped into `bin/`.
- Renderer no longer hunts for a vid-dl folder; `ensureDownloaderAvailable()` checks
  `checkFfmpeg()` for `ytDlpAvailable` + `ffmpegAvailable`.

### Phase 1 — Seamless (no play-first)  ✅ DONE  ← primary ask
- `startExternalDownload` now calls `resolveStreamForItem()`, which uses a fresh captured stream
  if available, otherwise resolves the embed on demand via `resolveStream(embedUrl)` — no playing first.
- Removed the "play this title first" throw. Fixes #2 and #3.
- Cancel-during-resolve is handled: renderer registers the job first; main aborts before spawning
  if the job was already cancelled.

**Resolver rework (the hard part).** The hidden `resolveStream` window could not start the
ad-gated cloudnestra/ProRCP player, so no `.m3u8` was ever requested. Fixed by, in `main.js`:
1. **On-screen invisible window** (`x:0,y:0`, `opacity:0`, `showInactive`, `setIgnoreMouseEvents`,
   `backgroundThrottling:false`) instead of off-screen `-9999` — an off-screen window is treated as
   occluded (`document.hidden`), which blocks autoplay.
2. **Nudge on `dom-ready` + a 6s fallback timer** instead of `did-finish-load`, which never fires on
   these pages (a hanging ad/tracker subresource blocks the load event).
3. **CDP `Input.dispatchMouseEvent`** trusted clicks — the decisive fix; reaches the cross-origin
   (out-of-process) player iframe that ignores `sendInputEvent`.
4. **Session-level `.m3u8`/`.mp4` detection** (`captureResolverMediaRequest` on the shared
   `webRequest` hook) — sees the media request from the OOPIF, which the top-frame CDP `Network`
   domain does not.

Verified headless (Fight Club / tmdb 550): 3/3 clean resolves to a `master.m3u8`.

### Phase 2 — Drive yt-dlp properly  ✅ DONE (handler already existed)
- Renderer now calls `runYtDlpDownload` (the pre-existing, correct `download-run-ytdlp` handler)
  instead of the opaque `vid-dl` path. It already uses `--continue`, `--newline`,
  `--progress-template`, Referer/Origin/UA headers, `--ffmpeg-location`, and default
  `bv*+ba/b` best-audio+video merge.
- Added `formatByteSize()` so progress speed/size render as human-readable strings.
- Fixes #8, #9. (The flaky vid-dl stdout regex parser is now unused, to be deleted in Phase 4.)

### Phase 3 — Resume  ← secondary ask
- Separate **pause** (keep `.part`) from **cancel/delete** (remove files).
- On resume / app restart: re-resolve the expired URL, re-run yt-dlp with `--continue` at the same output path.
- Add startup reconciliation in `bootstrapDownloads` (`src/js/app.js:1112`) so interrupted entries become
  **resumable** instead of stuck.
- Fix #4, #5, #7.

### Phase 4 — Concurrency + cleanup
- Download queue honoring `max_concurrent_downloads` (`download_config.ini`). Fix #6.
- Fix cancel to delete partials only on explicit delete.
- Delete the ~700 lines of dead native pipeline + its unused preload/IPC surface. Fix #1.

### Phase 5 — Verify
- Confirm on a real vidsrc stream that the output file **has audio** (the whole reason for keeping yt-dlp).
- Confirm resume works across an app restart.

---

## Open items / prerequisites

- [ ] **`yt-dlp.exe`**: official binary from yt-dlp GitHub releases, dropped into `bin/` by the user
      (executables are not auto-downloaded).
- [ ] Confirm phase order: **Phase 0 + 1 first** (immediate seamless win), then Phase 3 (resume).
- [ ] Verify vidsrc's actual stream format during Phase 5 (muxed vs. separate audio).

---

## Risks

- yt-dlp fragment resume assumes fragment/index stability across re-resolution of an expired URL — generally holds
  for the same title, to be confirmed in Phase 5.
- `resolveStream` uses a hidden `webSecurity:false` window loading an untrusted embed page. It is isolated, but
  worth keeping the allow-list (`PLAYER_ALLOWED_HOSTS`) tight.
- vidsrc may change its player/obfuscation, breaking `resolveStream`; the resolver's heuristics may need upkeep.
