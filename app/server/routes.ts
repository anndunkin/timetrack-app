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
  return res.status(400).json({ error: err.errors[0]?.message ?? "Validation error" });
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

  // -- Time Entries --
  app.get("/api/time-entries", (req, res) => {
    const { start, end, page, pageSize } = req.query as {
      start?: string; end?: string; page?: string; pageSize?: string;
    };

    // Paginated mode: when `page` (or `pageSize`) is supplied, return an
    // envelope { entries, total, page, pageSize } so the History view can
    // page through ALL entries — optionally constrained by a date range.
    if (page !== undefined || pageSize !== undefined) {
      const p  = Math.max(1, Number(page) || 1);
      const ps = Math.min(200, Math.max(1, Number(pageSize) || 25));
      const { entries, total } = storage.getTimeEntriesPage({
        start: start || undefined,
        end: end || undefined,
        limit: ps,
        offset: (p - 1) * ps,
      });
      return res.json({ entries, total, page: p, pageSize: ps });
    }

    if (start && end) {
      return res.json(storage.getTimeEntriesByDateRange(start, end));
    }
    res.json(storage.getTimeEntries());
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
