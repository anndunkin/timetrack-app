# TimeTrack

A Windows desktop time-tracking application built with Electron, Express, and React.

---

## Features

- **Organizations → Departments → Projects** hierarchy
- **Multi-department time entries** — log a single task against multiple departments; time is split equally across them in all reports
- **Live timer** — start/stop a running timer on the Log Time page, then click "Use Time" to copy the elapsed time into the entry form
- **Edit any entry** — the **History** page lists *all* time entries with date-range filtering and pagination, so you're no longer limited to the recent entries on the Log Time page. Click the pencil on any entry (however old) to open it in the same edit form used for recent entries
- **Weekly view** — day-by-day breakdown with per-project summary sidebar
- **Annual summary** — monthly bar chart, by-org/dept/project breakdowns, average per week and per month (both calculated over elapsed periods, not the full year)
- **Budget tracking** — set optional budget hours per project; over-budget projects are highlighted
- **Custom fiscal year** — configure any start month and day in Settings
- **Multi-file support** — create, open, and switch between database files at runtime via the native **File** menu
- **Persistent local database** — SQLite file stored at `%APPDATA%\TimeTrack\data\timetracker.db` by default, survives app updates and uninstalls
- **Single-instance** — launching a second copy focuses the existing window

---

## Prerequisites (Windows)

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18 or later | https://nodejs.org |

> **No Visual Studio, no Python, no C++ build tools required.**
> TimeTrack uses `sql.js` (SQLite compiled to WebAssembly) — a 100% pure JavaScript
> database driver with zero native compilation. See [Why sql.js?](#why-sqljs) below.

---

## Build the installer

Open **Command Prompt** or **PowerShell** in this folder and run:

```bat
npm install
npm run make
```

The installer will be produced at:

```
dist-electron\TimeTrack Setup 1.1.0.exe
```

Double-click it to install on any Windows 10 / 11 x64 machine. The installer creates Desktop and Start Menu shortcuts.

> The first run downloads Electron (~115 MB) and NSIS tools and may take several minutes.
> No native modules are compiled at any point.

---

## Releasing

Releases are built automatically by the **Release Windows Installer** GitHub Actions workflow
(`.github/workflows/release.yml`), which runs on `windows-latest`.

1. **Bump the version and update the changelog.**
   - Update `"version"` in `package.json` (and `app/package.json` for consistency).
   - Add a new section to `CHANGELOG.md` describing the release.
2. **Push a `vX.Y.Z` tag** to trigger the workflow:
   ```bash
   git tag v1.3.0
   git push origin v1.3.0
   ```
   The workflow runs `npm run make`, uploads the installer as a build artifact, and — because
   the trigger is a tag — attaches the `.exe` to the GitHub Release for that tag.
   You can also run it manually from the **Actions** tab via **workflow_dispatch** (this still
   produces a build artifact, but does not create a Release).
3. **For a SIGNED installer**, add two repository secrets (Settings → Secrets and variables →
   Actions):
   - `WINDOWS_CERT_BASE64` — your code-signing certificate (`.pfx`) encoded as base64, e.g.
     `base64 -w0 cert.pfx` (Linux/macOS) or
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` (PowerShell).
   - `WINDOWS_CERT_PASSWORD` — the password for that `.pfx`.

   When these secrets are present the workflow decodes the certificate, sets electron-builder's
   `CSC_LINK` / `CSC_KEY_PASSWORD`, and produces a **signed** installer. When they are absent the
   workflow builds an **unsigned** installer (electron-builder skips signing when `CSC_LINK` is
   unset, and `forceCodeSigning` stays `false`).

---

## ⚠️ Known build pitfalls

### OneDrive / paths with spaces

If your project folder lives under OneDrive — or any path that contains a space — `electron-builder` will fail during the NSIS packaging step with a cryptic path error. The workaround is to **move the project to a path with no spaces** before building:

```bat
C:\dev\timetracker-electron\   ✓  safe
C:\Users\Ann Dunkin\source\    ✗  space in "Ann Dunkin" will break the build
C:\Users\Ann\OneDrive\source\  ✗  may also contain spaces in the OneDrive path
```

To relocate quickly, copy the folder (excluding `node_modules` and `dist-electron`) to `C:\dev\` or similar, then run `npm install && npm run make` from the new location.

### Node.js version

TimeTrack was developed and tested on **Node.js v24**. The bundled Electron runtime ships its own Node (v20), so the host Node version does not affect the installed app — only the build tooling.

### "index.js does not exist" / asar entry point error

This error appears when `electron-builder` picks up the wrong `package.json` as the app manifest. It is caused by setting `directories.app` to a sub-folder (e.g. `app/`). The fix already in place is:

```json
"directories": {
  "output": "dist-electron",
  "app": "."
}
```

`"app": "."` tells electron-builder to treat the repo root as the application directory, so `main.js` at the root is correctly used as the Electron entry point.

### Preload script not found in production

Electron's `preload` path must use `__dirname` (the main process's own directory), **not** a helper like `getAppDir()` that redirects to `app.asar.unpacked`. Inside a packaged asar, `__dirname` in the main process correctly resolves to the asar root where `preload.js` lives.

```js
// ✓ correct
preload: path.join(__dirname, 'preload.js')

// ✗ wrong — preload.js is not in app.asar.unpacked
preload: path.join(getAppDir(), 'preload.js')
```

### Multiple app instances on launch

Electron spawns additional instances if the server is started as a child process, because each child process triggers another `app.ready` event chain. The fix already in place is to **load the server bundle in-process**:

```js
// ✓ correct — server runs inside the Electron main process
require(SERVER_ENTRY);

// ✗ wrong — causes spawn loop
const child = require('child_process').spawn('node', [SERVER_ENTRY]);
```

A single-instance lock (`app.requestSingleInstanceLock()`) is also in place to focus the existing window if a second launch is attempted.

### `better-sqlite3` / native module errors

These errors occur if `better-sqlite3` (or any native `.node` module) is present in the dependency tree. TimeTrack exclusively uses `sql.js`, which is pure JavaScript. If you see a native module error, check that `better-sqlite3` has not been added as a dependency. See [Why sql.js?](#why-sqljs) for background.

---

## Why sql.js?

TimeTrack originally used `better-sqlite3`, the most common SQLite binding for Node.js. While performant, it is a **native addon** — it compiles C++ code during `npm install` and the resulting `.node` binary must exactly match the Node/Electron ABI for the target platform.

This caused several problems in an Electron context:

- `electron-rebuild` was required after every `npm install` to recompile the addon against Electron's bundled Node ABI
- The recompiled binary had to be excluded from asar packaging and placed in `app.asar.unpacked` to be loadable at runtime
- Any mismatch in ABI (e.g. host Node vs. Electron's Node) produced a cryptic `MODULE_NOT_FOUND` or `invalid ELF header` error

**`sql.js`** solves all of this by shipping SQLite compiled to WebAssembly. There is no native compilation, no ABI to match, and no `electron-rebuild` step. The only requirement is that the `.wasm` file is accessible at runtime:

```
app/dist/sql-wasm.wasm   ← copied here by the build script
```

The WASM path is passed to the server via the `SQLJS_WASM_PATH` environment variable, set in `main.js` before the server bundle is loaded.

The trade-off is that `sql.js` loads the entire database into memory on open and flushes it to disk on write (rather than memory-mapping the file). For a personal time-tracking tool this is negligible — the database rarely exceeds a few hundred kilobytes.

---

## How `npm run make` works

1. **`npm run build-app`** — installs the app's Node dependencies (`app/`), then runs:
   - **Vite** to bundle the React frontend → `app/dist/public/`
   - **esbuild** to bundle the Express server → `app/dist/index.cjs`
   - Copies `sql-wasm.wasm` into `app/dist/` alongside the server bundle
2. **`electron-builder --win --x64`** — packages Electron + the compiled app into an NSIS `.exe` installer

The `asarUnpack` setting in `package.json` ensures `app/dist/**/*` (including the WASM file) is extracted from the asar archive so the server can read it at runtime:

```json
"asarUnpack": ["app/dist/**/*"]
```

---

## Development (no installer)

To run the app directly without building an installer:

```bat
npm install
npm run build-app
npm start
```

This launches Electron, which loads the app in a native window. Live reload is not supported in this mode; re-run `npm run build-app` after changing server or client code.

---

## File menu (multi-file support)

The native **File** menu in the application menu bar (top of the window) provides:

| Item | Shortcut | Description |
|------|----------|-------------|
| *(file name)* | — | Switch to a known database file (checkmark shows active) |
| New File… | Ctrl+N | Opens a Save dialog — choose name and folder for a new `.db` |
| Open File… | Ctrl+O | Opens an existing `.db` file and adds it to the known files list |
| Exit | Alt+F4 | Quit the application |

The list of known files is stored in `%APPDATA%\TimeTrack\files.json`. The first entry is always the active file. Switching files reloads all in-app data automatically.

---

## Data storage

| Path | Contents |
|------|----------|
| `%APPDATA%\TimeTrack\data\timetracker.db` | Default SQLite database |
| `%APPDATA%\TimeTrack\files.json` | Registry of known database files (active file is index 0) |

To open the data folder quickly, paste into Windows Run (`Win + R`) or File Explorer:

```
%APPDATA%\TimeTrack
```

The uninstaller intentionally does **not** delete your data. Both files are preserved across updates and uninstalls.

---

## Data model

| Entity | Key fields |
|--------|-----------|
| Organization | id, name, color |
| Department | id, organizationId, name |
| Project | id, name, departmentIds (array), budgetHours, color |
| Time Entry | id, date, minutes, organizationId, departmentIds (array), projectId, description |

A project can belong to multiple departments. A time entry records one or more departments; when multiple departments are selected, time is divided equally across them in all summary calculations.

---

## Project layout

```
timetracker-electron/
├── main.js              ← Electron main process: loads server in-process, opens BrowserWindow,
│                          builds native File menu, handles IPC for file registry
├── preload.js           ← contextBridge: exposes timetrackFiles API to renderer
├── build/
│   └── icon.ico         ← App icon (multi-resolution)
├── app/
│   ├── server/
│   │   ├── index.ts     ← Express app entry (initialises DB, registers routes)
│   │   ├── routes.ts    ← REST API route handlers + /api/files/switch
│   │   └── storage.ts   ← sql.js storage layer, DB migrations, switchDb()
│   ├── client/
│   │   └── src/
│   │       ├── pages/   ← TimeEntryPage, HistoryPage, WeeklyPage, AnnualPage, AdminPage, SettingsPage
│   │       ├── lib/     ← queryClient, files.ts (IPC bridge), utils.ts (date helpers)
│   │       └── components/
│   ├── shared/
│   │   └── schema.ts    ← TypeScript types + Zod schemas (shared by client & server)
│   ├── script/
│   │   └── build.ts     ← Vite + esbuild build script; copies sql-wasm.wasm
│   └── package.json
├── package.json         ← Electron + electron-builder config
└── README.md
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop wrapper | Electron 33 |
| HTTP server | Express 5 (runs in-process inside Electron main) |
| Database | sql.js (SQLite via WebAssembly — no native deps) |
| Frontend | React 18 + Vite 7 |
| UI components | shadcn/ui + Tailwind CSS 3 |
| Data fetching | TanStack Query 5 |
| Routing | wouter 3 (hash routing) |
| Validation | Zod |
| Installer | electron-builder (NSIS) |

---

## Installer features

- Custom install directory
- Desktop shortcut + Start Menu shortcut
- x64 only (Windows 10 / 11)
- Uninstall via Add/Remove Programs (data is preserved)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Build fails with path/space error | Move project to a path with no spaces (e.g. `C:\dev\timetracker-electron`) — see [OneDrive / paths with spaces](#onedrive--paths-with-spaces) |
| `electron-builder` download fails | Re-run `npm run make` — transient network issue |
| Port 5000 already in use | Set `PORT=5001` as an environment variable before launching |
| App shows "Missing Build" error | Run `npm run build-app` manually and check for errors |
| Build fails with "module not found" | Delete `app/node_modules` and re-run `npm run make` |
| App window is blank after install | Check `%APPDATA%\TimeTrack\data` exists and is writable |
| Native module / ABI errors | Ensure `better-sqlite3` is not in the dependency tree; TimeTrack uses `sql.js` only |
| Multiple windows open on launch | Ensure the server is loaded via `require(SERVER_ENTRY)`, not spawned as a child process |

---

## Version history

| Tag | Description |
|-----|-------------|
| v1.3.0 | **History page** — browse, filter (by date range), paginate, and edit *any* time entry, not just recent ones; paginated `GET /api/time-entries?page=&pageSize=` endpoint |
| v1.1.0 | Multi-file support — native File menu (top menu bar) with create/open/switch; fix preload path bug; fix Annual dept list truncation |
| v1.0 / v1.0.0 | Initial stable release — core time tracking, multi-dept entries, live timer, weekly/annual summaries, timezone-safe date handling |
