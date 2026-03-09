import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPort = Number(process.env.PORT || 4317);
const serverUrl = `http://127.0.0.1:${serverPort}`;
let serverProcess = null;

function resolveRuntimeRoot() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "..");
  }

  const unpackedRoot = path.join(process.resourcesPath, "app.asar.unpacked");
  if (fs.existsSync(unpackedRoot)) {
    return unpackedRoot;
  }

  return path.join(process.resourcesPath, "app.asar");
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return true;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function ensureServer() {
  const existing = await waitForServer(serverUrl, 1200);
  if (existing) {
    return;
  }

  const runtimeRoot = resolveRuntimeRoot();
  const serverEntry = path.join(runtimeRoot, "server", "server.mjs");

  serverProcess = spawn(
    process.execPath,
    [serverEntry],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(serverPort),
      },
      stdio: "inherit",
    },
  );

  const ready = await waitForServer(serverUrl);
  if (!ready) {
    throw new Error("desktop_server_start_timeout");
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 1360,
    minHeight: 760,
    title: "OpenClaw Agent Team Control",
    backgroundColor: "#f3f6fb",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.loadURL(serverUrl);
}

app.whenReady().then(async () => {
  await ensureServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
});
