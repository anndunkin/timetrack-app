# TimeTrack v1.2.1 — Release Notes

**Release date:** April 27, 2026
**Platform:** Windows (Native Installer, .exe)
**Tag:** `v1.2.1`

---

## Overview

v1.2.1 is a focused security hardening and correctness release. No new user-facing features were introduced. All changes address issues discovered during a comprehensive 107-test automated security and functionality audit conducted prior to this release.

---

## Security Fixes

### Strengthened Windows Path Validation
The file-switch, save-as, and org-export routes now explicitly block paths containing Windows system directories in addition to the existing path-traversal checks:

- `C:\Windows\system32` and variations
- `C:\Windows\`
- `C:\Program Files` / `C:\ProgramData`

Previously, only Unix-style traversal sequences (`../`) were detected; Windows absolute paths to protected directories were not blocked.

### DELETE Routes Now Return 404 for Missing Resources
All DELETE endpoints (`/api/organizations/:id`, `/api/departments/:id`, `/api/projects/:id`, `/api/time-entries/:id`, `/api/recurring/:id`) now return `HTTP 404` when the requested resource does not exist. Previously, deleting a nonexistent ID silently returned `HTTP 200`, which could mask logic errors in client code.

### Export Error Surfacing
The org-export route now returns the actual error message in the response body rather than a generic failure string, making debugging easier without exposing internal paths.

---

## Bug Fixes

### Org Export: `undefined` → `null` Coercion
`exportOrgDb()` in `storage.ts` now coerces all optional fields to `null` (using `?? null`) before passing them as sql.js query bindings. Previously, JavaScript `undefined` values were passed directly, causing sql.js (WebAssembly SQLite) to throw a binding error and crash the export for any org containing projects or entries with optional fields omitted.

Affected fields: `project.organizationId`, `project.budgetHours`, `project.color`, `entry.description`, `entry.departmentId`, `recurring.description`, `recurring.lastRun`.

---

## Custom Application Icon

A new custom icon replaces the default Electron icon across all surfaces:

- **Taskbar** — 16 × 16 through 48 × 48 px sizes
- **Window chrome** — 32 × 32 px
- **Alt-Tab / Task Switcher** — 48 × 48 px
- **Desktop shortcut** — 256 × 256 px

The icon features a bold amber/gold **T** monogram over a teal progress bar on a deep navy background, making TimeTrack visually distinct from other Electron applications on the taskbar.

Technical note: the ICO file is encoded as raw BMP (no PNG chunk) to ensure compatibility with all Windows rendering paths.

---

## New Features (since v1.2.0)

The following features were shipped in patch builds between v1.2.0 and v1.2.1 and are documented here for completeness.

### Monthly Summary Tab
A new **Monthly** tab mirrors the Weekly tab format. It always reflects the complete calendar month (first through last day) and shows the same horizontal pill-row summary with total hours and per-organization breakdowns.

### Per-Organization Breakdowns on Weekly and Monthly Tabs
The summary row on the Weekly and Monthly tabs now displays a small labeled box for each organization, showing that organization's hours for the period alongside the overall total. Percentages have been removed for clarity.

### Annual Summary: Per-Organization Metric Boxes
The Annual Summary tab now renders Total Hours, Avg/Week, and Avg/Month as separate bordered metric boxes for each organization, matching the formatting of the all-organizations totals row at the top.

### Org Data Export
A new **Export** button on the Admin page allows exporting all data for a single organization (organizations, departments, projects, time entries, and recurring tasks) as a standalone `.db` file that can be imported into a fresh TimeTrack installation.

---

## Test Coverage

v1.2.1 ships with a full automated test suite (`test_suite.py`) covering:

| Category | Tests | Result |
|---|---|---|
| Settings CRUD | 5 | 5/5 PASS |
| Organizations CRUD | 7 | 7/7 PASS |
| Departments CRUD | 6 | 6/6 PASS |
| Projects CRUD | 8 | 8/8 PASS |
| Time Entries CRUD + date range | 14 | 14/14 PASS |
| Recurring Tasks | 9 | 9/9 PASS |
| Org Export integrity | 10 | 10/10 PASS |
| Delete operations | 5 | 5/5 PASS |
| Security headers | 8 | 8/8 PASS |
| Path traversal validation | 7 | 7/7 PASS |
| Export path validation | 4 | 4/4 PASS |
| Input validation | 8 | 8/8 PASS |
| SQL injection probes | 9 | 9/9 PASS |
| Not-found (404) handling | 5 | 5/5 PASS |
| Concurrent write safety | 2 | 2/2 PASS |
| **Total** | **107** | **107/107 PASS** |

---

## Code Signing

The installer is signed with a self-signed certificate:

```
CN=Ann Dunkin / O=Dunkin Global Advisors / C=US
```

Windows will display a SmartScreen warning on first install ("Windows protected your PC"). Click **More info → Run anyway** to proceed. This warning appears because the certificate is not issued by a commercial CA; the application itself is safe.

To suppress this warning permanently, a commercial EV code-signing certificate from a CA such as DigiCert, Sectigo, or GlobalSign is required.

---

## Upgrade Instructions

1. Run the new installer (`TimeTrack Setup 1.2.1.exe`).
2. The installer will update the application in place; your data file is not affected.
3. No migration script is required for this release.

---

*TimeTrack is developed and maintained by Ann Dunkin — Dunkin Global Advisors.*
