# Changelog

All notable changes to TimeTrack are documented here.

## [1.4.1] — 2026-10-15

### Fixed
- **Log Time date default now follows the entry you just logged.** In 1.4.0, after saving a new entry the form reset to the date of the *previous* entry rather than the one just saved (the reset ran before the entry list refreshed), and the default used the latest calendar date across all entries rather than the most recently logged entry — so back-dating an entry never became the new default. The form now carries forward the date of the entry just saved, and on load it uses the date of the most recently logged entry (falling back to today when there are none). Editing an existing entry still shows that entry's own date.

### Validation
- Browser reproduction (Playwright): with entries on Oct 1 and Oct 5, logging Oct 8 then Sep 20 now leaves the form on Oct 8 then Sep 20, and Sep 20 persists after reload (previously Oct 5, Oct 8, Oct 8).
- `tsc` clean; `npm run build` passes; full test suite 163/163 (109 functionality + 54 security).

---

## [1.4.0] — 2026-08-16

### Added
- **About TimeTrack dialog** — a new Help ▸ About TimeTrack menu item opens a native dialog showing the app name, current version (read from `app.getVersion()`, never hard-coded), a short description, and the bundled Electron / Chromium / Node runtime versions.

### Changed
- **Log Time now defaults the date to your most recent entry's date** — when adding a new entry, the date field is seeded from the latest existing entry (even if that date isn't today) instead of always defaulting to today, so logging several entries for a past day no longer requires re-picking the date each time. Falls back to today when there are no entries, never overrides a date you've already changed, and does not affect editing an existing entry.

### Fixed
- **Report Project Breakdown row overlap** — when a project's department subtitle wrapped onto multiple lines, the next project's title was drawn on top of it. Rows now measure their wrapped label height and expand dynamically so titles and subtitles never collide. The Department Breakdown (wrapping titles) is handled by the same measurement logic.

### Validation
- `npm run check` (tsc) is clean and `npm run build` passes from `app/`.
- Full test suite: 163/163 passed (109 functionality + 54 security).
- Report fix verified visually by generating a report with multi-line wrapped department subtitles.

---

## [1.3.4] — 2026-08-13

### Changed
- **Full dependency modernization** — upgraded the desktop shell to Electron 43.4.0 and electron-builder 26.15.3; upgraded the bundled REST/Express app to current stable direct dependencies, including React 19, Vite 8, Tailwind CSS 4, TypeScript 7, Zod 4, Express 5.2, sql.js 1.14, current Radix UI primitives, and current React ecosystem libraries.
- Updated the Tailwind/Vite integration and migrated component/form compatibility code for the corresponding API and type changes.
- The documented development prerequisite is now Node.js 22.12 or later, which satisfies the current Electron and Vite toolchain engines.

### Security
- Retained the root lockfile overrides `keyv@4.5.4` and `cacheable-request@7.0.4`.

### Validation
- `npm run check` and `npm run build` pass from `app/`.

---

## [1.3.3] — 2026-06-06

### Fixed
- Export Report dialog is now scrollable on small screens; the content area scrolls while the header and action buttons (Cancel / Open PDF) stay pinned, so the buttons no longer disappear off the bottom of the screen.


---

## [1.3.2] — 2026-06-06

### Added
- **Confirm before deleting a time entry (and recurring task) to prevent accidental data loss.** Deleting a time entry from the **History** page or the **Log Time** recent-entries list, and deleting a **recurring task**, now open a confirmation dialog instead of deleting immediately on the first click. The dialog warns the deletion is permanent; a destructive **Delete permanently** button confirms and **Cancel** aborts. This reuses the existing shadcn `AlertDialog` pattern already used on the Database page, for visual/UX consistency.
  - Purely a client-side UX change — the `DELETE /api/time-entries/:id` and `DELETE /api/recurring/:id` endpoints are unchanged. A targeted delete still removes only the requested id, re-deleting a missing id is an idempotent `404`, and non-integer ids are rejected (verified by new regression tests).
  - Manual verification: clicking a trash button opens the dialog and does **not** delete until **Delete permanently** is clicked; **Cancel** closes the dialog with the entry intact; only one dialog is open at a time.

---

## [1.3.1] — 2026-06-05

### Added
- **PDF reports for any custom date range** — the Export Report dialog now offers a **Monthly** / **Custom range** toggle. In custom-range mode you pick an explicit start and end date, so reports are no longer limited to a calendar month (1st → end of month). Any inclusive range works, including ranges that span multiple months or a full quarter/year.
  - Custom reports render the date range in the header (e.g. `Time Report · January 5, 2026 – February 12, 2026`) and use a `TimeTrack-<org>-<start>_to_<end>.pdf` filename. Monthly reports are unchanged.
  - API: `POST /api/report/monthly` (and the new alias `POST /api/report`) accepts either `{ orgId, year, month, fields, timeFormat }` (monthly, backward-compatible) **or** `{ orgId, start, end, fields, timeFormat }` (custom range, ISO `YYYY-MM-DD`). When `start`/`end` are present they take precedence.
  - Security/validation: `start`/`end` must be strict, real `YYYY-MM-DD` dates with `start <= end` (else `400`); the storage query remains fully parameterized, so injection probes in the date fields are rejected at validation and never reach SQL.
- 157/157 tests passing.

---

## [1.3.0] — 2026-06-03

### Added
- **Edit any time entry from a new History page** — a dedicated History page lets you browse and manage every recorded entry, not just the most recent ones.
  - Date-range filter (start/end) plus pagination and a running total-count display, so large datasets stay navigable.
  - **Edit** and **Delete** actions on *every* entry, not only the recent ones surfaced on the main view.
  - Editing reuses the existing inline edit form via a `/?edit=<id>` deep link, giving a single, consistent editing experience.
  - New paginated API: `GET /api/time-entries?page=&pageSize=[&start=&end=]`. Responses remain backward-compatible plain arrays, so existing callers continue to work unchanged.
  - Security hardening: parameterized SQL (no string interpolation), bounded pagination limits, and re-validation of incoming data against the schema.
- 138/138 tests passing.

---

## [1.2.2] — 2026-05-09

### Fixed
- **Windows shortcut activation collision with Expense Track** — TimeTrack would steal a fresh launch of Expense Track and bring its own window to the foreground instead. Root cause: TimeTrack called `app.requestSingleInstanceLock()` without first setting an explicit `AppUserModelID`, so Windows could not reliably distinguish TimeTrack from another Electron app at activation time and routed the second launch into TimeTrack's running instance.

### Changed
- `main.js` now calls `app.setAppUserModelId('com.timetrack.app')` on Windows before `requestSingleInstanceLock()`. This scopes the instance lock to TimeTrack only and ensures Windows treats TimeTrack as a distinct application for taskbar grouping, jump-list, and shortcut routing.
- The matching change has shipped in Expense Track 1.0.3 (`com.expensetrack.app`). Both apps must be on these versions or later for the fix to be complete.

---
