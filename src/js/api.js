// ═══════════════════════════════════════════
// TMDB API Wrapper
// ═══════════════════════════════════════════

const TMDB_API_KEY = "0cc7f9b606eed786b0c5d01c1bb8e676";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const VIDSRC_BASE = "https://vidsrc-embed.ru/embed";
const JIKAN_BASE = "https://api.jikan.moe/v4";
const MANGADEX_BASE = "https://api.mangadex.org";
const MANGADEX_UPLOADS = "https://uploads.mangadex.org";
const IMDB_TOP_MOVIES_MARKDOWN = "https://r.jina.ai/http://r.jina.ai/http://https://www.imdb.com/chart/top/";
const IMDB_TOP_TV_CSV = "https://imdb-show-explorer.vercel.app/data/imdb_top_tv_shows.csv";
const IMDB_CHART_CACHE_MS = 24 * 60 * 60 * 1000;
const IMDB_TOP_MOVIES_SNAPSHOT = [
  { rank: 1, title: "The Shawshank Redemption", year: 1994, rating: 9.3, votes: "3.2M" },
  { rank: 2, title: "The Godfather", year: 1972, rating: 9.2, votes: "2.2M" },
  { rank: 3, title: "The Dark Knight", year: 2008, rating: 9.1, votes: "3.2M" },
  { rank: 4, title: "The Godfather Part II", year: 1974, rating: 9.0, votes: "1.5M" },
  { rank: 5, title: "12 Angry Men", year: 1957, rating: 9.0, votes: "985K" },
  { rank: 6, title: "The Lord of the Rings: The Return of the King", year: 2003, rating: 9.0, votes: "2.2M" },
  { rank: 7, title: "Schindler's List", year: 1993, rating: 9.0, votes: "1.6M" },
  { rank: 8, title: "The Lord of the Rings: The Fellowship of the Ring", year: 2001, rating: 8.9, votes: "2.2M" },
  { rank: 9, title: "Pulp Fiction", year: 1994, rating: 8.8, votes: "2.4M" },
  { rank: 10, title: "The Good, the Bad and the Ugly", year: 1966, rating: 8.8, votes: "892K" },
  { rank: 11, title: "The Lord of the Rings: The Two Towers", year: 2002, rating: 8.8, votes: "2M" },
  { rank: 12, title: "Forrest Gump", year: 1994, rating: 8.8, votes: "2.5M" },
  { rank: 13, title: "Fight Club", year: 1999, rating: 8.8, votes: "2.6M" },
  { rank: 14, title: "Inception", year: 2010, rating: 8.8, votes: "2.8M" },
  { rank: 15, title: "Star Wars: Episode V - The Empire Strikes Back", year: 1980, rating: 8.7, votes: "1.5M" },
  { rank: 16, title: "The Matrix", year: 1999, rating: 8.7, votes: "2.2M" },
  { rank: 17, title: "GoodFellas", year: 1990, rating: 8.7, votes: "1.4M" },
  { rank: 18, title: "Interstellar", year: 2014, rating: 8.7, votes: "2.5M" },
  { rank: 19, title: "One Flew Over the Cuckoo's Nest", year: 1975, rating: 8.6, votes: "1.2M" },
  { rank: 20, title: "Se7en", year: 1995, rating: 8.6, votes: "2M" },
];
const imdbChartMemoryCache = new Map();
const imdbRatingMemoryCache = new Map();

const tmdb = {
  // ── Fetch helper with retry ──
  async fetch(endpoint, params = {}) {
    const url = new URL(`${TMDB_BASE}${endpoint}`);
    url.searchParams.set("api_key", TMDB_API_KEY);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url.toString());
        if (res.status === 401) {
          throw new Error("Invalid API key. Please add your TMDB API key in api.js");
        }
        if (res.status === 429) {
          // Rate limited — wait and retry
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        if (!res.ok) throw new Error(`TMDB Error: ${res.status} ${res.statusText}`);
        return res.json();
      } catch (err) {
        lastError = err;
        if (attempt === 0 && !err.message.includes("Invalid API key")) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  },

  async fetchExternalJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`External API Error: ${res.status} ${res.statusText}`);
    return res.json();
  },

  async fetchExternalText(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`External API Error: ${res.status} ${res.statusText}`);
    return res.text();
  },

  async fetchGraphQL(url, query, variables = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`GraphQL Error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data.errors?.length) {
      throw new Error(data.errors[0].message || "GraphQL request failed");
    }
    return data;
  },

  async mangadexFetch(endpoint, params = {}) {
    const url = new URL(`${MANGADEX_BASE}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach((entry) => url.searchParams.append(key, entry));
        return;
      }
      url.searchParams.append(key, value);
    });
    if (window?.electronAPI?.mangadexJson) {
      return window.electronAPI.mangadexJson(url.toString());
    }
    return this.fetchExternalJson(url.toString());
  },

  mangadexCover(mangaId, fileName, size = "512") {
    if (!mangaId || !fileName) return "";
    return `${MANGADEX_UPLOADS}/covers/${mangaId}/${fileName}.${size}.jpg`;
  },

  mangadexTitle(attributes = {}) {
    const titleMap = attributes.title || {};
    const altTitles = attributes.altTitles || [];
    return (
      titleMap.en ||
      titleMap["ja-ro"] ||
      titleMap["ko-ro"] ||
      titleMap.ja ||
      titleMap.ko ||
      Object.values(titleMap)[0] ||
      altTitles.find((entry) => entry.en)?.en ||
      Object.values(altTitles[0] || {})[0] ||
      "Untitled"
    );
  },

  mangadexDescription(attributes = {}) {
    const descriptionMap = attributes.description || {};
    const raw =
      descriptionMap.en ||
      descriptionMap["en-us"] ||
      Object.values(descriptionMap).find(Boolean) ||
      "";

    return String(raw)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  },

  mangadexTags(attributes = {}) {
    return (attributes.tags || [])
      .map((tag) => tag?.attributes?.name?.en)
      .filter(Boolean);
  },

  mangadexAuthors(relationships = []) {
    return relationships
      .filter((rel) => rel.type === "author" || rel.type === "artist")
      .map((rel) => rel.attributes?.name)
      .filter(Boolean);
  },

  mangadexPrimaryCover(manga) {
    return (manga.relationships || []).find(
      (rel) => rel.type === "cover_art" && rel.attributes?.fileName
    );
  },

  normalizeMangaChapter(chapter) {
    const attributes = chapter.attributes || {};
    const chapterNumber = attributes.chapter ? parseFloat(attributes.chapter) : null;
    const volumeNumber = attributes.volume ? parseFloat(attributes.volume) : null;

    return {
      id: chapter.id,
      chapter: attributes.chapter || "",
      chapter_number: Number.isFinite(chapterNumber) ? chapterNumber : null,
      volume: attributes.volume || "",
      volume_number: Number.isFinite(volumeNumber) ? volumeNumber : null,
      title: attributes.title || "",
      pages: attributes.pages || 0,
      translated_language: attributes.translatedLanguage || "",
      external_url: attributes.externalUrl || "",
      readable_at: attributes.readableAt || "",
      publish_at: attributes.publishAt || "",
      is_unavailable: Boolean(attributes.isUnavailable),
    };
  },

  normalizeManga(rawManga, chapterSeed = null) {
    const attributes = rawManga.attributes || {};
    const coverRelationship = this.mangadexPrimaryCover(rawManga);
    const coverFileName = coverRelationship?.attributes?.fileName || "";
    const title = this.mangadexTitle(attributes);
    const tags = this.mangadexTags(attributes);
    const authors = this.mangadexAuthors(rawManga.relationships || []);
    const posterUrl = this.mangadexCover(rawManga.id, coverFileName, "512");
    const backdropUrl = this.mangadexCover(rawManga.id, coverFileName, "768");

    return {
      id: rawManga.id,
      media_type: "manga",
      title,
      name: title,
      overview: this.mangadexDescription(attributes),
      poster_path: posterUrl,
      backdrop_path: backdropUrl,
      manga_status: attributes.status || "",
      content_rating: attributes.contentRating || "",
      release_date: attributes.year ? `${attributes.year}-01-01` : "",
      first_air_date: attributes.year ? `${attributes.year}-01-01` : "",
      year: attributes.year || null,
      tags,
      genres: tags,
      authors,
      artists: (rawManga.relationships || [])
        .filter((rel) => rel.type === "artist")
        .map((rel) => rel.attributes?.name)
        .filter(Boolean),
      original_language: attributes.originalLanguage || "",
      available_translated_languages: attributes.availableTranslatedLanguages || [],
      last_chapter: attributes.lastChapter || "",
      last_volume: attributes.lastVolume || "",
      publication_demographic: attributes.publicationDemographic || "",
      latest_uploaded_chapter: attributes.latestUploadedChapter || chapterSeed?.id || "",
      latest_readable_chapter: chapterSeed ? this.normalizeMangaChapter(chapterSeed) : null,
      cover_file_name: coverFileName,
      vote_average: null,
      external_ids: {},
    };
  },

  async mangadexMangaByIds(ids = []) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) return [];

    const chunkSize = 25;
    const batches = [];
    for (let index = 0; index < uniqueIds.length; index += chunkSize) {
      batches.push(
        this.mangadexFetch("/manga", {
          "ids[]": uniqueIds.slice(index, index + chunkSize),
          "includes[]": ["cover_art", "author", "artist"],
          "contentRating[]": ["safe", "suggestive"],
          limit: Math.min(chunkSize, uniqueIds.length - index),
        })
      );
    }

    const responses = await Promise.all(batches);
    return responses.flatMap((response) => response.data || []);
  },

  async mangaLatestPool(limit = 60, offset = 0) {
    const chapterByMangaId = new Map();
    const pageSize = 100;
    const targetChapterCount = Math.max(limit * 2, 80);
    const maxPages = 4;

    for (let page = 0; page < maxPages && chapterByMangaId.size < limit; page++) {
      const chapterResponse = await this.mangadexFetch("/chapter", {
        limit: pageSize,
        offset: offset + page * pageSize,
        "translatedLanguage[]": ["en"],
        "includes[]": ["manga"],
        "order[readableAt]": "desc",
      });

      const readableChapters = (chapterResponse.data || []).filter((chapter) => {
        const attrs = chapter.attributes || {};
        return !attrs.externalUrl && !attrs.isUnavailable && (attrs.pages || 0) > 0;
      });

      for (const chapter of readableChapters) {
        const mangaRelationship = (chapter.relationships || []).find((rel) => rel.type === "manga");
        if (!mangaRelationship?.id) continue;
        if (!chapterByMangaId.has(mangaRelationship.id)) {
          chapterByMangaId.set(mangaRelationship.id, chapter);
        }
        if (chapterByMangaId.size >= targetChapterCount) break;
      }

      if ((chapterResponse.data || []).length < pageSize || chapterByMangaId.size >= targetChapterCount) {
        break;
      }
    }

    const mangaIds = [...chapterByMangaId.keys()];
    const rawManga = await this.mangadexMangaByIds(mangaIds);
    const rawById = new Map(rawManga.map((entry) => [entry.id, entry]));

    return mangaIds
      .map((mangaId) => {
        const raw = rawById.get(mangaId);
        if (!raw) return null;
        const normalized = this.normalizeManga(raw, chapterByMangaId.get(mangaId));
        if (!normalized.poster_path) return null;
        if (!["safe", "suggestive"].includes(normalized.content_rating || "safe")) return null;
        return normalized;
      })
      .filter(Boolean);
  },

  async mangaPopular(limit = 20) {
    const response = await this.mangadexFetch("/manga", {
      limit,
      "includes[]": ["cover_art", "author", "artist"],
      "availableTranslatedLanguage[]": ["en"],
      "contentRating[]": ["safe", "suggestive"],
      "order[followedCount]": "desc",
      "order[latestUploadedChapter]": "desc",
    });

    return {
      results: (response.data || [])
        .map((entry) => this.normalizeManga(entry))
        .filter((entry) => entry.poster_path),
    };
  },

  async mangaDetails(id) {
    const response = await this.mangadexFetch(`/manga/${id}`, {
      "includes[]": ["cover_art", "author", "artist"],
    });
    return this.normalizeManga(response.data);
  },

  async mangaChapterList(mangaId, limit = 200) {
    const response = await this.mangadexFetch(`/manga/${mangaId}/feed`, {
      limit,
      "translatedLanguage[]": ["en"],
      "order[volume]": "asc",
      "order[chapter]": "asc",
    });

    return (response.data || [])
      .filter((chapter) => {
        const attrs = chapter.attributes || {};
        return !attrs.externalUrl && !attrs.isUnavailable && (attrs.pages || 0) > 0;
      })
      .map((chapter) => this.normalizeMangaChapter(chapter))
      .sort((a, b) => {
        if (a.volume_number !== null && b.volume_number !== null && a.volume_number !== b.volume_number) {
          return a.volume_number - b.volume_number;
        }
        if (a.chapter_number !== null && b.chapter_number !== null && a.chapter_number !== b.chapter_number) {
          return a.chapter_number - b.chapter_number;
        }
        return new Date(a.readable_at || 0) - new Date(b.readable_at || 0);
      });
  },

  async mangaChapterPages(chapterId, useDataSaver = true) {
    const response = await this.mangadexFetch(`/at-home/server/${chapterId}`);
    const chapter = response.chapter || {};
    const files = useDataSaver ? chapter.dataSaver || [] : chapter.data || [];
    const qualityFolder = useDataSaver ? "data-saver" : "data";

    return files.map(
      (fileName) => `${response.baseUrl}/${qualityFolder}/${chapter.hash}/${fileName}`
    );
  },

  // ── Image URLs ──
  img(path, size = "w500") {
    if (!path) return "";
    return `${TMDB_IMG}/${size}${path}`;
  },
  backdrop(path) {
    return this.img(path, "original");
  },
  poster(path) {
    return this.img(path, "w500");
  },
  posterSmall(path) {
    return this.img(path, "w342");
  },
  still(path) {
    return this.img(path, "w300");
  },
  logo(path) {
    return this.img(path, "w500");
  },

  // ── Trending ──
  trending(type = "all", time = "week") {
    return this.fetch(`/trending/${type}/${time}`);
  },

  list(id, page = 1) {
    return this.fetch(`/list/${id}`, { page });
  },

  normalizeChartTitle(value = "") {
    return String(value)
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  },

  chartTitleKeys(value = "") {
    const key = this.normalizeChartTitle(value);
    const aliases = {
      seven: "se7en",
    };
    return new Set([key, aliases[key]].filter(Boolean));
  },

  parseImdbTopMoviesMarkdown(markdown = "") {
    const lines = String(markdown)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const items = [];

    for (let index = 0; index < lines.length; index++) {
      const rankMatch = lines[index].match(/^#(\d+)$/);
      if (!rankMatch) continue;

      const title = lines[index + 1] || "";
      const meta = lines[index + 2] || "";
      const rating = Number(lines[index + 3]);
      const yearMatch = meta.match(/^(\d{4})/);
      if (!title || !yearMatch || !Number.isFinite(rating)) continue;

      items.push({
        rank: Number(rankMatch[1]),
        title,
        year: Number(yearMatch[1]),
        rating,
        votes: (lines[index + 4] || "").replace(/[()]/g, "").trim(),
      });
    }

    return items;
  },

  parseCsvRows(csv = "") {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < csv.length; index++) {
      const char = csv[index];
      const next = csv[index + 1];
      if (char === '"') {
        if (quoted && next === '"') {
          field += '"';
          index++;
        } else {
          quoted = !quoted;
        }
        continue;
      }
      if (char === "," && !quoted) {
        row.push(field);
        field = "";
        continue;
      }
      if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index++;
        row.push(field);
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        field = "";
        continue;
      }
      field += char;
    }

    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }

    const headers = rows.shift() || [];
    return rows.map((values) =>
      headers.reduce((entry, header, index) => {
        entry[header] = values[index] || "";
        return entry;
      }, {})
    );
  },

  parseImdbTopTVCsv(csv = "") {
    return this.parseCsvRows(csv)
      .map((row) => {
        const imdbId = String(row.seriesLink || "").match(/\/title\/(tt\d+)/)?.[1] || "";
        return {
          rank: Number(row.seriesRank),
          title: row.seriesTitle,
          year: Number(String(row.timeRange || "").match(/\d{4}/)?.[0]) || null,
          rating: Number(row.overallRating),
          votes: row.numberOfRatings,
          imdb_id: imdbId,
        };
      })
      .filter((entry) => entry.rank && entry.title && Number.isFinite(entry.rating));
  },

  readCachedImdbChart(type) {
    const memory = imdbChartMemoryCache.get(type);
    if (memory?.items?.length && Date.now() - memory.cachedAt < IMDB_CHART_CACHE_MS) return memory.items;

    try {
      const raw = localStorage.getItem(`velvet_imdb_top_${type}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.items?.length || Date.now() - parsed.cachedAt >= IMDB_CHART_CACHE_MS) return null;
      imdbChartMemoryCache.set(type, parsed);
      return parsed.items;
    } catch {
      return null;
    }
  },

  writeCachedImdbChart(type, items) {
    const payload = { cachedAt: Date.now(), items };
    imdbChartMemoryCache.set(type, payload);
    try {
      localStorage.setItem(`velvet_imdb_top_${type}`, JSON.stringify(payload));
    } catch {}
  },

  async loadRawImdbMovieChart() {
    try {
      const markdown = await this.fetchExternalText(IMDB_TOP_MOVIES_MARKDOWN, 2500);
      const chart = this.parseImdbTopMoviesMarkdown(markdown);
      if (chart.length) return chart;
    } catch {}
    return IMDB_TOP_MOVIES_SNAPSHOT;
  },

  async loadRawImdbTVChart() {
    const csv = await this.fetchExternalText(IMDB_TOP_TV_CSV);
    const chart = this.parseImdbTopTVCsv(csv);
    if (!chart.length) throw new Error("IMDb TV chart returned no titles.");
    chart.forEach((entry) => {
      if (entry.imdb_id && Number.isFinite(entry.rating)) {
        imdbRatingMemoryCache.set(entry.imdb_id, entry.rating.toFixed(1));
      }
    });
    return chart;
  },

  pickBestTmdbMatch(results = [], entry = {}, type = "movie") {
    const titleKeys = this.chartTitleKeys(entry.title);
    const exact = results.find((item) => {
      const itemTitle = this.normalizeChartTitle(item.title || item.name);
      const itemYear = Number(String(item.release_date || item.first_air_date || "").slice(0, 4));
      return titleKeys.has(itemTitle) && (!entry.year || itemYear === entry.year);
    });
    if (exact) return exact;

    const sameYear = results.find((item) => {
      const itemYear = Number(String(item.release_date || item.first_air_date || "").slice(0, 4));
      return item.poster_path && entry.year && itemYear === entry.year;
    });
    if (sameYear) return sameYear;

    return results.find((item) => item.poster_path) || results[0] || null;
  },

  async hydrateImdbChartEntry(entry, type = "movie") {
    let match = null;

    if (entry.imdb_id) {
      const found = await this.findByImdbId(entry.imdb_id).catch(() => null);
      const results = type === "tv" ? found?.tv_results : found?.movie_results;
      match = results?.find((item) => item.poster_path) || results?.[0] || null;
    }

    if (!match) {
      const search =
        type === "tv"
          ? await this.searchTV(entry.title, 1, entry.year ? { first_air_date_year: entry.year } : {})
          : await this.searchMovies(entry.title, 1, entry.year ? { year: entry.year } : {});
      match = this.pickBestTmdbMatch(search.results || [], entry, type);
    }

    if (!match?.poster_path) return null;

    return {
      ...match,
      media_type: type,
      imdb_rank: entry.rank,
      imdb_rating: Number.isFinite(entry.rating) ? entry.rating.toFixed(1) : null,
      imdb_votes: entry.votes || "",
      imdb_id: entry.imdb_id || "",
      vote_average: Number.isFinite(entry.rating) ? entry.rating : match.vote_average,
      rank: entry.rank,
    };
  },

  async hydrateImdbChart(chart, type = "movie", limit = 20) {
    const items = [];
    const seen = new Set();
    const slice = chart.slice(0, Math.max(limit, 1));

    const batchSize = 8;
    for (let index = 0; index < slice.length && items.length < limit; index += batchSize) {
      const batch = slice.slice(index, index + batchSize);
      const hydrated = await Promise.all(batch.map((entry) => this.hydrateImdbChartEntry(entry, type).catch(() => null)));
      for (const item of hydrated) {
        if (!item) continue;
        const key = `${item.media_type}-${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }

    return items.sort((a, b) => (a.imdb_rank || 999) - (b.imdb_rank || 999));
  },

  async imdbTopMovies(page = 1) {
    const limit = 20;
    const cached = page === 1 ? this.readCachedImdbChart("movies") : null;
    if (cached?.length) return { items: cached, source: "imdb" };

    try {
      const chart = await this.loadRawImdbMovieChart();
      const items = await this.hydrateImdbChart(chart, "movie", limit);
      if (page === 1) this.writeCachedImdbChart("movies", items);
      return { items, source: "imdb" };
    } catch (err) {
      const fallback = await this.list(634, page).catch(() => ({ items: [] }));
      return { ...fallback, source: "tmdb-list-fallback", error: err.message };
    }
  },

  async imdbTopTV(page = 1) {
    const limit = 20;
    const cached = page === 1 ? this.readCachedImdbChart("tv") : null;
    if (cached?.length) return { items: cached, source: "imdb" };

    try {
      const chart = await this.loadRawImdbTVChart();
      const items = await this.hydrateImdbChart(chart, "tv", limit);
      if (page === 1) this.writeCachedImdbChart("tv", items);
      return { items, source: "imdb" };
    } catch (err) {
      const fallback = await this.list(142134, page).catch(() => ({ items: [] }));
      return { ...fallback, source: "tmdb-list-fallback", error: err.message };
    }
  },

  // ── Movies ──
  popularMovies(page = 1) {
    return this.fetch("/movie/popular", { page });
  },
  topRatedMovies(page = 1) {
    return this.fetch("/movie/top_rated", { page });
  },
  nowPlayingMovies(page = 1) {
    return this.fetch("/movie/now_playing", { page });
  },
  todayISODate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },
  upcomingMovies(page = 1) {
    return this.fetch("/movie/upcoming", { page });
  },
  comingSoonMovies(page = 1) {
    return this.fetch("/discover/movie", {
      sort_by: "primary_release_date.asc",
      "primary_release_date.gte": this.todayISODate(),
      include_adult: "false",
      page,
    });
  },

  // ── TV Shows ──
  popularTV(page = 1) {
    return this.fetch("/tv/popular", { page });
  },
  topRatedTV(page = 1) {
    return this.fetch("/tv/top_rated", { page });
  },
  airingTodayTV(page = 1) {
    return this.fetch("/tv/airing_today", { page });
  },
  onTheAirTV(page = 1) {
    return this.fetch("/tv/on_the_air", { page });
  },
  comingSoonTV(page = 1) {
    return this.fetch("/discover/tv", {
      sort_by: "first_air_date.asc",
      "first_air_date.gte": this.todayISODate(),
      include_null_first_air_dates: "false",
      page,
    });
  },

  // ── Details ──
  movieDetails(id) {
    return this.fetch(`/movie/${id}`, {
      append_to_response: "credits,videos,similar,external_ids,release_dates",
    });
  },
  tvDetails(id) {
    return this.fetch(`/tv/${id}`, {
      append_to_response: "credits,videos,similar,external_ids,content_ratings",
    });
  },
  tvSeason(id, seasonNum) {
    return this.fetch(`/tv/${id}/season/${seasonNum}`);
  },
  titleImages(id, type = "movie") {
    const mediaType = type === "tv" ? "tv" : "movie";
    return this.fetch(`/${mediaType}/${id}/images`);
  },
  async titleLogo(id, type = "movie") {
    const data = await this.titleImages(id, type);
    const sortLogos = (logos) =>
      logos.sort((a, b) => {
        const scoreA = (a.vote_average || 0) * 1000 + (a.width || 0);
        const scoreB = (b.vote_average || 0) * 1000 + (b.width || 0);
        return scoreB - scoreA;
      });
    const allLogos = (data.logos || []).filter((logo) => logo.file_path);
    const englishLogos = sortLogos(allLogos.filter((logo) => logo.iso_639_1 === "en"));
    const neutralLogos = sortLogos(allLogos.filter((logo) => !logo.iso_639_1));
    const logos = englishLogos.length ? englishLogos : neutralLogos;
    if (!logos.length) return null;
    return {
      ...logos[0],
      url: this.logo(logos[0].file_path),
    };
  },

  // ── Search ──
  searchMulti(query, page = 1) {
    return this.fetch("/search/multi", { query, page });
  },
  searchMovies(query, page = 1, params = {}) {
    return this.fetch("/search/movie", { query, page, ...params });
  },
  searchTV(query, page = 1, params = {}) {
    return this.fetch("/search/tv", { query, page, ...params });
  },
  findByImdbId(imdbId) {
    return this.fetch(`/find/${imdbId}`, { external_source: "imdb_id" });
  },
  async searchManga(query, limit = 12) {
    const response = await this.mangadexFetch("/manga", {
      title: query,
      limit,
      "includes[]": ["cover_art", "author", "artist"],
      "availableTranslatedLanguage[]": ["en"],
      "contentRating[]": ["safe", "suggestive"],
      "order[relevance]": "desc",
    });

    return {
      results: (response.data || [])
        .map((entry) => this.normalizeManga(entry))
        .filter((entry) => entry.poster_path),
    };
  },

  // ── Genres ──
  movieGenres() {
    return this.fetch("/genre/movie/list");
  },
  tvGenres() {
    return this.fetch("/genre/tv/list");
  },

  // ── Discover & Anime ──
  discoverMovies(params = {}) {
    return this.fetch("/discover/movie", params);
  },
  discoverTV(params = {}) {
    return this.fetch("/discover/tv", params);
  },
  popularAnimeTV(page = 1) {
    return this.fetch("/discover/tv", { with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc", page });
  },
  topRatedAnimeTV(page = 1) {
    return this.fetch("/discover/tv", { with_genres: "16", with_original_language: "ja", sort_by: "vote_average.desc", "vote_count.gte": 200, page });
  },
  popularAnimeMovies(page = 1) {
    return this.fetch("/discover/movie", { with_genres: "16", with_original_language: "ja", sort_by: "popularity.desc", page });
  },
  topRatedAnimeMovies(page = 1) {
    return this.fetch("/discover/movie", { with_genres: "16", with_original_language: "ja", sort_by: "vote_average.desc", "vote_count.gte": 200, page });
  },
  async animeRightNow(limit = 10) {
    const url = new URL(`${JIKAN_BASE}/seasons/now`);
    url.searchParams.set("limit", String(Math.max(limit + 4, 14)));
    url.searchParams.set("sfw", "true");

    const data = await this.fetchExternalJson(url.toString());
    const candidates = (data.data || []).slice(0, Math.max(limit + 4, 14));

    const resolveCandidate = async (candidate) => {
      const query = candidate.title_english || candidate.title || candidate.title_japanese;
      if (!query) return null;

      const preferredOrder = candidate.type === "Movie" ? ["movie", "tv"] : ["tv", "movie"];
      for (const type of preferredOrder) {
        const searchResults = type === "tv" ? await this.searchTV(query) : await this.searchMovies(query);
        const best = (searchResults.results || []).find((item) => item.poster_path);
        if (best) {
          return { ...best, media_type: type };
        }
      }

      return null;
    };

    const seen = new Set();
    const resolved = [];
    for (let index = 0; index < candidates.length && resolved.length < limit; index += 3) {
      const batch = candidates.slice(index, index + 3);
      const batchResults = await Promise.all(batch.map((candidate) => resolveCandidate(candidate)));
      for (const item of batchResults) {
        if (!item) continue;
        if (seen.has(`${item.media_type}-${item.id}`)) continue;
        seen.add(`${item.media_type}-${item.id}`);
        resolved.push({
          ...item,
          rank: resolved.length + 1,
        });
        if (resolved.length >= limit) break;
      }
      if (resolved.length >= limit) break;
    }

    return { results: resolved };
  },
  comingSoonAnimeTV(page = 1) {
    return this.fetch("/discover/tv", {
      with_genres: "16",
      with_original_language: "ja",
      sort_by: "first_air_date.asc",
      "first_air_date.gte": this.todayISODate(),
      include_null_first_air_dates: "false",
      page,
    });
  },
  comingSoonAnimeMovies(page = 1) {
    return this.fetch("/discover/movie", {
      with_genres: "16",
      with_original_language: "ja",
      sort_by: "primary_release_date.asc",
      "primary_release_date.gte": this.todayISODate(),
      include_adult: "false",
      page,
    });
  },

  // ── VidSrc embed URLs ──
  searchFrieren() {
    return this.searchTV("Frieren: Beyond Journey's End");
  },

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

  async netflixPakistanTop10Movies() {
    if (!window.electronAPI?.getNetflixTop10Cache) return { results: [], fallback: true };
    const cache = await window.electronAPI.getNetflixTop10Cache();
    if (cache.empty || !cache.movies?.length) {
      const data = await this.netflixPKMoviesFallback().catch(() => ({ results: [] }));
      return {
        results: (data.results || [])
          .slice(0, 10)
          .map((r, index) => ({ ...r, media_type: "movie", netflix_rank: index + 1 })),
        fallback: true,
      };
    }
    return { results: cache.movies, fallback: false };
  },

  async netflixPakistanTop10TV() {
    if (!window.electronAPI?.getNetflixTop10Cache) return { results: [], fallback: true };
    const cache = await window.electronAPI.getNetflixTop10Cache();
    if (cache.empty || !cache.tv?.length) {
      const data = await this.netflixPKTVFallback().catch(() => ({ results: [] }));
      return {
        results: (data.results || [])
          .slice(0, 10)
          .map((r, index) => ({ ...r, media_type: "tv", netflix_rank: index + 1 })),
        fallback: true,
      };
    }
    return { results: cache.tv, fallback: false };
  },

  getMovieEmbed(tmdbId, startTime = 0) {
    const url = new URL(`${VIDSRC_BASE}/movie`);
    url.searchParams.set("tmdb", tmdbId);
    url.searchParams.set("autoplay", "1");
    if (startTime > 0) url.searchParams.set("t", Math.floor(startTime));
    return url.toString();
  },
  getTVEmbed(tmdbId, season, episode, startTime = 0) {
    const url = new URL(`${VIDSRC_BASE}/tv`);
    url.searchParams.set("tmdb", tmdbId);
    url.searchParams.set("season", season);
    url.searchParams.set("episode", episode);
    url.searchParams.set("autoplay", "1");
    if (startTime > 0) url.searchParams.set("t", Math.floor(startTime));
    return url.toString();
  },

  // ── IMDb Rating via Cinemeta ──
  async getImdbRating(imdbId, type = "movie") {
    if (!imdbId) return null;
    if (imdbRatingMemoryCache.has(imdbId)) return imdbRatingMemoryCache.get(imdbId);
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type === "tv" ? "series" : "movie"}/${imdbId}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      const rating = data?.meta?.imdbRating || null;
      if (rating) imdbRatingMemoryCache.set(imdbId, rating);
      return rating;
    } catch (err) {
      return null;
    }
  },
};
