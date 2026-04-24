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
  /** All departments this entry is split across (at least one). */
  departmentIds: number[];
  projectId: number;
  description: string | null;
};
export const insertTimeEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  minutes: z.number().int().positive("Duration must be positive"),
  organizationId: z.number().int().positive(),
  departmentIds: z.array(z.number().int().positive()).min(1, "Select at least one department"),
  projectId: z.number().int().positive(),
  description: z.string().optional().nullable(),
});
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

// ─── Recurring Tasks ──────────────────────────────────────────────────────────
export type RecurringFrequency = "daily" | "weekly" | "monthly";

export type RecurringTask = {
  id: number;
  organizationId: number;
  departmentIds: number[]; // parsed
  projectId: number;
  description: string | null;
  minutes: number;
  frequency: RecurringFrequency;
  /** YYYY-MM-DD the user chose as the start date for this recurring task. */
  startDate: string;
  /** YYYY-MM-DD of the last time entries were created for this task. Null = never run. */
  lastRun: string | null;
  enabled: number; // 1 = active, 0 = paused
};

export const insertRecurringTaskSchema = z.object({
  organizationId: z.number().int().positive(),
  departmentIds: z.array(z.number().int().positive()).min(1),
  projectId: z.number().int().positive(),
  description: z.string().optional().nullable(),
  minutes: z.number().int().positive(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  enabled: z.number().int().min(0).max(1).default(1),
});
export type InsertRecurringTask = z.infer<typeof insertRecurringTaskSchema>;

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
