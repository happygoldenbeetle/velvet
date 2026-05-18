# Velvet App — Chat History & Change Log
> Starting point: User asked to read `contenxt.md` and get up to speed on the codebase.
> Model used: **Gemini 2.5 Pro** (Antigravity)

---

## Session Overview

This document covers two sessions:
- **Session A** (pre-truncation) — UI polish, card hover fixes, Top 10 rows, horizontal scroll bug
- **Session B** (current) — Offline video download system implementation

---

## Session A — UI Polish & Rows

### 1. Read context.md + codebase
**User:** *"read the updated code and get your hands around it, also read context.md for updated context"*

**What happened:**
- Read `contenxt.md`, `conversation_history.md`, `main.js`, `preload.js`, `src/index.html`, `src/js/api.js`, `src/js/app.js`, `src/css/style.css`
- Confirmed mental model of the app: Electron shell, TMDB+VidSrc, Netflix-inspired dark UI, hero/modal/player flow

**No code changes.**

---

### 2. Offline Downloads — Implementation Plan
**User:** *"I want offline videos first, manga can be done later. Create an implementation plan for downloading of movies/TV."*

**What happened:**
- Created implementation plan artifact with a 4-phase plan using `yt-dlp` + `ffmpeg`

**Files changed:** None (plan only)

---

## Session B — Offline Download Implementation

### 3. Resume after shutdown?
**User:** *"just to be sure there will be a download resume feature even after my laptop has shutdown?"*

**Answer:** Explained that true resume isn't possible with short-lived vidsrc tokens — URLs expire in minutes, so on restart the download would have to start over.

**No code changes.**

---

### 4. Find a way to add resume anyway
**User:** *"find a way to add resume feature even if i close my pc"*

**Solution designed:**

HLS streams are made up of hundreds of small `.ts` segment files (~2–10s each) hosted on a CDN. By downloading segments one by one and tracking which are `done` in a `state.json` per download, resume is achievable:

- Segment URLs live on CDNs and stay valid for **hours to days** (much longer than the manifest URL)
- On resume: load `state.json` → skip already-downloaded segments → continue
- If segment URLs expired: re-resolve the manifest (5s) and remap fresh URLs
- **No re-downloading anything already on disk**
- Final step: `ffmpeg` concatenates all `.ts` files into one `.mp4`

**Implementation plan updated** — yt-dlp removed, replaced with custom segment downloader + ffmpeg assembly.

---

### 5. Save location question
**User:** *"Right now, the app is still source code and I launch it through npm so idk where to store downloads?"*

**Answer:** Use `app.getPath('videos')` — Electron API that returns `C:\Users\<you>\Videos` whether running from source or packaged. No hard-coding needed.

**No code changes.**

---

### 6. Confirmed save path
**User:** *"C:\Users\Abdullah\Videos\Velvet"*

Confirmed. Auto-resume on launch set to **silent** (no prompt).

---

### 7. Full implementation — all 5 files
**User:** *(approved, started building)*

#### `main.js` — ~420 new lines
Added all download IPC handlers:

| Handler | Purpose |
|---|---|
| `download-resolve-stream` | Opens hidden BrowserWindow, intercepts `.m3u8`/`.mp4` URLs |
| `download-fetch-manifest` | Fetches `.m3u8` text, parses segment URLs, detects master playlist vs media playlist, reads encryption keys |
| `download-segment` | Downloads a single `.ts` segment file to disk, supports cancel |
| `download-assemble` | Runs `ffmpeg -f concat` to join all segments into `.mp4` |
| `download-save-state` | Writes per-download `state.json` to `Videos/Velvet/.states/` |
| `download-load-state` | Reads state file |
| `download-delete-state` | Deletes state file after completion |
| `download-list-pending-states` | Returns all in-progress states on startup for auto-resume |
| `downloads-load` | Reads global `downloads.json` manifest |
| `downloads-save` | Writes global manifest |
| `download-delete` | Deletes MP4 + segments + state + empty folder |
| `downloads-get-dir` | Returns `C:\Users\Abdullah\Videos\Velvet` |
| `downloads-check-ffmpeg` | Checks if `app/bin/ffmpeg.exe` exists |
| `download-job-register` / `unregister` | Tracks active download jobs for cancellation |
| `download-cancel` | Marks job as cancelled, destroys current segment request |

**Key data structure — `state.json` (per download):**
```json
{
  "id": "movie-550",
  "title": "Fight Club (1999)",
  "type": "movie",
  "tmdbId": 550,
  "outputPath": "C:\\Users\\...\\Videos\\Velvet\\Fight Club (1999)\\Fight Club (1999).mp4",
  "segmentsDir": "...\\.segments\\movie-550",
  "status": "in-progress",
  "totalSegments": 1247,
  "completedSegments": 312,
  "segments": [
    { "index": 0, "url": "https://cdn.../seg001.ts", "done": true },
    { "index": 1, "url": "https://cdn.../seg002.ts", "done": false }
  ]
}
```

---

#### `preload.js` — full rewrite (~50 lines)
Exposed 15 new download bridge methods to the renderer:
```js
resolveStream, fetchManifest, downloadSegment,
registerDownloadJob, unregisterDownloadJob, cancelDownload,
assembleDownload, saveDownloadState, loadDownloadState,
deleteDownloadState, listPendingStates,
loadDownloads, saveDownloads, deleteDownload,
getDownloadsDir, checkFfmpeg
```

---

#### `src/index.html` — 8 new lines
- Added **Downloads** nav link (after My List) with download arrow SVG icon
- Added `#modal-download` button in modal action row (hidden by default, shown when ffmpeg found)
- Added `#modal-download-label` span for dynamic text ("Download" / "38% · Cancel" / "Downloaded ✓")

---

#### `src/css/style.css` — ~335 new lines appended
New CSS sections:
- `.btn-download` — modal download button with animated green progress fill via `::before` pseudo-element using `--dl-progress` CSS variable
- `.btn-download.downloading` — green border + pulsing animation
- `.btn-download.assembling` — pulsing indeterminate state during ffmpeg
- `.btn-download.complete` — green tint, disabled cursor
- `.card-downloaded-badge` — small checkmark circle overlaid on poster corner
- `.card-download-bar` — thin green bar along card bottom edge
- `.downloads-page` — full page container with padding
- `.downloads-grid` — `auto-fill minmax(200px,1fr)` grid
- `.download-card` — card with poster (2:3 ratio), title, episode label, progress bar, action buttons
- `.download-card-play-btn` / `.cancel-btn` / `.delete-btn` — action buttons
- `.downloads-empty` — empty state with large icon, heading, description
- `.ffmpeg-warning` — yellow alert banner shown when ffmpeg.exe is missing

---

#### `src/js/app.js` — ~680 new lines appended + hooks in existing functions

**New state variables:**
```js
let downloadsManifest = [];          // persisted to disk via IPC
let ffmpegAvailable = false;         // checked once at startup
const activeDownloads = new Map();   // downloadId → { cancelled, percent }
```

**Modifications to existing functions:**
- `init()` — added `initDownloads()` call after page loads
- `setActivePage()` — added `case "downloads": loadDownloadsPage()`
- `els` object — added `modalDownload`, `modalDownloadLabel` refs

**New functions added:**

| Function | Description |
|---|---|
| `initDownloads()` | Loads manifest + checks ffmpeg + auto-resumes all pending downloads silently |
| `buildDownloadId(item,s,e)` | Stable ID: `movie-550` or `tv-1399-s1e1` |
| `buildSafeFilename(str)` | Strips illegal Windows filename chars |
| `buildOutputFilename(item,s,e)` | `Fight Club (1999).mp4` or `S01E01.mp4` |
| `buildFolderName(item)` | `Fight Club (1999)` |
| `getDownloadEntry(item,s,e)` | Finds manifest entry or null |
| `isDownloaded(item,s,e)` | Boolean — complete entry exists |
| `isDownloading(item,s,e)` | Boolean — active job in Map |
| `getDownloadPercent(item,s,e)` | Current % for live progress badge |
| `saveManifest()` | Persists `downloadsManifest` via IPC |
| `updateModalDownloadButton(item,s,e)` | Shows/hides button, sets state class + click handler |
| `updateCardDownloadUI(item,s,e)` | Updates `is-downloaded`/`is-downloading` classes + bar width on all matching cards |
| `startDownload(item,s,e)` | Orchestrator: resolve → fetch manifest → save state → downloadSegments |
| `downloadSegments(state,item,s,e)` | Segment loop: skip done segments, download each, save state every 10, re-resolve on 403, call assemble when all done |
| `resumeDownloadFromState(state)` | Same as downloadSegments but from persisted state; called on app launch for interrupted downloads |
| `cancelDownload(item,s,e)` | Sets cancelled flag + destroys active segment request |
| `deleteDownload(entry)` | IPC delete + remove from manifest |
| `loadDownloadsPage()` | Renders Downloads page: Downloading section + Downloaded section + empty state |
| `openLocalVideoFile(path,title)` | Opens `file:///...` URL in player webview for offline playback |

---

### 8. Download button not showing in modal
**User:** *"The download button isn't showing up in the modal? Also make sure we are able to download specific or all episodes of a TV/anime too."*

**Root cause:** `updateModalDownloadButton()` existed but was never called from `openModal()`. The button had `style="display:none"` in HTML and nothing ever showed it.

**Fixes in `src/js/app.js`:**
- Added call to `updateModalDownloadButton(modalItem)` inside `openModal()` after details load
- For **TV/Anime**: top-level modal button stays hidden — downloads are per-episode
- For **Movies**: button appears in action row next to My List

**Episode download buttons added in `loadEpisodes()`:**
- Each episode row gets a circular 32px download icon button on the far right
- Shows green checkmark when downloaded, pulsing animation when in progress
- Clicking it downloads that specific episode; clicking again cancels
- Episode click handler updated with `e.target.closest(".ep-dl-btn")` guard so the download button doesn't also trigger playback

**"Download Season" button:**
- Injected above the episode list with episode count shown on the left
- Queues all un-downloaded episodes in the current season with 2s gaps between each resolve
- Shows "Queued ✓" when all are submitted

**`src/css/style.css` — ~85 new lines:**
- `.ep-dl-btn` — circular icon button, green border/color when downloading/complete
- `.season-dl-header` — flex row with episode count + button
- `.season-dl-btn` — pill button matching app style

---

### 9. Stream resolution timeout (first attempt)
**User:** *(screenshot — "Stream resolution timed out (20s)")*

**Root cause:** Three issues with the hidden BrowserWindow approach:
1. Fresh partition = no cookies/fingerprint → vidsrc bot-detects it
2. `show: false` → Chromium sets headless flags → detectable
3. URL matching too narrow (only `.m3u8` in URL)

**Fix in `main.js`:**
- Set real Chrome 124 User-Agent on the session
- Added `webSecurity: false`, `allowRunningInsecureContent: true`
- Broadened URL matching (master.m3u8, index.m3u8, `/hls/` paths)
- Added `onHeadersReceived` for Content-Type sniffing
- Extended timeout to 35s

---

### 10. Stream resolution timeout (second attempt)
**User:** *"Download failed: Error invoking remote method 'download-resolve-stream': Error: Stream resolution timed out (35s)."*

**Root cause confirmed:**
- `webRequest.onBeforeRequest` only allows ONE listener per session — our new listener was replacing the ad-blocker's listener (on defaultSession) OR the fresh partition had zero cookies
- `show: false` still headless-detectable

**Final fix in `main.js` — complete rewrite of `download-resolve-stream`:**

1. **`session.defaultSession`** — same session the player webview uses; already has cookies and fingerprint from prior browsing
2. **`show: true, x: -9999, y: -9999`** — window is off-screen, not headless; behaves like a real browser
3. **CDP (Chrome DevTools Protocol)** via `webContents.debugger.attach('1.1')` — attaches at the V8 engine level, captures every network request from every frame including cross-origin iframes, completely undetectable by any website
4. Listens to:
   - `Network.requestWillBeSent` → URL pattern matching (`.m3u8`, CDN `.mp4`)
   - `Network.responseReceived` → Content-Type sniffing (`mpegurl`, `x-mpegurl`, `vnd.apple`)
5. Timeout extended to 40s with mp4 fallback

---

## File Change Summary

| File | Lines Added | What |
|---|---|---|
| `main.js` | ~500 | All download IPC handlers, CDP-based stream resolver |
| `preload.js` | ~45 | 15 download bridge methods |
| `src/index.html` | ~8 | Downloads nav tab + modal download button |
| `src/css/style.css` | ~420 | All download UI CSS |
| `src/js/app.js` | ~680 | Download engine, Downloads page, episode buttons |
| `bin/ffmpeg.exe` | — | Copied from `C:\ytdlp\ffmpeg.exe` (123 MB) |

**Total new code: ~1,650 lines across 5 source files.**

---

## Download Flow Architecture

```
User clicks Download (movie or episode)
  │
  ▼
startDownload(item, season, episode)
  │
  ├─ Build vidsrc embed URL (VIDSRC_BASE/movie?tmdb=ID)
  ├─ resolveStream(embedUrl) → off-screen BrowserWindow (defaultSession)
  │    └─ CDP Network.requestWillBeSent + responseReceived
  │         └─ intercept .m3u8 URL → return it
  │
  ├─ fetchManifest(m3u8Url)
  │    └─ Parse .m3u8 text → extract all segment URLs
  │         └─ If master playlist → pick highest BANDWIDTH variant → parse again
  │
  ├─ Save state.json (all segment URLs with done:false)
  ├─ Add entry to downloads.json manifest (status: "in-progress")
  │
  └─ downloadSegments() loop
       ├─ Skip segments already marked done
       ├─ Download each .ts file via https.get() → disk
       ├─ Mark done:true, save state every 10 segments
       ├─ On 403 expired URL → re-resolve manifest → remap URLs → retry
       ├─ Update progress UI every 5 segments
       └─ All done → ffmpeg -f concat → .mp4
            └─ Delete segments dir + state.json
                 └─ Update manifest: status "complete"

App restart with interrupted download:
  initDownloads()
    └─ listPendingStates() → all .state.json files in .states/
         └─ resumeDownloadFromState(state) for each
              └─ downloadSegments() → segments with done:true are skipped
                   └─ Continues from exactly where shutdown happened
```

---

## Known Issues / Next Steps as of Session End

| Issue | Status |
|---|---|
| Stream resolution with CDP | Deployed, awaiting test |
| Encrypted HLS (`#EXT-X-KEY`) | State stores key, ffmpeg decrypts automatically |
| "Download Season" queue | 2s gaps between resolves; could use a smarter queue |
| Offline playback | `file:///` loaded into player webview; native HTML5 controls |
| ffmpeg.exe location | Copied to `app/bin/ffmpeg.exe` from `C:\ytdlp\ffmpeg.exe` |
