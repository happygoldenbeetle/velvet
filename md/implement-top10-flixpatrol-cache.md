# Implementation Plan — FlixPatrol Cache + TMDB Fallback

## What This Does

Replaces the current slow Tudum-scraping approach with a three-layer system:

1. **Instant fallback** — on first launch (no cache yet), TMDB's watch provider filter renders "On Netflix in Pakistan" rows immediately using the existing TMDB key. No scraping, no waiting.
2. **Background script** — on every launch, a detached Node process checks if the cache is stale. If so, it fetches one FlixPatrol page (both movies + TV in a single request), resolves each title to TMDB, and writes `top10_cache.json`.
3. **Instant cache read** — on every launch after the first, the app reads `top10_cache.json` in microseconds and renders the accurate Pakistan-specific ranked rows immediately.

The user never waits for a network call after the first session.

---

## Files Changed

| File | Change |
|---|---|
| `fetch-top10.js` | New file — FlixPatrol fetch, parse, TMDB resolve, cache write |
| `main.js` | Add `fs` + `spawn`, replace 2 IPC handlers with 1 cache reader, spawn script on ready, remove old Tudum helpers |
| `preload.js` | Replace 2 bridge calls with 1 |
| `src/js/api.js` | 2 methods read cache; 2 new TMDB fallback methods; remove old resolve helpers |
| `src/js/app.js` | `loadHomePage` uses cache methods with TMDB fallback when cache is empty |
| `top10_cache.json` | Auto-generated, never edit manually |

---

## Step 1 — Create `fetch-top10.js`

Create this file at the project root next to `main.js`.

```js
// fetch-top10.js
// Runs as a detached background process on every app launch.
// Skips entirely if top10_cache.json is less than 24 hours old.
// Fetches ONE FlixPatrol page for Pakistan (movies + TV combined),
// resolves each title through TMDB, writes top10_cache.json.

const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "top10_cache.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TMDB_API_KEY = "0cc7f9b606eed786b0c5d01c1bb8e676";
const TMDB_BASE = "https://api.themoviedb.org/3";
const FLIXPATROL_URL = "https://flixpatrol.com/top10/netflix/pakistan/";

// ── Cache freshness check ──────────────────────────────────────────────────
function isCacheFresh() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return cache.timestamp && (Date.now() - cache.timestamp < CACHE_MAX_AGE_MS);
  } catch {
    return false;
  }
}

// ── Fetch FlixPatrol page ──────────────────────────────────────────────────
async function fetchFlixPatrol() {
  const res = await fetch(FLIXPATROL_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`FlixPatrol returned HTTP ${res.status}`);
  return res.text();
}

// ── Parse titles from FlixPatrol HTML ─────────────────────────────────────
// FlixPatrol renders two sections on the page: TOP 10 Movies and TOP 10 TV Shows.
// Each item is an anchor tag with a title inside a heading or span.
// Strategy: find the two table sections by their heading text, then extract
// the ranked title anchors from each section.
function parseFlixPatrol(html) {
  const movies = [];
  const tv = [];

  // FlixPatrol wraps each top-10 table in a section with a heading like
  // "TOP 10 Movies" and "TOP 10 TV Shows". We split on these headings.
  // Each ranked row contains an <a href="/title/...">Title Name</a>.
  // The rank is derived from the order of items in the list (1-indexed).

  // Extract a block of HTML between two markers
  function extractSection(html, startMarker, endMarker) {
    const start = html.indexOf(startMarker);
    if (start === -1) return "";
    const end = html.indexOf(endMarker, start + startMarker.length);
    return end === -1 ? html.slice(start) : html.slice(start, end);
  }

  // Pull title text from anchor tags pointing to /title/ paths
  function extractTitles(sectionHtml) {
    const titles = [];
    // Match anchor tags that link to FlixPatrol title pages
    const anchorPattern = /href="\/title\/[^"]+">([^<]+)<\/a>/g;
    let match;
    while ((match = anchorPattern.exec(sectionHtml)) !== null && titles.length < 10) {
      const title = match[1].trim();
      if (title && title.length > 0) titles.push(title);
    }
    return titles;
  }

  const moviesSection = extractSection(html, "TOP 10 Movies", "TOP 10 TV Shows");
  const tvSection = extractSection(html, "TOP 10 TV Shows", "TOP Movies and TV Shows");

  extractTitles(moviesSection).forEach((title, i) => {
    movies.push({ rank: i + 1, title });
  });

  extractTitles(tvSection).forEach((title, i) => {
    tv.push({ rank: i + 1, title });
  });

  return { movies, tv };
}

// ── Normalize TV title (strip season/series suffixes) ─────────────────────
function normalizeTitle(title, type) {
  if (type !== "tv") return title;
  return title
    .replace(/:\s*Season\s+\d+$/i, "")
    .replace(/:\s*Limited Series$/i, "")
    .replace(/\s+Season\s+\d+$/i, "")
    .trim();
}

// ── Resolve a single title to a TMDB object ───────────────────────────────
async function resolveTitle(title, type) {
  const query = normalizeTitle(title, type);
  const endpoint = type === "tv" ? "search/tv" : "search/movie";
  const url = `${TMDB_BASE}/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;

  const data = await res.json();
  const results = data.results || [];

  // Prefer exact title match, fall back to first result with a poster
  const titleKey = query.toLowerCase();
  const nameField = type === "tv" ? "name" : "title";
  return (
    results.find((r) => (r[nameField] || "").toLowerCase() === titleKey && r.poster_path) ||
    results.find((r) => r.poster_path) ||
    null
  );
}

// ── Resolve all titles in parallel, dedupe by TMDB id ─────────────────────
async function resolveAll(entries, type) {
  const resolved = await Promise.all(
    entries.map(async (entry) => {
      try {
        const result = await resolveTitle(entry.title, type);
        if (!result) return null;
        return { ...result, media_type: type, netflix_rank: entry.rank };
      } catch {
        return null;
      }
    })
  );

  const seen = new Set();
  return resolved
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.netflix_rank - b.netflix_rank);
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  if (isCacheFresh()) {
    process.exit(0);
  }

  try {
    console.log("[top10] Cache stale or missing — fetching FlixPatrol...");
    const html = await fetchFlixPatrol();
    const { movies: movieEntries, tv: tvEntries } = parseFlixPatrol(html);

    if (movieEntries.length === 0 && tvEntries.length === 0) {
      console.warn("[top10] FlixPatrol parse returned 0 titles — aborting cache write");
      process.exit(1);
    }

    console.log(`[top10] Parsed ${movieEntries.length} movies, ${tvEntries.length} TV shows — resolving via TMDB...`);

    const [movies, tv] = await Promise.all([
      resolveAll(movieEntries, "movie"),
      resolveAll(tvEntries, "tv"),
    ]);

    const cache = { timestamp: Date.now(), movies, tv };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
    console.log(`[top10] Cache written — ${movies.length} movies, ${tv.length} TV shows`);
  } catch (err) {
    console.error("[top10] Fatal:", err.message);
    process.exit(1);
  }
})();
```

---

## Step 2 — Modify `main.js`

### 2a — Add imports at the top

The file currently starts with:

```js
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
```

Change to:

```js
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
```

### 2b — Remove these constants at the top of the file

Delete both lines:

```js
const NETFLIX_PAKISTAN_FILMS_URL = "https://www.netflix.com/tudum/top10/pakistan/films";
const NETFLIX_PAKISTAN_TV_URL = "https://www.netflix.com/tudum/top10/pakistan/tv";
```

### 2c — Remove these three helper functions entirely

Delete `decodeHtmlEntity`, `fetchTextWithRetry`, and `parseNetflixTop10`. They are no longer used.

### 2d — Add background script spawn inside `createWindow`

After the line `mainWindow.loadFile(path.join(__dirname, "src", "index.html"));`, add:

```js
// Spawn background Top 10 cache refresh (detached, non-blocking)
const top10Script = path.join(__dirname, "fetch-top10.js");
if (fs.existsSync(top10Script)) {
  const child = spawn(process.execPath, [top10Script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
```

### 2e — Replace the two Netflix IPC handlers with one cache reader

Find and delete:

```js
ipcMain.handle("netflix-top10-pakistan-films", async () => {
  const html = await fetchTextWithRetry(NETFLIX_PAKISTAN_FILMS_URL);
  return parseNetflixTop10(html, NETFLIX_PAKISTAN_FILMS_URL);
});

ipcMain.handle("netflix-top10-pakistan-tv", async () => {
  const html = await fetchTextWithRetry(NETFLIX_PAKISTAN_TV_URL);
  return parseNetflixTop10(html, NETFLIX_PAKISTAN_TV_URL);
});
```

Replace with:

```js
// ── Top 10 cache reader ────────────────────────────────────────────────────
const TOP10_CACHE_PATH = path.join(__dirname, "top10_cache.json");

ipcMain.handle("netflix-top10-cache", () => {
  try {
    if (!fs.existsSync(TOP10_CACHE_PATH)) return { movies: [], tv: [], empty: true };
    const raw = fs.readFileSync(TOP10_CACHE_PATH, "utf8");
    return { ...JSON.parse(raw), empty: false };
  } catch {
    return { movies: [], tv: [], empty: true };
  }
});
```

---

## Step 3 — Modify `preload.js`

Find and remove:

```js
getNetflixPakistanTop10Films: () => ipcRenderer.invoke("netflix-top10-pakistan-films"),
getNetflixPakistanTop10TV: () => ipcRenderer.invoke("netflix-top10-pakistan-tv"),
```

Replace with:

```js
getNetflixTop10Cache: () => ipcRenderer.invoke("netflix-top10-cache"),
```

Full file after change:

```js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  getNetflixTop10Cache: () => ipcRenderer.invoke("netflix-top10-cache"),
});
```

---

## Step 4 — Modify `src/js/api.js`

### 4a — Add two TMDB fallback methods

Add these two new methods inside the `tmdb` object, anywhere near the existing `discoverTV` and `discoverMovies` methods:

```js
// Netflix Pakistan fallback via TMDB watch provider filter.
// Used on first launch when top10_cache.json does not exist yet.
// Provider 8 = Netflix. watch_region=PK filters to Pakistan catalog.
netflixPKMoviesFallback(page = 1) {
  return this.fetch("/discover/movie", {
    with_watch_providers: "8",
    watch_region: "PK",
    sort_by: "popularity.desc",
    page,
  });
},
netflixPKTVFallback(page = 1) {
  return this.fetch("/discover/tv", {
    with_watch_providers: "8",
    watch_region: "PK",
    sort_by: "popularity.desc",
    page,
  });
},
```

### 4b — Replace `netflixPakistanTop10Movies` and `netflixPakistanTop10TV`

Find these two methods:

```js
async netflixPakistanTop10Movies() {
  if (!window.electronAPI?.getNetflixPakistanTop10Films) return { results: [], period: "" };
  const top10 = await window.electronAPI.getNetflixPakistanTop10Films();
  return this.resolveNetflixTop10(top10, "movie");
},

async netflixPakistanTop10TV() {
  if (!window.electronAPI?.getNetflixPakistanTop10TV) return { results: [], period: "" };
  const top10 = await window.electronAPI.getNetflixPakistanTop10TV();
  return this.resolveNetflixTop10(top10, "tv");
},
```

Replace both with:

```js
async netflixPakistanTop10Movies() {
  if (!window.electronAPI?.getNetflixTop10Cache) return { results: [], fallback: true };
  const cache = await window.electronAPI.getNetflixTop10Cache();
  if (cache.empty || !cache.movies?.length) {
    // No cache yet — use TMDB watch provider as fallback
    const data = await this.netflixPKMoviesFallback().catch(() => ({ results: [] }));
    return { results: (data.results || []).slice(0, 10).map((r) => ({ ...r, media_type: "movie" })), fallback: true };
  }
  return { results: cache.movies, fallback: false };
},

async netflixPakistanTop10TV() {
  if (!window.electronAPI?.getNetflixTop10Cache) return { results: [], fallback: true };
  const cache = await window.electronAPI.getNetflixTop10Cache();
  if (cache.empty || !cache.tv?.length) {
    // No cache yet — use TMDB watch provider as fallback
    const data = await this.netflixPKTVFallback().catch(() => ({ results: [] }));
    return { results: (data.results || []).slice(0, 10).map((r) => ({ ...r, media_type: "tv" })), fallback: true };
  }
  return { results: cache.tv, fallback: false };
},
```

### 4c — Remove `normalizeNetflixTop10Title` and `resolveNetflixTop10`

Delete both methods entirely. Resolution now happens inside `fetch-top10.js`, not in the renderer.

---

## Step 5 — Modify `src/js/app.js`

### 5a — Update row titles to reflect fallback state

Inside `loadHomePage`, the two Netflix rows are currently built like this:

```js
createRankedRowHTML("Top 10 Movies in Pakistan", netflixTop10MoviesPakistan.results, "movie"),
createRankedRowHTML("Top 10 TV Series in Pakistan", netflixTop10TVPakistan.results, "tv"),
```

Change to:

```js
createRankedRowHTML(
  netflixTop10MoviesPakistan.fallback ? "Popular on Netflix in Pakistan" : "Top 10 Movies in Pakistan",
  netflixTop10MoviesPakistan.results,
  "movie"
),
createRankedRowHTML(
  netflixTop10TVPakistan.fallback ? "Popular on Netflix in Pakistan" : "Top 10 TV Series in Pakistan",
  netflixTop10TVPakistan.results,
  "tv"
),
```

When the cache does not exist yet (first launch), the heading reads "Popular on Netflix in Pakistan" and shows the TMDB-sourced fallback data with no rank badges. Once the cache exists (second launch onward), it switches to "Top 10 Movies in Pakistan" with the proper numbered rank badges.

### 5b — Suppress rank badges on fallback data

The `createRankedRowHTML` function renders rank badges from `item.netflix_rank`. TMDB fallback items do not have this field, so they will already render as plain cards with no badge. No code change needed for this — it works automatically because `createRankedCardHTML` checks `item.netflix_rank` before rendering the badge.

---

## Step 6 — Verify

Run `node --check` on all modified files:

```
node --check fetch-top10.js
node --check main.js
node --check preload.js
node --check src/js/api.js
node --check src/js/app.js
```

---

## How It Behaves After Implementation

**First ever launch:**
- Home opens immediately
- "Popular on Netflix in Pakistan" rows appear quickly (TMDB API, same speed as other rows)
- Background script runs, fetches FlixPatrol, resolves via TMDB, writes cache
- No visible spinner or delay

**Every subsequent launch:**
- Home opens immediately
- "Top 10 Movies in Pakistan" and "Top 10 TV Series in Pakistan" rows appear instantly from cache
- Background script checks cache age — skips if under 24 hours old
- If over 24 hours old, refreshes silently in background; current launch still shows previous cached data

**If FlixPatrol is unreachable:**
- Background script fails and exits
- Cache remains unchanged from previous successful run
- App continues showing whatever was last cached with no error shown to user

---

## Summary

The key improvements over the previous Tudum approach:

- **One fetch instead of two** — FlixPatrol serves both movies and TV on a single page
- **Zero startup blocking** — the app never waits for any network call
- **TMDB fallback on first launch** — rows are never empty, even on the very first session
- **Pakistan-specific data** — FlixPatrol tracks actual Netflix Pakistan rankings updated daily
- **More stable** — FlixPatrol's HTML is simpler and less likely to break than Tudum's Next.js table structure
- **No new dependencies** — no new API keys, no paid services
