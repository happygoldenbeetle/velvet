const { app, ipcMain, BrowserWindow } = require("electron");

const handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  handlers.set(channel, listener);
  return originalHandle(channel, listener);
};

require("./main.js");

async function main() {
  await app.whenReady();

  const resolveHandler = handlers.get("download-resolve-stream");
  if (!resolveHandler) {
    throw new Error("download-resolve-stream handler not found");
  }

  const embedUrl = "https://vidsrc-embed.ru/embed/tv?tmdb=127529&season=1&episode=1";
  console.log("[Probe] Resolving:", embedUrl);

  try {
    const result = await resolveHandler({}, embedUrl);
    console.log("[Probe] Success:", result);
  } catch (error) {
    console.error("[Probe] Failure:", error.message);
  } finally {
    BrowserWindow.getAllWindows().forEach((win) => {
      try { win.destroy(); } catch {}
    });
    setTimeout(() => app.quit(), 500);
  }
}

main().catch((error) => {
  console.error("[Probe] Fatal:", error);
  setTimeout(() => app.exit(1), 500);
});
