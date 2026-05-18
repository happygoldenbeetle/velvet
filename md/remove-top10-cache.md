# Remove Top 10 Cache System (Revert)

## Context

This document describes how to remove the background caching system for Netflix Top 10 Pakistan and revert the Cinemax Electron app back to the original approach where `main.js` fetches the Tudum pages directly at startup.

The app root is `C:\Users\Abdullah\Desktop\app`. All file paths below are relative to that root.

---

## Step 1 — Delete `fetch-top10.js`

Delete the file:

```
C:\Users\Abdullah\Desktop\app\fetch-top10.js
```

---

## Step 2 — Delete `top10_cache.json` (if it exists)

Delete the generated cache file if present:

```
C:\Users\Abdullah\Desktop\app\top10_cache.json
```

---

## Step 3 — Revert `main.js`

### 3a — Remove the added imports

At the top of `main.js`, find and remove these two lines that were added:

```js
const fs = require("fs");
const { spawn } = require("child_process");
```

The top of the file should go back to:

```js
const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");
```

### 3b — Restore the two URL constants

At the top of the file, after the `require` lines, add back the two URL constants:

```js
const NETFLIX_PAKISTAN_FILMS_URL = "https://www.netflix.com/tudum/top10/pakistan/films";
const NETFLIX_PAKISTAN_TV_URL = "https://www.netflix.com/tudum/top10/pakistan/tv";
```

### 3c — Restore the three helper functions

Add back these three functions. Place them before the `createWindow` function:

```js
function decodeHtmlEntity(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchTextWithRetry(url, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 Cinemax",
          "accept": "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) throw new Error(`Netflix Top 10 request failed: ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function parseNetflixTop10(html, source) {
  const dateMatch = html.match(/data-uia="section-eyebrow-heading"[^>]*>([^<]+)<\/div>/);
  const rows = [];
  const rowPattern = /<span class="rank">(\d+)<\/span>[\s\S]*?<button>([^<]+)<\/button>[\s\S]*?data-uia="top10-table-row-weeks">([^<]*)<\/td>/g;

  let match;
  while ((match = rowPattern.exec(html)) && rows.length < 10) {
    rows.push({
      rank: Number(match[1]),
      title: decodeHtmlEntity(match[2].trim()),
      weeks: Number(match[3]) || null,
    });
  }

  return {
    source,
    period: dateMatch ? decodeHtmlEntity(dateMatch[1].trim()) : "",
    titles: rows,
  };
}
```

### 3d — Remove the background script spawn

Inside the `createWindow` function, find and remove this block that was added after `mainWindow.loadFile(...)`:

```js
// Spawn background Top 10 cache refresh script
const scriptPath = path.join(__dirname, "fetch-top10.js");
if (fs.existsSync(scriptPath)) {
  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
```

### 3e — Replace the cache IPC handler with the original two handlers

Find and remove this handler that was added:

```js
const TOP10_CACHE_PATH = path.join(__dirname, "top10_cache.json");

ipcMain.handle("netflix-top10-cache", () => {
  try {
    if (!fs.existsSync(TOP10_CACHE_PATH)) return { movies: [], tv: [] };
    const raw = fs.readFileSync(TOP10_CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { movies: [], tv: [] };
  }
});
```

Replace it with the original two handlers:

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

---

## Step 4 — Revert `preload.js`

Find and remove:

```js
getNetflixTop10Cache: () => ipcRenderer.invoke("netflix-top10-cache"),
```

Replace it with the original two lines:

```js
getNetflixPakistanTop10Films: () => ipcRenderer.invoke("netflix-top10-pakistan-films"),
getNetflixPakistanTop10TV: () => ipcRenderer.invoke("netflix-top10-pakistan-tv"),
```

The full `preload.js` should look like:

```js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  getNetflixPakistanTop10Films: () => ipcRenderer.invoke("netflix-top10-pakistan-films"),
  getNetflixPakistanTop10TV: () => ipcRenderer.invoke("netflix-top10-pakistan-tv"),
});
```

---

## Step 5 — Revert `src/js/api.js`

### 5a — Replace the simplified cache-read methods

Find these two simplified methods:

```js
async netflixPakistanTop10Movies() {
  if (!window.electronAPI?.getNetflixTop10Cache) return { results: [] };
  const cache = await window.electronAPI.getNetflixTop10Cache();
  return { results: cache.movies || [] };
},

async netflixPakistanTop10TV() {
  if (!window.electronAPI?.getNetflixTop10Cache) return { results: [] };
  const cache = await window.electronAPI.getNetflixTop10Cache();
  return { results: cache.tv || [] };
},
```

Replace them with the original versions:

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

### 5b — Restore `normalizeNetflixTop10Title` and `resolveNetflixTop10`

Add back these two methods inside the `tmdb` object:

```js
normalizeNetflixTop10Title(title, type) {
  if (type !== "tv") return title;
  return title
    .replace(/:\s*Season\s+\d+$/i, "")
    .replace(/:\s*Limited Series$/i, "")
    .trim();
},

async resolveNetflixTop10(top10, type) {
  const rankedResults = await Promise.all(
    (top10.titles || []).map(async (entry) => {
      try {
        const searchTitle = this.normalizeNetflixTop10Title(entry.title, type);
        const search = type === "tv" ? await this.searchTV(searchTitle) : await this.searchMovies(searchTitle);
        const titleKey = searchTitle.toLowerCase();
        const match =
          search.results.find((item) => ((type === "tv" ? item.name : item.title) || "").toLowerCase() === titleKey) ||
          search.results.find((item) => item.poster_path);

        return match ? { ...match, media_type: type, netflix_rank: entry.rank, netflix_weeks: entry.weeks } : null;
      } catch (err) {
        return null;
      }
    })
  );

  const results = rankedResults
    .filter(Boolean)
    .sort((a, b) => a.netflix_rank - b.netflix_rank)
    .filter((item, index, list) => type !== "tv" || list.findIndex((candidate) => candidate.id === item.id) === index);

  return {
    period: top10.period || "",
    source: top10.source || "",
    results,
  };
},
```

---

## Step 6 — Verify

Run `node --check` on all modified files:

```
node --check main.js
node --check preload.js
node --check src/js/api.js
```

Then start the app with `npm start` or `electron .` The app will behave exactly as it did before the cache system was added: both Tudum pages are fetched at startup and Home waits for them before rendering.

---

## Summary of reverted files

| File | Action |
|---|---|
| `fetch-top10.js` | Deleted |
| `top10_cache.json` | Deleted |
| `main.js` | Removed `fs` + `spawn` imports, removed spawn block, removed cache IPC handler, restored 2 URL constants + 3 helper functions + 2 original IPC handlers |
| `preload.js` | Restored 2 original bridge calls, removed 1 cache bridge call |
| `src/js/api.js` | Restored 2 original methods + 2 helper methods, removed cache-read versions |
