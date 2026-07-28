/**
 * Optional always-on-top companion shell.
 * Run: npx electron electron-main.cjs
 * (with Vite already on http://127.0.0.1:5173)
 */
const { app, BrowserWindow } = require("electron");

const START_URL = process.env.LOLCALLOUT_URL || "http://127.0.0.1:5173";

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    title: "LOLCallout",
    autoHideMenuBar: true,
    alwaysOnTop: true,
    backgroundColor: "#0b0f1a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.loadURL(START_URL);

  // IPC-less: user can toggle via menu later
  win.webContents.on("did-finish-load", () => {
    win.setTitle("LOLCallout — Companion");
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
