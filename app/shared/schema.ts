import { z } from "zod";

// ─── Organizations ────────────────────────────────────────────────────────────
export type Organization = {
  id: number;
  name: string;
  color: string;
};
export const insertOrganizationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  color: z.string().default("#01696F"),
});
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

// ─── Departments ──────────────────────────────────────────────────────────────
export type Department = {
  id: number;
  organizationId: number;
  name: string;
};
export const insertDepartmentSchema = z.object({
  organizationId: z.number().int().positive(),
  name: z.string().min(1, "Name is required"),
});
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;

// ─── Projects ─────────────────────────────────────────────────────────────────
/** Raw DB shape — departmentIds is a JSON string */
export type Project = {
  id: number;
  name: string;
  departmentIds: string; // JSON array e.g. "[1,2]"
  budgetHours: number | null;
  color: string;
};
/** Parsed shape used in application code */
export type ProjectWithParsedDepts = Omit<Project, "departmentIds"> & {
  departmentIds: number[];
};
export const insertProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  departmentIds: z.array(z.number()).min(1, "Select at least one department"),
  budgetHours: z.number().positive().optional().nullable(),
  color: z.string().default("#20808D"),
});
export type InsertProject = z.infer<typeof insertProjectSchema>;

// ─── Time Entries ─────────────────────────────────────────────────────────────
export type TimeEntry = {
  id: number;
  date: string; // YYYY-MM-DD
  minutes: number;
  organizationId: number;
  departmentId: number;
  projectId: number;
  description: string | null;
};
export const insertTimeEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  minutes: z.number().int().positive("Duration must be positive"),
  organizationId: z.number().int().positive(),
  departmentId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  description: z.string().optional().nullable(),
});
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

// ─── Settings ─────────────────────────────────────────────────────────────────
export type Settings = {
  id: number;
  yearStartMonth: number; // 1 = January
  yearStartDay: number;
};
export const insertSettingsSchema = z.object({
  yearStartMonth: z.number().int().min(1).max(12).default(1),
  yearStartDay: z.number().int().min(1).max(31).default(1),
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
