const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Window controls ──
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  toggleFullscreen: () => ipcRenderer.send("window-toggle-fullscreen"),
  close: () => ipcRenderer.send("window-close"),
  isFullscreen: () => ipcRenderer.invoke("window-is-fullscreen"),

  // ── Data bridges ──
  getNetflixTop10Cache: () => ipcRenderer.invoke("netflix-top10-cache"),
  mangadexJson: (url) => ipcRenderer.invoke("mangadex-json", url),
  configureDiscordPresence: (options) => ipcRenderer.invoke("discord-presence-configure", options),
  setDiscordActivity: (payload) => ipcRenderer.invoke("discord-presence-set-activity", payload),
  clearDiscordActivity: () => ipcRenderer.invoke("discord-presence-clear"),
  getDiscordPresenceStatus: () => ipcRenderer.invoke("discord-presence-status"),
  onDiscordPresenceStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("discord-presence-status", listener);
    return () => ipcRenderer.removeListener("discord-presence-status", listener);
  },

  // ── Window state events ──
  onFullscreenChanged: (callback) => {
    const listener = (_event, isFullscreen) => callback(isFullscreen);
    ipcRenderer.on("window-fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("window-fullscreen-changed", listener);
  },

  // ── Downloads: stream resolution ──
  resolveStream: (embedUrl) => ipcRenderer.invoke("download-resolve-stream", embedUrl),
  onM3u8Found: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("m3u8-found", listener);
    return () => ipcRenderer.removeListener("m3u8-found", listener);
  },
  onMp4Found: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("mp4-found", listener);
    return () => ipcRenderer.removeListener("mp4-found", listener);
  },
  onPlayerPlaybackState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("player-playback-state", listener);
    return () => ipcRenderer.removeListener("player-playback-state", listener);
  },
  fetchManifest: (m3u8Url) => ipcRenderer.invoke("download-fetch-manifest", m3u8Url),

  // ── Downloads: segment downloader ──
  downloadSegment: (opts) => ipcRenderer.invoke("download-segment", opts),
  registerDownloadJob: (id) => ipcRenderer.send("download-job-register", id),
  unregisterDownloadJob: (id) => ipcRenderer.send("download-job-unregister", id),
  cancelDownload: (id) => ipcRenderer.send("download-cancel", id),

  // ── Downloads: assembly ──
  assembleDownload: (opts) => ipcRenderer.invoke("download-assemble", opts),
  runYtDlpDownload: (opts) => ipcRenderer.invoke("download-run-ytdlp", opts),

  // ── Downloads: state persistence ──
  saveDownloadState: (state) => ipcRenderer.invoke("download-save-state", state),
  loadDownloadState: (id) => ipcRenderer.invoke("download-load-state", id),
  deleteDownloadState: (id) => ipcRenderer.invoke("download-delete-state", id),
  listPendingStates: () => ipcRenderer.invoke("download-list-pending-states"),

  // ── Downloads: manifest ──
  loadDownloads: () => ipcRenderer.invoke("downloads-load"),
  saveDownloads: (manifest) => ipcRenderer.invoke("downloads-save", manifest),
  deleteDownload: (entry) => ipcRenderer.invoke("download-delete", entry),

  // ── Downloads: utility ──
  getDownloadsDir: () => ipcRenderer.invoke("downloads-get-dir"),
  getDownloadsLogPath: () => ipcRenderer.invoke("downloads-get-log-path"),
  checkFfmpeg: () => ipcRenderer.invoke("downloads-check-ffmpeg"),
  checkExternalDownloader: (folderPath) => ipcRenderer.invoke("downloads-check-external-tool", folderPath),
  getBundledExternalDownloader: () => ipcRenderer.invoke("downloads-get-bundled-external-tool"),
  runExternalDownload: (opts) => ipcRenderer.invoke("downloads-run-external", opts),
  pickFolder: () => ipcRenderer.invoke("downloads-pick-folder"),
  showInFolder: (filePath) => ipcRenderer.invoke("downloads-show-in-folder", filePath),
  getLocalVideoUrl: (filePath) => ipcRenderer.invoke("downloads-local-video-url", filePath),
  findSubtitleForVideo: (filePath) => ipcRenderer.invoke("downloads-find-subtitle", filePath),
  logDownload: (payload) => ipcRenderer.send("downloads-log", payload),
  onDownloadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("downloads-progress", listener);
    return () => ipcRenderer.removeListener("downloads-progress", listener);
  },
  onDownloadComplete: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("downloads-complete", listener);
    return () => ipcRenderer.removeListener("downloads-complete", listener);
  },
  onDownloadError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("downloads-error", listener);
    return () => ipcRenderer.removeListener("downloads-error", listener);
  },
  onDownloadCancelled: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("downloads-cancelled", listener);
    return () => ipcRenderer.removeListener("downloads-cancelled", listener);
  },
});
