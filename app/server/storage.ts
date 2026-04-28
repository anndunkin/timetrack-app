import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import {
  type Organization, type InsertOrganization,
  type Department, type InsertDepartment,
  type Project, type InsertProject, type ProjectWithParsedDepts,
  type TimeEntry, type InsertTimeEntry,
  type RecurringTask, type InsertRecurringTask,
  type RecurringFrequency,
  type Settings, type InsertSettings,
} from "@shared/schema";

// ─── DB setup ────────────────────────────────────────────────────────────────

let DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), "timetracker.db");

let db: SqlJsDatabase;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Load or create the SQLite database using sql.js (pure WebAssembly — no
 * native compilation required).
 */
function locateWasm(file: string): string {
  if (process.env.SQLJS_WASM_PATH) {
    return path.join(process.env.SQLJS_WASM_PATH, file);
  }
  try {
    const sqlJsDist = require.resolve("sql.js").replace(/[\\/]dist[\\/].*$/, "/dist");
    return path.join(sqlJsDist, file);
  } catch {
    return file;
  }
}

export async function initDb(): Promise<void> {
  SQL = await initSqlJs({ locateFile: locateWasm });
  await loadDb(DB_PATH);

  // Persist on process exit
  process.on("exit", () => flushSync());
  process.on("SIGINT", () => { flushSync(); process.exit(0); });
  process.on("SIGTERM", () => { flushSync(); process.exit(0); });
}

/** Switch to a different database file at runtime. Flushes current DB first. */
export async function switchDb(newPath: string): Promise<void> {
  flushSync(); // save current DB before switching
  if (db) { try { db.close(); } catch (_) {} }
  DB_PATH = path.resolve(newPath);
  await loadDb(DB_PATH);
}

/**
 * Save a copy of the current database to a new path, then switch to it.
 * The original file is left untouched. The copy becomes the active file.
 */
export async function saveAsDb(newPath: string): Promise<void> {
  const resolved = path.resolve(newPath);
  // Flush in-memory state to disk first so the copy is fully up to date
  flushSync();
  // Copy binary SQLite file to new location
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(DB_PATH, resolved);
  // Now switch the active DB to the copy
  if (db) { try { db.close(); } catch (_) {} }
  DB_PATH = resolved;
  await loadDb(DB_PATH);
}

/** Load (or create) a database file and run migrations. */
async function loadDb(dbPath: string): Promise<void> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL!.Database(buf);
  } else {
    db = new SQL!.Database();
  }

  runMigrations();
  seedDefaults();
}

/**
 * Export all data for a single organisation to a brand-new TimeTrack database
 * file at `destPath`. The exported file is a fully self-contained .db that can
 * be opened directly in TimeTrack via File → Open.
 *
 * Exported tables:
 *   - organizations   (just the one org)
 *   - departments     (belonging to that org)
 *   - projects        (linked to any of those departments)
 *   - time_entries    (for that org)
 *   - recurring_tasks (for that org)
 *   - settings        (copied from current DB)
 */
export function exportOrgDb(orgId: number, destPath: string): void {
  if (!db || !SQL) throw new Error("Database not initialised");

  const resolved = path.resolve(destPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Build a fresh in-memory DB with the same schema
  const exportDb = new SQL.Database();

  // ── Schema ──────────────────────────────────────────────────────────────
  exportDb.run(`
    CREATE TABLE IF NOT EXISTS organizations (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1'
    );
    CREATE TABLE IF NOT EXISTS departments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name            TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      department_ids  TEXT NOT NULL DEFAULT '[]',
      organization_id INTEGER REFERENCES organizations(id),
      budget_hours    REAL,
      color           TEXT NOT NULL DEFAULT '#6366f1'
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT NOT NULL,
      minutes         INTEGER NOT NULL,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      department_id   INTEGER,
      department_ids  TEXT NOT NULL DEFAULT '[]',
      project_id      INTEGER NOT NULL REFERENCES projects(id),
      description     TEXT
    );
    CREATE TABLE IF NOT EXISTS recurring_tasks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      department_ids  TEXT NOT NULL DEFAULT '[]',
      project_id      INTEGER NOT NULL REFERENCES projects(id),
      description     TEXT,
      minutes         INTEGER NOT NULL,
      frequency       TEXT NOT NULL,
      start_date      TEXT NOT NULL,
      last_run        TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (
      id                INTEGER PRIMARY KEY DEFAULT 1,
      year_start_month  INTEGER NOT NULL DEFAULT 1,
      year_start_day    INTEGER NOT NULL DEFAULT 1
    );
  `);

  // ── Copy organisation ────────────────────────────────────────────────────
  const orgs = toObjects<any>(db.exec(
    "SELECT * FROM organizations WHERE id = ?", [orgId]
  ));
  if (!orgs.length) throw new Error(`Organisation ${orgId} not found`);
  for (const o of orgs) {
    exportDb.run("INSERT INTO organizations (id, name, color) VALUES (?,?,?)",
      [o.id, o.name, o.color ?? '#6366f1']);
  }

  // ── Copy departments ─────────────────────────────────────────────────────
  const depts = toObjects<any>(db.exec(
    "SELECT * FROM departments WHERE organization_id = ?", [orgId]
  ));
  const deptIds = depts.map((d: any) => d.id as number);
  for (const d of depts) {
    exportDb.run("INSERT INTO departments (id, organization_id, name) VALUES (?,?,?)",
      [d.id, d.organization_id, d.name]);
  }

  // ── Copy projects linked to any of those departments ─────────────────────
  // A project belongs here if any entry in its department_ids JSON array
  // matches one of the org's department IDs.
  const allProjects = toObjects<any>(db.exec("SELECT * FROM projects"));
  const orgProjects = allProjects.filter((p: any) => {
    try {
      const ids: number[] = JSON.parse(p.department_ids ?? "[]");
      return ids.some(id => deptIds.includes(id));
    } catch { return false; }
  });
  const projIds = orgProjects.map((p: any) => p.id as number);
  for (const p of orgProjects) {
    exportDb.run(
      "INSERT INTO projects (id, name, department_ids, organization_id, budget_hours, color) VALUES (?,?,?,?,?,?)",
      [p.id, p.name, p.department_ids ?? '[]', p.organization_id ?? null, p.budget_hours ?? null, p.color ?? '#6366f1']
    );
  }

  // ── Copy time entries ────────────────────────────────────────────────────
  const entries = toObjects<any>(db.exec(
    "SELECT * FROM time_entries WHERE organization_id = ?", [orgId]
  ));
  for (const e of entries) {
    exportDb.run(
      `INSERT INTO time_entries
         (id, date, minutes, organization_id, department_id, department_ids, project_id, description)
       VALUES (?,?,?,?,?,?,?,?)`,
      [e.id, e.date, e.minutes, e.organization_id,
       e.department_id ?? null, e.department_ids ?? '[]', e.project_id, e.description ?? null]
    );
  }

  // ── Copy recurring tasks ─────────────────────────────────────────────────
  const recur = toObjects<any>(db.exec(
    "SELECT * FROM recurring_tasks WHERE organization_id = ?", [orgId]
  ));
  for (const r of recur) {
    exportDb.run(
      `INSERT INTO recurring_tasks
         (id, organization_id, department_ids, project_id, description,
          minutes, frequency, start_date, last_run, enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.organization_id, r.department_ids ?? '[]', r.project_id, r.description ?? null,
       r.minutes, r.frequency, r.start_date, r.last_run ?? null, r.enabled]
    );
  }

  // ── Copy settings ────────────────────────────────────────────────────────
  const settingsRows = toObjects<any>(db.exec("SELECT * FROM settings LIMIT 1"));
  if (settingsRows.length) {
    const s = settingsRows[0];
    exportDb.run(
      "INSERT INTO settings (id, year_start_month, year_start_day) VALUES (?,?,?)",
      [1, s.year_start_month, s.year_start_day]
    );
  }

  // ── Write to disk ────────────────────────────────────────────────────────
  const data = exportDb.export();
  fs.writeFileSync(resolved, Buffer.from(data));
  exportDb.close();
}

/** Write the in-memory DB to disk immediately. */
function flushSync(): void {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (_) {}
}

/** Schedule a disk flush (debounced — max 500ms after last write). */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flushSync(); saveTimer = null; }, 500);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert sql.js result rows to plain objects. */
function toObjects<T>(result: ReturnType<SqlJsDatabase["exec"]>): T[] {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj as T;
  });
}

/** Execute a SELECT and return all rows as objects. */
function all<T>(sql: string, params: (string | number | null)[] = []): T[] {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  } catch {
    return [];
  }
}

/** Execute a SELECT and return the first row, or undefined. */
function first<T>(sql: string, params: (string | number | null)[] = []): T | undefined {
  return all<T>(sql, params)[0];
}

/** Execute an INSERT/UPDATE/DELETE statement and return the last inserted rowid. */
function run(sql: string, params: (string | number | null | undefined)[] = []): number {
  db.run(sql, params as (string | number | null)[]);
  scheduleSave();
  return db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0] as number ?? 0;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

function runMigrations(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS organizations (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT    NOT NULL,
      color TEXT    NOT NULL DEFAULT '#01696F'
    );
    CREATE TABLE IF NOT EXISTS departments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      name            TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL,
      department_ids TEXT    NOT NULL DEFAULT '[]',
      budget_hours   REAL,
      color          TEXT    NOT NULL DEFAULT '#20808D'
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT    NOT NULL,
      minutes         INTEGER NOT NULL,
      organization_id INTEGER NOT NULL,
      department_id   INTEGER NOT NULL,
      project_id      INTEGER NOT NULL,
      description     TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      year_start_month INTEGER NOT NULL DEFAULT 1,
      year_start_day   INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Migration: recurring_tasks table
  db.run(`
    CREATE TABLE IF NOT EXISTS recurring_tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      department_ids  TEXT    NOT NULL DEFAULT '[]',
      project_id      INTEGER NOT NULL,
      description     TEXT,
      minutes         INTEGER NOT NULL,
      frequency       TEXT    NOT NULL DEFAULT 'weekly',
      start_date      TEXT    NOT NULL DEFAULT (date('now')),
      last_run        TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Migration: add start_date column to recurring_tasks if it doesn't exist.
  // NOTE: ALTER TABLE ADD COLUMN only accepts constant literals as DEFAULT,
  // not expressions like date('now'). We use '' and normalise in the mapper.
  const recurCols = db.exec("PRAGMA table_info(recurring_tasks)");
  const recurColNames = recurCols[0]?.values.map((r) => r[1] as string) ?? [];
  if (!recurColNames.includes("start_date")) {
    db.run("ALTER TABLE recurring_tasks ADD COLUMN start_date TEXT NOT NULL DEFAULT ''");
    flushSync();
  }

  // Migration: add department_ids column to time_entries if it doesn't exist.
  // Existing rows get a JSON array containing their single department_id value,
  // so no data is lost and all old entries continue to work correctly.
  const cols = db.exec("PRAGMA table_info(time_entries)");
  const colNames = cols[0]?.values.map((r) => r[1] as string) ?? [];
  if (!colNames.includes("department_ids")) {
    db.run("ALTER TABLE time_entries ADD COLUMN department_ids TEXT NOT NULL DEFAULT '[]'");
    flushSync();
  }

  // Back-fill: any row where department_ids is still '[]' gets wrapped from
  // the legacy department_id column. Runs unconditionally on every startup so
  // existing databases that already had the column (but missed the original
  // back-fill) are fixed automatically.
  db.run("UPDATE time_entries SET department_ids = json_array(department_id) WHERE department_ids = '[]' AND department_id IS NOT NULL");
  flushSync();
}

function seedDefaults(): void {
  const existing = first<Settings>("SELECT * FROM settings LIMIT 1");
  if (!existing) {
    db.run("INSERT INTO settings (year_start_month, year_start_day) VALUES (1, 1)");
    flushSync();
  }
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

/** sql.js returns snake_case columns — map to camelCase for our types. */
function mapOrg(r: Record<string, unknown>): Organization {
  return { id: r.id as number, name: r.name as string, color: r.color as string };
}

function mapDept(r: Record<string, unknown>): Department {
  return { id: r.id as number, organizationId: r.organization_id as number, name: r.name as string };
}

function mapProject(r: Record<string, unknown>): Project {
  return {
    id: r.id as number,
    name: r.name as string,
    departmentIds: r.department_ids as string,
    budgetHours: r.budget_hours as number | null,
    color: r.color as string,
  };
}

function mapTimeEntry(r: Record<string, unknown>): TimeEntry {
  // department_ids is a JSON array string e.g. "[1,2]"
  // Fall back to wrapping the legacy department_id if for any reason the new
  // column is missing or empty.
  let departmentIds: number[];
  try {
    const raw = r.department_ids as string;
    departmentIds = raw ? JSON.parse(raw) as number[] : [];
  } catch {
    departmentIds = [];
  }
  if (departmentIds.length === 0 && r.department_id) {
    departmentIds = [r.department_id as number];
  }
  return {
    id: r.id as number,
    date: r.date as string,
    minutes: r.minutes as number,
    organizationId: r.organization_id as number,
    departmentIds,
    projectId: r.project_id as number,
    description: r.description as string | null,
  };
}

function mapRecurring(r: Record<string, unknown>): RecurringTask {
  let departmentIds: number[];
  try {
    departmentIds = JSON.parse(r.department_ids as string) as number[];
  } catch {
    departmentIds = [];
  }
  return {
    id: r.id as number,
    organizationId: r.organization_id as number,
    departmentIds,
    projectId: r.project_id as number,
    description: r.description as string | null,
    minutes: r.minutes as number,
    frequency: r.frequency as RecurringFrequency,
    startDate: (r.start_date as string) || localDateStr(),
    lastRun: r.last_run as string | null,
    enabled: r.enabled as number,
  };
}

function mapSettings(r: Record<string, unknown>): Settings {
  return {
    id: r.id as number,
    yearStartMonth: r.year_start_month as number,
    yearStartDay: r.year_start_day as number,
  };
}

function parseProject(p: Project): ProjectWithParsedDepts {
  return { ...p, departmentIds: JSON.parse(p.departmentIds) as number[] };
}

// ─── IStorage interface ────────────────────────────────────────────────────────

export interface IStorage {
  // Recurring tasks
  getRecurringTasks(): RecurringTask[];
  createRecurringTask(data: InsertRecurringTask): RecurringTask;
  updateRecurringTask(id: number, data: Partial<InsertRecurringTask>): RecurringTask | undefined;
  deleteRecurringTask(id: number): void;

  getOrganizations(): Organization[];
  createOrganization(data: InsertOrganization): Organization;
  updateOrganization(id: number, data: InsertOrganization): Organization | undefined;
  deleteOrganization(id: number): void;

  getDepartments(): Department[];
  getDepartmentsByOrg(orgId: number): Department[];
  createDepartment(data: InsertDepartment): Department;
  updateDepartment(id: number, data: InsertDepartment): Department | undefined;
  deleteDepartment(id: number): void;

  getProjects(): ProjectWithParsedDepts[];
  getProjectsByDepartment(deptId: number): ProjectWithParsedDepts[];
  createProject(data: InsertProject): ProjectWithParsedDepts;
  updateProject(id: number, data: InsertProject): ProjectWithParsedDepts | undefined;
  deleteProject(id: number): void;

  getTimeEntries(): TimeEntry[];
  getTimeEntriesByDateRange(start: string, end: string): TimeEntry[];
  createTimeEntry(data: InsertTimeEntry): TimeEntry;
  updateTimeEntry(id: number, data: InsertTimeEntry): TimeEntry | undefined;
  deleteTimeEntry(id: number): void;

  getSettings(): Settings;
  updateSettings(data: InsertSettings): Settings;
}

// ─── Storage implementation ───────────────────────────────────────────────────

/**
 * Walk through all enabled recurring tasks, compute which dates have been
 * missed since last_run, and insert a time entry for each one.
 * Called on every app launch.
 */
export function runDueRecurrences(): void {
  const tasks = storage.getRecurringTasks().filter(t => t.enabled === 1);
  const today = localDateStr();

  for (const task of tasks) {
    // Use start_date as the anchor: if never run before, generate dates from
    // start_date (inclusive) up to today. If already run, generate from lastRun
    // (exclusive) up to today — but never before start_date.
    const anchor = task.lastRun ?? beforeDate(task.startDate, task.frequency);
    const dueDates = getMissedDates(task.frequency, anchor, today, task.startDate);
    if (dueDates.length === 0) continue;

    for (const date of dueDates) {
      const primaryDept = task.departmentIds[0];
      const deptIdsJson = JSON.stringify(task.departmentIds);
      db.run(
        "INSERT INTO time_entries (date, minutes, organization_id, department_id, department_ids, project_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [date, task.minutes, task.organizationId, primaryDept, deptIdsJson, task.projectId, task.description ?? null],
      );
    }

    db.run("UPDATE recurring_tasks SET last_run = ? WHERE id = ?", [today, task.id]);
    flushSync();
  }
}

/**
 * Return a fake "previous period" date just before startDate so that
 * getMissedDates will include startDate itself as the first due date.
 */
function beforeDate(startDate: string, frequency: RecurringFrequency): string {
  const d = new Date(startDate + "T00:00:00");
  if (frequency === "daily") d.setDate(d.getDate() - 1);
  else if (frequency === "weekly") d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Return YYYY-MM-DD string for today using local time (avoids UTC offset issues). */
function localDateStr(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Compute all dates that should have fired for `frequency` between
 * `lastRun` (exclusive) and `today` (inclusive), but never before `minDate`.
 */
function getMissedDates(
  frequency: RecurringFrequency,
  lastRun: string,
  today: string,
  minDate?: string,
): string[] {
  const dates: string[] = [];
  const toMs = (s: string) => new Date(s + "T00:00:00").getTime();
  const todayMs = toMs(today);
  const minMs   = minDate ? toMs(minDate) : 0;

  const lastMs = toMs(lastRun);
  if (lastMs >= todayMs) return [];

  const cursor = new Date(lastMs);

  while (true) {
    if (frequency === "daily") {
      cursor.setDate(cursor.getDate() + 1);
    } else if (frequency === "weekly") {
      cursor.setDate(cursor.getDate() + 7);
    } else {
      cursor.setMonth(cursor.getMonth() + 1);
    }
    if (cursor.getTime() > todayMs) break;
    if (cursor.getTime() < minMs) continue; // skip dates before startDate
    dates.push([
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, "0"),
      String(cursor.getDate()).padStart(2, "0"),
    ].join("-"));
  }

  return dates;
}

export const storage: IStorage = {
  // --- Recurring Tasks ---
  getRecurringTasks() {
    return all<Record<string, unknown>>("SELECT * FROM recurring_tasks ORDER BY id").map(mapRecurring);
  },
  createRecurringTask(data) {
    const id = run(
      "INSERT INTO recurring_tasks (organization_id, department_ids, project_id, description, minutes, frequency, start_date, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [data.organizationId, JSON.stringify(data.departmentIds), data.projectId, data.description ?? null, data.minutes, data.frequency, data.startDate, data.enabled ?? 1],
    );
    return mapRecurring(first<Record<string, unknown>>("SELECT * FROM recurring_tasks WHERE id = ?", [id])!);
  },
  updateRecurringTask(id, data) {
    const existing = first<Record<string, unknown>>("SELECT * FROM recurring_tasks WHERE id = ?", [id]);
    if (!existing) return undefined;
    const merged = mapRecurring(existing);
    const orgId     = data.organizationId   ?? merged.organizationId;
    const deptIds   = data.departmentIds     ?? merged.departmentIds;
    const projId    = data.projectId         ?? merged.projectId;
    const desc      = data.description !== undefined ? data.description : merged.description;
    const mins      = data.minutes            ?? merged.minutes;
    const freq      = data.frequency          ?? merged.frequency;
    const startDate = data.startDate          ?? merged.startDate;
    const enabled   = data.enabled            ?? merged.enabled;
    run(
      "UPDATE recurring_tasks SET organization_id=?, department_ids=?, project_id=?, description=?, minutes=?, frequency=?, start_date=?, enabled=? WHERE id=?",
      [orgId, JSON.stringify(deptIds), projId, desc ?? null, mins, freq, startDate, enabled, id],
    );
    return mapRecurring(first<Record<string, unknown>>("SELECT * FROM recurring_tasks WHERE id = ?", [id])!);
  },
  deleteRecurringTask(id) {
    run("DELETE FROM recurring_tasks WHERE id = ?", [id]);
  },

  // --- Organizations ---
  getOrganizations() {
    return all<Record<string, unknown>>("SELECT * FROM organizations").map(mapOrg);
  },
  createOrganization(data) {
    const id = run("INSERT INTO organizations (name, color) VALUES (?, ?)", [data.name, data.color]);
    return mapOrg(first<Record<string, unknown>>("SELECT * FROM organizations WHERE id = ?", [id])!);
  },
  updateOrganization(id, data) {
    run("UPDATE organizations SET name = ?, color = ? WHERE id = ?", [data.name, data.color, id]);
    const row = first<Record<string, unknown>>("SELECT * FROM organizations WHERE id = ?", [id]);
    return row ? mapOrg(row) : undefined;
  },
  deleteOrganization(id) {
    run("DELETE FROM organizations WHERE id = ?", [id]);
  },

  // --- Departments ---
  getDepartments() {
    return all<Record<string, unknown>>("SELECT * FROM departments").map(mapDept);
  },
  getDepartmentsByOrg(orgId) {
    return all<Record<string, unknown>>("SELECT * FROM departments WHERE organization_id = ?", [orgId]).map(mapDept);
  },
  createDepartment(data) {
    const id = run("INSERT INTO departments (organization_id, name) VALUES (?, ?)", [data.organizationId, data.name]);
    return mapDept(first<Record<string, unknown>>("SELECT * FROM departments WHERE id = ?", [id])!);
  },
  updateDepartment(id, data) {
    run("UPDATE departments SET organization_id = ?, name = ? WHERE id = ?", [data.organizationId, data.name, id]);
    const row = first<Record<string, unknown>>("SELECT * FROM departments WHERE id = ?", [id]);
    return row ? mapDept(row) : undefined;
  },
  deleteDepartment(id) {
    run("DELETE FROM departments WHERE id = ?", [id]);
  },

  // --- Projects ---
  getProjects() {
    return all<Record<string, unknown>>("SELECT * FROM projects").map(mapProject).map(parseProject);
  },
  getProjectsByDepartment(deptId) {
    return all<Record<string, unknown>>("SELECT * FROM projects")
      .map(mapProject)
      .map(parseProject)
      .filter((p) => p.departmentIds.includes(deptId));
  },
  createProject(data) {
    const id = run(
      "INSERT INTO projects (name, department_ids, budget_hours, color) VALUES (?, ?, ?, ?)",
      [data.name, JSON.stringify(data.departmentIds), data.budgetHours ?? null, data.color],
    );
    return parseProject(mapProject(first<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [id])!));
  },
  updateProject(id, data) {
    run(
      "UPDATE projects SET name = ?, department_ids = ?, budget_hours = ?, color = ? WHERE id = ?",
      [data.name, JSON.stringify(data.departmentIds), data.budgetHours ?? null, data.color, id],
    );
    const row = first<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [id]);
    return row ? parseProject(mapProject(row)) : undefined;
  },
  deleteProject(id) {
    run("DELETE FROM projects WHERE id = ?", [id]);
  },

  // --- Time Entries ---
  getTimeEntries() {
    return all<Record<string, unknown>>("SELECT * FROM time_entries ORDER BY date DESC").map(mapTimeEntry);
  },
  getTimeEntriesByDateRange(start, end) {
    return all<Record<string, unknown>>(
      "SELECT * FROM time_entries WHERE date >= ? AND date <= ? ORDER BY date DESC",
      [start, end],
    ).map(mapTimeEntry);
  },
  createTimeEntry(data) {
    // Store the first dept in the legacy column for backward compat, and the
    // full array in department_ids.
    const primaryDept = data.departmentIds[0];
    const deptIdsJson = JSON.stringify(data.departmentIds);
    const id = run(
      "INSERT INTO time_entries (date, minutes, organization_id, department_id, department_ids, project_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [data.date, data.minutes, data.organizationId, primaryDept, deptIdsJson, data.projectId, data.description ?? null],
    );
    return mapTimeEntry(first<Record<string, unknown>>("SELECT * FROM time_entries WHERE id = ?", [id])!);
  },
  updateTimeEntry(id, data) {
    const primaryDept = data.departmentIds[0];
    const deptIdsJson = JSON.stringify(data.departmentIds);
    run(
      "UPDATE time_entries SET date = ?, minutes = ?, organization_id = ?, department_id = ?, department_ids = ?, project_id = ?, description = ? WHERE id = ?",
      [data.date, data.minutes, data.organizationId, primaryDept, deptIdsJson, data.projectId, data.description ?? null, id],
    );
    const row = first<Record<string, unknown>>("SELECT * FROM time_entries WHERE id = ?", [id]);
    return row ? mapTimeEntry(row) : undefined;
  },
  deleteTimeEntry(id) {
    run("DELETE FROM time_entries WHERE id = ?", [id]);
  },

  // --- Settings ---
  getSettings() {
    return mapSettings(first<Record<string, unknown>>("SELECT * FROM settings LIMIT 1")!);
  },
  updateSettings(data) {
    const existing = first<Record<string, unknown>>("SELECT id FROM settings LIMIT 1");
    if (existing) {
      run("UPDATE settings SET year_start_month = ?, year_start_day = ? WHERE id = ?", [
        data.yearStartMonth, data.yearStartDay, existing.id as number,
      ]);
    } else {
      run("INSERT INTO settings (year_start_month, year_start_day) VALUES (?, ?)", [
        data.yearStartMonth, data.yearStartDay,
      ]);
    }
    return mapSettings(first<Record<string, unknown>>("SELECT * FROM settings LIMIT 1")!);
  },
};
