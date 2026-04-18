# TimeTrack

A Windows desktop time-tracking application built with Electron, Express, and React.

---

## Features

- **Organizations → Departments → Projects** hierarchy
- **Multi-department time entries** — log a single task against multiple departments; time is split equally across them in all reports
- **Live timer** — start/stop a running timer on the Log Time page, then click "Use Time" to copy the elapsed time into the entry form
- **Weekly view** — day-by-day breakdown with per-project summary sidebar
- **Annual summary** — monthly bar chart, by-org/dept/project breakdowns, average per week and per month (both calculated over elapsed periods, not the full year)
- **Budget tracking** — set optional budget hours per project; over-budget projects are highlighted
- **Custom fiscal year** — configure any start month and day in Settings
- **Persistent local database** — SQLite file stored at `%APPDATA%\TimeTrack\data\timetracker.db`, survives app updates and uninstalls
- **Single-instance** — launching a second copy focuses the existing window

---

## Prerequisites (Windows)

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18 or later | https://nodejs.org |

> **No Visual Studio, no Python, no C++ build tools required.**
> TimeTrack uses `sql.js` (SQLite compiled to WebAssembly) — a 100% pure JavaScript
> database driver with zero native compilation.

---

## Build the installer

Open **Command Prompt** or **PowerShell** in this folder and run:

```bat
npm install
npm run make
```

The installer will be produced at:

```
dist-electron\TimeTrack Setup 1.0.0.exe
```

Double-click it to install on any Windows 10 / 11 x64 machine. The installer creates Desktop and Start Menu shortcuts.

> The first run downloads Electron (~90 MB) and may take a few minutes.
> No native modules are compiled at any point.

---

## Development (no installer)

To run the app directly without building an installer:

```bat
npm install
npm run build-app
npm start
```

This launches Electron, which loads the app in a native window.

---

## How `npm run make` works

1. **`npm run build-app`** — installs the app's Node dependencies, then runs:
   - **Vite** to bundle the React frontend → `app/dist/public/`
   - **esbuild** to bundle the Express server → `app/dist/index.cjs`
   - Copies `sql-wasm.wasm` into `app/dist/` alongside the server bundle
2. **`electron-builder --win --x64`** — packages Electron + the compiled app into an NSIS `.exe` installer

---

## Data storage

TimeTrack stores its SQLite database at:

```
%APPDATA%\TimeTrack\data\timetracker.db
```

To open this folder quickly, paste the following into Windows Run (`Win + R`) or File Explorer:

```
%APPDATA%\TimeTrack\data
```

The uninstaller intentionally does **not** delete your data. The database is preserved across updates.

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
├── main.js              ← Electron main process (loads server in-process, opens BrowserWindow)
├── build/
│   └── icon.ico         ← App icon (multi-resolution)
├── app/                 ← Full TimeTrack source (Express + React)
│   ├── server/
│   │   ├── index.ts     ← Express app entry point (initialises DB, registers routes)
│   │   ├── routes.ts    ← REST API route handlers
│   │   └── storage.ts   ← sql.js storage layer + DB migrations
│   ├── client/
│   │   └── src/
│   │       ├── pages/   ← TimeEntryPage, WeeklyPage, AnnualPage, AdminPage, SettingsPage
│   │       ├── lib/     ← utils.ts (date helpers, formatters)
│   │       └── components/
│   ├── shared/
│   │   └── schema.ts    ← TypeScript types + Zod validation schemas (shared by client & server)
│   ├── script/
│   │   └── build.ts     ← Custom Vite + esbuild build script
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
- Uninstall via Add/Remove Programs

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `electron-builder` download fails | Re-run `npm run make` — transient network issue |
| Port 5000 already in use | Set `PORT=5001` as an environment variable before launching |
| App shows "Missing Build" error | Run `npm run build-app` manually and check for errors |
| Build fails with "module not found" | Delete `app/node_modules` and re-run `npm run make` |
| App window is blank after install | Check `%APPDATA%\TimeTrack\data` exists and is writable |

---

## Version history

| Tag | Description |
|-----|-------------|
| v1.1.0 | Multi-file support — File menu in sidebar, create/open/switch database files at runtime; fix Annual dept list truncation |
| v1.0 / v1.0.0 | Initial stable release — core time tracking, multi-dept entries, live timer, weekly/annual summaries, timezone-safe date handling |
