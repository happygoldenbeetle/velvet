const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Window controls ──
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  toggleFullscreen: () => ipcRenderer.send("window-toggle-fullscreen"),
  close: () => ipcRenderer.send("window-close"),

  // ── Data bridges ──
  getNetflixTop10Cache: () => ipcRenderer.invoke("netflix-top10-cache"),
  mangadexJson: (url) => ipcRenderer.invoke("mangadex-json", url),

  // ── Window state events ──
  onFullscreenChanged: (callback) => {
    const listener = (_event, isFullscreen) => callback(isFullscreen);
    ipcRenderer.on("window-fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("window-fullscreen-changed", listener);
  },

  // ── Downloads: stream resolution ──
  resolveStream: (embedUrl) => ipcRenderer.invoke("download-resolve-stream", embedUrl),
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
