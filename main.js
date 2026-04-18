const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 5000;

function getAppDir() {
  const insideAsar = __dirname.includes('app.asar') && !__dirname.includes('app.asar.unpacked');
  if (insideAsar) return __dirname.replace('app.asar', 'app.asar.unpacked');
  return __dirname;
}

const APP_DIR      = path.join(getAppDir(), 'app');
const SERVER_ENTRY = path.join(APP_DIR, 'dist', 'index.cjs');
const WASM_DIR     = path.join(APP_DIR, 'dist');

let mainWindow = null;
let serverStarted = false;

// ─── Data directory & file registry ──────────────────────────────────────────

function getDataDir() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

const REGISTRY_PATH = () => path.join(app.getPath('userData'), 'files.json');

/**
 * The file registry is a JSON array of { name, path } objects stored at
 * %APPDATA%\TimeTrack\files.json. The first entry is always the active file.
 */
function readRegistry() {
  try {
    if (fs.existsSync(REGISTRY_PATH())) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH(), 'utf8'));
    }
  } catch (_) {}
  return [];
}

function writeRegistry(entries) {
  fs.writeFileSync(REGISTRY_PATH(), JSON.stringify(entries, null, 2));
}

/**
 * Ensure the default file exists in the registry. Called on first launch.
 */
function ensureDefaultFile() {
  const registry = readRegistry();
  if (registry.length === 0) {
    const defaultPath = path.join(getDataDir(), 'timetracker.db');
    const defaultEntry = { name: 'Default', path: defaultPath };
    writeRegistry([defaultEntry]);
    return defaultEntry;
  }
  return registry[0]; // active file is always first
}

// ─── Server startup ───────────────────────────────────────────────────────────

function waitForServer(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      const req = http.get(`http://127.0.0.1:${port}/api/organizations`, () => resolve());
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

function startServer(dbPath) {
  if (serverStarted) return;
  serverStarted = true;

  if (!fs.existsSync(SERVER_ENTRY)) {
    dialog.showErrorBox('TimeTrack – Missing Build',
      `Could not find the server bundle at:\n${SERVER_ENTRY}\n\nThe installation may be corrupted. Please reinstall.`);
    app.quit();
    return;
  }

  process.env.NODE_ENV        = 'production';
  process.env.PORT            = String(PORT);
  process.env.DB_PATH         = dbPath;
  process.env.SQLJS_WASM_PATH = WASM_DIR;

  try {
    require(SERVER_ENTRY);
    console.log('[main] server bundle loaded, db:', dbPath);
  } catch (err) {
    dialog.showErrorBox('TimeTrack – Startup Error', `Failed to load server:\n${err.message}`);
    app.quit();
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

/**
 * GET /ipc/files — return the registry array
 * The active file is always registry[0].
 */
ipcMain.handle('files:list', () => readRegistry());

/**
 * Switch the active database to an existing registry entry by path.
 * Moves the chosen entry to index 0, then asks the server to reload.
 */
ipcMain.handle('files:switch', async (_event, filePath) => {
  const registry = readRegistry();
  const idx = registry.findIndex(f => f.path === filePath);
  if (idx === -1) return { error: 'File not found in registry' };

  // Move chosen entry to front (= active)
  const [chosen] = registry.splice(idx, 1);
  registry.unshift(chosen);
  writeRegistry(registry);

  // Tell the server to switch databases
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }
  return { ok: true, active: chosen };
});

/**
 * Create a new database file.
 * Shows a native folder-picker dialog, then creates the .db file.
 */
ipcMain.handle('files:new', async (_event, name) => {
  if (!name || !name.trim()) return { error: 'Name is required' };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder for new file',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const folder   = result.filePaths[0];
  // Sanitise name for use as filename
  const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  const filePath = path.join(folder, `${safeName}.db`);

  if (fs.existsSync(filePath)) {
    return { error: `A file named "${safeName}.db" already exists in that folder.` };
  }

  // Register first so the server knows about it
  const registry = readRegistry();
  const entry = { name: name.trim(), path: filePath };
  registry.unshift(entry); // new file becomes active
  writeRegistry(registry);

  // Ask the server to switch (it will create the file on first write)
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }

  return { ok: true, active: entry };
});

/**
 * Open an existing .db file not yet in the registry.
 */
ipcMain.handle('files:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open TimeTrack database',
    filters: [{ name: 'TimeTrack Database', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const filePath = result.filePaths[0];
  const registry = readRegistry();

  // If already known, just switch to it
  const existing = registry.find(f => f.path === filePath);
  if (existing) {
    const idx = registry.indexOf(existing);
    registry.splice(idx, 1);
    registry.unshift(existing);
    writeRegistry(registry);
  } else {
    // Derive a display name from the filename
    const name = path.basename(filePath, '.db');
    const entry = { name, path: filePath };
    registry.unshift(entry);
    writeRegistry(registry);
  }

  const active = registry[0];

  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }

  return { ok: true, active };
});

// ─── Window ───────────────────────────────────────────────────────────────────

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
      preload: path.join(getAppDir(), 'preload.js'),
    },
    backgroundColor: '#0f1623',
    show: false,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Loading screen
  const loadingHtml = `<html><head><style>
    body{margin:0;display:flex;align-items:center;justify-content:center;
    height:100vh;background:#0f1623;font-family:system-ui,sans-serif;
    color:#94a3b8;flex-direction:column;gap:16px;}
    .spinner{width:40px;height:40px;border:3px solid #1e293b;
    border-top-color:#0e7490;border-radius:50%;animation:spin .8s linear infinite;}
    @keyframes spin{to{transform:rotate(360deg);}}
    p{font-size:14px;letter-spacing:.05em;}
  </style></head><body>
    <div class="spinner"></div><p>Starting TimeTrack\u2026</p>
  </body></html>`;

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
    const activeFile = ensureDefaultFile();
    startServer(activeFile.path);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
