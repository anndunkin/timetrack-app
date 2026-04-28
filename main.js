const { app, BrowserWindow, shell, dialog, ipcMain, Menu } = require('electron');
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

// ─── Native application menu ──────────────────────────────────────────────────

/**
 * Build and set the native Electron application menu.
 * Called on startup and whenever the file registry changes.
 */
function buildMenu() {
  const registry = readRegistry();
  const active = registry[0];

  // File submenu items: one per known file (checkmark on active), then actions
  const fileItems = [];

  if (registry.length > 0) {
    registry.forEach(f => {
      fileItems.push({
        label: f.name,
        type: 'checkbox',
        checked: active && f.path === active.path,
        click: async () => {
          if (active && f.path === active.path) return; // already active
          await doSwitch(f.path);
        },
      });
    });
    fileItems.push({ type: 'separator' });
  }

  fileItems.push({
    label: 'New File…',
    accelerator: 'CmdOrCtrl+N',
    click: async () => {
      await doNewFile();
    },
  });

  fileItems.push({
    label: 'Open File…',
    accelerator: 'CmdOrCtrl+O',
    click: async () => {
      await doOpenFile();
    },
  });

  fileItems.push({
    label: 'Save As…',
    accelerator: 'CmdOrCtrl+Shift+S',
    click: async () => {
      await doSaveAs();
    },
  });

  fileItems.push({ type: 'separator' });

  fileItems.push({
    label: 'Exit',
    accelerator: 'Alt+F4',
    click: () => app.quit(),
  });

  const template = [
    {
      label: 'File',
      submenu: fileItems,
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── File operation helpers (shared by IPC handlers and native menu) ──────────

/**
 * Switch to an existing file by path. Updates registry, tells server, notifies renderer.
 */
async function doSwitch(filePath) {
  const registry = readRegistry();
  const idx = registry.findIndex(f => f.path === filePath);
  if (idx === -1) return { error: 'File not found in registry' };

  const [chosen] = registry.splice(idx, 1);
  registry.unshift(chosen);
  writeRegistry(registry);

  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }

  buildMenu(); // refresh checkmarks
  notifyRenderer();
  return { ok: true, active: chosen };
}

/**
 * Prompt for a name then a folder, create a new DB entry.
 */
async function doNewFile() {
  if (!mainWindow) return { error: 'No window' };

  // Ask for a name via an input dialog (Electron has no built-in text prompt,
  // so we use a small browser-side dialog via IPC instead — see preload)
  const nameResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Create New TimeTrack Database',
    defaultPath: path.join(app.getPath('documents'), 'timetracker.db'),
    filters: [{ name: 'TimeTrack Database', extensions: ['db'] }],
    buttonLabel: 'Create',
  });

  if (nameResult.canceled || !nameResult.filePath) return { canceled: true };

  const filePath = nameResult.filePath.endsWith('.db')
    ? nameResult.filePath
    : nameResult.filePath + '.db';

  if (fs.existsSync(filePath)) {
    dialog.showErrorBox('TimeTrack', `File already exists:\n${filePath}`);
    return { error: 'File already exists' };
  }

  // Derive display name from filename
  const name = path.basename(filePath, '.db');
  const entry = { name, path: filePath };

  const registry = readRegistry();
  registry.unshift(entry);
  writeRegistry(registry);

  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }

  buildMenu();
  notifyRenderer();
  return { ok: true, active: entry };
}

/**
 * Show an open-file dialog and switch to the chosen .db.
 */
async function doOpenFile() {
  if (!mainWindow) return { error: 'No window' };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open TimeTrack Database',
    filters: [{ name: 'TimeTrack Database', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const filePath = result.filePaths[0];
  const registry = readRegistry();

  const existing = registry.find(f => f.path === filePath);
  if (existing) {
    const idx = registry.indexOf(existing);
    registry.splice(idx, 1);
    registry.unshift(existing);
    writeRegistry(registry);
  } else {
    const name = path.basename(filePath, '.db');
    const entry = { name, path: filePath };
    registry.unshift(entry);
    writeRegistry(registry);
  }

  const active = readRegistry()[0];

  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }

  buildMenu();
  notifyRenderer();
  return { ok: true, active };
}

/**
 * Save a copy of the current database to a user-chosen path, then switch to it.
 * The Save dialog opens pre-seeded in the current file's folder with its name,
 * so the user only needs to change what they want to change.
 */
async function doSaveAs() {
  if (!mainWindow) return { error: 'No window' };

  const registry = readRegistry();
  const active = registry[0];
  if (!active) return { error: 'No active file' };

  // Pre-seed the dialog at the active file's folder and name so the user
  // starts from the current location.
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Database As',
    defaultPath: active.path,          // opens the dialog in the active file's folder
    filters: [{ name: 'TimeTrack Database', extensions: ['db'] }],
    buttonLabel: 'Save As',
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const newPath = result.filePath.endsWith('.db')
    ? result.filePath
    : result.filePath + '.db';

  // Don't allow saving over the same file — that would be a no-op save, not Save As
  if (newPath === active.path) {
    dialog.showErrorBox('TimeTrack', 'The destination is the same as the current file.\nChoose a different name or folder.');
    return { error: 'Same path' };
  }

  // Ask the server to copy+switch
  try {
    const resp = await fetch(`http://127.0.0.1:${PORT}/api/files/save-as`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: newPath }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { error: body.error ?? 'Save As failed' };
    }
  } catch (err) {
    return { error: err.message };
  }

  // Update registry: add the new entry at the front (as active),
  // keeping the original entry intact further down the list.
  const name = path.basename(newPath, '.db');
  const newEntry = { name, path: newPath };
  const existing = registry.find(f => f.path === newPath);
  if (!existing) {
    registry.unshift(newEntry);
  } else {
    // Already in list — just move it to front
    const idx = registry.indexOf(existing);
    registry.splice(idx, 1);
    registry.unshift(existing);
  }
  writeRegistry(registry);

  buildMenu();
  notifyRenderer();
  return { ok: true, active: newEntry };
}

/**
 * Tell the renderer to clear its query cache and reload data.
 */
function notifyRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('files:reloaded', readRegistry());
  }
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

/** Return the registry array (active file is always index 0). */
ipcMain.handle('files:list', () => readRegistry());

/** Switch active database to an existing registry entry by path. */
ipcMain.handle('files:switch', async (_event, filePath) => doSwitch(filePath));

/**
 * Create a new database file.
 * name parameter comes from the renderer's NewFileDialog.
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
  const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  const filePath = path.join(folder, `${safeName}.db`);

  if (fs.existsSync(filePath)) {
    return { error: `A file named "${safeName}.db" already exists in that folder.` };
  }

  const registry = readRegistry();
  const entry = { name: name.trim(), path: filePath };
  registry.unshift(entry);
  writeRegistry(registry);

  try {
    await fetch(`http://127.0.0.1:${PORT}/api/files/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  } catch (err) {
    return { error: err.message };
  }

  buildMenu();
  notifyRenderer();
  return { ok: true, active: entry };
});

/** Open an existing .db file not yet in the registry. */
ipcMain.handle('files:open', async () => doOpenFile());

/** Save a copy of the current database to a new path and switch to it. */
ipcMain.handle('files:saveas', async () => doSaveAs());

/**
 * Export all data for a single organization to a new .db file.
 * Shows a native Save dialog, then calls the server export route.
 */
ipcMain.handle('orgs:export', async (_event, orgId) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Organization Data',
    defaultPath: path.join(app.getPath('documents'), 'timetrack-export.db'),
    filters: [{ name: 'TimeTrack Database', extensions: ['db'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const destPath = result.filePath.endsWith('.db')
    ? result.filePath
    : result.filePath + '.db';

  try {
    console.log('[orgs:export] destPath:', destPath);
    const resp = await fetch(`http://127.0.0.1:${PORT}/api/organizations/${orgId}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: destPath }),
    });
    const body = await resp.json().catch(() => ({}));
    console.log('[orgs:export] server response:', resp.status, JSON.stringify(body));
    if (!resp.ok) {
      return { error: body.error ?? 'Export failed' };
    }
    return { ok: true, path: destPath };
  } catch (err) {
    console.error('[orgs:export] fetch error:', err);
    return { error: err.message };
  }
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
      // __dirname in the main process always points to the app root — correct for preload
      preload: path.join(__dirname, 'preload.js'),
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
    // Fire any recurring tasks that were missed since the last launch.
    // We await this so all back-filled entries exist before the page loads.
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/recurring/run`, { method: 'POST' });
    } catch (_) {}
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
    buildMenu(); // set up native File menu before window opens
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
