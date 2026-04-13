# TimeTrack — Windows Installer Build

This folder contains everything needed to produce a Windows `.exe` installer for TimeTrack.

## Prerequisites (on your Windows machine)

| Tool | Version | Download |
|------|---------|----------|
| Node.js | Any version 18+ | https://nodejs.org |

> **No Visual Studio, no Python, no C++ build tools required.**
> TimeTrack uses `sql.js` (SQLite compiled to WebAssembly) — a 100% pure JavaScript
> database driver with no native compilation whatsoever.

---

## Build the installer

Open **Command Prompt** or **PowerShell** in this folder, then run:

```bat
npm install
npm run make
```

When the build finishes you'll find the installer at:

```
dist-electron\TimeTrack Setup 1.0.0.exe
```

Double-click it to install TimeTrack on any Windows 10/11 x64 machine.
The installer creates Desktop and Start Menu shortcuts.

---

## What `npm run make` does

1. **`npm run build-app`** — installs the app's dependencies and runs the Vite + esbuild production build, producing `app/dist/index.cjs`, `app/dist/sql-wasm.wasm`, and `app/dist/public/`.
2. **`electron-builder --win --x64`** — packages Electron + the compiled app into an NSIS installer `.exe`.

> The first run takes a few minutes because Electron (~90 MB) is downloaded.
> No native modules are compiled at any point.

---

## Quick start without building the installer (dev mode)

```bat
npm install
npm run build-app
npm start
```

This launches Electron directly, which opens a window loading the app.

---

## Where data is stored

TimeTrack stores its SQLite database at:

```
%APPDATA%\TimeTrack\data\timetracker.db
```

This location persists through app updates. The uninstaller intentionally does **not** delete your data.

---

## Installer features

- Custom install directory (user can choose where to install)
- Creates a **Desktop shortcut** and **Start Menu shortcut**
- x64 only (Windows 10 / 11)
- Uninstall available from Add/Remove Programs

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `electron-builder` download fails | Re-run `npm run make` — transient download issue |
| Port 5000 already in use | Set `PORT=5001` as an environment variable before launching |
| App shows "Missing Build" error | Run `npm run build-app` manually and check for errors |
| Build fails with "module not found" | Delete `app/node_modules` and re-run `npm run make` |

---

## Project layout

```
timetracker-electron/
├── electron/
│   └── main.js          ← Electron main process
├── app/                 ← Full TimeTrack source (Express + React)
│   ├── server/          ← Express + sql.js storage layer
│   ├── client/          ← React + Vite frontend
│   ├── shared/          ← Shared types and schemas
│   └── package.json
├── build/
│   └── icon.ico         ← App icon (multi-resolution)
├── package.json         ← Electron + electron-builder config
└── README.md
```

## Tech stack

- **Electron 33** — desktop wrapper
- **Express 5** — HTTP server (runs inside Electron as a child process)
- **sql.js** — SQLite via WebAssembly (zero native dependencies)
- **React 18 + Vite** — frontend UI
- **electron-builder** — NSIS installer packaging
