import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import {
  type Organization, type InsertOrganization,
  type Department, type InsertDepartment,
  type Project, type InsertProject, type ProjectWithParsedDepts,
  type TimeEntry, type InsertTimeEntry,
  type Settings, type InsertSettings,
} from "@shared/schema";

// ─── DB setup ────────────────────────────────────────────────────────────────

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), "timetracker.db");

let db: SqlJsDatabase;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Load or create the SQLite database using sql.js (pure WebAssembly — no
 * native compilation required).
 */
export async function initDb(): Promise<void> {
  // Locate the WASM file relative to the compiled bundle in production,
  // or from the sql.js package in development.
  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      // SQLJS_WASM_PATH is set by Electron's main process to the dist/ folder
      if (process.env.SQLJS_WASM_PATH) {
        return path.join(process.env.SQLJS_WASM_PATH, file);
      }
      // Fallback for dev: use sql.js package's own dist folder
      try {
        const sqlJsDist = require.resolve("sql.js").replace(/[\\/]dist[\\/].*$/, "/dist");
        return path.join(sqlJsDist, file);
      } catch {
        return file;
      }
    },
  });

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Ensure parent directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  runMigrations();
  seedDefaults();

  // Persist on process exit
  process.on("exit", () => flushSync());
  process.on("SIGINT", () => { flushSync(); process.exit(0); });
  process.on("SIGTERM", () => { flushSync(); process.exit(0); });
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
  return {
    id: r.id as number,
    date: r.date as string,
    minutes: r.minutes as number,
    organizationId: r.organization_id as number,
    departmentId: r.department_id as number,
    projectId: r.project_id as number,
    description: r.description as string | null,
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

export const storage: IStorage = {
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
    const id = run(
      "INSERT INTO time_entries (date, minutes, organization_id, department_id, project_id, description) VALUES (?, ?, ?, ?, ?, ?)",
      [data.date, data.minutes, data.organizationId, data.departmentId, data.projectId, data.description ?? null],
    );
    return mapTimeEntry(first<Record<string, unknown>>("SELECT * FROM time_entries WHERE id = ?", [id])!);
  },
  updateTimeEntry(id, data) {
    run(
      "UPDATE time_entries SET date = ?, minutes = ?, organization_id = ?, department_id = ?, project_id = ?, description = ? WHERE id = ?",
      [data.date, data.minutes, data.organizationId, data.departmentId, data.projectId, data.description ?? null, id],
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
