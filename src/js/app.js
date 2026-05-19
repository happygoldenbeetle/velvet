// ═══════════════════════════════════════════
// CINEMAX — Main Application Logic
// ═══════════════════════════════════════════

(() => {
  // ── State ──
  let currentPage = "home";
  let myList = JSON.parse(localStorage.getItem("cinemax_mylist") || "[]");
  let continueWatching = JSON.parse(localStorage.getItem("cinemax_continue_watching") || "[]");
  let heroItem = null;
  const tabHeroes = { home: null, movies: null, tvshows: null, anime: null };
  let modalItem = null;
  let searchTimeout = null;
  let activeWatchSession = null;
  let watchProgressTimer = null;
  let heroVisualRequestId = 0;
  let modalVisualRequestId = 0;
  const itemStore = new Map(); // Safe item storage (avoids XSS via data attributes)
  const continueStore = new Map();
  const heroLogoCache = new Map();

  const curatedRowConfigs = {
    home: [
      {
        title: "Action Movies",
        type: "movie",
        fetch: () => tmdb.discoverMovies({ with_genres: "28", sort_by: "popularity.desc", "vote_count.gte": 200 }),
      },
      {
        title: "K-Dramas",
        type: "tv",
        fetch: () => tmdb.discoverTV({ with_origin_country: "KR", with_genres: "18", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
      {
        title: "Anime Spotlight",
        type: "tv",
        fetch: () => tmdb.popularAnimeTV(),
      },
    ],
    movies: [
      {
        title: "Action Hits",
        type: "movie",
        fetch: () => tmdb.discoverMovies({ with_genres: "28", sort_by: "popularity.desc", "vote_count.gte": 200 }),
      },
      {
        title: "Crime Thrillers",
        type: "movie",
        fetch: () => tmdb.discoverMovies({ with_genres: "80,53", sort_by: "popularity.desc", "vote_count.gte": 200 }),
      },
      {
        title: "Sci-Fi Adventures",
        type: "movie",
        fetch: () => tmdb.discoverMovies({ with_genres: "878,12", sort_by: "popularity.desc", "vote_count.gte": 200 }),
      },
    ],
    tvshows: [
      {
        title: "K-Dramas",
        type: "tv",
        fetch: () => tmdb.discoverTV({ with_origin_country: "KR", with_genres: "18", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
      {
        title: "Crime Series",
        type: "tv",
        fetch: () => tmdb.discoverTV({ with_genres: "80", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
      {
        title: "Sci-Fi & Fantasy",
        type: "tv",
        fetch: () => tmdb.discoverTV({ with_genres: "10765", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
    ],
    anime: [
      {
        title: "Fantasy Anime",
        type: "tv",
        fetch: () => tmdb.discoverTV({ with_genres: "16,10765", with_original_language: "ja", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
      {
        title: "Shonen Adventure",
        type: "tv",
        fetch: () => tmdb.discoverTV({ with_genres: "16,10759", with_original_language: "ja", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
      {
        title: "Anime Movie Gems",
        type: "movie",
        fetch: () => tmdb.discoverMovies({ with_genres: "16,14", with_original_language: "ja", sort_by: "popularity.desc", "vote_count.gte": 100 }),
      },
    ],
  };

  // ── DOM References ──
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const els = {
    navbar: $("#navbar"),
    contentRows: $("#content-rows"),
    hero: $("#hero"),
    heroBackdrop: $("#hero-backdrop"),
    heroTitleBlock: $("#hero-title-block"),
    heroLogo: $("#hero-logo"),
    heroTitle: $("#hero-title"),
    heroOverview: $("#hero-overview"),
    heroMeta: $("#hero-meta"),
    heroPlay: $("#hero-play"),
    heroInfo: $("#hero-info"),
    heroBadge: $("#hero-badge"),
    mainContent: $("#main-content"),
    modalOverlay: $("#modal-overlay"),
    modalBackdrop: $("#modal-backdrop"),
    modalTitleBlock: $("#modal-title-block"),
    modalLogo: $("#modal-logo"),
    modalTitle: $("#modal-title"),
    modalMeta: $("#modal-meta"),
    modalOverview: $("#modal-overview"),
    modalDetails: $("#modal-details"),
    modalPlay: $("#modal-play"),
    modalList: $("#modal-list"),
    modalClose: $("#modal-close"),
    seasonPicker: $("#season-picker"),
    seasonSelect: $("#season-select"),
    episodeList: $("#episode-list"),
    playerOverlay: $("#player-overlay"),
    playerWebview: $("#player-webview"),
    playerBack: $("#player-back"),
    playerTitle: $("#player-title"),
    loadingScreen: $("#loading-screen"),
    searchContainer: $("#search-container"),
    searchToggle: $("#search-toggle"),
    searchInput: $("#search-input"),
    searchResultsPage: $("#search-results-page"),
    searchResultsTitle: $("#search-results-title"),
    searchResultsGrid: $("#search-results-grid"),
    toastContainer: $("#toast-container"),
    playerEpisodesToggleBtn: $("#player-episodes-toggle"),
    playerEpisodesToggleContainer: $("#player-episodes-toggle-container"),
    playerEpisodesPanel: $("#player-episodes-panel"),
    playerEpisodesClose: $("#player-episodes-close"),
    playerSeasonSelect: $("#player-season-select"),
    playerEpisodeList: $("#player-episode-list"),
  };

  // ═══════════════════════════════════════════
  // TOAST NOTIFICATIONS
  // ═══════════════════════════════════════════
  function showToast(message, type = "info", duration = 3500) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icons = {
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.75l6 6 9-13.5"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>',
      info: '<svg width="18" height="18" viewBox="-2 -2 24 24" fill="currentColor"><path d=\'M10 20C4.477 20 0 15.523 0 10S4.477 0 10 0s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm0-10a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1zm0-1a1 1 0 1 1 0-2 1 1 0 0 1 0 2z\'/></svg>',
    };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${message}</span>`;
    els.toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
      toast.classList.remove("show");
      toast.addEventListener("transitionend", () => toast.remove());
    }, duration);
  }

  // ═══════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════
  async function init() {
    setupTitlebar();
    setupNavbar();
    setupSearch();
    setupModal();
    setupPlayer();
    setupScroll();
    await loadHomePage();
    hideLoading();
  }

  function hideLoading() {
    setTimeout(() => {
      els.loadingScreen.classList.add("hidden");
      setTimeout(() => els.loadingScreen.remove(), 600);
    }, 1000);
  }

  // ═══════════════════════════════════════════
  // TITLEBAR
  // ═══════════════════════════════════════════
  function setupTitlebar() {
    $("#btn-minimize").addEventListener("click", () => window.electronAPI.minimize());
    $("#btn-maximize").addEventListener("click", () => window.electronAPI.maximize());
    $("#btn-close").addEventListener("click", () => window.electronAPI.close());
  }

  // ═══════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════
  function setupNavbar() {
    $$(".nav-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        if (page === currentPage) return;
        setActivePage(page);
      });
    });
  }

  function setActivePage(page) {
    currentPage = page;
    $$(".nav-link").forEach((l) => l.classList.remove("active"));
    $(`[data-page="${page}"]`).classList.add("active");

    els.searchResultsPage.style.display = "none";
    els.mainContent.style.display = "";
    prepareHeroTransition();

    // Page transition
    els.contentRows.style.opacity = "0";
    els.contentRows.style.transform = "translateY(16px)";

    switch (page) {
      case "home": loadHomePage(); break;
      case "movies": loadMoviesPage(); break;
      case "tvshows": loadTVPage(); break;
      case "anime": loadAnimePage(); break;
      case "mylist": loadMyListPage(); break;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function animateContentIn() {
    requestAnimationFrame(() => {
      els.contentRows.style.transition = "opacity 0.4s ease, transform 0.4s ease";
      els.contentRows.style.opacity = "1";
      els.contentRows.style.transform = "translateY(0)";
    });
  }

  async function loadCuratedRows(page) {
    const configs = curatedRowConfigs[page] || [];
    const rows = await Promise.all(
      configs.map(async (config) => {
        try {
          const data = await config.fetch();
          return { ...config, items: data.results || [] };
        } catch (err) {
          console.warn(`Failed to load curated row "${config.title}":`, err);
          return { ...config, items: [] };
        }
      })
    );
    return rows.filter((row) => row.items.length > 0);
  }

  function renderCuratedRows(rows) {
    return rows.map((row) => createRowHTML(row.title, row.items, row.type)).join("");
  }

  function isBlockedAnimeHero(item) {
    const title = `${item?.name || ""} ${item?.original_name || ""}`.toLowerCase();
    return title.includes("overflow");
  }

  function normalizeAgeRating(value = "") {
    const raw = String(value).trim();
    if (!raw) return "";

    const normalized = raw.toUpperCase();
    const directMap = {
      "TV-Y": "0+",
      "TV-G": "0+",
      "G": "0+",
      "U": "0+",
      "TV-Y7": "7+",
      "7": "7+",
      "PG": "10+",
      "TV-PG": "10+",
      "PG-13": "13+",
      "UA": "13+",
      "13": "13+",
      "TV-14": "14+",
      "14": "14+",
      "15": "15+",
      "MA15+": "15+",
      "16": "16+",
      "M": "16+",
      "R": "17+",
      "NC-17": "17+",
      "18": "18+",
      "18A": "18+",
      "A": "18+",
      "TV-MA": "18+",
    };

    if (directMap[normalized]) return directMap[normalized];

    const digits = normalized.match(/\d+/);
    if (digits) return `${digits[0]}+`;

    return "";
  }

  function getTitleAgeRating(details, type) {
    const regionPriority = ["US", "PK", "GB", "IN", "CA", "AU"];

    if (type === "tv") {
      const ratings = details.content_ratings?.results || [];
      for (const region of regionPriority) {
        const match = ratings.find((item) => item.iso_3166_1 === region && item.rating);
        const normalized = normalizeAgeRating(match?.rating);
        if (normalized) return normalized;
      }
      for (const item of ratings) {
        const normalized = normalizeAgeRating(item.rating);
        if (normalized) return normalized;
      }
      return "";
    }

    const releaseRegions = details.release_dates?.results || [];
    for (const region of regionPriority) {
      const regionEntry = releaseRegions.find((item) => item.iso_3166_1 === region);
      const certification = regionEntry?.release_dates?.find((item) => item.certification)?.certification;
      const normalized = normalizeAgeRating(certification);
      if (normalized) return normalized;
    }

    for (const regionEntry of releaseRegions) {
      const certification = regionEntry.release_dates?.find((item) => item.certification)?.certification;
      const normalized = normalizeAgeRating(certification);
      if (normalized) return normalized;
    }

    return "";
  }

  function showHeroText(title = "") {
    els.heroTitleBlock.classList.remove("has-logo", "logo-pending");
    els.heroLogo.style.backgroundImage = "";
    els.heroTitle.textContent = title;
  }

  function prepareHeroTitleLookup(title) {
    els.heroTitleBlock.classList.remove("has-logo");
    els.heroTitleBlock.classList.add("logo-pending");
    els.heroLogo.style.backgroundImage = "";
    els.heroTitle.textContent = title;
  }

  function showHeroLogo(src, title) {
    els.heroLogo.style.backgroundImage = `url("${src}")`;
    els.heroTitle.textContent = title;
    els.heroTitleBlock.classList.remove("logo-pending");
    els.heroTitleBlock.classList.add("has-logo");
  }

  function prepareHeroTransition() {
    heroVisualRequestId += 1;
    showHeroText("");
    els.heroOverview.textContent = "";
    els.heroMeta.innerHTML = "";
  }

  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(src);
      image.onerror = reject;
      image.src = src;
    });
  }

  async function getPreparedTitleLogo(id, mediaType = "movie") {
    const logoCacheKey = `${mediaType}-${id}`;
    if (heroLogoCache.has(logoCacheKey)) return heroLogoCache.get(logoCacheKey);

    try {
      const logo = await tmdb.titleLogo(id, mediaType);
      if (logo?.url) {
        await preloadImage(logo.url);
        heroLogoCache.set(logoCacheKey, logo.url);
        return logo.url;
      }
    } catch (err) {}

    heroLogoCache.set(logoCacheKey, null);
    return null;
  }

  async function prepareHeroItem(item, forceType = null) {
    if (!item) return null;
    const mediaType = forceType || item.media_type || "movie";
    const preparedItem = { ...item, media_type: mediaType };
    preparedItem.heroLogoUrl = await getPreparedTitleLogo(preparedItem.id, mediaType);
    return preparedItem;
  }

  function showModalText(title = "") {
    els.modalTitleBlock.classList.remove("has-logo");
    els.modalLogo.style.backgroundImage = "";
    els.modalTitle.textContent = title;
  }

  function showModalLogo(src, title) {
    els.modalLogo.style.backgroundImage = `url("${src}")`;
    els.modalTitle.textContent = title;
    els.modalTitleBlock.classList.add("has-logo");
  }

  // ═══════════════════════════════════════════
  // SCROLL — navbar background on scroll
  // ═══════════════════════════════════════════
  function setupScroll() {
    window.addEventListener("scroll", () => {
      els.navbar.classList.toggle("scrolled", window.scrollY > 50);
    });
  }

  // ═══════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════
  function setupSearch() {
    els.searchToggle.addEventListener("click", () => {
      els.searchContainer.classList.toggle("active");
      if (els.searchContainer.classList.contains("active")) {
        els.searchInput.focus();
      }
    });

    els.searchInput.addEventListener("input", (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      if (q.length < 2) {
        els.searchResultsPage.style.display = "none";
        els.mainContent.style.display = "";
        return;
      }
      searchTimeout = setTimeout(() => performSearch(q), 400);
    });

    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        els.searchInput.value = "";
        els.searchContainer.classList.remove("active");
        els.searchResultsPage.style.display = "none";
        els.mainContent.style.display = "";
      }
    });
  }

  async function performSearch(query) {
    try {
      const data = await tmdb.searchMulti(query);
      const results = data.results.filter(
        (r) => (r.media_type === "movie" || r.media_type === "tv") && r.poster_path
      );

      els.mainContent.style.display = "none";
      els.searchResultsPage.style.display = "";
      els.searchResultsTitle.textContent = `Results for "${query}"`;
      els.searchResultsGrid.innerHTML = results.length
        ? results.map((item) => createCardHTML(item, item.media_type)).join("")
        : '<div class="empty-state"><p>No results found.</p></div>';

      attachCardListeners(els.searchResultsGrid);
    } catch (err) {
      console.error("Search error:", err);
      showToast("Search failed. Please try again.", "error");
    }
  }

  // ═══════════════════════════════════════════
  function escapeHTML(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getWatchKey(item, season = null, episode = null) {
    const type = item.media_type || "movie";
    if (type === "tv") return `tv-${item.id}`;
    return `movie-${item.id}`;
  }

  function getContinueEntry(item, season = null, episode = null) {
    const key = getWatchKey(item, season, episode);
    return continueWatching.find((entry) => entry.key === key) || null;
  }

  function getEpisodeResumeSeconds(item, season, episode) {
    const entry = getContinueEntry(item);
    if (!entry || entry.season !== season || entry.episode !== episode) return 0;
    return entry.progressSeconds || 0;
  }

  function getDurationSeconds(item, episodeMeta = null) {
    if (episodeMeta?.runtime) return episodeMeta.runtime * 60;
    if (item.runtime) return item.runtime * 60;
    if (item.episode_run_time?.[0]) return item.episode_run_time[0] * 60;
    return (item.media_type || "movie") === "tv" ? 45 * 60 : 120 * 60;
  }

  function persistContinueWatching() {
    continueWatching = continueWatching
      .filter((entry) => entry.progressSeconds >= 30)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40);
    localStorage.setItem("cinemax_continue_watching", JSON.stringify(continueWatching));
  }

  function saveContinueEntry(entry) {
    const durationSeconds = Math.max(entry.durationSeconds || 1, 1);
    if (entry.progressSeconds >= durationSeconds * 0.92) {
      continueWatching = continueWatching.filter((item) => item.key !== entry.key);
      persistContinueWatching();
      return;
    }

    const idx = continueWatching.findIndex((item) => item.key === entry.key);
    if (idx >= 0) continueWatching[idx] = entry;
    else continueWatching.unshift(entry);
    persistContinueWatching();
  }

  async function hydratePlayableItem(item) {
    try {
      const type = item.media_type || "movie";
      if (type === "tv" && !item.number_of_seasons) {
        const details = await tmdb.tvDetails(item.id);
        return { ...item, ...details, media_type: "tv" };
      }
      if (type !== "tv" && !item.runtime) {
        const details = await tmdb.movieDetails(item.id);
        return { ...item, ...details, media_type: "movie" };
      }
    } catch (err) {
      console.warn("Could not hydrate playable item:", err);
    }
    return item;
  }

  function buildContinueEntryFromSession() {
    if (!activeWatchSession) return null;
    const { item, season, episode, episodeMeta } = activeWatchSession;
    const title = item.title || item.name || activeWatchSession.title || "Untitled";
    const key = getWatchKey(item, season, episode);

    return {
      key,
      id: item.id,
      media_type: item.media_type || "movie",
      title: item.title,
      name: item.name,
      display_title: activeWatchSession.title || title,
      episode_title: episodeMeta?.name || "",
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      vote_average: item.vote_average,
      release_date: item.release_date,
      first_air_date: item.first_air_date,
      runtime: item.runtime,
      episode_run_time: item.episode_run_time,
      number_of_seasons: item.number_of_seasons,
      season,
      episode,
      progressSeconds: Math.floor(activeWatchSession.progressSeconds),
      durationSeconds: activeWatchSession.durationSeconds,
      updatedAt: Date.now(),
    };
  }

  function updateActiveWatchProgress(save = true) {
    if (!activeWatchSession) return;
    const now = Date.now();
    const elapsed = Math.max(0, (now - activeWatchSession.lastTickAt) / 1000);
    activeWatchSession.lastTickAt = now;
    activeWatchSession.progressSeconds = Math.min(
      activeWatchSession.progressSeconds + elapsed,
      activeWatchSession.durationSeconds
    );
    if (save) {
      const entry = buildContinueEntryFromSession();
      if (entry) saveContinueEntry(entry);
    }
  }

  function startWatchSession(item, options = {}) {
    stopWatchSession(true);
    const durationSeconds = getDurationSeconds(item, options.episodeMeta);

    activeWatchSession = {
      item,
      season: options.season || null,
      episode: options.episode || null,
      episodeMeta: options.episodeMeta || null,
      title: options.title || item.title || item.name || "",
      progressSeconds: Math.min(options.startTime || 0, Math.max(durationSeconds - 10, 0)),
      durationSeconds,
      lastTickAt: Date.now(),
    };

    if (watchProgressTimer) clearInterval(watchProgressTimer);
    watchProgressTimer = setInterval(() => updateActiveWatchProgress(true), 5000);
  }

  function stopWatchSession(save = true) {
    if (!activeWatchSession) return;
    if (watchProgressTimer) {
      clearInterval(watchProgressTimer);
      watchProgressTimer = null;
    }
    updateActiveWatchProgress(save);
    activeWatchSession = null;
  }

  function formatWatchTime(seconds) {
    const mins = Math.max(1, Math.floor(seconds / 60));
    if (mins < 60) return `${mins} min watched`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}h ${rem}m watched` : `${hrs}h watched`;
  }

  // PAGE LOADERS
  // ═══════════════════════════════════════════
  async function loadHomePage() {
    try {
      const trendingPromise = tmdb.trending("all", "week");
      const homeHeroPromise = tabHeroes.home
        ? Promise.resolve(tabHeroes.home)
        : trendingPromise
            .then((trending) => {
              const validHeroes = trending.results.filter((r) => r.backdrop_path);
              const heroData = validHeroes.length > 0 ? validHeroes[Math.floor(Math.random() * Math.min(10, validHeroes.length))] : null;
              return prepareHeroItem(heroData, heroData?.media_type || "movie");
            })
            .catch(() => null);

      const [trending, preparedHomeHero, netflixTop10MoviesPakistan, netflixTop10TVPakistan, homeCuratedRows, imdbTopMovies, imdbTopTV] =
        await Promise.all([
          trendingPromise,
          homeHeroPromise,
          tmdb.netflixPakistanTop10Movies().catch((err) => {
            console.warn("Failed to load Netflix Pakistan Top 10 movies:", err);
            return { results: [] };
          }),
          tmdb.netflixPakistanTop10TV().catch((err) => {
            console.warn("Failed to load Netflix Pakistan Top 10 TV:", err);
            return { results: [] };
          }),
          loadCuratedRows("home"),
          tmdb.imdbTopMovies().catch((err) => {
            console.warn("Failed to load IMDb Top movies:", err);
            return { items: [] };
          }),
          tmdb.imdbTopTV().catch((err) => {
            console.warn("Failed to load IMDb Top TV:", err);
            return { items: [] };
          }),
        ]);

      if (!tabHeroes.home) {
        tabHeroes.home = preparedHomeHero || null;
      }
      if (tabHeroes.home) setHero(tabHeroes.home);
      els.hero.style.display = "";

      els.contentRows.innerHTML = [
        createRowHTML("Trending Now", trending.results),
        createContinueRowHTML(),
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
        renderCuratedRows(homeCuratedRows),
        createRowHTML("Top 250 IMDb Movies", imdbTopMovies.items || [], "movie"),
        createRowHTML("Top 250 IMDb TV Shows", imdbTopTV.items || [], "tv"),
      ].join("");

      attachAllRowListeners();
      attachContinueListeners(els.contentRows);
      animateContentIn();
    } catch (err) {
      console.error("Failed to load home:", err);
      els.contentRows.innerHTML = `<div class="empty-state"><p>Failed to load content. Check your API key in <code>api.js</code>.</p></div>`;
      animateContentIn();
      showToast(err.message || "Failed to load content", "error");
    }
  }

  function createContinueRowHTML() {
    const entries = continueWatching.filter((entry) => entry.poster_path && entry.progressSeconds >= 30);
    if (!entries.length) return "";

    const rowId = "row-continue-watching";
    return `
      <div class="content-row continue-row" id="${rowId}">
        <div class="row-header">
          <div class="row-title">Continue Watching</div>
        </div>
        <div class="row-slider-container">
          <button class="row-arrow row-arrow-left" data-row="${rowId}" aria-label="Scroll left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div class="row-slider">${entries.map(createContinueCardHTML).join("")}</div>
          <button class="row-arrow row-arrow-right" data-row="${rowId}" aria-label="Scroll right">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  async function loadMoviesPage() {
    try {
      const popularPromise = tmdb.popularMovies();
      const moviesHeroPromise = tabHeroes.movies
        ? Promise.resolve(tabHeroes.movies)
        : popularPromise
            .then((popular) => {
              const validHeroes = popular.results.filter((r) => r.backdrop_path);
              const heroData = validHeroes.length > 0 ? validHeroes[Math.floor(Math.random() * Math.min(10, validHeroes.length))] : null;
              return prepareHeroItem(heroData, "movie");
            })
            .catch(() => null);

      const [popular, preparedMoviesHero, topRated, nowPlaying, upcoming, netflixTop10MoviesPakistan, movieCuratedRows, imdbTopMovies] = await Promise.all([
        popularPromise,
        moviesHeroPromise,
        tmdb.topRatedMovies(),
        tmdb.nowPlayingMovies(),
        tmdb.upcomingMovies(),
        tmdb.netflixPakistanTop10Movies().catch((err) => {
          console.warn("Failed to load Netflix Pakistan Top 10 movies:", err);
          return { results: [] };
        }),
        loadCuratedRows("movies"),
        tmdb.imdbTopMovies().catch((err) => {
          console.warn("Failed to load IMDb Top movies:", err);
          return { items: [] };
        }),
      ]);

      if (!tabHeroes.movies) {
        tabHeroes.movies = preparedMoviesHero || null;
      }
      if (tabHeroes.movies) setHero(tabHeroes.movies);
      els.hero.style.display = "";

      els.contentRows.innerHTML = [
        createRowHTML("Popular Movies", popular.results, "movie"),
        createRankedRowHTML(
          netflixTop10MoviesPakistan.fallback ? "Popular on Netflix in Pakistan" : "Top 10 Movies in Pakistan",
          netflixTop10MoviesPakistan.results,
          "movie"
        ),
        renderCuratedRows(movieCuratedRows),
        createRowHTML("Top Rated", topRated.results, "movie"),
        createRowHTML("Now Playing", nowPlaying.results, "movie"),
        createRowHTML("Upcoming", upcoming.results, "movie"),
        createRowHTML("Top 250 IMDb Movies", imdbTopMovies.items || [], "movie"),
      ].join("");

      attachAllRowListeners();
      animateContentIn();
    } catch (err) {
      console.error("Failed to load movies:", err);
      showToast("Failed to load movies", "error");
      animateContentIn();
    }
  }

  async function loadTVPage() {
    try {
      const popularPromise = tmdb.popularTV();
      const tvHeroPromise = tabHeroes.tvshows
        ? Promise.resolve(tabHeroes.tvshows)
        : popularPromise
            .then((popular) => {
              const validHeroes = popular.results.filter((r) => r.backdrop_path);
              const heroData = validHeroes.length > 0 ? validHeroes[Math.floor(Math.random() * Math.min(10, validHeroes.length))] : null;
              return prepareHeroItem(heroData, "tv");
            })
            .catch(() => null);

      const [popular, preparedTVHero, topRated, airing, onAir, netflixTop10TVPakistan, tvCuratedRows, imdbTopTV] = await Promise.all([
        popularPromise,
        tvHeroPromise,
        tmdb.topRatedTV(),
        tmdb.airingTodayTV(),
        tmdb.onTheAirTV(),
        tmdb.netflixPakistanTop10TV().catch((err) => {
          console.warn("Failed to load Netflix Pakistan Top 10 TV:", err);
          return { results: [] };
        }),
        loadCuratedRows("tvshows"),
        tmdb.imdbTopTV().catch((err) => {
          console.warn("Failed to load IMDb Top TV:", err);
          return { items: [] };
        }),
      ]);

      if (!tabHeroes.tvshows) {
        tabHeroes.tvshows = preparedTVHero || null;
      }
      if (tabHeroes.tvshows) setHero(tabHeroes.tvshows);
      els.hero.style.display = "";

      els.contentRows.innerHTML = [
        createRowHTML("Popular TV Shows", popular.results, "tv"),
        createRankedRowHTML(
          netflixTop10TVPakistan.fallback ? "Popular on Netflix in Pakistan" : "Top 10 TV Series in Pakistan",
          netflixTop10TVPakistan.results,
          "tv"
        ),
        renderCuratedRows(tvCuratedRows),
        createRowHTML("Top Rated", topRated.results, "tv"),
        createRowHTML("Airing Today", airing.results, "tv"),
        createRowHTML("On The Air", onAir.results, "tv"),
        createRowHTML("Top 250 IMDb TV Shows", imdbTopTV.items || [], "tv"),
      ].join("");

      attachAllRowListeners();
      animateContentIn();
    } catch (err) {
      console.error("Failed to load TV:", err);
      showToast("Failed to load TV shows", "error");
      animateContentIn();
    }
  }

  async function loadAnimePage() {
    try {
      const popularTVPromise = tmdb.popularAnimeTV();
      const topTVPromise = tmdb.topRatedAnimeTV();
      const animeHeroPromise = tabHeroes.anime
        ? Promise.resolve(tabHeroes.anime)
        : Promise.all([popularTVPromise, topTVPromise])
            .then(([popularTV, topTV]) => {
              const heroPool = [...popularTV.results, ...topTV.results].filter(
                (item) => item.backdrop_path && !isBlockedAnimeHero(item)
              );
              const heroData = heroPool.length > 0 ? heroPool[Math.floor(Math.random() * Math.min(20, heroPool.length))] : null;
              return prepareHeroItem(heroData, "tv");
            })
            .catch(() => null);

      const [popularTV, topTV, preparedAnimeHero, animeCuratedRows, animeRightNow, popularMovies, topMovies, imdbTopTV] = await Promise.all([
        popularTVPromise,
        topTVPromise,
        animeHeroPromise,
        loadCuratedRows("anime"),
        tmdb.animeRightNow(10).catch((err) => {
          console.warn("Failed to load Anime Right Now:", err);
          return { results: [] };
        }),
        tmdb.popularAnimeMovies(),
        tmdb.topRatedAnimeMovies(),
        tmdb.imdbTopTV().catch((err) => {
          console.warn("Failed to load IMDb Top TV:", err);
          return { items: [] };
        }),
      ]);

      if (!tabHeroes.anime) {
        tabHeroes.anime = preparedAnimeHero || null;
      }
      if (tabHeroes.anime) setHero(tabHeroes.anime);
      els.hero.style.display = "";

      els.contentRows.innerHTML = [
        createRowHTML("Anime Right Now", animeRightNow.results || animeRightNow.items || animeRightNow, null),
        createRowHTML("Popular Anime Series", popularTV.results, "tv"),
        createRowHTML("Top Rated Anime Series", topTV.results, "tv"),
        renderCuratedRows(animeCuratedRows),
        createRowHTML("Popular Anime Movies", popularMovies.results, "movie"),
        createRowHTML("Top Rated Anime Movies", topMovies.results, "movie"),
        createRowHTML("Top 250 IMDb TV Shows", imdbTopTV.items || [], "tv"),
      ].join("");

      attachAllRowListeners();
      animateContentIn();
    } catch (err) {
      console.error("Failed to load Anime:", err);
      showToast("Failed to load Anime", "error");
      animateContentIn();
    }
  }

  function loadMyListPage() {
    els.hero.style.display = "none";
    if (myList.length === 0) {
      els.contentRows.innerHTML = `<div class="empty-state">
        <svg width="64" height="64" viewBox="-5 -2 24 24" fill="currentColor">
          <path d='M3 2a1 1 0 0 0-1 1v15l2.978-2.717a3 3 0 0 1 4.044 0L12 18V3a1 1 0 0 0-1-1H3zm0-2h8a3 3 0 0 1 3 3v15a2 2 0 0 1-3.348 1.477L7.674 16.76a1 1 0 0 0-1.348 0l-2.978 2.717A2 2 0 0 1 0 18V3a3 3 0 0 1 3-3z'/>
        </svg>
        <h3>Your list is empty</h3>
        <p>Add movies and shows you want to watch and they'll appear here.</p>
      </div>`;
      animateContentIn();
      return;
    }

    // Grid layout for My List
    const cards = myList.filter((i) => i.poster_path).map((i) => createCardHTML(i)).join("");
    els.contentRows.innerHTML = `
      <div class="mylist-section">
        <h2 class="mylist-heading">My List <span class="mylist-count">${myList.length} titles</span></h2>
        <div class="mylist-grid">${cards}</div>
      </div>`;
    attachCardListeners(els.contentRows);
    animateContentIn();
  }

  // ═══════════════════════════════════════════
  // HERO
  // ═══════════════════════════════════════════
  function setHero(item) {
    const title = item.title || item.name || "Untitled";
    const requestId = ++heroVisualRequestId;
    const apiType = item.media_type || "movie";
    const logoCacheKey = `${apiType}-${item.id}`;
    heroItem = item;
    els.heroBackdrop.style.backgroundImage = `url(${tmdb.backdrop(item.backdrop_path)})`;
    if (typeof item.heroLogoUrl !== "undefined") {
      if (item.heroLogoUrl) showHeroLogo(item.heroLogoUrl, title);
      else showHeroText(title);
    } else if (heroLogoCache.has(logoCacheKey)) {
      const cachedLogo = heroLogoCache.get(logoCacheKey);
      if (cachedLogo) showHeroLogo(cachedLogo, title);
      else showHeroText(title);
    } else {
      prepareHeroTitleLookup(title);
    }
    els.heroOverview.textContent = item.overview || "";

    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    let rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
    const type = item.media_type === "tv" ? "TV Series" : "Movie";

    els.heroMeta.innerHTML = `
      <span class="rating">★ ${rating}</span>
      ${year ? `<span class="meta-divider">•</span><span>${year}</span>` : ""}
      <span class="meta-divider">•</span><span>${type}</span>
    `;

    // Fetch details asynchronously to get IMDb rating for hero banner
    tmdb[apiType === "tv" ? "tvDetails" : "movieDetails"](item.id).then(async (details) => {
      if (requestId !== heroVisualRequestId || heroItem?.id !== item.id) return;
      const imdbId = details.external_ids?.imdb_id;
      if (imdbId) {
        const imdbRating = await tmdb.getImdbRating(imdbId, apiType);
        if (requestId !== heroVisualRequestId || heroItem?.id !== item.id) return;
        if (imdbRating) {
          const ratingEl = els.heroMeta.querySelector(".rating");
          if (ratingEl) ratingEl.textContent = `★ ${imdbRating}`;
        }
      }
    }).catch(() => {});

    if (typeof item.heroLogoUrl === "undefined") {
      getPreparedTitleLogo(item.id, apiType)
        .then((logoUrl) => {
          if (requestId !== heroVisualRequestId || heroItem?.id !== item.id) return;
          if (!logoUrl) {
            showHeroText(title);
            return;
          }
          showHeroLogo(logoUrl, title);
        })
        .catch(() => {
          if (requestId !== heroVisualRequestId || heroItem?.id !== item.id) return;
          showHeroText(title);
        });
    }

    els.heroPlay.onclick = () => playItem(item);
    els.heroInfo.onclick = () => openModal(item);
  }

  // ═══════════════════════════════════════════
  // CARDS & ROWS
  // ═══════════════════════════════════════════
  function storeItem(item, type) {
    const key = `${type}-${item.id}`;
    itemStore.set(key, { ...item, media_type: type });
    return key;
  }

  function createCardHTML(item, forceType) {
    const type = forceType || item.media_type || "movie";
    const title = item.title || item.name || "Untitled";
    const poster = item.poster_path ? tmdb.posterSmall(item.poster_path) : "";
    if (!poster) return "";

    const key = storeItem(item, type);
    const safeTitle = escapeHTML(title);

    return `
      <div class="card skeleton" data-key="${key}" tabindex="0">
        <img class="card-img" src="${poster}" alt="${safeTitle}" loading="lazy" draggable="false" ondragstart="return false;" style="opacity: 0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.parentElement.classList.remove('skeleton');" onerror="this.parentElement.classList.remove('skeleton');" />
      </div>
    `;
  }

  function createContinueCardHTML(entry) {
    continueStore.set(entry.key, entry);
    const poster = entry.poster_path ? tmdb.posterSmall(entry.poster_path) : "";
    if (!poster) return "";

    const percent = Math.max(3, Math.min(100, (entry.progressSeconds / Math.max(entry.durationSeconds || 1, 1)) * 100));
    const title = entry.display_title || entry.title || entry.name || "Untitled";
    const meta =
      entry.media_type === "tv"
        ? `S${entry.season || 1}:E${entry.episode || 1} - ${formatWatchTime(entry.progressSeconds)}`
        : formatWatchTime(entry.progressSeconds);

    return `
      <div class="card continue-card" data-continue-key="${escapeHTML(entry.key)}" tabindex="0" aria-label="Resume ${escapeHTML(title)}">
        <img class="card-img" src="${poster}" alt="${escapeHTML(title)}" loading="lazy" draggable="false" ondragstart="return false;" />
        <div class="continue-progress" aria-hidden="true"><span style="width:${percent.toFixed(2)}%"></span></div>
        <div class="continue-card-meta">${escapeHTML(meta)}</div>
      </div>
    `;
  }

  function createRankedCardHTML(item, forceType) {
    const card = createCardHTML(item, forceType);
    if (!card) return "";
    const rank = item.netflix_rank || item.rank;
    if (!rank) return card;
    return card.replace('class="card', 'class="card ranked-card').replace(
      "</div>",
      `<div class="top10-rank">${rank}</div></div>`
    );
  }

  function createRowHTML(title, items, forceType) {
    const cards = items
      .filter((i) => i.poster_path)
      .map((i) => createCardHTML(i, forceType))
      .join("");
    if (!cards) return "";

    const rowId = "row-" + Math.random().toString(36).slice(2, 8);

    return `
      <div class="content-row" id="${rowId}">
        <div class="row-header">
          <div class="row-title">${title}</div>
        </div>
        <div class="row-slider-container">
          <button class="row-arrow row-arrow-left" data-row="${rowId}" aria-label="Scroll left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div class="row-slider">${cards}</div>
          <button class="row-arrow row-arrow-right" data-row="${rowId}" aria-label="Scroll right">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function createRankedRowHTML(title, items, forceType = "movie", rowId = null) {
    if (!items?.length) return "";
    const cards = items
      .filter((i) => i.poster_path)
      .map((i) => createRankedCardHTML(i, forceType))
      .join("");
    if (!cards) return "";

    const resolvedRowId = rowId || "row-" + Math.random().toString(36).slice(2, 8);

    return `
      <div class="content-row" id="${resolvedRowId}">
        <div class="row-header">
          <div class="row-title">${title}</div>
        </div>
        <div class="row-slider-container">
          <button class="row-arrow row-arrow-left" data-row="${resolvedRowId}" aria-label="Scroll left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div class="row-slider">${cards}</div>
          <button class="row-arrow row-arrow-right" data-row="${resolvedRowId}" aria-label="Scroll right">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function attachCardListeners(container) {
    container.querySelectorAll(".card").forEach((card) => {
      if (card.classList.contains("continue-card")) return;
      card.addEventListener("click", () => {
        const item = itemStore.get(card.dataset.key);
        if (item) openModal(item);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const item = itemStore.get(card.dataset.key);
          if (item) openModal(item);
        }
      });
    });
  }

  function attachContinueListeners(container) {
    container.querySelectorAll(".continue-card").forEach((card) => {
      const resume = () => {
        const entry = continueStore.get(card.dataset.continueKey);
        if (entry) playContinueEntry(entry);
      };
      card.addEventListener("click", resume);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter") resume();
      });
    });
  }

  async function playContinueEntry(entry) {
    const item = await hydratePlayableItem({
      id: entry.id,
      media_type: entry.media_type,
      title: entry.title,
      name: entry.name,
      poster_path: entry.poster_path,
      backdrop_path: entry.backdrop_path,
      overview: entry.overview,
      vote_average: entry.vote_average,
      release_date: entry.release_date,
      first_air_date: entry.first_air_date,
      runtime: entry.runtime,
      episode_run_time: entry.episode_run_time,
      number_of_seasons: entry.number_of_seasons,
    });

    if (entry.media_type === "tv") {
      const title = `${item.name || item.title} - S${entry.season || 1}E${entry.episode || 1}`;
      playTV(item, entry.season || 1, entry.episode || 1, title, null, entry.progressSeconds);
    } else {
      const startTime = entry.progressSeconds || 0;
      openPlayer(tmdb.getMovieEmbed(item.id, startTime), item.title || item.name, item, null, null, null, startTime);
    }
  }

  function attachRowArrowListeners(container) {
    container.querySelectorAll(".row-arrow").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = document.getElementById(btn.dataset.row);
        if (!row) return;
        const slider = row.querySelector(".row-slider");
        const scrollAmt = slider.clientWidth * 0.75;
        if (btn.classList.contains("row-arrow-left")) {
          slider.scrollBy({ left: -scrollAmt, behavior: "smooth" });
        } else {
          slider.scrollBy({ left: scrollAmt, behavior: "smooth" });
        }
      });
    });
  }

  function attachAllRowListeners() {
    attachCardListeners(els.contentRows);
    attachRowArrowListeners(els.contentRows);
  }

  // ═══════════════════════════════════════════
  // MODAL
  // ═══════════════════════════════════════════
  function setupModal() {
    els.modalClose.addEventListener("click", closeModal);
    els.modalOverlay.addEventListener("click", (e) => {
      if (e.target === els.modalOverlay) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (els.playerOverlay.style.display !== "none") closePlayer();
        else closeModal();
      }
    });
  }

  async function openModal(item) {
    const type = item.media_type || "movie";
    const requestId = ++modalVisualRequestId;
    modalItem = item;
    const modalLogoPromise = getPreparedTitleLogo(item.id, type);

    // Show modal immediately in loading state
    const modalEl = document.getElementById("detail-modal");
    modalEl.classList.add("loading");
    els.modalOverlay.classList.add("active");
    document.body.style.overflow = "hidden";

    // Clear previous content
    els.modalBackdrop.style.backgroundImage = "none";
    showModalText("Loading...");
    els.modalOverview.textContent = "Loading details...";
    els.modalMeta.innerHTML = "";
    els.modalDetails.innerHTML = `
      <div class="modal-similar" style="opacity: 0.5; pointer-events: none;">
        <h3 class="skeleton" style="width: 150px; height: 24px; margin-bottom: 14px;"></h3>
        <div class="similar-grid">
          ${Array(6).fill('<div class="card skeleton" style="border-radius: 4px; aspect-ratio: 2/3; background-color: var(--skeleton-base);"></div>').join("")}
        </div>
      </div>
    `;
    els.seasonPicker.style.display = "none";

    try {
      const details =
        type === "tv"
          ? await tmdb.tvDetails(item.id)
          : await tmdb.movieDetails(item.id);

      modalItem = { ...item, ...details, media_type: type };

      // Remove loading state
      modalEl.classList.remove("loading");

      els.modalBackdrop.style.backgroundImage = `url(${tmdb.backdrop(details.backdrop_path)})`;
      const modalTitle = details.title || details.name || "Untitled";
      showModalText(modalTitle);
      modalLogoPromise.then((logoUrl) => {
        if (requestId !== modalVisualRequestId || !logoUrl) return;
        showModalLogo(logoUrl, modalTitle);
      });
      els.modalOverview.textContent = details.overview || "";

      const year = (details.release_date || details.first_air_date || "").slice(0, 4);
      let rating = details.vote_average ? details.vote_average.toFixed(1) : "N/A";
      const imdbId = details.external_ids?.imdb_id;
      if (imdbId) {
        const imdbRating = await tmdb.getImdbRating(imdbId, type);
        if (imdbRating) rating = imdbRating;
      }


      const runtime = details.runtime
        ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m`
        : details.episode_run_time?.[0]
        ? `${details.episode_run_time[0]} min/ep`
        : "";
      const ageRating = getTitleAgeRating(details, type);
      const genres = (details.genres || []).map((g) => g.name).join(", ");

      els.modalMeta.innerHTML = `
        <span class="rating">★ ${rating}</span>
        ${year ? `<span>${year}</span>` : ""}
        ${runtime ? `<span>${runtime}</span>` : ""}
        ${details.number_of_seasons ? `<span>${details.number_of_seasons} Season${details.number_of_seasons > 1 ? "s" : ""}</span>` : ""}
        <span class="tag">${type === "tv" ? "Series" : "Movie"}</span>
        ${ageRating ? `<span class="tag">${ageRating}</span>` : ""}
      `;

      const cast = (details.credits?.cast || []).slice(0, 6).map((c) => c.name).join(", ");
      const director = (details.credits?.crew || []).find((c) => c.job === "Director");

      els.modalDetails.innerHTML = `
        ${director ? `<div class="detail-row"><strong>Director:</strong> <span>${director.name}</span></div>` : ""}
        ${cast ? `<div class="detail-row"><strong>Cast:</strong> <span>${cast}</span></div>` : ""}
        ${genres ? `<div class="detail-row"><strong>Genres:</strong> <span>${genres}</span></div>` : ""}
      `;

      // Similar titles
      if (details.similar?.results?.length > 0) {
        const similarCards = details.similar.results
          .filter((s) => s.poster_path)
          .slice(0, 6)
          .map((s) => createCardHTML(s, type))
          .join("");
        if (similarCards) {
          els.modalDetails.innerHTML += `
            <div class="modal-similar">
              <h3>More Like This</h3>
              <div class="similar-grid">${similarCards}</div>
            </div>`;
          attachCardListeners(els.modalDetails.querySelector(".similar-grid"));
        }
      }

      els.modalPlay.onclick = () => playItem(modalItem);

      // My List button
      updateListButton(item.id);
      els.modalList.onclick = () => toggleMyList(modalItem);

      // Season/Episode picker for TV
      if (type === "tv" && details.number_of_seasons > 0) {
        els.seasonPicker.style.display = "";
        els.seasonSelect.innerHTML = Array.from(
          { length: details.number_of_seasons },
          (_, i) => `<option value="${i + 1}">Season ${i + 1}</option>`
        ).join("");
        els.seasonSelect.onchange = () =>
          loadEpisodes(details.id, parseInt(els.seasonSelect.value));
        loadEpisodes(details.id, 1);
      } else {
        els.seasonPicker.style.display = "none";
      }

    } catch (err) {
      console.error("Failed to load details:", err);
      modalEl.classList.remove("loading");
      showToast("Failed to load details", "error");
    }
  }

  function updateListButton(itemId) {
    const isInList = myList.some((m) => m.id === itemId);
    els.modalList.classList.toggle("added", isInList);
    els.modalList.title = isInList ? "Remove from My List" : "Add to My List";
  }

  async function loadEpisodes(tvId, seasonNum) {
    els.episodeList.innerHTML = Array(5).fill(`
      <div class="episode-item" style="pointer-events: none; opacity: 0.7;">
        <div class="episode-num skeleton" style="color:transparent; border-radius: 4px;">1</div>
        <div class="episode-thumb skeleton"></div>
        <div class="episode-info">
          <div class="episode-title-text skeleton" style="color:transparent; width: 60%; height: 16px; margin-bottom: 8px; border-radius: 4px;">Loading...</div>
          <div class="episode-desc skeleton" style="color:transparent; width: 95%; height: 32px; border-radius: 4px;">Loading description text...</div>
        </div>
      </div>
    `).join("");
    try {
      const season = await tmdb.tvSeason(tvId, seasonNum);
      els.episodeList.innerHTML = (season.episodes || [])
        .map(
          (ep) => `
          <div class="episode-item" data-season="${seasonNum}" data-episode="${ep.episode_number}">
            <div class="episode-num">${ep.episode_number}</div>
            <div class="episode-thumb skeleton">
              <img src="${tmdb.still(ep.still_path)}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.3s ease;" onload="this.style.opacity=1; this.parentElement.classList.remove('skeleton');" onerror="this.parentElement.classList.remove('skeleton');" />
              <div class="episode-play-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M18.54,9,8.88,3.46a3.42,3.42,0,0,0-5.13,3V17.58A3.42,3.42,0,0,0,7.17,21a3.43,3.43,0,0,0,1.71-.46L18.54,15a3.42,3.42,0,0,0,0-5.92Z"/></svg>
              </div>
            </div>
            <div class="episode-info">
              <div class="episode-title-text">${ep.name || `Episode ${ep.episode_number}`}</div>
              <div class="episode-desc">${ep.overview || ""}</div>
            </div>
          </div>
        `
        )
        .join("");

      els.episodeList.querySelectorAll(".episode-item").forEach((el) => {
        el.addEventListener("click", () => {
          const s = parseInt(el.dataset.season);
          const e = parseInt(el.dataset.episode);
          playTV(modalItem, s, e, `${modalItem.name || modalItem.title} — S${s}E${e}`);
        });
      });
    } catch (err) {
      console.error("Failed to load episodes:", err);
      els.episodeList.innerHTML = '<div class="episode-loading">Failed to load episodes.</div>';
    }
  }

  function closeModal() {
    modalVisualRequestId += 1;
    els.modalOverlay.classList.remove("active");
    document.body.style.overflow = "";
    modalItem = null;
  }

  // ═══════════════════════════════════════════
  // MY LIST
  // ═══════════════════════════════════════════
  function toggleMyList(item) {
    const idx = myList.findIndex((m) => m.id === item.id);
    if (idx >= 0) {
      myList.splice(idx, 1);
      showToast(`Removed "${item.title || item.name}" from your list`, "info");
    } else {
      myList.push({
        id: item.id,
        title: item.title,
        name: item.name,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        vote_average: item.vote_average,
        release_date: item.release_date,
        first_air_date: item.first_air_date,
        overview: item.overview,
        media_type: item.media_type,
      });
      showToast(`Added "${item.title || item.name}" to your list`, "success");
    }
    localStorage.setItem("cinemax_mylist", JSON.stringify(myList));
    updateListButton(item.id);
    if (currentPage === "mylist") loadMyListPage();
  }

  // ═══════════════════════════════════════════
  // PLAYER
  // ═══════════════════════════════════════════
  function clearPlayerChromeTimer() {
    if (playerChromeTimer) {
      clearTimeout(playerChromeTimer);
      playerChromeTimer = null;
    }
  }

  function showPlayerChrome(scheduleHide = true) {
    els.playerOverlay.classList.remove("chrome-hidden");
    clearPlayerChromeTimer();
    if (!scheduleHide || els.playerEpisodesPanel.classList.contains("open")) return;
    playerChromeTimer = setTimeout(() => {
      if (els.playerOverlay.style.display === "flex" && !els.playerEpisodesPanel.classList.contains("open")) {
        els.playerOverlay.classList.add("chrome-hidden");
      }
    }, 2400);
  }

  function clearPlayerLoadTimer() {
    if (playerLoadTimer) {
      clearTimeout(playerLoadTimer);
      playerLoadTimer = null;
    }
  }

  function showPlayerStatus(title, copy, options = {}) {
    els.playerStatusTitle.textContent = title;
    els.playerStatusCopy.textContent = copy;
    els.playerStatusSpinner.style.display = options.spinner === false ? "none" : "";
    els.playerReloadBtn.style.display = options.showReload === false ? "none" : "";
    els.playerStatusBackBtn.style.display = options.showBack === false ? "none" : "";
    els.playerStatusOverlay.classList.add("visible");
  }

  function hidePlayerStatus() {
    clearPlayerLoadTimer();
    els.playerStatusOverlay.classList.remove("visible");
    els.playerStatusSpinner.style.display = "";
    els.playerReloadBtn.style.display = "";
    els.playerStatusBackBtn.style.display = "";
  }

  function scheduleSlowPlayerMessage() {
    clearPlayerLoadTimer();
    playerLoadTimer = setTimeout(() => {
      if (els.playerOverlay.style.display === "flex" && els.playerStatusOverlay.classList.contains("visible")) {
        showPlayerStatus("Still loading...", "This source is taking longer than usual. You can wait a bit or reload.");
      }
    }, 9000);
  }

  function updatePlayerNavButtons() {
    const isSeries = playerState.item?.media_type === "tv" && playerState.episodes.length > 0;
    if (!isSeries) {
      els.playerNavGroup.style.display = "none";
      els.playerPrevEpisode.disabled = true;
      els.playerNextEpisode.disabled = true;
      return;
    }

    els.playerNavGroup.style.display = "flex";
    const currentIndex = playerState.episodes.findIndex((ep) => ep.episode_number === playerState.episode);
    els.playerPrevEpisode.disabled = currentIndex <= 0;
    els.playerNextEpisode.disabled = currentIndex === -1 || currentIndex >= playerState.episodes.length - 1;
  }

  function syncActivePlayerEpisode() {
    els.playerEpisodeList.querySelectorAll(".episode-item").forEach((el) => {
      const season = parseInt(el.dataset.season, 10);
      const episode = parseInt(el.dataset.episode, 10);
      el.classList.toggle("active", season === playerState.season && episode === playerState.episode);
    });
  }

  function playPlayerEpisode(tvItem, season, episode, title, episodeMeta = null) {
    stopWatchSession(true);
    const resume = getContinueEntry(tvItem, season, episode)?.progressSeconds || 0;
    playerState.item = tvItem;
    playerState.season = season;
    playerState.episode = episode;
    playerState.title = title;
    els.playerTitle.textContent = title;
    showPlayerChrome();
    showPlayerStatus("Loading video...", "Preparing the player.");
    scheduleSlowPlayerMessage();
    els.playerWebview.setAttribute("src", tmdb.getTVEmbed(tvItem.id, season, episode, resume));
    startWatchSession(tvItem, {
      season,
      episode,
      episodeMeta,
      title,
      startTime: resume,
    });
    syncActivePlayerEpisode();
    updatePlayerNavButtons();
    if (window.innerWidth < 850) {
      els.playerEpisodesPanel.classList.remove("open");
    }
  }

  function stepPlayerEpisode(direction) {
    const currentIndex = playerState.episodes.findIndex((ep) => ep.episode_number === playerState.episode);
    if (currentIndex === -1) return;
    const nextEpisode = playerState.episodes[currentIndex + direction];
    if (!nextEpisode || !playerState.item) return;
    const season = playerState.season || 1;
    const title = `${playerState.item.name || playerState.item.title} — S${season}E${nextEpisode.episode_number}`;
    playPlayerEpisode(playerState.item, season, nextEpisode.episode_number, title, nextEpisode);
  }

  function setupPlayer() {
    els.playerBack.addEventListener("click", closePlayer);
    els.playerEpisodesToggleBtn?.addEventListener("click", () => {
      els.playerEpisodesPanel.classList.toggle("open");
    });

    els.playerEpisodesClose?.addEventListener("click", () => {
      els.playerEpisodesPanel.classList.remove("open");
    });
  }

  function playTV(item, season, episode, title, episodeMeta = null, startTime = null) {
    const resume = startTime !== null ? startTime : getEpisodeResumeSeconds(item, season, episode);
    const url = tmdb.getTVEmbed(item.id, season, episode, resume);
    openPlayer(url, title, item, season, episode, episodeMeta, resume);
  }

  function openPlayer(url, title, item, currentSeason = null, currentEpisode = null, episodeMeta = null, startTime = 0) {
    closeModal();
    els.playerTitle.textContent = title || "";
    els.playerWebview.setAttribute("src", url);
    els.playerOverlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    startWatchSession(item, {
      season: currentSeason,
      episode: currentEpisode,
      episodeMeta,
      title,
      startTime,
    });

    if (item && item.media_type === "tv" && item.number_of_seasons > 0) {
      els.playerEpisodesToggleContainer.style.display = "block";

      els.playerSeasonSelect.innerHTML = Array.from(
        { length: item.number_of_seasons },
        (_, i) => `<option value="${i + 1}" ${i + 1 === currentSeason ? 'selected' : ''}>Season ${i + 1}</option>`
      ).join("");

      loadPlayerEpisodes(item.id, currentSeason || 1, item);
      els.playerSeasonSelect.onchange = () => {
        loadPlayerEpisodes(item.id, parseInt(els.playerSeasonSelect.value), item);
      };
    } else {
      els.playerEpisodesToggleContainer.style.display = "none";
      els.playerEpisodesPanel.classList.remove("open");
    }
  }

  async function loadPlayerEpisodes(tvId, seasonNum, tvItem) {
    els.playerEpisodeList.innerHTML = '<div class="episode-loading">Loading episodes...</div>';
    try {
      const season = await tmdb.tvSeason(tvId, seasonNum);
      playerState.item = tvItem;
      playerState.season = seasonNum;
      playerState.episodes = season.episodes || [];
      els.playerEpisodeList.innerHTML = (season.episodes || [])
        .map(
          (ep) => `
          <div class="episode-item" data-season="${seasonNum}" data-episode="${ep.episode_number}">
            <div class="episode-num">${ep.episode_number}</div>
            <div class="episode-thumb" style="background-image:url(${tmdb.still(ep.still_path)});">
              <div class="episode-play-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M18.54,9,8.88,3.46a3.42,3.42,0,0,0-5.13,3V17.58A3.42,3.42,0,0,0,7.17,21a3.43,3.43,0,0,0,1.71-.46L18.54,15a3.42,3.42,0,0,0,0-5.92Z"/></svg>
              </div>
            </div>
            <div class="episode-info">
              <div class="episode-title-text">${ep.name || `Episode ${ep.episode_number}`}</div>
              <div class="episode-desc">${ep.overview || ""}</div>
            </div>
          </div>
        `
        )
        .join("");

      // Add click listeners to play the selected episode
      els.playerEpisodeList.querySelectorAll(".episode-item").forEach((el) => {
        el.addEventListener("click", () => {
          const s = parseInt(el.dataset.season);
          const e = parseInt(el.dataset.episode);
          const title = `${tvItem.name || tvItem.title} — S${s}E${e}`;
          
          // Update player title and webview URL
          const episodeMeta = (season.episodes || []).find((ep) => ep.episode_number === e);
          playPlayerEpisode(tvItem, s, e, title, episodeMeta);
        });
      });
      syncActivePlayerEpisode();
      updatePlayerNavButtons();
    } catch (err) {
      console.error("Failed to load episodes in player:", err);
      els.playerEpisodeList.innerHTML = '<div class="episode-loading">Failed to load episodes.</div>';
      playerState.episodes = [];
      updatePlayerNavButtons();
    }
  }

  async function playItem(item) {
    item = await hydratePlayableItem(item);
    const type = item.media_type || "movie";

    if (type === "tv") {
      const resume = getContinueEntry(item);
      const season = resume?.season || 1;
      const episode = resume?.episode || 1;
      playTV(item, season, episode, `${item.name || item.title} - S${season}E${episode}`, null, resume?.progressSeconds || 0);
      return;
    }

    const resume = getContinueEntry(item);
    const startTime = resume?.progressSeconds || 0;
    const url = tmdb.getMovieEmbed(item.id, startTime);
    openPlayer(url, item.title || item.name, item, null, null, null, startTime);
  }

  function closePlayer() {
    stopWatchSession(true);
    clearPlayerChromeTimer();
    hidePlayerStatus();
    els.playerOverlay.style.display = "none";
    els.playerOverlay.classList.remove("chrome-hidden");
    els.playerWebview.src = "about:blank";
    els.playerEpisodesPanel.classList.remove("open");
    els.playerEpisodesToggleContainer.style.display = "none";
    els.playerNavGroup.style.display = "none";
    playerState = { item: null, season: null, episode: null, episodes: [], title: "" };
    document.body.style.overflow = "";
    if (currentPage === "home") loadHomePage();
  }

  // ═══════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════
  window.addEventListener("beforeunload", () => stopWatchSession(true));
  document.addEventListener("DOMContentLoaded", init);
})();
