# TimeTrack v1.2.0 Release Notes

**Released:** April 24, 2026  
**Platform:** Windows x64  
**Tag:** [`v1.2.0`](https://github.com/anndunkin/timetrack-app/releases/tag/v1.2.0)

---

## sql.js (WebAssembly SQLite) Architecture

TimeTrack uses **sql.js** — a pure WebAssembly port of SQLite — instead of native binaries. This eliminates all platform-specific compiled modules and removes the need for node-gyp, build tools, or native compilation on the target machine.

**How it works:**

- The WASM file (`sql-wasm.wasm`) is bundled via `asarUnpack` so it is accessible outside the ASAR archive at runtime
- The database is loaded entirely into memory by sql.js; writes are debounced and flushed to disk automatically (max 500ms delay)
- **DB path:** `%APPDATA%\TimeTrack\data\timetracker.db`
- **File registry:** `%APPDATA%\TimeTrack\files.json` — array of `{ name, path }` entries; first entry is the active file
- Multiple `.db` files can be created, opened, and switched between via the native **File** menu at runtime without restarting the app

---

## Dependency Upgrades

| Package | Before | After | Reason |
|---|---|---|---|
| `electron` | 33.4.11 | **36.9.5** | HIGH severity CVE — ASAR integrity bypass |
| `electron-builder` | 25.1.8 | **26.8.1** | HIGH severity CVEs in tar, cacache, xmldom, node-gyp |
| `postcss` | 8.5.9 | **8.5.10** | MODERATE CVE — XSS via unescaped `</style>` in CSS output |

---

## Security Changes

### HTTP Security Headers
Three headers are now set on every API response:

- **`Content-Security-Policy`** — restricts scripts and styles to `self`, blocks all external resource loads and inline injection via external sources
- **`X-Content-Type-Options: nosniff`** — prevents MIME-type sniffing attacks
- **`X-Frame-Options: DENY`** — prevents iframe embedding and clickjacking

### Path Traversal Validation
The `/api/files/switch` and `/api/files/save-as` routes now validate all incoming paths before passing them to the storage layer:

- Path must end in `.db`
- Path must not contain `../` or `./` traversal sequences
- Empty or non-string values are rejected with HTTP 400

### Removed Unused Dependencies
Five packages that were listed as dependencies but never imported or used have been removed. Unused dependencies increase the attack surface and slow installs with no benefit.

| Removed | Notes |
|---|---|
| `passport` | Authentication framework — not used in this local-only app |
| `passport-local` | Local auth strategy — not used |
| `express-session` | Session middleware — not used |
| `memorystore` | Session store — not used |
| `ws` | WebSocket server — not used |

---

## Bug Fixes

- **Recurring tasks — duplicate entry on create:** When saving a new recurring task, `createMut` (manual entry) and `createRecurMut` (recurring template) were both fired. Since `runDueRecurrences` already inserts an entry for the start date, this produced a duplicate. The manual `createMut` call has been removed from the recurring task creation path.

- **Weekly view — multi-line description layout:** Entry rows with multi-line descriptions (e.g. recurring tasks with `\n` in the description field) caused the department name and time columns to overlap the description text. The row layout was changed from `items-center` to `items-start`, description is now in its own `<p>` element with `whitespace-pre-line` and `line-clamp-2`, and the time/color-dot are pinned to the top edge.

---

## Acknowledged Non-Issue

One `npm audit` finding remains after all upgrades:

> **HIGH** — AppleScript injection in `app.moveToApplicationsFolder` (Electron ≤39.8.4)

This is a **macOS-only** API call. TimeTrack is a Windows-only application and does not invoke `app.moveToApplicationsFolder` anywhere in its code. Resolving this would require upgrading to Electron 41 (a major version with breaking API changes) for no practical security benefit on Windows.

---

## Testing

All changes were verified against a live Express server before release:

- All API routes (CRUD for orgs, depts, projects, time entries, recurring tasks, settings)
- Path validation — traversal attempts and non-`.db` paths correctly rejected
- Security headers — confirmed present on all responses
- TypeScript compilation — zero errors after dependency removal
- Full build and NSIS installer generation — successful
