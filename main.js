const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 5000;

// In a packaged app, __dirname is inside app.asar which cannot be read by
// Node's require(). asarUnpack puts app/dist/ in app.asar.unpacked/ so the
// server bundle can actually be loaded as a real file.
function getAppDir() {
  const insideAsar = __dirname.includes('app.asar') && !__dirname.includes('app.asar.unpacked');
  if (insideAsar) {
    return __dirname.replace('app.asar', 'app.asar.unpacked');
  }
  return __dirname;
}

const APP_DIR    = path.join(getAppDir(), 'app');
const SERVER_ENTRY = path.join(APP_DIR, 'dist', 'index.cjs');
const WASM_DIR   = path.join(APP_DIR, 'dist');

let mainWindow = null;
let serverStarted = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDataDir() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

/**
 * Poll localhost:PORT until it responds or we time out.
 */
function waitForServer(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function attempt() {
      const req = http.get(`http://127.0.0.1:${port}/api/organizations`, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
      req.end();
    }

    attempt();
  });
}

// ─── Start Express server in-process ─────────────────────────────────────────

function startServer() {
  if (serverStarted) return;
  serverStarted = true;

  if (!fs.existsSync(SERVER_ENTRY)) {
    dialog.showErrorBox(
      'TimeTrack – Missing Build',
      `Could not find the server bundle at:\n${SERVER_ENTRY}\n\nThe installation may be corrupted. Please reinstall.`
    );
    app.quit();
    return;
  }

  const dataDir = getDataDir();
  const dbPath  = path.join(dataDir, 'timetracker.db');

  // Set env vars BEFORE requiring the bundle — the server reads them at startup
  process.env.NODE_ENV        = 'production';
  process.env.PORT            = String(PORT);
  process.env.DB_PATH         = dbPath;
  process.env.SQLJS_WASM_PATH = WASM_DIR;

  try {
    // Run the Express server bundle inside this process.
    // Because it uses a self-executing async IIFE it starts immediately.
    // No child process — no spawn loop, no missing node binary.
    require(SERVER_ENTRY);
    console.log('[main] server bundle loaded');
  } catch (err) {
    dialog.showErrorBox('TimeTrack – Startup Error', `Failed to load server:\n${err.message}`);
    app.quit();
  }
}

// ─── Create window ────────────────────────────────────────────────────────────

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'TimeTrack',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f1623',
    show: false,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Show a loading screen while the server warms up
  const loadingHtml = `
    <html>
      <head>
        <style>
          body {
            margin: 0; display: flex; align-items: center; justify-content: center;
            height: 100vh; background: #0f1623; font-family: system-ui, sans-serif;
            color: #94a3b8; flex-direction: column; gap: 16px;
          }
          .spinner {
            width: 40px; height: 40px; border: 3px solid #1e293b;
            border-top-color: #0e7490; border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          p { font-size: 14px; letter-spacing: 0.05em; }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <p>Starting TimeTrack…</p>
      </body>
    </html>`;

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml));
  mainWindow.show();

  try {
    await waitForServer(PORT);
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  } catch (err) {
    dialog.showErrorBox('TimeTrack – Startup Failed', err.message);
    app.quit();
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Enforce single instance — if a second instance is launched, focus the first
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
