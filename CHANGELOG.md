# Changelog

All notable changes to TimeTrack are documented here.

---

## [1.2.2] — 2026-05-09

### Fixed
- **Windows shortcut activation collision with Expense Track** — TimeTrack would steal a fresh launch of Expense Track and bring its own window to the foreground instead. Root cause: TimeTrack called `app.requestSingleInstanceLock()` without first setting an explicit `AppUserModelID`, so Windows could not reliably distinguish TimeTrack from another Electron app at activation time and routed the second launch into TimeTrack's running instance.

### Changed
- `main.js` now calls `app.setAppUserModelId('com.timetrack.app')` on Windows before `requestSingleInstanceLock()`. This scopes the instance lock to TimeTrack only and ensures Windows treats TimeTrack as a distinct application for taskbar grouping, jump-list, and shortcut routing.
- The matching change has shipped in Expense Track 1.0.3 (`com.expensetrack.app`). Both apps must be on these versions or later for the fix to be complete.

---
