const { app, BrowserWindow, session, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

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

let mainWindow;

function attachFullscreenShortcut(webContents) {
  webContents.on("before-input-event", (event, input) => {
    if (!mainWindow) return;
    if (input.type !== "keyDown") return;

    if (input.key === "F11") {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return;
    }

    if (input.key === "Escape" && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
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

  const sendFullscreenState = (isFullscreen) => {
    mainWindow.webContents.send("window-fullscreen-changed", isFullscreen);
  };

  mainWindow.on("enter-full-screen", () => sendFullscreenState(true));
  mainWindow.on("leave-full-screen", () => sendFullscreenState(false));

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
    if (isAdUrl(details.url)) {
      callback({ cancel: true });
    } else {
      callback({});
    }
  });

  // Block new window popups (ad popups)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: "deny" };
  });

  // Lock down guest webviews used by the player.
  mainWindow.webContents.on("did-attach-webview", (_event, guestContents) => {
    attachFullscreenShortcut(guestContents);
    guestContents.setWindowOpenHandler(() => ({ action: "deny" }));

    guestContents.on("will-navigate", (details) => {
      if (!isAllowedPlayerUrl(details.url)) {
        details.preventDefault();
      }
    });

    guestContents.on("dom-ready", () => {
      guestContents.insertCSS(PLAYER_WATERMARK_CSS).catch(() => {});
      guestContents.executeJavaScript(PLAYER_WATERMARK_SCRIPT).catch(() => {});
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
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
ipcMain.on("window-close", () => mainWindow?.close());

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
const { URL: NodeURL } = require("url");

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
  return { exists: true, binaryPath: path.join(folderPath, binary) };
}

function findLatestVideoFile(folderPath, preferredStem = "") {
  try {
    const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"];
    const normalizedStem = preferredStem.trim().toLowerCase();
    const candidates = fs
      .readdirSync(folderPath)
      .filter((fileName) => VIDEO_EXTS.includes(path.extname(fileName).toLowerCase()))
      .map((fileName) => {
        const absolutePath = path.join(folderPath, fileName);
        return {
          absolutePath,
          fileName,
          mtimeMs: fs.statSync(absolutePath).mtimeMs,
          preferred: normalizedStem ? fileName.toLowerCase().startsWith(normalizedStem) : false,
        };
      })
      .sort((a, b) => {
        if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
        return b.mtimeMs - a.mtimeMs;
      });
    return candidates[0]?.absolutePath || null;
  } catch {
    return null;
  }
}

// Track active download jobs so they can be cancelled
// Map<downloadId, { cancelled: boolean, currentReq: http.ClientRequest | null, currentProc: ChildProcess | null }>
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
  if (typeof extra === "string") return extra;
  try {
    return JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}

function appendDownloadLog(level, scope, message, extra = null) {
  try {
    ensureVelvetDir();
    ensureDownloadsLogDir();
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

    // Show off-screen (not show:false) — avoids headless detection by vidsrc
    const hidden = new BrowserWindow({
      x: -9999,
      y: -9999,
      width: 1280,
      height: 720,
      show: true,
      frame: false,
      skipTaskbar: true,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        javascript: true,
      },
    });

    let resolved = false;
    let mp4Candidate = null;
    let timer = null;
    let sawAnyRequest = false;
    let sawMediaResponse = false;
    let finishLoad = false;
    let failLoad = null;
    let lastObservedUrl = "";
    let clickInterval = null;

    function resolveWith(url) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(clickInterval);
      logDownload("resolve", "Resolved playable stream URL.", {
        streamType: url.includes(".m3u8") ? "hls" : "mp4",
        url,
      });
      setTimeout(() => { try { hidden.destroy(); } catch {} }, 500);
      resolve({ streamUrl: url, streamType: url.includes(".m3u8") ? "hls" : "mp4" });
    }

    function rejectWith(err) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(clickInterval);
      errorDownload("resolve", err.message);
      setTimeout(() => { try { hidden.destroy(); } catch {} }, 500);
      reject(err);
    }

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
          logDownload("resolve", "Detected HLS manifest request.", { url: u });
          resolveWith(u);
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

    hidden.webContents.on("did-finish-load", () => {
      finishLoad = true;
      logDownload("resolve", "Embed page finished loading.");
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
    });

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
  const job = activeSegmentJobs.get(downloadId);
  if (job) {
    warnDownload("job", "Cancelling download job.", { downloadId });
    job.cancelled = true;
    try { job.currentReq?.destroy(); } catch {}
    try { job.currentProc?.kill(); } catch {}
  }
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

function parseExternalDownloaderLine(line, previous = {}) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;

  const update = {};

  const fragMatch = trimmed.match(/\(frag\s+(\d+)\/(\d+)\)/i);
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

  return {
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : null,
    totalBytes: resolvedTotal,
    eta,
    speed,
    status,
    percent,
  };
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
      currentReq: null,
      currentProc: null,
    };
    job.currentProc = proc;
    activeSegmentJobs.set(downloadId, job);

    let stdoutBuffer = "";
    let stderrBuffer = "";
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
        completedFragments: update.completedFragments ?? parserState.completedFragments ?? null,
        totalFragments: update.totalFragments ?? parserState.totalFragments ?? null,
        message: update.message || "",
        outputPath: update.outputPath || parserState.outputPath || null,
      });
    };

    const consumeLine = (line, source) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      if (source === "stderr") {
        warnDownload("external", "External downloader stderr.", { downloadId, line: trimmed });
      } else {
        logDownload("external", "External downloader stdout.", { downloadId, line: trimmed });
      }

      const update = parseExternalDownloaderLine(trimmed, parserState);
      if (!update) return;
      parserState = { ...parserState, ...update };
      emitProgress(update);
    };

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const parts = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = parts.pop() || "";
      parts.forEach((line) => consumeLine(line, "stdout"));
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      text.split(/\r?\n/).forEach((line) => consumeLine(line, "stderr"));
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

      if (job.cancelled || signal) {
        warnDownload("external", "External downloader cancelled.", { downloadId, code, signal });
        event.sender.send("downloads-cancelled", { downloadId });
        return;
      }

      if (code === 0) {
        const resolvedOutputPath =
          parserState.outputPath ||
          findLatestVideoFile(downloadPath, safeTitle) ||
          outputPath;
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
        String(stderrBuffer || "")
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

ipcMain.handle("download-run-ytdlp", async (event, { downloadId, sourceUrl, outputPath, referer = "", title = "" }) => {
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

    const refererUrl = referer || "https://vidsrc-embed.ru/";
    let originUrl = "https://vidsrc-embed.ru";
    try {
      originUrl = new NodeURL(refererUrl).origin;
    } catch {}

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
      "--add-headers", `Origin:${originUrl}`,
      "--add-headers", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-o", outputPath,
      sourceUrl,
    ];

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

    const job = activeSegmentJobs.get(downloadId) || { cancelled: false, currentReq: null, currentProc: null };
    job.currentProc = proc;
    activeSegmentJobs.set(downloadId, job);

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

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
      const text = chunk.toString();
      stderrBuffer += text;
      text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
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

      const cancelled = job.cancelled || signal === "SIGTERM" || signal === "SIGKILL";
      job.currentProc = null;

      if (cancelled) {
        warnDownload("ytdlp", "yt-dlp download cancelled.", { downloadId, signal });
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

      const stderr = stderrBuffer.trim();
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
    // Delete final MP4
    if (entry.outputPath && fs.existsSync(entry.outputPath)) {
      fs.unlinkSync(entry.outputPath);
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
    }
    // Delete segments dir if it still exists
    if (entry.segmentsDir && fs.existsSync(entry.segmentsDir)) {
      fs.rmSync(entry.segmentsDir, { recursive: true, force: true });
    }
    // Delete state file
    if (entry.id) {
      const statePath = path.join(getVelvetVideosDir(), ".states", `${entry.id}.json`);
      if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    }
    // Try to remove the title folder if now empty
    if (entry.outputPath) {
      const folder = path.dirname(entry.outputPath);
      if (fs.existsSync(folder)) {
        const remaining = fs.readdirSync(folder).filter((f) => !f.startsWith("."));
        if (remaining.length === 0) {
          fs.rmSync(folder, { recursive: true, force: true });
        }
      }
    }
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
