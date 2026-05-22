// fetch-top10.js
// Standalone background script — fetches Netflix Top 10 Pakistan (Tudum) and resolves
// titles through TMDB. Writes top10_cache.json in the app root.
// Skips entirely if cache is less than 24 hours old.

const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "top10_cache.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const TMDB_API_KEY = "0cc7f9b606eed786b0c5d01c1bb8e676";
const TMDB_BASE = "https://api.themoviedb.org/3";

const NETFLIX_FILMS_URL = "https://www.netflix.com/tudum/top10/pakistan/films";
const NETFLIX_TV_URL = "https://www.netflix.com/tudum/top10/pakistan/tv";

// ── Cache freshness check ──────────────────────────────────────────────────
function isCacheFresh() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const cache = JSON.parse(raw);
    if (!cache.timestamp) return false;
    if (!cache.movies?.length || !cache.tv?.length) return false;
    return Date.now() - cache.timestamp < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function readExistingCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Cinemax",
      accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function tmdbSearch(query, type) {
  const endpoint = type === "tv" ? "search/tv" : "search/movie";
  const url = `${TMDB_BASE}/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0] || null;
}

// ── Parse __NEXT_DATA__ JSON blob from Tudum HTML ─────────────────────────
function parseNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (!match) throw new Error("__NEXT_DATA__ not found in page HTML");
  return JSON.parse(match[1]);
}

// ── Extract ranked titles from Next.js page data ──────────────────────────
function extractTitles(nextData) {
  // Walk the dehydrated query cache to find the top10 rows array
  try {
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];
    for (const q of queries) {
      const rows = q?.state?.data?.rows || q?.state?.data?.data?.rows;
      if (Array.isArray(rows) && rows.length > 0 && rows[0]?.rank !== undefined) {
        return rows.slice(0, 10).map((r) => ({
          rank: r.rank,
          title: r.showTitle || r.title || r.movieTitle || "",
          weeks: r.weeksInTop10 || null,
        }));
      }
    }
  } catch {
    // fall through to table fallback
  }

  // Fallback: parse the rendered HTML table (existing approach)
  return null;
}

// ── Fallback HTML table parser (existing regex approach) ──────────────────
function decodeHtmlEntity(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseTableFallback(html) {
  const rows = [];
  const pattern = /<span class="rank">(\d+)<\/span>[\s\S]*?<button>([^<]+)<\/button>/g;
  let match;
  while ((match = pattern.exec(html)) !== null && rows.length < 10) {
    rows.push({ rank: Number(match[1]), title: decodeHtmlEntity(match[2].trim()), weeks: null });
  }
  return rows.length > 0 ? rows : null;
}

// ── Normalize TV titles (strip season suffixes) ───────────────────────────
function normalizeTitle(title, type) {
  if (type !== "tv") return title;
  return title
    .replace(/:\s*Season\s+\d+$/i, "")
    .replace(/:\s*Limited Series$/i, "")
    .trim();
}

// ── Fetch one Tudum page and resolve titles to TMDB objects ───────────────
async function fetchAndResolve(url, type) {
  const html = await fetchText(url);

  let titles = null;

  try {
    const nextData = parseNextData(html);
    titles = extractTitles(nextData);
  } catch {
    // __NEXT_DATA__ parse failed, use table fallback
  }

  if (!titles) {
    titles = parseTableFallback(html);
  }

  if (!titles || titles.length === 0) {
    console.warn(`[top10] No titles extracted from ${url}`);
    return [];
  }

  // Resolve all titles through TMDB in parallel
  const resolved = await Promise.all(
    titles.map(async (entry) => {
      try {
        const query = normalizeTitle(entry.title, type);
        const result = await tmdbSearch(query, type);
        if (!result) return null;
        return {
          ...result,
          media_type: type,
          netflix_rank: entry.rank,
          netflix_weeks: entry.weeks,
        };
      } catch {
        return null;
      }
    })
  );

  // Filter nulls, deduplicate by TMDB id, sort by rank
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
    console.log("[top10] Cache stale or missing — fetching Tudum...");
    const [movies, tv] = await Promise.all([
      fetchAndResolve(NETFLIX_FILMS_URL, "movie").catch((err) => {
        console.warn("[top10] Movies fetch failed:", err.message);
        return [];
      }),
      fetchAndResolve(NETFLIX_TV_URL, "tv").catch((err) => {
        console.warn("[top10] TV fetch failed:", err.message);
        return [];
      }),
    ]);

    const existing = readExistingCache();
    const cache = {
      timestamp: Date.now(),
      movies: movies.length ? movies : existing?.movies || [],
      tv: tv.length ? tv : existing?.tv || [],
    };
    if (!cache.movies.length && !cache.tv.length) {
      console.warn("[top10] No Top 10 entries resolved; keeping cache empty so the app can use fallback rows.");
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
    console.log(`[top10] Cache written — ${movies.length} movies, ${tv.length} TV shows`);
  } catch (err) {
    console.error("[top10] Fatal error:", err.message);
    process.exit(1);
  }
})();
