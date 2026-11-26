import type { Express } from "express";
import { type Server } from "http";
import { storage, switchDb, saveAsDb, exportOrgDb, runDueRecurrences } from "./storage";
import { registerReportRoute } from "./reportRoute";
import {
  insertOrganizationSchema,
  insertDepartmentSchema,
  insertProjectSchema,
  insertRecurringTaskSchema,
  insertTimeEntrySchema,
  insertSettingsSchema,
} from "@shared/schema";
import { ZodError } from "zod";

function zodError(res: any, err: ZodError) {
  return res.status(400).json({ error: err.issues[0]?.message ?? "Validation error" });
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // -- Organizations --
  app.get("/api/organizations", (_req, res) => res.json(storage.getOrganizations()));
  app.post("/api/organizations", (req, res) => {
    const parsed = insertOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    res.json(storage.createOrganization(parsed.data));
  });
  app.put("/api/organizations/:id", (req, res) => {
    const parsed = insertOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const result = storage.updateOrganization(Number(req.params.id), parsed.data);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  });
  app.delete("/api/organizations/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!storage.getOrganizations().some(o => o.id === id))
      return res.status(404).json({ error: "Not found" });
    storage.deleteOrganization(id);
    res.json({ ok: true });
  });

  // -- Departments --
  app.get("/api/departments", (_req, res) => res.json(storage.getDepartments()));
  app.get("/api/departments/by-org/:orgId", (req, res) => {
    res.json(storage.getDepartmentsByOrg(Number(req.params.orgId)));
  });
  app.post("/api/departments", (req, res) => {
    const parsed = insertDepartmentSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    res.json(storage.createDepartment(parsed.data));
  });
  app.put("/api/departments/:id", (req, res) => {
    const parsed = insertDepartmentSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const result = storage.updateDepartment(Number(req.params.id), parsed.data);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  });
  app.delete("/api/departments/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!storage.getDepartments().some(d => d.id === id))
      return res.status(404).json({ error: "Not found" });
    storage.deleteDepartment(id);
    res.json({ ok: true });
  });

  // -- Projects --
  app.get("/api/projects", (_req, res) => res.json(storage.getProjects()));
  app.get("/api/projects/by-department/:deptId", (req, res) => {
    res.json(storage.getProjectsByDepartment(Number(req.params.deptId)));
  });
  app.post("/api/projects", (req, res) => {
    const parsed = insertProjectSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    res.json(storage.createProject(parsed.data));
  });
  app.put("/api/projects/:id", (req, res) => {
    const parsed = insertProjectSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const result = storage.updateProject(Number(req.params.id), parsed.data);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  });
  app.delete("/api/projects/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!storage.getProjects().some(p => p.id === id))
      return res.status(404).json({ error: "Not found" });
    storage.deleteProject(id);
    res.json({ ok: true });
  });

  // -- Search --
  // Case-insensitive search across time entries (description, date, organization,
  // department and project names), organizations, departments, projects and
  // recurring tasks. Every whitespace-separated term must match somewhere.
  app.get("/api/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const start = typeof req.query.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start) ? req.query.start : undefined;
    const end = typeof req.query.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end) ? req.query.end : undefined;
    let organizationId: number | undefined;
    if (req.query.organizationId !== undefined && req.query.organizationId !== "") {
      const raw = req.query.organizationId;
      if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        return res.status(400).json({ error: "organizationId must be a positive integer" });
      }
      organizationId = Number(raw);
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const empty = { query: q, entries: [], entryTotal: 0, organizations: [], departments: [], projects: [], recurring: [] };
    if (terms.length === 0) return res.json(empty);

    const orgs = storage.getOrganizations();
    const depts = storage.getDepartments();
    const projects = storage.getProjects();
    const orgName = (id: number) => orgs.find(o => o.id === id)?.name ?? "";
    const deptName = (id: number) => depts.find(d => d.id === id)?.name ?? "";
    const projName = (id: number) => projects.find(p => p.id === id)?.name ?? "";
    const matches = (...parts: (string | null | undefined)[]) => {
      const hay = parts.filter(Boolean).join(" \u0001 ").toLowerCase();
      return terms.every(t => hay.includes(t));
    };

    const inRange = (d: string) => (!start || d >= start) && (!end || d <= end);
    const allEntries = (start && end ? storage.getTimeEntriesByDateRange(start, end) : storage.getTimeEntries())
      .filter(e => inRange(e.date) && (organizationId === undefined || e.organizationId === organizationId));
    const matched = allEntries.filter(e => matches(
      e.description, e.date, orgName(e.organizationId), projName(e.projectId),
      ...e.departmentIds.map(deptName),
    ));
    // Stable order: newest first.
    matched.sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
    const LIMIT = 200;

    res.json({
      query: q,
      entries: matched.slice(0, LIMIT),
      entryTotal: matched.length,
      organizations: organizationId === undefined ? orgs.filter(o => matches(o.name)) : [],
      departments: depts.filter(d => (organizationId === undefined || d.organizationId === organizationId) && matches(d.name, orgName(d.organizationId))),
      projects: projects.filter(p => matches(p.name, ...p.departmentIds.map(deptName))),
      recurring: storage.getRecurringTasks().filter(t =>
        (organizationId === undefined || t.organizationId === organizationId) &&
        matches(t.description, t.frequency, orgName(t.organizationId), projName(t.projectId), ...t.departmentIds.map(deptName))),
    });
  });

  // -- Time Entries --
  app.get("/api/time-entries", (req, res) => {
    const { start, end, page, pageSize } = req.query as {
      start?: string; end?: string; page?: string; pageSize?: string;
    };
    const rawOrganizationId = req.query.organizationId;
    let organizationId: number | undefined;
    if (rawOrganizationId !== undefined) {
      if (typeof rawOrganizationId !== "string" ||
          !/^[1-9]\d*$/.test(rawOrganizationId) ||
          !Number.isSafeInteger(Number(rawOrganizationId))) {
        return res.status(400).json({ error: "organizationId must be a positive integer" });
      }
      organizationId = Number(rawOrganizationId);
    }

    // Paginated mode: when `page` (or `pageSize`) is supplied, return an
    // envelope { entries, total, page, pageSize } so the History view can
    // page through ALL entries, optionally constrained by dates and organization.
    if (page !== undefined || pageSize !== undefined) {
      const p  = Math.max(1, Number(page) || 1);
      const ps = Math.min(200, Math.max(1, Number(pageSize) || 25));
      const { entries, total } = storage.getTimeEntriesPage({
        start: start || undefined,
        end: end || undefined,
        organizationId,
        limit: ps,
        offset: (p - 1) * ps,
      });
      return res.json({ entries, total, page: p, pageSize: ps });
    }

    const entries = start && end
      ? storage.getTimeEntriesByDateRange(start, end)
      : storage.getTimeEntries();
    res.json(organizationId === undefined
      ? entries
      : entries.filter(entry => entry.organizationId === organizationId));
  });
  app.post("/api/time-entries", (req, res) => {
    const parsed = insertTimeEntrySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    res.json(storage.createTimeEntry(parsed.data));
  });
  app.put("/api/time-entries/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
    const parsed = insertTimeEntrySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const result = storage.updateTimeEntry(id, parsed.data);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  });
  app.delete("/api/time-entries/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!storage.getTimeEntries().some(e => e.id === id))
      return res.status(404).json({ error: "Not found" });
    storage.deleteTimeEntry(id);
    res.json({ ok: true });
  });

  // -- Settings --
  app.get("/api/settings", (_req, res) => res.json(storage.getSettings()));
  app.put("/api/settings", (req, res) => {
    const parsed = insertSettingsSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    res.json(storage.updateSettings(parsed.data));
  });

  // -- Recurring tasks --
  app.get("/api/recurring", (_req, res) => res.json(storage.getRecurringTasks()));

  app.post("/api/recurring", (req, res) => {
    const parsed = insertRecurringTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const task = storage.createRecurringTask(parsed.data);
    // Fire immediately so back-dated entries are created right away,
    // without requiring a restart.
    try { runDueRecurrences(); } catch (_) {}
    res.status(201).json(task);
  });

  app.put("/api/recurring/:id", (req, res) => {
    const partial = insertRecurringTaskSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ error: partial.error.flatten() });
    const result = storage.updateRecurringTask(Number(req.params.id), partial.data);
    if (!result) return res.status(404).json({ error: "Not found" });
    // Re-run in case start_date or frequency changed.
    try { runDueRecurrences(); } catch (_) {}
    res.json(result);
  });

  app.delete("/api/recurring/:id", (req, res) => {
    storage.deleteRecurringTask(Number(req.params.id));
    res.status(204).end();
  });

  // Run due recurrences on first load (also called from Electron main on launch)
  app.post("/api/recurring/run", (_req, res) => {
    try {
      runDueRecurrences();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // -- Export org to standalone .db file --
  app.post("/api/organizations/:id/export", (req, res) => {
    const orgId = Number(req.params.id);
    const { path: destPath } = req.body as { path?: string };
    if (!destPath) return res.status(400).json({ error: "path is required" });
    if (!isValidDbPath(destPath)) return res.status(400).json({ error: `Invalid database path: ${JSON.stringify(destPath)}` });
    try {
      exportOrgDb(orgId, destPath);
      res.json({ ok: true, path: destPath });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Export failed" });
    }
  });

  // -- File switching (called by Electron main process IPC handlers) --
  // Validate that the path ends with .db and contains no traversal sequences.
  function isValidDbPath(p: unknown): p is string {
    if (typeof p !== "string" || !p.trim()) return false;
    const normalized = p.replace(/\\/g, "/");
    if (normalized.includes("../") || normalized.includes("./")) return false;
    if (!p.toLowerCase().endsWith(".db")) return false;
    // Block Windows absolute paths pointing to sensitive system directories
    const lower = normalized.toLowerCase();
    const blockedDirs = ["/windows/", "/system32/", "/program files", "/programdata/"];
    if (blockedDirs.some(d => lower.includes(d))) return false;
    return true;
  }

  app.post("/api/files/switch", async (req, res) => {
    const { path: dbPath } = req.body as { path?: string };
    if (!dbPath) return res.status(400).json({ error: "path is required" });
    if (!isValidDbPath(dbPath)) return res.status(400).json({ error: "Invalid database path" });
    try {
      await switchDb(dbPath);
      res.json({ ok: true, path: dbPath });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Failed to switch database" });
    }
  });

  // -- Save As (copy current DB to new path and switch to it) --
  app.post("/api/files/save-as", async (req, res) => {
    const { path: newPath } = req.body as { path?: string };
    if (!newPath) return res.status(400).json({ error: "path is required" });
    if (!isValidDbPath(newPath)) return res.status(400).json({ error: "Invalid database path" });
    try {
      await saveAsDb(newPath);
      res.json({ ok: true, path: newPath });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Failed to save database" });
    }
  });

  registerReportRoute(app);

  return httpServer;
}
