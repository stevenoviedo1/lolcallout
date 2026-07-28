/**
 * LOLCallout — packaged app entry
 * Spawns local API + Agent using Electron as Node, loads built UI.
 */
const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const children = [];

function resourcePath(...parts) {
  if (isDev) {
    return path.join(__dirname, "..", ...parts);
  }
  return path.join(process.resourcesPath, ...parts);
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
  const child = spawn(process.execPath, [scriptPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (d) => console.log(`[${name}]`, d.toString().trim()));
  child.stderr.on("data", (d) => console.error(`[${name}]`, d.toString().trim()));
  child.on("exit", (code) => console.log(`[${name}] exited`, code));
  children.push(child);
  return child;
}

function startBackend() {
  const rootEnv = loadEnvFile(
    isDev
      ? path.join(__dirname, "../../../.env")
      : resourcePath("playtest.env")
  );
  const userEnv = loadEnvFile(path.join(app.getPath("userData"), "playtest.env"));
  const envFile = { ...rootEnv, ...userEnv };

  const apiPort = envFile.API_PORT || "8787";
  const agentPort = envFile.AGENT_PORT || "3847";
  const uiPort = 5179;

  // Prefer packaged server bundles
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
    return { apiPort, agentPort };
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

  const common = {
    ...envFile,
    API_PORT: String(apiPort),
    API_HOST: "127.0.0.1",
    AGENT_PORT: String(agentPort),
    AGENT_HOST: "127.0.0.1",
    AGENT_USE_MOCK: envFile.AGENT_USE_MOCK || "false",
    API_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    AUTH_APP_URL: `http://127.0.0.1:${uiPort}`,
    AUTH_DEV_RETURN_LINK: envFile.AUTH_DEV_RETURN_LINK || "1",
    CORS_ORIGIN: `http://127.0.0.1:${uiPort}`,
    DATA_DIR: dataDir,
    NODE_PATH: nodePath,
  };

  spawnNodeScript(apiEntry, common, "api");
  spawnNodeScript(agentEntry, common, "agent");

  return { apiPort, agentPort, uiPort };
}

let mainWindow = null;
let staticServer = null;

function startUiStaticServer(uiDir, port) {
  const http = require("http");
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
  staticServer.listen(port, "127.0.0.1");
}

function createWindow(apiPort, uiPort) {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 720,
    minWidth: 340,
    minHeight: 480,
    title: "LOLCallout",
    autoHideMenuBar: true,
    alwaysOnTop: true,
    backgroundColor: "#080b12",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      // Allow coach callouts without requiring a click every time
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");

  const uiDir = isDev
    ? path.join(__dirname, "..", "dist")
    : resourcePath("ui");

  startUiStaticServer(uiDir, uiPort);

  // Inject API/agent URLs via query so config can read them
  const url = `http://127.0.0.1:${uiPort}/?api=http://127.0.0.1:${apiPort}&agent=http://127.0.0.1:3847`;
  // Wait for servers to boot
  setTimeout(() => {
    mainWindow.loadURL(url);
  }, 1200);

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    shell.openExternal(openUrl);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  const { apiPort, uiPort } = startBackend();
  createWindow(apiPort, uiPort || 5179);
});

app.on("window-all-closed", () => {
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
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
});
