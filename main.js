const { app, BrowserWindow, session, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const DiscordRPC = require("discord-rpc");
const { pid: getDiscordPid } = require("discord-rpc/src/util");

// ──────────────────────────────────────────────
// Ad-blocker: known ad/tracker domain patterns
// ──────────────────────────────────────────────
const AD_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "adservice.google.",
  "adsrvr.org",
  "adnxs.com",
  "ads-twitter.com",
  "amazon-adsystem.com",
  "moatads.com",
  "popads.net",
  "popcash.net",
  "juicyads.com",
  "exoclick.com",
  "exosrv.com",
  "trafficjunky.com",
  "trafficfactory.biz",
  "propellerads.com",
  "hilltopads.net",
  "clickadu.com",
  "a-ads.com",
  "ad-maven.com",
  "adsterra.com",
  "bidvertiser.com",
  "revcontent.com",
  "mgid.com",
  "taboola.com",
  "outbrain.com",
  "pushnami.com",
  "pushwoosh.com",
  "onesignal.com",
  "cookielaw.org",
  "betrad.com",
  "serving-sys.com",
  "2mdn.net",
  "rubiconproject.com",
  "openx.net",
  "pubmatic.com",
  "casalemedia.com",
  "lijit.com",
  "criteo.com",
  "criteo.net",
  "sharethrough.com",
  "33across.com",
  "yieldmanager.com",
  "aralego.com",
];

// Additional keyword-based blocking for URLs
const AD_KEYWORDS = [
  "/ads/",
  "/ad/",
  "/adserver",
  "popunder",
  "pop-under",
  "/banner",
  "/tracking",
  "clicktrack",
  "/pixel",
  "prebid",
  "syndication",
];

function isAdUrl(url) {
  const lowerUrl = url.toLowerCase();
  // Check domain patterns
  if (AD_DOMAINS.some((domain) => lowerUrl.includes(domain))) return true;
  // Check keyword patterns
  if (AD_KEYWORDS.some((keyword) => lowerUrl.includes(keyword))) return true;
  return false;
}

const PLAYER_ALLOWED_HOSTS = [
  "vidsrc-embed.ru",
];

function isAllowedPlayerUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (["about:", "data:", "blob:"].includes(url.protocol)) return true;
    return PLAYER_ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

const PLAYER_WATERMARK_CSS = `
  a[href*="vidsrc"],
  a[href*="vidsrc-embed"],
  a[href*="vidsrc.to"],
  [class*="watermark"],
  [id*="watermark"],
  [aria-label*="vidsrc" i],
  [title*="vidsrc" i] {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    display: none !important;
  }
`;

const PLAYER_WATERMARK_SCRIPT = `
  (() => {
    const selectors = [
      'a[href*="vidsrc"]',
      'a[href*="vidsrc-embed"]',
      'a[href*="vidsrc.to"]',
      '[class*="watermark"]',
      '[id*="watermark"]',
      '[aria-label*="vidsrc" i]',
      '[title*="vidsrc" i]'
    ];

    const hide = () => {
      document.querySelectorAll(selectors.join(',')).forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        if (el.tagName === 'A') {
          el.removeAttribute('href');
          el.setAttribute('tabindex', '-1');
        }
      });
    };

    hide();
    const root = document.documentElement || document.body;
    if (root) {
      new MutationObserver(hide).observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }
  })();
`;

const PLAYER_STATE_PREFIX = "__VELVET_PLAYER_STATE__";
const PLAYER_STATE_SCRIPT = `
  (() => {
    if (window.__velvetPlaybackMonitorInstalled) return;
    window.__velvetPlaybackMonitorInstalled = true;
    const prefix = ${JSON.stringify("__VELVET_PLAYER_STATE__")};
    let currentVideo = null;
    let lastPayload = "";
    let lastEmitAt = 0;
    let lastTimeupdateAt = 0;

    const emit = (eventName, video) => {
      if (!video) return;
      const now = Date.now();
      if (eventName === "timeupdate" && now - lastTimeupdateAt < 4000) return;
      if (eventName === "timeupdate") lastTimeupdateAt = now;

      const payload = {
        event: eventName,
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: Boolean(video.paused),
        ended: Boolean(video.ended),
        readyState: video.readyState || 0,
      };
      const serialized = JSON.stringify(payload);
      if (serialized === lastPayload && now - lastEmitAt < 1000) return;
      lastPayload = serialized;
      lastEmitAt = now;
      console.log(prefix + serialized);
    };

    const attach = (video) => {
      if (!video || video === currentVideo) return;
      currentVideo = video;
      ["playing", "play", "pause", "waiting", "seeked", "seeking", "ended", "loadedmetadata", "canplay", "timeupdate"].forEach((eventName) => {
        video.addEventListener(eventName, () => emit(eventName, video), { passive: true });
      });
      emit(video.paused ? "pause" : "playing", video);
    };

    const scan = () => attach(document.querySelector("video"));
    scan();
    setInterval(scan, 1000);
  })();
`;

let mainWindow;
const playerWebContentsIds = new Set();
// Active stream resolvers keyed by their hidden window's webContents id.
// Populated during download-resolve-stream so the session-level webRequest hook
// (which, unlike CDP, sees out-of-process iframe requests) can surface the media URL.
const streamResolverWaiters = new Map();
let discordClient = null;
let discordClientId = "";
let discordEnabled = false;
let discordReady = false;
let discordLoginPromise = null;
let discordActivity = null;
let discordStatusMessage = "Off";
let discordSessionId = 0;
let discordLastActivitySetAt = 0;
let discordActivityApplyTimer = null;
let discordRawActivitySupported = true;
const DISCORD_ACTIVITY_MIN_INTERVAL_MS = 15000;

function cleanDiscordText(value, fallback = "", maxLength = 128) {
  const cleanedValue = String(value ?? "").replace(/\s+/g, " ").trim();
  const cleanedFallback = String(fallback ?? "").replace(/\s+/g, " ").trim();
  const text = cleanedValue || cleanedFallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function cleanDiscordImageValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    return text.length <= 313 ? text : "";
  }
  return cleanDiscordText(text, "", 32);
}

function normalizeDiscordClientId(value) {
  return String(value || "").trim();
}

function isValidDiscordClientId(value) {
  return /^\d{17,22}$/.test(value);
}

function getDiscordPresenceStatus() {
  return {
    enabled: discordEnabled,
    connected: discordReady,
    configured: isValidDiscordClientId(discordClientId),
    message: discordStatusMessage,
  };
}

function emitDiscordPresenceStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("discord-presence-status", getDiscordPresenceStatus());
}

function clearDiscordActivityApplyTimer() {
  clearTimeout(discordActivityApplyTimer);
  discordActivityApplyTimer = null;
}

function withDiscordTimeout(promise, timeoutMs = 1200) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([
    Promise.resolve(promise),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

async function destroyDiscordClient() {
  discordSessionId += 1;
  discordLoginPromise = null;
  clearDiscordActivityApplyTimer();
  discordLastActivitySetAt = 0;
  discordRawActivitySupported = true;
  const wasReady = discordReady;
  discordReady = false;
  const client = discordClient;
  discordClient = null;
  if (!client) return;
  try {
    if (wasReady) {
      await withDiscordTimeout(client.clearActivity());
    }
  } catch {}
  try {
    await withDiscordTimeout(client.destroy());
  } catch {}
}

function buildDiscordActivity(payload = {}) {
  const title = cleanDiscordText(payload.title || payload.details, "Watching on Velvet");
  const state = cleanDiscordText(payload.state, "Watching");
  const activity = {
    details: title,
    state,
    instance: false,
    force: Boolean(payload.force),
  };
  if (Number.isFinite(payload.startTimestamp)) {
    activity.startTimestamp = payload.startTimestamp;
  }
  if (Number.isFinite(payload.endTimestamp)) {
    activity.endTimestamp = payload.endTimestamp;
  }

  const largeImageKey = cleanDiscordImageValue(payload.largeImageKey);
  if (largeImageKey) {
    activity.largeImageKey = largeImageKey;
    activity.largeImageText = cleanDiscordText(payload.largeImageText || "Velvet", "Velvet");
  }

  return activity;
}

function toDiscordRpcActivity(activity = {}) {
  const rpcActivity = {
    type: 3,
    details: activity.details,
    state: activity.state,
    instance: Boolean(activity.instance),
  };

  if (activity.startTimestamp || activity.endTimestamp) {
    rpcActivity.timestamps = {
      start: activity.startTimestamp,
      end: activity.endTimestamp,
    };
  }

  if (activity.largeImageKey || activity.largeImageText || activity.smallImageKey || activity.smallImageText) {
    rpcActivity.assets = {
      large_image: activity.largeImageKey,
      large_text: activity.largeImageText,
      small_image: activity.smallImageKey,
      small_text: activity.smallImageText,
    };
  }

  if (activity.buttons?.length) {
    rpcActivity.buttons = activity.buttons;
  }

  return rpcActivity;
}

async function setDiscordActivity(activity) {
  const { force: _force, ...clientActivity } = activity || {};
  if (discordRawActivitySupported && typeof discordClient?.request === "function") {
    try {
      await discordClient.request("SET_ACTIVITY", {
        pid: getDiscordPid(),
        activity: toDiscordRpcActivity(clientActivity),
      });
      return;
    } catch (err) {
      discordRawActivitySupported = false;
      if (err?.code && err.code !== 4002 && err.code !== 4000) {
        throw err;
      }
    }
  }

  await discordClient.setActivity(clientActivity);
}

async function markDiscordDisconnected(sessionId, client, message = "Disconnected") {
  if (sessionId !== discordSessionId || client !== discordClient) return;
  discordStatusMessage = message;
  await destroyDiscordClient();
  emitDiscordPresenceStatus();
}

async function applyDiscordActivity() {
  if (!discordClient || !discordReady || !discordActivity) return;
  const elapsed = Date.now() - discordLastActivitySetAt;
  if (!discordActivity.force && discordLastActivitySetAt && elapsed < DISCORD_ACTIVITY_MIN_INTERVAL_MS) {
    clearDiscordActivityApplyTimer();
    discordActivityApplyTimer = setTimeout(() => {
      discordActivityApplyTimer = null;
      applyDiscordActivity().catch((err) => {
        discordStatusMessage = err.message || "Presence failed";
        emitDiscordPresenceStatus();
      });
    }, DISCORD_ACTIVITY_MIN_INTERVAL_MS - elapsed);
    return;
  }

  clearDiscordActivityApplyTimer();
  await setDiscordActivity(discordActivity);
  discordLastActivitySetAt = Date.now();
}

async function ensureDiscordConnected() {
  if (!discordEnabled) {
    discordStatusMessage = "Off";
    emitDiscordPresenceStatus();
    return { success: false, ...getDiscordPresenceStatus() };
  }

  if (!isValidDiscordClientId(discordClientId)) {
    discordStatusMessage = "Client ID needed";
    emitDiscordPresenceStatus();
    return { success: false, ...getDiscordPresenceStatus() };
  }

  if (discordClient && discordReady) {
    return { success: true, ...getDiscordPresenceStatus() };
  }

  if (discordLoginPromise) return discordLoginPromise;

  if (discordClient) {
    await destroyDiscordClient();
  }

  const sessionId = ++discordSessionId;
  const client = new DiscordRPC.Client({ transport: "ipc" });
  discordClient = client;
  DiscordRPC.register(discordClientId);

  client.on("ready", async () => {
    if (sessionId !== discordSessionId || client !== discordClient) return;
    discordReady = true;
    discordStatusMessage = "Connected";
    emitDiscordPresenceStatus();
  });

  client.on("disconnected", () => {
    markDiscordDisconnected(sessionId, client).catch(() => {});
  });

  client.on("error", (err) => {
    markDiscordDisconnected(sessionId, client, err.message || "Discord unavailable").catch(() => {});
  });

  discordLoginPromise = client
    .login({ clientId: discordClientId })
    .then(async () => {
      if (sessionId !== discordSessionId || client !== discordClient) {
        return { success: false, ...getDiscordPresenceStatus() };
      }
      discordReady = true;
      discordStatusMessage = "Connected";
      emitDiscordPresenceStatus();
      return { success: true, ...getDiscordPresenceStatus() };
    })
    .catch(async (err) => {
      if (sessionId !== discordSessionId || client !== discordClient) {
        return { success: false, ...getDiscordPresenceStatus() };
      }
      discordStatusMessage = err.message || "Discord unavailable";
      await destroyDiscordClient();
      emitDiscordPresenceStatus();
      return { success: false, ...getDiscordPresenceStatus() };
    })
    .finally(() => {
      if (sessionId === discordSessionId) {
        discordLoginPromise = null;
      }
    });

  return discordLoginPromise;
}

function capturePlayerMediaRequest(details) {
  const url = details?.url || "";
  const lowerUrl = url.toLowerCase();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!playerWebContentsIds.has(details.webContentsId)) return;

  if (lowerUrl.includes(".m3u8")) {
    mainWindow.webContents.send("m3u8-found", url);
    return;
  }

  if (lowerUrl.includes(".vtt") || lowerUrl.includes(".srt")) {
    mainWindow.webContents.send("subtitle-found", {
      url,
      lang: "unknown",
    });
    return;
  }

  if (lowerUrl.includes(".mp4")) {
    mainWindow.webContents.send("mp4-found", url);
  }
}

// Session-level detection for the hidden stream-resolver window. Catches the
// .m3u8/.mp4 request even when it originates inside a cross-origin (out-of-process)
// iframe, which the resolver's top-frame CDP debugger cannot observe.
// Resolve which active resolver (by its registered webContents id) a session
// request belongs to. Exact match on webContentsId, with a fallback for
// out-of-process iframes attributed to their own id when a single resolve is active.
function matchResolverWcId(details) {
  if (streamResolverWaiters.size === 0) return null;
  if (streamResolverWaiters.has(details?.webContentsId)) return details.webContentsId;
  if (
    streamResolverWaiters.size === 1 &&
    details?.webContentsId !== mainWindow?.webContents?.id &&
    !playerWebContentsIds.has(details?.webContentsId)
  ) {
    return streamResolverWaiters.keys().next().value;
  }
  return null;
}

// Runs in onBeforeSendHeaders so the finalized request headers (Referer/Origin/
// User-Agent) are available alongside the URL. Detection must live here, not in
// onBeforeRequest, so the media URL and the headers the CDN requires are captured
// together — the segment CDN 403s requests that lack the player's Referer.
function captureResolverMediaRequest(details) {
  if (streamResolverWaiters.size === 0) return;

  const lowerUrl = (details?.url || "").toLowerCase();
  const isHls = lowerUrl.includes(".m3u8");
  const isMp4 =
    lowerUrl.includes(".mp4") &&
    !lowerUrl.includes("thumb") &&
    !lowerUrl.includes("poster") &&
    !lowerUrl.includes("preview");
  if (!isHls && !isMp4) return;

  const wcId = matchResolverWcId(details);
  if (wcId == null) return;
  const waiter = streamResolverWaiters.get(wcId);
  if (!waiter) return;

  const reqHeaders = details.requestHeaders || {};
  const pick = (name) => {
    const key = Object.keys(reqHeaders).find((h) => h.toLowerCase() === name);
    return key ? reqHeaders[key] : "";
  };
  const headers = { referer: pick("referer"), origin: pick("origin"), userAgent: pick("user-agent") };

  waiter(details.url, isHls ? "hls" : "mp4", headers);
}

function attachFullscreenShortcut(webContents, options = {}) {
  webContents.on("before-input-event", (event, input) => {
    if (!mainWindow) return;
    if (input.type !== "keyDown") return;

    if (input.key === "F11") {
      event.preventDefault();
      setMainWindowFullscreen(!mainWindow.isFullScreen());
      return;
    }

    if (input.key === "Escape" && mainWindow.isFullScreen()) {
      event.preventDefault();
      setMainWindowFullscreen(false);
    }

    if (
      options.syncVideoFullscreenKeys &&
      input.key?.toLowerCase() === "f" &&
      !input.control &&
      !input.meta &&
      !input.alt
    ) {
      setTimeout(() => setMainWindowFullscreen(true), 80);
    }
  });
}

function attachHtmlFullscreenBridge(webContents) {
  webContents.on("enter-html-full-screen", () => {
    setMainWindowFullscreen(true);
  });

  webContents.on("leave-html-full-screen", () => {
    setMainWindowFullscreen(false);
  });
}

function emitFullscreenState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("window-fullscreen-changed", mainWindow.isFullScreen());
}

function setMainWindowFullscreen(isFullscreen) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreen(Boolean(isFullscreen));
  setTimeout(emitFullscreenState, 0);
  setTimeout(emitFullscreenState, 120);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: "#0a0a0f",
    icon: path.join(__dirname, "src", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  attachFullscreenShortcut(mainWindow.webContents);
  attachHtmlFullscreenBridge(mainWindow.webContents);

  mainWindow.on("enter-full-screen", emitFullscreenState);
  mainWindow.on("leave-full-screen", emitFullscreenState);

  // Spawn background Top 10 cache refresh (detached, non-blocking)
  const top10Script = path.join(__dirname, "fetch-top10.js");
  if (fs.existsSync(top10Script)) {
    const child = spawn(process.execPath, [top10Script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  // ──────────────────────────────────────────────
  // Ad-blocker: single unified request interceptor
  // ──────────────────────────────────────────────
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = isAdUrl(details.url);
    if (!blocked) {
      try {
        capturePlayerMediaRequest(details);
      } catch {}
    }
    callback({ cancel: blocked });
  });

  // Detect the resolver's media request here (not in onBeforeRequest) so the
  // finalized Referer/Origin/User-Agent headers are captured with the URL.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      captureResolverMediaRequest(details);
    } catch {}
    callback({ requestHeaders: details.requestHeaders });
  });

  // Block new window popups (ad popups)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: "deny" };
  });

  // Lock down guest webviews used by the player.
  mainWindow.webContents.on("did-attach-webview", (_event, guestContents) => {
    playerWebContentsIds.add(guestContents.id);
    guestContents.once("destroyed", () => {
      playerWebContentsIds.delete(guestContents.id);
    });

    attachFullscreenShortcut(guestContents, { syncVideoFullscreenKeys: true });
    attachHtmlFullscreenBridge(guestContents);
    guestContents.setWindowOpenHandler(() => ({ action: "deny" }));
    guestContents.on("console-message", (_event, _level, message) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (typeof message !== "string" || !message.startsWith(PLAYER_STATE_PREFIX)) return;
      try {
        mainWindow.webContents.send("player-playback-state", JSON.parse(message.slice(PLAYER_STATE_PREFIX.length)));
      } catch {}
    });

    guestContents.on("will-navigate", (details) => {
      if (!isAllowedPlayerUrl(details.url)) {
        details.preventDefault();
      }
    });

    guestContents.on("dom-ready", () => {
      guestContents.insertCSS(PLAYER_WATERMARK_CSS).catch(() => {});
      guestContents.executeJavaScript(PLAYER_WATERMARK_SCRIPT).catch(() => {});
      guestContents.executeJavaScript(PLAYER_STATE_SCRIPT).catch(() => {});
    });
  });
}

// ──────────────────────────────────────────────
// IPC Handlers for window controls
// ──────────────────────────────────────────────
ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on("window-toggle-fullscreen", () => {
  if (!mainWindow) return;
  setMainWindowFullscreen(!mainWindow.isFullScreen());
});
ipcMain.on("window-close", async () => {
  await destroyDiscordClient();
  mainWindow?.close();
});
ipcMain.handle("window-is-fullscreen", () => Boolean(mainWindow?.isFullScreen()));

ipcMain.handle("discord-presence-configure", async (_event, options = {}) => {
  const nextEnabled = Boolean(options.enabled);
  const nextClientId = normalizeDiscordClientId(options.clientId);
  const clientChanged = nextClientId !== discordClientId;

  discordEnabled = nextEnabled;
  discordClientId = nextClientId;

  if (!discordEnabled) {
    discordStatusMessage = "Off";
    await destroyDiscordClient();
    emitDiscordPresenceStatus();
    return { success: true, ...getDiscordPresenceStatus() };
  }

  if (!isValidDiscordClientId(discordClientId)) {
    discordStatusMessage = "Client ID needed";
    await destroyDiscordClient();
    emitDiscordPresenceStatus();
    return { success: false, ...getDiscordPresenceStatus() };
  }

  if (clientChanged) {
    await destroyDiscordClient();
  }

  return ensureDiscordConnected();
});

ipcMain.handle("discord-presence-set-activity", async (_event, payload = {}) => {
  discordActivity = buildDiscordActivity(payload);
  const connection = await ensureDiscordConnected();
  if (!connection.success) return connection;

  try {
    await applyDiscordActivity();
    discordStatusMessage = "Connected";
    emitDiscordPresenceStatus();
    return { success: true, ...getDiscordPresenceStatus() };
  } catch (err) {
    discordStatusMessage = err.message || "Presence failed";
    emitDiscordPresenceStatus();
    return { success: false, ...getDiscordPresenceStatus() };
  }
});

ipcMain.handle("discord-presence-clear", async () => {
  discordActivity = null;
  clearDiscordActivityApplyTimer();
  discordLastActivitySetAt = 0;
  if (discordClient && discordReady) {
    try {
      await withDiscordTimeout(discordClient.clearActivity());
    } catch {}
  }
  return { success: true, ...getDiscordPresenceStatus() };
});

ipcMain.handle("discord-presence-status", () => getDiscordPresenceStatus());

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

// ──────────────────────────────────────────────
// MangaDex JSON bridge
// ──────────────────────────────────────────────
ipcMain.handle("mangadex-json", async (_event, url) => {
  if (typeof url !== "string" || !url.startsWith("https://api.mangadex.org/")) {
    throw new Error("Invalid MangaDex URL");
  }
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Velvet/1.0 (Electron desktop app)",
      "Accept": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`MangaDex Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
});

// ══════════════════════════════════════════════════════════════════════════
// OFFLINE DOWNLOADS
// ══════════════════════════════════════════════════════════════════════════
const https = require("https");
const http = require("http");
const { URL: NodeURL, pathToFileURL } = require("url");

// Paths
const BUNDLED_FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const BUNDLED_YTDLP_PATH = path.join(__dirname, "bin", "yt-dlp.exe");

function getVelvetVideosDir() {
  return path.join(app.getPath("videos"), "Velvet");
}

function getDownloadsManifestPath() {
  return path.join(getVelvetVideosDir(), "downloads.json");
}

function getDownloadsLogDir() {
  return path.join(getVelvetVideosDir(), "logs");
}

function getDownloadsLogPath() {
  return path.join(getDownloadsLogDir(), "downloads.log");
}

function getPreviousDownloadsLogPath() {
  return path.join(getDownloadsLogDir(), "downloads.previous.log");
}

const DOWNLOAD_LOG_MAX_BYTES = 256 * 1024;
const DOWNLOAD_LOG_VALUE_MAX_CHARS = 2000;

function findFirstOnPath(commandName) {
  try {
    const result = spawnSync("where.exe", [commandName], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    const first = String(result.stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

function getResolvedFfmpegPath() {
  if (fs.existsSync(BUNDLED_FFMPEG_PATH)) return BUNDLED_FFMPEG_PATH;
  return findFirstOnPath("ffmpeg");
}

function getResolvedYtDlpPath() {
  if (fs.existsSync(BUNDLED_YTDLP_PATH)) return BUNDLED_YTDLP_PATH;
  return findFirstOnPath("yt-dlp");
}

function getExternalDownloaderExecutable(folderPath) {
  if (!folderPath) return { exists: false, reason: "no_folder" };
  let entries;
  try {
    entries = fs.readdirSync(folderPath);
  } catch (err) {
    return {
      exists: false,
      reason: err?.code === "EACCES" ? "folder_permission" : "folder_unreadable",
    };
  }

  if (!entries.includes("_internal")) {
    return { exists: false, reason: "no_internal" };
  }

  const binary = entries.find((entry) => {
    if (entry === "_internal" || entry.startsWith(".")) return false;
    try {
      const stat = fs.statSync(path.join(folderPath, entry));
      if (!stat.isFile()) return false;
      return process.platform === "win32" ? entry.toLowerCase().endsWith(".exe") : Boolean(stat.mode & 0o111);
    } catch {
      return false;
    }
  });

  if (!binary) return { exists: false, reason: "no_executable" };
  return { exists: true, folderPath, binaryPath: path.join(folderPath, binary) };
}

function getBundledExternalDownloader() {
  return getExternalDownloaderExecutable(path.join(__dirname, "bin", "vid-dl"));
}

function findLatestVideoFile(folderPath, preferredStem = "") {
  try {
    const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"];
    const normalizedStem = preferredStem.trim().toLowerCase();
    const candidates = fs
      .readdirSync(folderPath)
      .filter((fileName) => VIDEO_EXTS.includes(path.extname(fileName).toLowerCase()))
      .filter((fileName) => !normalizedStem || fileName.toLowerCase().startsWith(normalizedStem))
      .map((fileName) => {
        const absolutePath = path.join(folderPath, fileName);
        return {
          absolutePath,
          fileName,
          mtimeMs: fs.statSync(absolutePath).mtimeMs,
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.absolutePath || null;
  } catch {
    return null;
  }
}

function resolveCompletedVideoPath(downloadPath, outputPath, preferredStem = "", reportedPath = "") {
  const candidates = [
    reportedPath,
    outputPath,
    findLatestVideoFile(downloadPath, preferredStem),
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || "";
}

function getPlayableFileUrl(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return { success: false, error: "No file path was provided." };
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: "The downloaded file was not found on disk." };
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return { success: false, error: "The selected download is not a video file." };
  }

  return {
    success: true,
    filePath: resolvedPath,
    url: pathToFileURL(resolvedPath).href,
    size: stat.size,
  };
}

function convertSrtToVtt(srtText) {
  return `WEBVTT\n\n${String(srtText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\n/gm, "")}`;
}

function getSubtitleForVideo(filePath) {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "No video path was provided." };
    }

    const videoPath = path.resolve(filePath);
    const videoDir = path.dirname(videoPath);
    const videoStem = path.basename(videoPath, path.extname(videoPath));
    if (!fs.existsSync(videoDir)) {
      return { success: false, error: "The video folder was not found." };
    }

    const candidates = fs
      .readdirSync(videoDir)
      .filter((fileName) => {
        const ext = path.extname(fileName).toLowerCase();
        return (ext === ".vtt" || ext === ".srt") && fileName.toLowerCase().startsWith(videoStem.toLowerCase());
      })
      .sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const score = (name) => {
          if (name.endsWith(".en.vtt")) return 0;
          if (name.endsWith(".vtt")) return 1;
          if (name.endsWith(".en.srt")) return 2;
          return 3;
        };
        return score(aLower) - score(bLower);
      });

    const subtitleName = candidates[0];
    if (!subtitleName) return { success: false, error: "No subtitle sidecar was found." };

    const subtitlePath = path.join(videoDir, subtitleName);
    const ext = path.extname(subtitlePath).toLowerCase();
    if (ext === ".vtt") {
      return {
        success: true,
        url: pathToFileURL(subtitlePath).href,
        label: subtitleName.toLowerCase().includes(".en.") ? "English" : "Subtitles",
        srclang: subtitleName.toLowerCase().includes(".en.") ? "en" : "",
      };
    }

    const subtitleCacheDir = path.join(getVelvetVideosDir(), ".subtitles");
    if (!fs.existsSync(subtitleCacheDir)) fs.mkdirSync(subtitleCacheDir, { recursive: true });
    const safeName = `${videoStem.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.vtt`;
    const vttPath = path.join(subtitleCacheDir, safeName);
    fs.writeFileSync(vttPath, convertSrtToVtt(fs.readFileSync(subtitlePath, "utf8")), "utf8");

    return {
      success: true,
      url: pathToFileURL(vttPath).href,
      label: subtitleName.toLowerCase().includes(".en.") ? "English" : "Subtitles",
      srclang: subtitleName.toLowerCase().includes(".en.") ? "en" : "",
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Track active download jobs so they can be cancelled.
// Map<downloadId, { cancelled: boolean, deleteOnCancel: boolean, entry: object | null, currentReq: http.ClientRequest | null, currentProc: ChildProcess | null }>
const activeSegmentJobs = new Map();

// Ensure Videos/Velvet dir exists
function ensureVelvetDir() {
  const velvetVideosDir = getVelvetVideosDir();
  if (!fs.existsSync(velvetVideosDir)) {
    fs.mkdirSync(velvetVideosDir, { recursive: true });
  }
}

function ensureDownloadsLogDir() {
  const logDir = getDownloadsLogDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function serializeLogExtra(extra) {
  if (extra === null || extra === undefined) return "";
  const limit = (value) => {
    const text = String(value);
    return text.length > DOWNLOAD_LOG_VALUE_MAX_CHARS
      ? `${text.slice(0, DOWNLOAD_LOG_VALUE_MAX_CHARS)}... [truncated ${text.length - DOWNLOAD_LOG_VALUE_MAX_CHARS} chars]`
      : text;
  };
  if (typeof extra === "string") return limit(extra);
  try {
    return limit(JSON.stringify(extra));
  } catch {
    return limit(extra);
  }
}

function deleteDownloadFiles(entry) {
  if (!entry || typeof entry !== "object") return;

  if (entry.outputPath && fs.existsSync(entry.outputPath)) {
    fs.rmSync(entry.outputPath, { force: true });
  }

  if (entry.outputPath) {
    const sidecarPaths = [
      `${entry.outputPath}.part`,
      `${entry.outputPath}.ytdl`,
      `${entry.outputPath}.temp`,
    ];
    sidecarPaths.forEach((sidecarPath) => {
      if (fs.existsSync(sidecarPath)) {
        fs.rmSync(sidecarPath, { force: true });
      }
    });

    const outputFolder = path.dirname(entry.outputPath);
    const outputBase = path.basename(entry.outputPath);
    const outputStem = path.basename(entry.outputPath, path.extname(entry.outputPath));
    if (fs.existsSync(outputFolder)) {
      fs.readdirSync(outputFolder)
        .filter((fileName) => fileName === outputBase || fileName.startsWith(`${outputBase}.`) || fileName.startsWith(`${outputStem}.`))
        .forEach((fileName) => {
          fs.rmSync(path.join(outputFolder, fileName), { recursive: true, force: true });
        });
    }
  }

  if (entry.segmentsDir && fs.existsSync(entry.segmentsDir)) {
    fs.rmSync(entry.segmentsDir, { recursive: true, force: true });
  }

  if (entry.id) {
    const statePath = path.join(getVelvetVideosDir(), ".states", `${entry.id}.json`);
    if (fs.existsSync(statePath)) fs.rmSync(statePath, { force: true });
  }

  if (entry.outputPath) {
    const folder = path.dirname(entry.outputPath);
    if (fs.existsSync(folder)) {
      const remaining = fs.readdirSync(folder).filter((f) => !f.startsWith("."));
      if (remaining.length === 0) {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }
  }
}

function cancelActiveDownload(downloadId, options = {}) {
  const job = activeSegmentJobs.get(downloadId);
  if (!job) return false;

  warnDownload("job", options.deleteOnCancel ? "Deleting active download job." : "Cancelling download job.", { downloadId });
  job.cancelled = true;
  if (options.deleteOnCancel) {
    job.deleteOnCancel = true;
    job.entry = options.entry || job.entry || null;
  }
  try { job.currentReq?.destroy(); } catch {}
  killProcessTree(job.currentProc);
  return true;
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      // Kill by root PID so parallel downloads with their own process trees keep running.
      const result = spawnSync("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
      if (result.status === 0) return;
    }
  } catch {}

  try { proc.kill(); } catch {}
}

function rotateDownloadLogIfNeeded() {
  const logPath = getDownloadsLogPath();
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size < DOWNLOAD_LOG_MAX_BYTES) return;

  const previousLogPath = getPreviousDownloadsLogPath();
  if (fs.existsSync(previousLogPath)) {
    fs.rmSync(previousLogPath, { force: true });
  }
  fs.renameSync(logPath, previousLogPath);
}

function appendDownloadLog(level, scope, message, extra = null) {
  try {
    ensureVelvetDir();
    ensureDownloadsLogDir();
    rotateDownloadLogIfNeeded();
    const timestamp = new Date().toISOString();
    const suffix = serializeLogExtra(extra);
    const line = `${timestamp} [${level.toUpperCase()}] [${scope}] ${message}${suffix ? ` ${suffix}` : ""}\n`;
    fs.appendFileSync(getDownloadsLogPath(), line, "utf8");
  } catch {}
}

function logDownload(scope, message, extra = null) {
  const prefix = `[Downloads:${scope}] ${message}`;
  appendDownloadLog("log", scope, message, extra);
  if (extra !== null && extra !== undefined) {
    console.log(prefix, extra);
  } else {
    console.log(prefix);
  }
}

function warnDownload(scope, message, extra = null) {
  const prefix = `[Downloads:${scope}] ${message}`;
  appendDownloadLog("warn", scope, message, extra);
  if (extra !== null && extra !== undefined) {
    console.warn(prefix, extra);
  } else {
    console.warn(prefix);
  }
}

function errorDownload(scope, message, extra = null) {
  const prefix = `[Downloads:${scope}] ${message}`;
  appendDownloadLog("error", scope, message, extra);
  if (extra !== null && extra !== undefined) {
    console.error(prefix, extra);
  } else {
    console.error(prefix);
  }
}

function shouldLogExternalStdoutLine(line, update) {
  if (!line) return false;
  if (/^\[download\]\s+[\d.]+%/i.test(line)) return false;
  if (/^Downloading:\s+/i.test(line)) return false;
  if (/^\[debug\]/i.test(line)) return false;
  if (update?.message && /^(Downloaded|Processing|\d+%|Fragment|Retrying)/i.test(update.message)) return false;
  return (
    /^\[generic\]/i.test(line) ||
    /^\[info\]/i.test(line) ||
    /^\[hlsnative\]/i.test(line) ||
    /^\[download\]\s+Destination:/i.test(line) ||
    /^\[Merger\]/i.test(line) ||
    /^Download finished/i.test(line) ||
    /warning|error|failed|unable|cannot|denied|timeout/i.test(line)
  );
}

function getHttpStatusMessage(statusCode) {
  switch (statusCode) {
    case 400: return "The server rejected the request as invalid.";
    case 401: return "The source rejected the request as unauthorized.";
    case 403: return "The source blocked access to this file.";
    case 404: return "The requested file was not found on the source server.";
    case 429: return "The source rate-limited the request.";
    case 500: return "The source server reported an internal error.";
    case 502:
    case 503:
    case 504:
      return "The source server is temporarily unavailable.";
    default:
      return "The source request failed.";
  }
}

// ── Resolve stream URL via hidden webview ─────────────────────────────────
ipcMain.handle("download-resolve-stream", async (_event, embedUrl) => {
  return new Promise((resolve, reject) => {
    logDownload("resolve", "Starting stream resolution.", { embedUrl });

    // Use defaultSession — same context as the player webview.
    // A fresh partition has no cookies/fingerprint and gets bot-detected by vidsrc.
    const ses = session.defaultSession;

    // On-screen but invisible (opacity 0, non-focusable, click-through). Positioning
    // off-screen marks the window occluded/hidden, so players that gate autoplay on
    // document.visibilityState never start and no .m3u8 is ever requested.
    const hidden = new BrowserWindow({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      show: false,
      frame: false,
      skipTaskbar: true,
      opacity: 0,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        backgroundThrottling: false,
        javascript: true,
      },
    });
    hidden.setIgnoreMouseEvents(true);
    hidden.showInactive();
    try { hidden.setOpacity(0); } catch {}

    let resolved = false;
    let mp4Candidate = null;
    let timer = null;
    let sawAnyRequest = false;
    let sawMediaResponse = false;
    let finishLoad = false;
    let failLoad = null;
    let lastObservedUrl = "";
    let clickInterval = null;

    const resolverWcId = hidden.webContents.id;

    function resolveWith(url, headers = null) {
      if (resolved) return;
      resolved = true;
      streamResolverWaiters.delete(resolverWcId);
      clearTimeout(timer);
      clearInterval(clickInterval);
      logDownload("resolve", "Resolved playable stream URL.", {
        streamType: url.includes(".m3u8") ? "hls" : "mp4",
        url,
        referer: headers?.referer || "",
      });
      setTimeout(() => { try { hidden.destroy(); } catch {} }, 500);
      resolve({ streamUrl: url, streamType: url.includes(".m3u8") ? "hls" : "mp4", headers });
    }

    function rejectWith(err) {
      if (resolved) return;
      resolved = true;
      streamResolverWaiters.delete(resolverWcId);
      clearTimeout(timer);
      clearInterval(clickInterval);
      errorDownload("resolve", err.message);
      setTimeout(() => { try { hidden.destroy(); } catch {} }, 500);
      reject(err);
    }

    // Detect the media request at the session level (which, unlike CDP, sees
    // cross-origin iframe requests) and carry its headers through.
    streamResolverWaiters.set(resolverWcId, (url, _type, headers) => {
      logDownload("resolve", "Detected stream via session request hook.", { url });
      resolveWith(url, headers);
    });

    // ── CDP: attach debugger and enable Network domain ────────────────────
    // CDP intercepts at engine level — invisible to websites, captures all frames
    const dbg = hidden.webContents.debugger;
    try { dbg.attach("1.1"); } catch {}
    dbg.sendCommand("Network.enable").catch(() => {});

    dbg.on("message", (_e, method, params) => {
      if (resolved) return;

      // All outgoing request URLs
      if (method === "Network.requestWillBeSent") {
        const u = params.request?.url || "";
        if (u) {
          sawAnyRequest = true;
          lastObservedUrl = u;
        }
        if (u.includes(".m3u8")) {
          sawMediaResponse = true;
          logDownload("resolve", "Detected HLS manifest request (CDP).", { url: u });
          // Defer so the session-level hook (which carries the Referer/Origin the
          // CDN requires) can resolve first. Fall back to this header-less URL only
          // if the session hook doesn't win within the grace window.
          if (!mp4Candidate) {
            setTimeout(() => { if (!resolved) resolveWith(u); }, 2500);
          }
          return;
        }
        if (
          u.includes(".mp4") &&
          !u.includes("thumb") && !u.includes("poster") && !u.includes("preview") &&
          (u.includes("cdn") || u.includes("stream") || u.includes("video") || u.includes("storage") || u.includes("media"))
        ) {
          logDownload("resolve", "Detected direct MP4 candidate.", { url: u });
          if (!mp4Candidate) {
            mp4Candidate = u;
            setTimeout(() => { if (!resolved) resolveWith(mp4Candidate); }, 4000);
          }
        }
      }

      // All incoming response headers — sniff by Content-Type
      if (method === "Network.responseReceived") {
        const ct = (params.response?.mimeType || "").toLowerCase();
        const u = params.response?.url || "";
        if (ct.includes("mpegurl") || ct.includes("x-mpegurl") || ct.includes("vnd.apple")) {
          sawMediaResponse = true;
          logDownload("resolve", "Detected HLS manifest response.", { url: u, mimeType: ct });
          resolveWith(u);
        }
      }
    });

    // Trigger playback without waiting for did-finish-load, which frequently never
    // fires on these ad-laden embed pages (a hanging tracker/ad subresource blocks
    // the load event). Start nudging on dom-ready and via a fallback timer instead.
    let nudgingStarted = false;
    const startNudging = () => {
      if (nudgingStarted || resolved) return;
      nudgingStarted = true;
      logDownload("resolve", "Starting playback nudge loop.");
      const clickHotspots = [
        { x: 640, y: 360 },
        { x: 640, y: 420 },
        { x: 960, y: 540 },
      ];
      const nudgePlayer = () => {
        clickHotspots.forEach(({ x, y }) => {
          try { hidden.webContents.sendInputEvent({ type: "mouseMove", x, y, movementX: 0, movementY: 0 }); } catch {}
          try { hidden.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 }); } catch {}
          try { hidden.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 }); } catch {}
          // CDP-level trusted input — routes into cross-origin (out-of-process)
          // player iframes that ignore sendInputEvent's synthetic clicks.
          dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 }).catch(() => {});
          dbg.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }).catch(() => {});
          dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1 }).catch(() => {});
        });
        try { hidden.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" }); } catch {}
        try { hidden.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" }); } catch {}
      };
      clearInterval(clickInterval);
      clickInterval = setInterval(() => {
        nudgePlayer();
        hidden.webContents.executeJavaScript(`
          (() => {
            let clicked = 0;
            const selectors = [
              'button',
              '[role="button"]',
              '[aria-label*="play" i]',
              '[class*="play" i]',
              '[id*="play" i]',
              'iframe',
              '.jw-display-icon-container',
              '.vjs-big-play-button'
            ];
            for (const selector of selectors) {
              document.querySelectorAll(selector).forEach((el) => {
                const rect = el.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0;
                if (!visible) return;
                try {
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                  clicked++;
                } catch {}
              });
            }
            const video = document.querySelector('video');
            if (video) {
              try { video.muted = true; } catch {}
              try { video.play(); clicked++; } catch {}
            }
            return { clicked, href: location.href, title: document.title };
          })();
        `, true).then((result) => {
          if (result?.clicked) {
            logDownload("resolve", "Auto-clicked playable elements in hidden resolver window.", result);
          }
        }).catch(() => {});
      }, 2500);
      nudgePlayer();
    };

    hidden.webContents.on("dom-ready", startNudging);
    hidden.webContents.on("did-finish-load", () => {
      finishLoad = true;
      logDownload("resolve", "Embed page finished loading.");
      startNudging();
    });
    // Fallback: some embed pages never emit dom-ready/did-finish-load for the top
    // frame quickly; begin nudging anyway once subresources are flowing.
    setTimeout(startNudging, 6000);

    hidden.webContents.on("did-fail-load", (_event2, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      failLoad = { errorCode, errorDescription, validatedURL };
      warnDownload("resolve", "Embed page failed to load.", failLoad);
    });

    timer = setTimeout(() => {
      if (mp4Candidate && !resolved) { resolveWith(mp4Candidate); return; }
      const failureContext = {
        sawAnyRequest,
        sawMediaResponse,
        finishLoad,
        failLoad,
        lastObservedUrl,
      };
      if (failLoad) {
        rejectWith(new Error(
          `The embed page failed to load (${failLoad.errorCode}: ${failLoad.errorDescription}).`
        ));
        return;
      }
      if (!finishLoad) {
        rejectWith(new Error(
          "The embed page never finished loading before stream resolution timed out."
        ));
        return;
      }
      if (!sawAnyRequest) {
        rejectWith(new Error(
          "The embed page loaded, but no network activity was captured for the stream request."
        ));
        return;
      }
      if (!sawMediaResponse) {
        errorDownload("resolve", "Timed out without a playable stream request.", failureContext);
        rejectWith(new Error(
          "The source page loaded, but no playable .m3u8 or .mp4 request was detected. The source may need a warmed playback session or manual interaction before download starts."
        ));
        return;
      }
      rejectWith(new Error(
        "Stream resolution timed out after a media request was detected, which usually means the source never exposed a stable downloadable URL."
      ));
    }, 40000);

    hidden.loadURL(embedUrl).catch((err) => {
      errorDownload("resolve", "Could not load the embed page.", { embedUrl, error: err.message });
      rejectWith(new Error(`Could not load embed page: ${err.message}`));
    });
  });
});


// ── Fetch and parse m3u8 manifest ─────────────────────────────────────────
ipcMain.handle("download-fetch-manifest", async (_event, m3u8Url) => {
  return new Promise((resolve, reject) => {
    logDownload("manifest", "Fetching manifest.", { m3u8Url });
    const parsedUrl = new NodeURL(m3u8Url);
    const protocol = parsedUrl.protocol === "https:" ? https : http;

    const req = protocol.get(m3u8Url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://vidsrc-embed.ru/",
        "Origin": "https://vidsrc-embed.ru",
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        const details = getHttpStatusMessage(res.statusCode);
        errorDownload("manifest", "Manifest request failed.", { m3u8Url, statusCode: res.statusCode });
        reject(new Error(`Manifest fetch failed with HTTP ${res.statusCode}. ${details}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
          const lines = data.split("\n").map((l) => l.trim()).filter(Boolean);

          // Detect if this is a master playlist (has #EXT-X-STREAM-INF)
          // If so, pick the highest bandwidth variant
          const variantLines = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
              variantLines.push({ tag: lines[i], url: lines[i + 1] || "" });
            }
          }

          if (variantLines.length > 0) {
            // This is a master playlist — pick best variant and resolve it recursively
            // Pick last (usually highest quality) or the one with highest BANDWIDTH
            let bestUrl = variantLines[variantLines.length - 1].url;
            let bestBandwidth = 0;
            for (const v of variantLines) {
              const bwMatch = v.tag.match(/BANDWIDTH=(\d+)/);
              const bw = bwMatch ? parseInt(bwMatch[1]) : 0;
              if (bw > bestBandwidth) {
                bestBandwidth = bw;
                bestUrl = v.url;
              }
            }
            // Resolve relative URL
            const fullVariantUrl = bestUrl.startsWith("http") ? bestUrl : baseUrl + bestUrl;
            logDownload("manifest", "Master playlist detected. Selecting variant.", {
              variantCount: variantLines.length,
              fullVariantUrl,
              bestBandwidth,
            });
            // Return signal to re-fetch this variant manifest
            resolve({ isMasterPlaylist: true, variantUrl: fullVariantUrl });
            return;
          }

          // Parse segments
          let encryptionKey = null;
          let targetDuration = null;
          let version = null;
          const segments = [];
          let segIndex = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith("#EXT-X-TARGETDURATION")) {
              const [, value] = line.split(":");
              const parsed = Number.parseFloat(value);
              if (Number.isFinite(parsed) && parsed > 0) targetDuration = parsed;
            }

            if (line.startsWith("#EXT-X-VERSION")) {
              const [, value] = line.split(":");
              const parsed = Number.parseInt(value, 10);
              if (Number.isFinite(parsed) && parsed > 0) version = parsed;
            }

            // Encryption key
            if (line.startsWith("#EXT-X-KEY")) {
              const uriMatch = line.match(/URI="([^"]+)"/);
              const methodMatch = line.match(/METHOD=([^,\s]+)/);
              const ivMatch = line.match(/IV=([^,\s]+)/);
              if (uriMatch && methodMatch && methodMatch[1] !== "NONE") {
                encryptionKey = {
                  method: methodMatch[1],
                  uri: uriMatch[1].startsWith("http") ? uriMatch[1] : baseUrl + uriMatch[1],
                  iv: ivMatch ? ivMatch[1] : null,
                };
              }
            }

            // Segment URL (line after #EXTINF)
            if (line.startsWith("#EXTINF")) {
              const segLine = lines[i + 1] || "";
              const durationMatch = line.match(/#EXTINF:([0-9.]+)/);
              const duration = durationMatch ? Number.parseFloat(durationMatch[1]) : null;
              if (segLine && !segLine.startsWith("#")) {
                const segUrl = segLine.startsWith("http") ? segLine : baseUrl + segLine;
                segments.push({ index: segIndex, url: segUrl, done: false, duration });
                segIndex++;
                i++; // Skip next line since we consumed it
              }
            }
          }

          resolve({
            isMasterPlaylist: false,
            segments,
            encryptionKey,
            totalSegments: segments.length,
            playlistMeta: {
              targetDuration,
              version,
            },
          });
          logDownload("manifest", "Parsed media playlist.", {
            totalSegments: segments.length,
            encrypted: Boolean(encryptionKey),
            targetDuration,
          });
        } catch (err) {
          errorDownload("manifest", "Manifest parsing failed.", { m3u8Url, error: err.message });
          reject(new Error(`Manifest parse error: ${err.message}`));
        }
      });
    });

    req.on("error", (err) => {
      errorDownload("manifest", "Manifest request errored.", { m3u8Url, error: err.message });
      reject(new Error(`Manifest fetch error: ${err.message}`));
    });
    req.setTimeout(15000, () => {
      req.destroy();
      warnDownload("manifest", "Manifest request timed out.", { m3u8Url });
      reject(new Error("Manifest fetch timed out after 15 seconds."));
    });
  });
});

// ── Download a single segment ──────────────────────────────────────────────
ipcMain.handle("download-segment", async (_event, { downloadId, url, outputPath }) => {
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Check if job was cancelled before we even start
  const job = activeSegmentJobs.get(downloadId);
  if (job?.cancelled) {
    warnDownload("segment", "Segment skipped because the job was already cancelled.", { downloadId, url });
    return { success: false, cancelled: true, error: "Download was cancelled before the segment started." };
  }

  logDownload("segment", "Downloading segment.", { downloadId, url, outputPath });

  return new Promise((resolve) => {
    const parsedUrl = new NodeURL(url);
    const protocol = parsedUrl.protocol === "https:" ? https : http;
    let file = null;

    const req = protocol.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://vidsrc-embed.ru/",
      },
    }, (res) => {
      if (res.statusCode === 403 || res.statusCode === 401) {
        warnDownload("segment", "Segment request was rejected by the source.", { downloadId, url, statusCode: res.statusCode });
        resolve({
          success: false,
          expired: true,
          status: res.statusCode,
          error: `Segment request failed with HTTP ${res.statusCode}. ${getHttpStatusMessage(res.statusCode)}`,
        });
        return;
      }
      if (res.statusCode !== 200) {
        errorDownload("segment", "Segment request failed.", { downloadId, url, statusCode: res.statusCode });
        resolve({ success: false, error: `Segment request failed with HTTP ${res.statusCode}. ${getHttpStatusMessage(res.statusCode)}` });
        return;
      }

      file = fs.createWriteStream(outputPath);
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        logDownload("segment", "Segment saved.", { downloadId, outputPath });
        resolve({ success: true });
      });
      file.on("error", (err) => {
        fs.unlink(outputPath, () => {});
        errorDownload("segment", "Could not write the segment to disk.", { downloadId, outputPath, error: err.message });
        resolve({ success: false, error: `Could not write the segment to disk: ${err.message}` });
      });
    });

    // Track the request so cancel works
    if (activeSegmentJobs.has(downloadId)) {
      activeSegmentJobs.get(downloadId).currentReq = req;
    }

    req.on("error", (err) => {
      if (job?.cancelled) {
        warnDownload("segment", "Segment request aborted by cancellation.", { downloadId, url });
        resolve({ success: false, cancelled: true, error: "Download was cancelled while fetching a segment." });
        return;
      }
      try { file?.destroy(); } catch {}
      fs.unlink(outputPath, () => {});
      errorDownload("segment", "Segment request errored.", { downloadId, url, error: err.message });
      resolve({ success: false, error: `Segment download error: ${err.message}` });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      warnDownload("segment", "Segment request timed out.", { downloadId, url });
      resolve({ success: false, error: "Segment download timed out after 30 seconds." });
    });
  });
});

// ── Register/unregister a download job ────────────────────────────────────
ipcMain.on("download-job-register", (_event, downloadId) => {
  logDownload("job", "Registered download job.", { downloadId });
  activeSegmentJobs.set(downloadId, { cancelled: false, currentReq: null, currentProc: null });
});

ipcMain.on("download-job-unregister", (_event, downloadId) => {
  logDownload("job", "Unregistered download job.", { downloadId });
  activeSegmentJobs.delete(downloadId);
});

// ── Cancel a download ──────────────────────────────────────────────────────
ipcMain.on("download-cancel", (_event, downloadId) => {
  cancelActiveDownload(downloadId);
});

ipcMain.handle("downloads-pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Folder",
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("downloads-check-external-tool", (_event, folderPath) => {
  return getExternalDownloaderExecutable(folderPath);
});

ipcMain.handle("downloads-get-bundled-external-tool", () => {
  return getBundledExternalDownloader();
});

ipcMain.handle("downloads-show-in-folder", (_event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { success: true };
    }
    return { success: false, error: "File not found." };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("downloads-local-video-url", (_event, filePath) => {
  try {
    return getPlayableFileUrl(filePath);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("downloads-find-subtitle", (_event, filePath) => {
  return getSubtitleForVideo(filePath);
});

function parseExternalDownloaderLine(line, previous = {}) {
  const trimmed = String(line || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x08/g, "")
    .trim();
  if (!trimmed) return null;

  const update = {};

  const fragMatch =
    trimmed.match(/\(frag\s+(\d+)\/(\d+)\)/i) ||
    trimmed.match(/\bfrag(?:ment)?\s+(\d+)\s*\/\s*(\d+)\b/i);
  if (fragMatch) {
    const completedFragments = Number.parseInt(fragMatch[1], 10);
    const totalFragments = Number.parseInt(fragMatch[2], 10);
    update.completedFragments = completedFragments;
    update.totalFragments = totalFragments;
    update.progress = Math.min(99, Math.round((completedFragments / Math.max(totalFragments, 1)) * 100));
    update.message = `Fragment ${completedFragments} / ${totalFragments}`;
  }

  const totalFragmentsMatch = trimmed.match(/Total fragments:\s*(\d+)/i);
  if (totalFragmentsMatch) {
    update.totalFragments = Number.parseInt(totalFragmentsMatch[1], 10);
    update.completedFragments = previous.completedFragments || 0;
    update.message = `HLS: ${update.totalFragments} fragments`;
  }

  const directPercentMatch = trimmed.match(/^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*(?:[KMGT]i?B|B))/i);
  if (directPercentMatch) {
    update.progress = Math.min(99, Math.round(Number.parseFloat(directPercentMatch[1])));
    update.size = directPercentMatch[2].trim();
    const speedMatch = trimmed.match(/\bat\s+([\d.]+\s*(?:[KMGT]i?B|B)\/s)/i);
    if (speedMatch) update.speed = speedMatch[1].trim();
    update.message = `${update.progress}% of ${update.size}`;
  }

  const percentOnlyMatch = trimmed.match(/^\[download\]\s+([\d.]+)%/i);
  if (percentOnlyMatch && typeof update.progress === "undefined") {
    update.progress = Math.min(99, Math.round(Number.parseFloat(percentOnlyMatch[1])));
    const speedMatch = trimmed.match(/\bat\s+([\d.]+\s*(?:[KMGT]i?B|B)\/s)/i);
    if (speedMatch) update.speed = speedMatch[1].trim();
    update.message = `Downloading ${update.progress}%`;
  }

  const byteProgressMatch = trimmed.match(/^Downloading:\s+([\d,]+)\s+bytes(?:\s+([\d.]+\s*(?:[KMGT]?B|[KMGT]i?B)\/s))?/i);
  if (byteProgressMatch) {
    const bytes = Number.parseInt(byteProgressMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(bytes)) {
      update.downloadedBytes = bytes;
      update.size = bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KiB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
      update.message = `Downloaded ${update.size}`;
    }
    if (byteProgressMatch[2]) update.speed = byteProgressMatch[2].trim();
  }

  const ffmpegDurationMatch = trimmed.match(/Duration:\s*(\d+):(\d+):([\d.]+)/i);
  if (ffmpegDurationMatch) {
    const totalSeconds =
      Number.parseInt(ffmpegDurationMatch[1], 10) * 3600 +
      Number.parseInt(ffmpegDurationMatch[2], 10) * 60 +
      Number.parseFloat(ffmpegDurationMatch[3]);
    if (totalSeconds > 0) update.totalSeconds = totalSeconds;
  }

  const ffmpegProgressMatch = trimmed.match(/size=\s*([\d.]+\s*\w+)\s+time=(\d+):(\d+):([\d.]+)/i);
  if (ffmpegProgressMatch) {
    const elapsedSeconds =
      Number.parseInt(ffmpegProgressMatch[2], 10) * 3600 +
      Number.parseInt(ffmpegProgressMatch[3], 10) * 60 +
      Number.parseFloat(ffmpegProgressMatch[4]);
    const totalSeconds = previous.totalSeconds || 0;
    if (totalSeconds > 0) {
      update.progress = Math.min(99, Math.round((elapsedSeconds / totalSeconds) * 100));
    }
    update.size = ffmpegProgressMatch[1].trim();
    const speedMatch = trimmed.match(/speed=\s*([\d.]+)x/i);
    if (speedMatch) update.speed = `${speedMatch[1]}x`;
    update.message = `Processing${update.size ? ` ${update.size}` : ""}${update.speed ? ` at ${update.speed}` : ""}`;
  }

  const destinationMatch = trimmed.match(/^\[download\]\s+Destination:\s+(.+)/i);
  if (destinationMatch) {
    update.outputPath = destinationMatch[1].trim();
    update.message = "Downloading...";
  }

  const mergeMatch = trimmed.match(/\[Merger\]\s+Merging formats into\s+\"(.+)\"/i);
  if (mergeMatch) {
    update.outputPath = mergeMatch[1].trim();
    update.progress = 99;
    update.phase = "assembling";
    update.message = "Merging video...";
  }

  const retryMatch = trimmed.match(/Retrying\s+\((\d+)\/(\d+)\)/i);
  if (retryMatch) {
    update.message = `Retrying... (${retryMatch[1]}/${retryMatch[2]})`;
  } else if (/timed?\s*out/i.test(trimmed)) {
    update.message = "Retrying after timeout...";
  }

  if (!update.message && !update.outputPath) {
    const suppressed =
      /^\[debug\]/i.test(trimmed) ||
      /^\[yt-dlp\s+DEBUG\]/i.test(trimmed) ||
      /Sleeping\s+[\d.]+\s+seconds/i.test(trimmed);
    if (!suppressed) update.message = trimmed;
  }

  return Object.keys(update).length ? update : null;
}

function parseYtDlpProgressLine(line) {
  if (!line.startsWith("DL:")) return null;
  const parts = line.slice(3).split("|");
  const downloadedBytes = Number.parseFloat(parts[0]);
  const totalBytes = Number.parseFloat(parts[1]);
  const totalEstimate = Number.parseFloat(parts[2]);
  const eta = parts[3] || "";
  const speed = parts[4] || "";
  const status = parts[5] || "";
  const resolvedTotal = Number.isFinite(totalBytes) && totalBytes > 0
    ? totalBytes
    : Number.isFinite(totalEstimate) && totalEstimate > 0
      ? totalEstimate
      : null;
  const percent = resolvedTotal && Number.isFinite(downloadedBytes)
    ? Math.max(0, Math.min(100, (downloadedBytes / resolvedTotal) * 100))
    : null;

  const speedBytes = Number.parseFloat(speed);
  return {
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : null,
    totalBytes: resolvedTotal,
    eta,
    speed: Number.isFinite(speedBytes) && speedBytes > 0 ? `${formatByteSize(speedBytes)}/s` : "",
    size: resolvedTotal ? formatByteSize(resolvedTotal) : "",
    status,
    percent,
  };
}

function formatByteSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

ipcMain.handle("downloads-run-external", (event, { downloadId, binaryPath, sourceUrl, outputPath, title = "" }) => {
  try {
    if (!binaryPath || !fs.existsSync(binaryPath)) {
      const error = "The selected downloader executable could not be found.";
      errorDownload("external", error, { downloadId, binaryPath });
      return { success: false, error };
    }

    const downloadPath = path.dirname(outputPath);
    fs.mkdirSync(downloadPath, { recursive: true });

    const safeTitle = path.basename(title || path.parse(outputPath).name || "download").trim();
    const args = [
      "--cli",
      sourceUrl,
      "-f",
      "mp4 (with Audio)",
      "-r",
      "best",
      "-b",
      "320",
      "-n",
      safeTitle,
      "-d",
      downloadPath,
    ];

    logDownload("external", "Starting external downloader.", {
      downloadId,
      binaryPath,
      sourceUrl,
      outputPath,
      args,
    });

    const proc = spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const job = activeSegmentJobs.get(downloadId) || {
      cancelled: false,
      deleteOnCancel: false,
      entry: null,
      currentReq: null,
      currentProc: null,
    };
    job.currentProc = proc;
    activeSegmentJobs.set(downloadId, job);

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stderrTail = "";
    let parserState = {
      totalFragments: 0,
      completedFragments: 0,
      totalSeconds: 0,
      outputPath: "",
    };

    const emitProgress = (update) => {
      event.sender.send("downloads-progress", {
        downloadId,
        phase: update.phase || "downloading",
        progress: update.progress ?? null,
        speed: update.speed ?? null,
        size: update.size ?? null,
        downloadedBytes: update.downloadedBytes ?? null,
        completedFragments: update.completedFragments ?? parserState.completedFragments ?? null,
        totalFragments: update.totalFragments ?? parserState.totalFragments ?? null,
        message: update.message || "",
        outputPath: update.outputPath || parserState.outputPath || null,
      });
    };

    const consumeLine = (line, source) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      const update = parseExternalDownloaderLine(trimmed, parserState);
      if (source === "stderr") {
        stderrTail = `${stderrTail}\n${trimmed}`.slice(-12000);
        warnDownload("external", "External downloader stderr.", { downloadId, line: trimmed });
      } else if (shouldLogExternalStdoutLine(trimmed, update)) {
        logDownload("external", "External downloader stdout.", { downloadId, line: trimmed });
      }

      if (!update) return;
      parserState = { ...parserState, ...update };
      emitProgress(update);
    };

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const parts = stdoutBuffer.split(/\r?\n|\r/);
      stdoutBuffer = parts.pop() || "";
      parts.forEach((line) => consumeLine(line, "stdout"));
    });

    proc.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const parts = stderrBuffer.split(/\r?\n|\r/);
      stderrBuffer = parts.pop() || "";
      parts.forEach((line) => consumeLine(line, "stderr"));
    });

    proc.on("error", (err) => {
      activeSegmentJobs.delete(downloadId);
      errorDownload("external", "Could not start external downloader.", {
        downloadId,
        binaryPath,
        error: err.message,
      });
      event.sender.send("downloads-error", {
        downloadId,
        error: `Could not start downloader: ${err.message}`,
      });
    });

    proc.on("close", (code, signal) => {
      activeSegmentJobs.delete(downloadId);
      if (stdoutBuffer.trim()) {
        consumeLine(stdoutBuffer.trim(), "stdout");
        stdoutBuffer = "";
      }
      if (stderrBuffer.trim()) {
        consumeLine(stderrBuffer.trim(), "stderr");
        stderrBuffer = "";
      }

      if (job.cancelled || signal) {
        warnDownload("external", "External downloader cancelled.", { downloadId, code, signal });
        if (job.deleteOnCancel && job.entry) {
          try {
            deleteDownloadFiles(job.entry);
            logDownload("external", "Deleted partial files for cancelled download.", { downloadId });
          } catch (err) {
            warnDownload("external", "Could not delete partial files for cancelled download.", { downloadId, error: err.message });
          }
        }
        event.sender.send("downloads-cancelled", { downloadId });
        return;
      }

      if (code === 0) {
        const resolvedOutputPath = resolveCompletedVideoPath(
          downloadPath,
          outputPath,
          safeTitle,
          parserState.outputPath
        );
        if (!resolvedOutputPath) {
          const error = "Downloader exited successfully, but no completed video file was found.";
          errorDownload("external", error, {
            downloadId,
            downloadPath,
            outputPath,
            reportedPath: parserState.outputPath,
          });
          event.sender.send("downloads-error", {
            downloadId,
            error,
          });
          return;
        }
        logDownload("external", "External downloader completed.", {
          downloadId,
          outputPath: resolvedOutputPath,
        });
        event.sender.send("downloads-complete", {
          downloadId,
          outputPath: resolvedOutputPath,
        });
        return;
      }

      const errorLine =
        String(stderrTail || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .reverse()
          .find((line) => /error|failed|unable|cannot|denied|timeout/i.test(line)) ||
        `Downloader exited with code ${code}.`;
      errorDownload("external", "External downloader failed.", {
        downloadId,
        code,
        error: errorLine,
      });
      event.sender.send("downloads-error", {
        downloadId,
        error: errorLine,
      });
    });

    return { success: true };
  } catch (err) {
    errorDownload("external", "Failed to launch external downloader.", {
      downloadId,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
});

ipcMain.handle("download-run-ytdlp", async (event, { downloadId, sourceUrl, outputPath, referer = "", headers = null, title = "" }) => {
  return new Promise((resolve) => {
    const ytDlpPath = getResolvedYtDlpPath();
    const ffmpegPath = getResolvedFfmpegPath();

    if (!ytDlpPath || !fs.existsSync(ytDlpPath)) {
      const error = "yt-dlp.exe was not found. Install yt-dlp or place it in app/bin/.";
      errorDownload("ytdlp", error, { downloadId });
      resolve({ success: false, error });
      return;
    }

    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      const error = "ffmpeg.exe was not found. Install ffmpeg or place it in app/bin/.";
      errorDownload("ytdlp", error, { downloadId });
      resolve({ success: false, error });
      return;
    }

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // If the job was cancelled while the stream was still being resolved, stop here.
    const preJob = activeSegmentJobs.get(downloadId);
    if (preJob?.cancelled) {
      warnDownload("ytdlp", "yt-dlp download cancelled before it started.", { downloadId });
      event.sender.send("downloads-cancelled", { downloadId });
      resolve({ success: false, cancelled: true, error: "Download was cancelled." });
      return;
    }

    // Prefer the real headers the browser used for the .m3u8 (captured during
    // resolve). The segment CDN 403s requests that lack the player's Referer.
    let refererUrl = headers?.referer || referer || "";
    if (!refererUrl) {
      try { refererUrl = `${new NodeURL(sourceUrl).origin}/`; } catch { refererUrl = "https://vidsrc-embed.ru/"; }
    }
    let originUrl = headers?.origin || "";
    if (!originUrl) {
      try { originUrl = new NodeURL(refererUrl).origin; } catch {}
    }
    const userAgent = headers?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

    const args = [
      "--ignore-config",
      "--newline",
      "--continue",
      "--no-overwrites",
      "--no-playlist",
      "--ffmpeg-location", ffmpegPath,
      "--progress-template", "download:DL:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.eta)s|%(progress.speed)s|%(progress.status)s",
      "--progress-template", "postprocess:PP:%(progress.status)s|%(progress.postprocessor)s",
      "--add-headers", `Referer:${refererUrl}`,
    ];
    if (originUrl) args.push("--add-headers", `Origin:${originUrl}`);
    args.push(
      "--add-headers", `User-Agent:${userAgent}`,
      "-o", outputPath,
      sourceUrl,
    );

    logDownload("ytdlp", "Using request headers for download.", {
      downloadId,
      referer: refererUrl,
      origin: originUrl,
      fromCapture: Boolean(headers?.referer),
    });

    logDownload("ytdlp", "Starting yt-dlp download.", {
      downloadId,
      title,
      sourceUrl,
      outputPath,
      ytDlpPath,
      ffmpegPath,
    });

    const proc = spawn(ytDlpPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const job = activeSegmentJobs.get(downloadId) || { cancelled: false, deleteOnCancel: false, entry: null, currentReq: null, currentProc: null };
    job.currentProc = proc;
    activeSegmentJobs.set(downloadId, job);

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stderrTail = "";

    const flushStdoutLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const progress = parseYtDlpProgressLine(trimmed);
      if (progress) {
        event.sender.send("downloads-progress", {
          downloadId,
          phase: "downloading",
          ...progress,
        });
        return;
      }

      if (trimmed.startsWith("PP:")) {
        const [, status = "", postprocessor = ""] = trimmed.slice(3).split("|");
        logDownload("ytdlp", "Post-processing update.", { downloadId, status, postprocessor });
        event.sender.send("downloads-progress", {
          downloadId,
          phase: "assembling",
          percent: null,
          downloadedBytes: null,
          totalBytes: null,
          eta: "",
          speed: "",
          status: status || "postprocessing",
          postprocessor,
        });
        return;
      }

      logDownload("ytdlp", "yt-dlp stdout.", { downloadId, line: trimmed });
    };

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      lines.forEach(flushStdoutLine);
    });

    proc.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";
      lines.map((line) => line.trim()).filter(Boolean).forEach((line) => {
        stderrTail = `${stderrTail}\n${line}`.slice(-12000);
        warnDownload("ytdlp", "yt-dlp stderr.", { downloadId, line });
      });
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      errorDownload("ytdlp", "Could not start yt-dlp.", { downloadId, error: err.message });
      resolve({ success: false, error: `Could not start yt-dlp: ${err.message}` });
    });

    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (stdoutBuffer.trim()) flushStdoutLine(stdoutBuffer.trim());
      stdoutBuffer = "";
      if (stderrBuffer.trim()) {
        const line = stderrBuffer.trim();
        stderrTail = `${stderrTail}\n${line}`.slice(-12000);
        warnDownload("ytdlp", "yt-dlp stderr.", { downloadId, line });
      }
      stderrBuffer = "";

      const cancelled = job.cancelled || signal === "SIGTERM" || signal === "SIGKILL";
      job.currentProc = null;

      if (cancelled) {
        warnDownload("ytdlp", "yt-dlp download cancelled.", { downloadId, signal });
        if (job.deleteOnCancel && job.entry) {
          try {
            deleteDownloadFiles(job.entry);
            logDownload("ytdlp", "Deleted partial files for cancelled download.", { downloadId });
          } catch (err) {
            warnDownload("ytdlp", "Could not delete partial files for cancelled download.", { downloadId, error: err.message });
          }
        }
        event.sender.send("downloads-cancelled", { downloadId });
        resolve({ success: false, cancelled: true, error: "Download was cancelled." });
        return;
      }

      if (code === 0) {
        logDownload("ytdlp", "yt-dlp download completed.", { downloadId, outputPath });
        event.sender.send("downloads-complete", { downloadId, outputPath });
        resolve({ success: true, outputPath });
        return;
      }

      const stderr = stderrTail.trim();
      const error = stderr || `yt-dlp exited with code ${code}.`;
      errorDownload("ytdlp", "yt-dlp download failed.", { downloadId, code, error });
      event.sender.send("downloads-error", { downloadId, error });
      resolve({ success: false, error });
    });
  });
});

// ── Assemble segments into MP4 via ffmpeg ─────────────────────────────────
ipcMain.handle("download-assemble", async (_event, { segmentsDir, outputPath, totalSegments, segments = [], encryptionKey = null, playlistMeta = null }) => {
  return new Promise((resolve) => {
    const ffmpegPath = getResolvedFfmpegPath();
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      resolve({ success: false, error: "ffmpeg.exe not found in app/bin/. Please add it to enable downloads." });
      return;
    }

    logDownload("assemble", "Starting ffmpeg assembly.", {
      segmentsDir,
      outputPath,
      totalSegments,
      encrypted: Boolean(encryptionKey),
    });

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const cleanupPaths = [];
    let ffmpegArgs;

    if (Array.isArray(segments) && segments.length > 0) {
      const playlistPath = path.join(segmentsDir, "_local.m3u8");
      const manifestLines = ["#EXTM3U"];

      if (playlistMeta?.version) {
        manifestLines.push(`#EXT-X-VERSION:${playlistMeta.version}`);
      }

      const targetDuration = playlistMeta?.targetDuration
        || Math.max(1, ...segments.map((segment) => Math.ceil(Number(segment.duration) || 1)));
      manifestLines.push(`#EXT-X-TARGETDURATION:${targetDuration}`);
      manifestLines.push("#EXT-X-MEDIA-SEQUENCE:0");

      if (encryptionKey?.method && encryptionKey?.localPath) {
        const ivPart = encryptionKey.iv ? `,IV=${encryptionKey.iv}` : "";
        manifestLines.push(
          `#EXT-X-KEY:METHOD=${encryptionKey.method},URI="${path.basename(encryptionKey.localPath)}"${ivPart}`
        );
      }

      for (let i = 0; i < totalSegments; i++) {
        const segment = segments[i];
        const segFile = path.join(segmentsDir, `seg-${String(i).padStart(5, "0")}.ts`);
        if (!fs.existsSync(segFile)) {
          resolve({ success: false, error: `Missing segment file: ${path.basename(segFile)}` });
          return;
        }

        manifestLines.push(`#EXTINF:${Number(segment?.duration) > 0 ? Number(segment.duration) : 1},`);
        manifestLines.push(path.basename(segFile));
      }
      manifestLines.push("#EXT-X-ENDLIST");

      fs.writeFileSync(playlistPath, manifestLines.join("\n"), "utf8");
      cleanupPaths.push(playlistPath);

      ffmpegArgs = [
        "-y",
        "-allowed_extensions", "ALL",
        "-protocol_whitelist", "file,crypto,data",
        "-i", playlistPath,
        "-c", "copy",
        outputPath,
      ];
    } else {
      const listPath = path.join(segmentsDir, "_concat.txt");
      const lines = [];
      for (let i = 0; i < totalSegments; i++) {
        const segFile = path.join(segmentsDir, `seg-${String(i).padStart(5, "0")}.ts`);
        if (fs.existsSync(segFile)) {
          lines.push(`file '${segFile.replace(/\\/g, "/")}'`);
        }
      }
      fs.writeFileSync(listPath, lines.join("\n"), "utf8");
      cleanupPaths.push(listPath);

      ffmpegArgs = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-c", "copy",
        outputPath,
      ];
    }

    const ffmpegProc = spawn(ffmpegPath, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    ffmpegProc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpegProc.on("close", (code) => {
      cleanupPaths.forEach((cleanupPath) => {
        try { fs.unlinkSync(cleanupPath); } catch {}
      });

      if (code === 0) {
        logDownload("assemble", "ffmpeg assembly finished successfully.", { outputPath });
        resolve({ success: true, filePath: outputPath });
      } else {
        errorDownload("assemble", "ffmpeg assembly failed.", { code, stderr: stderr.trim() });
        resolve({
          success: false,
          error: stderr.trim()
            ? `ffmpeg exited with code ${code}. ${stderr.trim()}`
            : `ffmpeg exited with code ${code}.`,
        });
      }
    });

    ffmpegProc.on("error", (err) => {
      errorDownload("assemble", "Could not start ffmpeg.", { error: err.message });
      resolve({ success: false, error: `ffmpeg error: ${err.message}` });
    });
  });
});

// ── State file read/write ──────────────────────────────────────────────────
ipcMain.handle("download-save-state", (_event, state) => {
  try {
    ensureVelvetDir();
    const stateDir = path.join(getVelvetVideosDir(), ".states");
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const statePath = path.join(stateDir, `${state.id}.json`);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("download-load-state", (_event, downloadId) => {
  try {
    const statePath = path.join(getVelvetVideosDir(), ".states", `${downloadId}.json`);
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
});

ipcMain.handle("download-delete-state", (_event, downloadId) => {
  try {
    const statePath = path.join(getVelvetVideosDir(), ".states", `${downloadId}.json`);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Return all in-progress state IDs (for auto-resume on launch)
ipcMain.handle("download-list-pending-states", () => {
  try {
    const stateDir = path.join(getVelvetVideosDir(), ".states");
    if (!fs.existsSync(stateDir)) return [];
    return fs.readdirSync(stateDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(stateDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
});

// ── Global downloads manifest read/write ──────────────────────────────────
ipcMain.handle("downloads-load", () => {
  try {
    ensureVelvetDir();
    const manifestPath = getDownloadsManifestPath();
    if (!fs.existsSync(manifestPath)) return [];
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return [];
  }
});

ipcMain.handle("downloads-save", (_event, manifest) => {
  try {
    ensureVelvetDir();
    fs.writeFileSync(getDownloadsManifestPath(), JSON.stringify(manifest, null, 2), "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Delete a downloaded file + its segments ────────────────────────────────
ipcMain.handle("download-delete", (_event, entry) => {
  try {
    if (entry?.id && cancelActiveDownload(entry.id, { deleteOnCancel: true, entry })) {
      try {
        deleteDownloadFiles(entry);
      } catch (err) {
        warnDownload("job", "Active download was cancelled, but immediate partial cleanup failed.", {
          downloadId: entry.id,
          error: err.message,
        });
      }
      return { success: true, cancelled: true };
    }

    deleteDownloadFiles(entry);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Expose download dir path to renderer ──────────────────────────────────
ipcMain.handle("downloads-get-dir", () => getVelvetVideosDir());
ipcMain.handle("downloads-get-log-path", () => getDownloadsLogPath());

// ── Check ffmpeg availability ──────────────────────────────────────────────
ipcMain.handle("downloads-check-ffmpeg", () => ({
  available: Boolean(getResolvedFfmpegPath() && getResolvedYtDlpPath()),
  path: getResolvedFfmpegPath(),
  ffmpegAvailable: Boolean(getResolvedFfmpegPath()),
  ffmpegPath: getResolvedFfmpegPath(),
  ytDlpAvailable: Boolean(getResolvedYtDlpPath()),
  ytDlpPath: getResolvedYtDlpPath(),
}));

ipcMain.on("downloads-log", (_event, payload = {}) => {
  const level = payload.level === "error" ? "error" : payload.level === "warn" ? "warn" : "log";
  const scope = payload.scope || "renderer";
  const message = payload.message || "Renderer log";
  const extra = payload.extra ?? null;
  appendDownloadLog(level, scope, message, extra);
});

// ──────────────────────────────────────────────
// App lifecycle & GPU Acceleration
// ──────────────────────────────────────────────
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  destroyDiscordClient();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
