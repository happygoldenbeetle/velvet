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

  imdbTopMovies(page = 1) {
    return this.list(634, page);
  },

  imdbTopTV(page = 1) {
    return this.list(142134, page);
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
  searchMovies(query, page = 1) {
    return this.fetch("/search/movie", { query, page });
  },
  searchTV(query, page = 1) {
    return this.fetch("/search/tv", { query, page });
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
    const seen = new Set();
    const resolvedCandidates = await Promise.all(
      candidates.map(async (candidate) => {
        const query = candidate.title_english || candidate.title || candidate.title_japanese;
        if (!query) return null;

        const preferredOrder =
          candidate.type === "Movie" ? ["movie", "tv"] : ["tv", "movie"];

        for (const type of preferredOrder) {
          const searchResults =
            type === "tv" ? await this.searchTV(query) : await this.searchMovies(query);
          const best = (searchResults.results || []).find((item) => item.poster_path);
          if (best) {
            return {
              ...best,
              media_type: type,
            };
          }
        }

        return null;
      })
    );

    const resolved = [];
    for (const item of resolvedCandidates) {
      if (!item) continue;
      if (seen.has(`${item.media_type}-${item.id}`)) continue;
      seen.add(`${item.media_type}-${item.id}`);
      resolved.push({
        ...item,
        rank: resolved.length + 1,
      });
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
      return { results: (data.results || []).slice(0, 10).map((r) => ({ ...r, media_type: "movie" })), fallback: true };
    }
    return { results: cache.movies, fallback: false };
  },

  async netflixPakistanTop10TV() {
    if (!window.electronAPI?.getNetflixTop10Cache) return { results: [], fallback: true };
    const cache = await window.electronAPI.getNetflixTop10Cache();
    if (cache.empty || !cache.tv?.length) {
      const data = await this.netflixPKTVFallback().catch(() => ({ results: [] }));
      return { results: (data.results || []).slice(0, 10).map((r) => ({ ...r, media_type: "tv" })), fallback: true };
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
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type === "tv" ? "series" : "movie"}/${imdbId}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.meta?.imdbRating || null;
    } catch (err) {
      return null;
    }
  },
};
