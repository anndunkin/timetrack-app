import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import {
  type Organization, type Department, type ProjectWithParsedDepts,
  type TimeEntry, insertTimeEntrySchema,
} from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Clock, Plus, CheckCircle2 } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn, minutesToHHMM, formatDate, todayISO } from "@/lib/utils";

const entrySchema = insertTimeEntrySchema.extend({
  hours: z.number().int().min(0).max(23),
  mins: z.number().int().min(0).max(59),
}).omit({ minutes: true });

type EntryForm = {
  date: string;
  organizationId: number;
  departmentId: number;
  projectId: number;
  hours: number;
  mins: number;
  description: string;
};

export default function TimeEntryPage() {
  const { toast } = useToast();
  const [editId, setEditId] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });
  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({ queryKey: ["/api/time-entries"] });

  const form = useForm<EntryForm>({
    defaultValues: {
      date: todayISO(),
      organizationId: 0,
      departmentId: 0,
      projectId: 0,
      hours: 0,
      mins: 0,
      description: "",
    },
  });

  const selectedOrgId = form.watch("organizationId");
  const selectedDeptId = form.watch("departmentId");

  // Derived filtered lists
  const filteredDepts = allDepts.filter(d => d.organizationId === Number(selectedOrgId));
  const filteredProjects = allProjects.filter(p => p.departmentIds.includes(Number(selectedDeptId)));

  // Reset dept when org changes
  useEffect(() => {
    form.setValue("departmentId", 0);
    form.setValue("projectId", 0);
  }, [selectedOrgId]);

  // Reset project when dept changes
  useEffect(() => {
    form.setValue("projectId", 0);
  }, [selectedDeptId]);

  // Auto-select org/dept/project if only one option
  useEffect(() => {
    if (orgs.length === 1 && form.getValues("organizationId") === 0) {
      form.setValue("organizationId", orgs[0].id);
    }
  }, [orgs]);
  useEffect(() => {
    if (filteredDepts.length === 1 && form.getValues("departmentId") === 0) {
      form.setValue("departmentId", filteredDepts[0].id);
    }
  }, [filteredDepts]);
  useEffect(() => {
    if (filteredProjects.length === 1 && form.getValues("projectId") === 0) {
      form.setValue("projectId", filteredProjects[0].id);
    }
  }, [filteredProjects]);

  const createMut = useMutation({
    mutationFn: (data: z.infer<typeof insertTimeEntrySchema>) =>
      apiRequest("POST", "/api/time-entries", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      form.reset({ date: todayISO(), organizationId: form.getValues("organizationId"), departmentId: form.getValues("departmentId"), projectId: 0, hours: 0, mins: 0, description: "" });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: z.infer<typeof insertTimeEntrySchema> }) =>
      apiRequest("PUT", `/api/time-entries/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      setEditId(null);
      form.reset({ date: todayISO(), organizationId: 0, departmentId: 0, projectId: 0, hours: 0, mins: 0, description: "" });
      toast({ title: "Entry updated" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/time-entries/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] }),
  });

  function handleSubmit(vals: EntryForm) {
    const minutes = vals.hours * 60 + vals.mins;
    if (minutes === 0) {
      toast({ title: "Duration required", description: "Enter at least 1 minute", variant: "destructive" });
      return;
    }
    if (!vals.organizationId || !vals.departmentId || !vals.projectId) {
      toast({ title: "Complete all fields", description: "Select org, department, and project", variant: "destructive" });
      return;
    }
    const payload = {
      date: vals.date,
      minutes,
      organizationId: Number(vals.organizationId),
      departmentId: Number(vals.departmentId),
      projectId: Number(vals.projectId),
      description: vals.description || null,
    };
    if (editId !== null) {
      updateMut.mutate({ id: editId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  function startEdit(entry: TimeEntry) {
    setEditId(entry.id);
    form.reset({
      date: entry.date,
      organizationId: entry.organizationId,
      departmentId: entry.departmentId,
      projectId: entry.projectId,
      hours: Math.floor(entry.minutes / 60),
      mins: entry.minutes % 60,
      description: entry.description ?? "",
    });
  }

  function cancelEdit() {
    setEditId(null);
    form.reset({ date: todayISO(), organizationId: 0, departmentId: 0, projectId: 0, hours: 0, mins: 0, description: "" });
  }

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? "—"; }
  function orgColor(id: number) { return orgs.find(o => o.id === id)?.color ?? "#ccc"; }
  function deptName(id: number) { return allDepts.find(d => d.id === id)?.name ?? "—"; }
  function projName(id: number) { return allProjects.find(p => p.id === id)?.name ?? "—"; }
  function projColor(id: number) { return allProjects.find(p => p.id === id)?.color ?? "#ccc"; }

  const noSetup = orgs.length === 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 items-start">
      {/* ── Form ── */}
      <div>
        <h1 className="text-xl font-semibold mb-1">{editId ? "Edit Entry" : "Log Time"}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {editId ? "Update this time entry." : "Record time against a project."}
        </p>

        {noSetup && (
          <div className="p-4 rounded-lg bg-muted text-sm text-muted-foreground mb-4">
            Set up your organizations, departments, and projects in <strong>Admin</strong> before logging time.
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Date */}
            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <Input data-testid="input-date" type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Organization */}
            <FormField control={form.control} name="organizationId" render={({ field }) => (
              <FormItem>
                <FormLabel>Organization</FormLabel>
                <FormControl>
                  <select
                    data-testid="select-org"
                    value={field.value}
                    onChange={e => field.onChange(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    disabled={noSetup}
                  >
                    <option value={0}>Select organization…</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FormControl>
              </FormItem>
            )} />

            {/* Department */}
            <FormField control={form.control} name="departmentId" render={({ field }) => (
              <FormItem>
                <FormLabel>Department</FormLabel>
                <FormControl>
                  <select
                    data-testid="select-department"
                    value={field.value}
                    onChange={e => field.onChange(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    disabled={!selectedOrgId || filteredDepts.length === 0}
                  >
                    <option value={0}>Select department…</option>
                    {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </FormControl>
              </FormItem>
            )} />

            {/* Project */}
            <FormField control={form.control} name="projectId" render={({ field }) => (
              <FormItem>
                <FormLabel>Project</FormLabel>
                <FormControl>
                  <select
                    data-testid="select-project"
                    value={field.value}
                    onChange={e => field.onChange(Number(e.target.value))}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    disabled={!selectedDeptId || filteredProjects.length === 0}
                  >
                    <option value={0}>Select project…</option>
                    {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FormControl>
                {selectedDeptId > 0 && filteredProjects.length === 0 && (
                  <p className="text-xs text-muted-foreground">No projects assigned to this department.</p>
                )}
              </FormItem>
            )} />

            {/* Duration */}
            <div>
              <FormLabel>Duration</FormLabel>
              <div className="flex items-center gap-2 mt-1.5">
                <Controller
                  control={form.control}
                  name="hours"
                  render={({ field }) => (
                    <div className="flex items-center gap-1.5">
                      <Input
                        data-testid="input-hours"
                        type="number"
                        min={0}
                        max={23}
                        className="w-20 text-center"
                        {...field}
                        onChange={e => field.onChange(Number(e.target.value))}
                      />
                      <span className="text-sm text-muted-foreground">h</span>
                    </div>
                  )}
                />
                <Controller
                  control={form.control}
                  name="mins"
                  render={({ field }) => (
                    <div className="flex items-center gap-1.5">
                      <Input
                        data-testid="input-mins"
                        type="number"
                        min={0}
                        max={59}
                        className="w-20 text-center"
                        {...field}
                        onChange={e => field.onChange(Number(e.target.value))}
                      />
                      <span className="text-sm text-muted-foreground">min</span>
                    </div>
                  )}
                />
              </div>
            </div>

            {/* Description */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                <FormControl>
                  <Input data-testid="input-description" placeholder="What did you work on?" {...field} />
                </FormControl>
              </FormItem>
            )} />

            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                data-testid="button-submit-entry"
                disabled={createMut.isPending || updateMut.isPending || noSetup}
                className="gap-1.5"
              >
                {saved ? (
                  <><CheckCircle2 size={15} /> Saved</>
                ) : editId ? (
                  "Update Entry"
                ) : (
                  <><Plus size={15} /> Log Time</>
                )}
              </Button>
              {editId && (
                <Button variant="outline" onClick={cancelEdit} data-testid="button-cancel-edit">
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>

      {/* ── Recent entries ── */}
      <div>
        <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Clock size={16} className="text-muted-foreground" /> Recent Entries
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
            <Clock size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No time entries yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.slice(0, 20).map(entry => (
              <div
                key={entry.id}
                data-testid={`card-entry-${entry.id}`}
                className={cn(
                  "p-3 rounded-lg border bg-card transition-colors",
                  editId === entry.id && "border-primary/50 bg-accent/20"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="color-dot" style={{ background: projColor(entry.projectId) }} />
                      <span className="text-sm font-medium truncate">{projName(entry.projectId)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{formatDate(entry.date)}</span>
                      <span>·</span>
                      <span className="font-mono">{minutesToHHMM(entry.minutes)}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <span className="color-dot" style={{ background: orgColor(entry.organizationId) }} />
                        {orgName(entry.organizationId)}
                      </span>
                      <span>·</span>
                      <span>{deptName(entry.departmentId)}</span>
                    </div>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{entry.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      data-testid={`button-edit-entry-${entry.id}`}
                      onClick={() => startEdit(entry)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      data-testid={`button-delete-entry-${entry.id}`}
                      onClick={() => deleteMut.mutate(entry.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
