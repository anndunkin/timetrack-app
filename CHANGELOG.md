# Changelog

## [1.3.3] — 2026-06-06

### Fixed
- Export Report dialog is now scrollable on small screens; the content area scrolls while the header and action buttons (Cancel / Open PDF) stay pinned, so the buttons no longer disappear off the bottom of the screen.

All notable changes to TimeTrack are documented here.

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
