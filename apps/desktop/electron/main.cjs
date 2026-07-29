/**
 * LOLCallout — packaged app entry
 * Spawns local API + Agent, loads built UI, desktop protocol for magic-link auth.
 */
const { app, BrowserWindow, shell, dialog, nativeImage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const children = [];
const PROTOCOL = "lolcallout";

let mainWindow = null;
let staticServer = null;
let bootPorts = { apiPort: "8787", agentPort: "3847", uiPort: 5179 };

/** Single instance so magic-link opens the existing window */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function resourcePath(...parts) {
  if (isDev) {
    return path.join(__dirname, "..", ...parts);
  }
  return path.join(process.resourcesPath, ...parts);
}

function appIcon() {
  // Single brand mark everywhere — same as lolcallout.com / logo-circle.png
  const candidates = [
    path.join(__dirname, "..", "build", "icon.ico"),
    resourcePath("ui", "logo-circle.png"),
    path.join(__dirname, "..", "public", "logo-circle.png"),
    path.join(__dirname, "..", "build", "icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const out = {};
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

function spawnNodeScript(scriptPath, envExtra, name) {
  const env = {
    ...process.env,
    ...envExtra,
    ELECTRON_RUN_AS_NODE: "1",
  };
  // Clear Electron-only flags that can confuse Node ESM boots
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  const logDir = path.join(app.getPath("userData"), "logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const logPath = path.join(logDir, `${name}.log`);
  const child = spawn(process.execPath, [scriptPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    cwd: path.dirname(scriptPath),
  });
  const append = (chunk) => {
    const line = chunk.toString();
    console.log(`[${name}]`, line.trim());
    try {
      fs.appendFileSync(logPath, line);
    } catch {
      /* ignore */
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code) => {
    console.log(`[${name}] exited`, code);
    try {
      fs.appendFileSync(logPath, `\n[exit ${code}]\n`);
    } catch {
      /* ignore */
    }
  });
  children.push(child);
  return child;
}

/** True if something already answers HTTP on this URL (healthy leftover from prior run). */
function httpOk(url, timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Listen on preferred port; if EADDRINUSE, bind OS-assigned free port.
 * Never throws uncaught — resolves with the port actually bound.
 */
function listenPreferPort(server, preferred, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const finish = (port) => {
      const addr = server.address();
      const bound =
        typeof addr === "object" && addr && typeof addr.port === "number"
          ? addr.port
          : port;
      resolve(bound);
    };

    const onError = (err) => {
      server.off("error", onError);
      if (err && err.code === "EADDRINUSE") {
        // Preferred busy (stale LOLCallout / second copy) — take any free port
        server.once("error", reject);
        server.listen(0, host, () => finish(0));
        return;
      }
      reject(err);
    };

    server.once("error", onError);
    server.listen(preferred, host, () => {
      server.off("error", onError);
      finish(preferred);
    });
  });
}

async function startBackend() {
  const rootEnv = loadEnvFile(
    isDev ? path.join(__dirname, "../../../.env") : resourcePath("playtest.env")
  );
  const userEnv = loadEnvFile(path.join(app.getPath("userData"), "playtest.env"));
  const envFile = { ...rootEnv, ...userEnv };

  const apiPort = envFile.API_PORT || "8787";
  const agentPort = envFile.AGENT_PORT || "3847";
  const uiPort = 5179;
  bootPorts = { apiPort, agentPort, uiPort };

  const apiEntry = isDev
    ? path.join(__dirname, "../../api/dist/index.js")
    : resourcePath("server", "api", "index.js");
  const agentEntry = isDev
    ? path.join(__dirname, "../../agent/dist/index.js")
    : resourcePath("server", "agent", "index.js");

  if (!fs.existsSync(apiEntry) || !fs.existsSync(agentEntry)) {
    dialog.showErrorBox(
      "LOLCallout",
      "Server files missing. Reinstall the app or contact support.\n\n" +
        apiEntry +
        "\n" +
        agentEntry
    );
    return bootPorts;
  }

  const nodePath = isDev
    ? path.join(__dirname, "../../../node_modules")
    : resourcePath("server", "node_modules");

  const dataDir = path.join(app.getPath("userData"), "data");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* ignore */
  }

  // Desktop auth: magic links complete inside the app (or via lolcallout:// protocol)
  // CORS allows any localhost UI port (UI may fall back if 5179 is busy)
  const common = {
    ...envFile,
    API_PORT: String(apiPort),
    API_HOST: "127.0.0.1",
    AGENT_PORT: String(agentPort),
    AGENT_HOST: "127.0.0.1",
    AGENT_USE_MOCK: envFile.AGENT_USE_MOCK || "false",
    API_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    AUTH_APP_URL: `${PROTOCOL}://auth`,
    AUTH_DEV_RETURN_LINK: "1",
    CORS_ORIGIN: `http://127.0.0.1:${uiPort}`,
    CORS_ALLOW_LOCALHOST: "1",
    DATA_DIR: dataDir,
    NODE_PATH: nodePath,
  };

  // Reuse healthy leftovers instead of crashing with EADDRINUSE
  const apiHealthy = await httpOk(`http://127.0.0.1:${apiPort}/health`);
  if (apiHealthy) {
    console.log(`[boot] reusing local API on :${apiPort}`);
  } else {
    spawnNodeScript(apiEntry, common, "api");
  }

  const agentHealthy = await httpOk(`http://127.0.0.1:${agentPort}/health`);
  if (agentHealthy) {
    console.log(`[boot] reusing local agent on :${agentPort}`);
  } else {
    spawnNodeScript(agentEntry, common, "agent");
  }

  return bootPorts;
}

function startUiStaticServer(uiDir, preferredPort) {
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
  };
  staticServer = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.join(uiDir, urlPath.replace(/^\//, ""));
      if (!filePath.startsWith(uiDir) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500);
      res.end("error");
    }
  });
  return listenPreferPort(staticServer, preferredPort, "127.0.0.1");
}

/** Optional cloud API (billing / website). Desktop auth + coach use local API. */
const CLOUD_API =
  process.env.LOL_CLOUD_API_URL ||
  "https://lolcallout-production.up.railway.app";

function uiLoadUrl(extraHash) {
  const { agentPort, uiPort, apiPort } = bootPorts;
  // Secure accounts + coach live on the cloud account API.
  // Live Client agent stays on this PC. Local API is still spawned as a helper.
  const localApi = `http://127.0.0.1:${apiPort}`;
  const qs = new URLSearchParams({
    api: CLOUD_API,
    authApi: CLOUD_API,
    cloudApi: CLOUD_API,
    localApi,
    agent: `http://127.0.0.1:${agentPort}`,
  });
  let url = `http://127.0.0.1:${uiPort}/?${qs.toString()}`;
  if (extraHash) {
    url += `#${extraHash.replace(/^#/, "")}`;
  }
  return url;
}

function waitForHttp(url, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 150);
      });
      req.setTimeout(800, () => {
        req.destroy();
      });
    };
    tick();
  });
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function applyAuthFromProtocolUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return;
  try {
    // lolcallout://auth#auth_token=...  or  lolcallout://auth?token=...
    const normalized = rawUrl.replace(`${PROTOCOL}://`, "http://dummy/");
    const u = new URL(normalized);
    let token =
      u.searchParams.get("token") ||
      u.searchParams.get("auth_token") ||
      "";
    if (!token && u.hash) {
      const m = u.hash.match(/auth_token=([^&]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (!token) return;
    focusMainWindow();
    if (mainWindow) {
      void mainWindow.loadURL(uiLoadUrl(`auth_token=${encodeURIComponent(token)}`));
    }
  } catch (e) {
    console.error("[auth protocol]", e);
  }
}

function loadWindowBounds() {
  try {
    const p = path.join(app.getPath("userData"), "window-bounds.json");
    if (!fs.existsSync(p)) return null;
    const b = JSON.parse(fs.readFileSync(p, "utf8"));
    if (
      b &&
      Number(b.width) >= 900 &&
      Number(b.height) >= 600 &&
      Number.isFinite(b.x) &&
      Number.isFinite(b.y)
    ) {
      return {
        width: Math.round(b.width),
        height: Math.round(b.height),
        x: Math.round(b.x),
        y: Math.round(b.y),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const b = mainWindow.getBounds();
    const p = path.join(app.getPath("userData"), "window-bounds.json");
    fs.writeFileSync(p, JSON.stringify(b), "utf8");
  } catch {
    /* ignore */
  }
}

async function createWindow() {
  const icon = appIcon();
  const saved = loadWindowBounds();
  // Default: full coach layout size (not a tiny phone-style panel)
  mainWindow = new BrowserWindow({
    width: saved?.width || 1280,
    height: saved?.height || 860,
    minWidth: 980,
    minHeight: 640,
    x: saved?.x,
    y: saved?.y,
    title: "LOLCallout",
    autoHideMenuBar: true,
    alwaysOnTop: false,
    backgroundColor: "#080b12",
    show: false,
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // Compact second-monitor mode can re-enable always-on-top from UI later if needed
  mainWindow.on("close", () => saveWindowBounds());
  mainWindow.on("resize", () => {
    if (!mainWindow.isMaximized()) saveWindowBounds();
  });
  mainWindow.on("move", () => {
    if (!mainWindow.isMaximized()) saveWindowBounds();
  });

  // Show window immediately (splash/login) — don't wait for backends
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  const uiDir = isDev ? path.join(__dirname, "..", "dist") : resourcePath("ui");
  try {
    const bound = await startUiStaticServer(uiDir, bootPorts.uiPort);
    if (bound !== bootPorts.uiPort) {
      console.warn(`[boot] UI port ${bootPorts.uiPort} busy — using ${bound}`);
    }
    bootPorts.uiPort = bound;
  } catch (e) {
    console.error("[boot] UI static server failed", e);
    dialog.showErrorBox(
      "LOLCallout",
      "Could not start the local UI server.\n\n" +
        "Close every LOLCallout window (check Task Manager), then reopen the app.\n\n" +
        String(e && e.message ? e.message : e)
    );
  }

  // Load UI once — do NOT reload when API comes up (that wiped sign-in mid-flow)
  mainWindow.loadURL(uiLoadUrl());

  const apiHealth = `http://127.0.0.1:${bootPorts.apiPort}/health`;
  void waitForHttp(apiHealth, 25000).then((ok) => {
    if (!ok) console.warn("[boot] API health check timed out — UI still open");
    else console.log("[boot] API ready");
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    // Keep magic-link verify inside app when possible
    if (openUrl.startsWith("http://127.0.0.1") || openUrl.startsWith("http://localhost")) {
      void mainWindow.loadURL(openUrl);
      return { action: "deny" };
    }
    if (openUrl.startsWith(`${PROTOCOL}://`)) {
      applyAuthFromProtocolUrl(openUrl);
      return { action: "deny" };
    }
    shell.openExternal(openUrl);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (navUrl.startsWith(`${PROTOCOL}://`)) {
      event.preventDefault();
      applyAuthFromProtocolUrl(navUrl);
    }
  });
}

function killChildren() {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  if (staticServer) {
    try {
      staticServer.close();
    } catch {
      /* ignore */
    }
  }
}

// Protocol for magic-link email → open this app
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

app.on("second-instance", (_event, argv) => {
  const proto = argv.find((a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`));
  if (proto) applyAuthFromProtocolUrl(proto);
  focusMainWindow();
});

// macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  applyAuthFromProtocolUrl(url);
});

app.whenReady().then(async () => {
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:openExternal", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return true;
    }
    return false;
  });
  ipcMain.handle("app:setAlwaysOnTop", (_e, on) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(Boolean(on), Boolean(on) ? "screen-saver" : undefined);
    }
    return true;
  });

  try {
    await startBackend();
    await createWindow();
  } catch (e) {
    console.error("[boot] failed", e);
    dialog.showErrorBox(
      "LOLCallout",
      "Startup failed.\n\nClose every LOLCallout in Task Manager, then try again.\n\n" +
        String(e && e.message ? e.message : e)
    );
  }

  // Windows: protocol URL may be in process.argv on first launch
  const proto = process.argv.find(
    (a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`)
  );
  if (proto) {
    // Wait briefly for window
    setTimeout(() => applyAuthFromProtocolUrl(proto), 400);
  }
});

app.on("window-all-closed", () => {
  killChildren();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killChildren();
});
