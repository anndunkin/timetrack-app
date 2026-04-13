import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import {
  insertOrganizationSchema,
  insertDepartmentSchema,
  insertProjectSchema,
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
    storage.deleteOrganization(Number(req.params.id));
    res.json({ success: true });
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
    storage.deleteDepartment(Number(req.params.id));
    res.json({ success: true });
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
    storage.deleteProject(Number(req.params.id));
    res.json({ success: true });
  });

  // -- Time Entries --
  app.get("/api/time-entries", (req, res) => {
    const { start, end } = req.query as { start?: string; end?: string };
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
    const parsed = insertTimeEntrySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    const result = storage.updateTimeEntry(Number(req.params.id), parsed.data);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  });
  app.delete("/api/time-entries/:id", (req, res) => {
    storage.deleteTimeEntry(Number(req.params.id));
    res.json({ success: true });
  });

  // -- Settings --
  app.get("/api/settings", (_req, res) => res.json(storage.getSettings()));
  app.put("/api/settings", (req, res) => {
    const parsed = insertSettingsSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed.error);
    res.json(storage.updateSettings(parsed.data));
  });

  return httpServer;
}
