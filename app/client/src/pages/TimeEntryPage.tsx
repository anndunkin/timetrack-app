import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import {
  type Organization, type Department, type ProjectWithParsedDepts,
  type TimeEntry, insertTimeEntrySchema,
  type RecurringTask, type RecurringFrequency,
} from "@shared/schema";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Clock, Plus, CheckCircle2, Play, Square, TimerReset, RefreshCw, Pause } from "lucide-react";
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
  selectedDeptIds: number[];
  projectId: number;
  hours: number;
  mins: number;
  description: string;
};

const FREQ_LABELS: Record<RecurringFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

// ─── Timer display helper ────────────────────────────────────────────────────
function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [
    h > 0 ? String(h).padStart(2, "0") : null,
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].filter(Boolean).join(":");
}

export default function TimeEntryPage() {
  const { toast } = useToast();
  const [editId, setEditId] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  // ── Recurring UI state ───────────────────────────────────────────────────────
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurFrequency, setRecurFrequency] = useState<RecurringFrequency>("weekly");
  // Pending payload waiting for past-date confirmation (recurring only)
  const [pendingRecurPayload, setPendingRecurPayload] = useState<null | { recurPayload: object }>(null);

  // ── Timer state ─────────────────────────────────────────────────────────────
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);

  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });
  const { data: rawEntries = [], isLoading } = useQuery<TimeEntry[]>({ queryKey: ["/api/time-entries"] });
  // Normalize departmentIds — guard against legacy `departmentId` (singular)
  // or JSON-string values that arrive from older DB rows.
  const entries = useMemo(() => rawEntries.map((e: any) => {
    let dids: number[];
    if (Array.isArray(e.departmentIds)) {
      dids = e.departmentIds;
    } else if (typeof e.departmentIds === "string") {
      try { dids = JSON.parse(e.departmentIds); } catch { dids = []; }
    } else if (typeof e.departmentId === "number") {
      dids = [e.departmentId];
    } else {
      dids = [];
    }
    return { ...e, departmentIds: dids } as TimeEntry;
  }), [rawEntries]);
  const { data: recurringTasks = [], isLoading: recurLoading } = useQuery<RecurringTask[]>({
    queryKey: ["/api/recurring"],
  });

  const form = useForm<EntryForm>({
    defaultValues: {
      date: todayISO(),
      organizationId: 0,
      selectedDeptIds: [],
      projectId: 0,
      hours: 0,
      mins: 0,
      description: "",
    },
  });

  const selectedOrgId = Number(form.watch("organizationId"));
  const selectedDeptIds = form.watch("selectedDeptIds") ?? [];

  const filteredDepts = useMemo(
    () => allDepts.filter(d => d.organizationId === selectedOrgId),
    [allDepts, selectedOrgId]
  );

  const filteredProjects = useMemo(() => {
    if (selectedDeptIds.length === 0) return [];
    return allProjects.filter(p =>
      selectedDeptIds.every(dId => p.departmentIds.includes(dId))
    );
  }, [allProjects, selectedDeptIds]);

  useEffect(() => {
    if (orgs.length === 1 && form.getValues("organizationId") === 0) {
      form.setValue("organizationId", orgs[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs.length]);

  // Deep-link edit: the History page navigates to "/?edit=<id>" to open a
  // specific (possibly old) entry in this exact same inline edit form. Once
  // entries have loaded, find the requested entry, open it for editing, then
  // strip the query param so a refresh doesn't re-trigger the edit.
  useEffect(() => {
    if (entries.length === 0) return;
    const hash = window.location.hash; // e.g. "#/?edit=42"
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return;
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    const editParam = params.get("edit");
    if (!editParam) return;
    const id = Number(editParam);
    const target = entries.find(e => e.id === id);
    if (target) {
      startEdit(target);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    // Clear the query param from the hash without reloading.
    const base = hash.slice(0, qIndex);
    history.replaceState(null, "", base || "#/");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // ── Timer logic ──────────────────────────────────────────────────────────────
  function startTimer() {
    if (timerRunning) return;
    startTimeRef.current = Date.now();
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(accumulatedRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
  }

  function stopTimer() {
    if (!timerRunning) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    accumulatedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
    setElapsedSeconds(accumulatedRef.current);
    setTimerRunning(false);
  }

  function resetTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    accumulatedRef.current = 0;
    setElapsedSeconds(0);
    setTimerRunning(false);
  }

  function useTimerTime() {
    stopTimer();
    const totalSeconds = accumulatedRef.current;
    if (totalSeconds === 0) {
      toast({ title: "Timer is at 0:00", description: "Start the timer first.", variant: "destructive" });
      return;
    }
    const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
    form.setValue("hours", Math.floor(totalMinutes / 60));
    form.setValue("mins", totalMinutes % 60);
    toast({ title: "Timer time applied", description: `${minutesToHHMM(totalMinutes)} copied to duration.` });
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Dept toggle helper ───────────────────────────────────────────────────────
  function toggleDept(deptId: number) {
    const current = form.getValues("selectedDeptIds");
    const next = current.includes(deptId)
      ? current.filter(id => id !== deptId)
      : [...current, deptId];
    form.setValue("selectedDeptIds", next);
    form.setValue("projectId", 0);
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createRecurMut = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/recurring", data),
    onSuccess: () => {
      // Invalidate both the recurring list AND time-entries — the server fires
      // runDueRecurrences immediately on create, so new back-filled entries
      // exist in the DB by the time this callback runs.
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      // Reset form and show saved indicator (createMut is NOT called in the
      // recurring path, so we handle UX feedback here instead).
      form.reset({
        date: todayISO(),
        organizationId: form.getValues("organizationId"),
        selectedDeptIds: [],
        projectId: 0,
        hours: 0,
        mins: 0,
        description: "",
      });
      resetTimer();
      setMakeRecurring(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const updateRecurMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) =>
      apiRequest("PUT", `/api/recurring/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    },
  });

  const deleteRecurMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recurring/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
    },
  });

  const createMut = useMutation({
    mutationFn: (data: z.infer<typeof insertTimeEntrySchema>) =>
      apiRequest("POST", "/api/time-entries", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      form.reset({
        date: todayISO(),
        organizationId: form.getValues("organizationId"),
        selectedDeptIds: [],
        projectId: 0,
        hours: 0,
        mins: 0,
        description: "",
      });
      resetTimer();
      setMakeRecurring(false);
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
      form.reset({ date: todayISO(), organizationId: 0, selectedDeptIds: [], projectId: 0, hours: 0, mins: 0, description: "" });
      resetTimer();
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
    if (!vals.organizationId || vals.selectedDeptIds.length === 0 || !vals.projectId) {
      toast({ title: "Complete all fields", description: "Select org, at least one department, and a project", variant: "destructive" });
      return;
    }
    const payload = {
      date: vals.date,
      minutes,
      organizationId: Number(vals.organizationId),
      departmentIds: vals.selectedDeptIds,
      projectId: Number(vals.projectId),
      description: vals.description || null,
    };

    if (editId !== null) {
      updateMut.mutate({ id: editId, data: payload });
      return;
    }

    if (makeRecurring) {
      const recurPayload = {
        organizationId: payload.organizationId,
        departmentIds: payload.departmentIds,
        projectId: payload.projectId,
        description: payload.description,
        minutes: payload.minutes,
        frequency: recurFrequency,
        startDate: payload.date,
        enabled: 1,
      };

      // If the start date is in the past, ask the user to confirm before
      // creating the recurring template (which will back-fill all missed entries).
      // NOTE: we do NOT call createMut here — runDueRecurrences (called by the
      // recurring POST route) already inserts a time entry for every due date
      // including the start date, so calling createMut would produce a duplicate.
      if (payload.date < todayISO()) {
        setPendingRecurPayload({ recurPayload });
        return; // wait for confirmation
      }

      createRecurMut.mutate(recurPayload);
    } else {
      createMut.mutate(payload);
    }
  }

  function confirmPastDate() {
    if (!pendingRecurPayload) return;
    const { recurPayload } = pendingRecurPayload;
    setPendingRecurPayload(null);
    createRecurMut.mutate(recurPayload);
  }

  function cancelPastDate() {
    setPendingRecurPayload(null);
  }

  function startEdit(entry: TimeEntry) {
    setEditId(entry.id);
    resetTimer();
    setMakeRecurring(false);
    form.reset({
      date: entry.date,
      organizationId: entry.organizationId,
      selectedDeptIds: entry.departmentIds,
      projectId: entry.projectId,
      hours: Math.floor(entry.minutes / 60),
      mins: entry.minutes % 60,
      description: entry.description ?? "",
    });
  }

  function cancelEdit() {
    setEditId(null);
    resetTimer();
    setMakeRecurring(false);
    form.reset({ date: todayISO(), organizationId: 0, selectedDeptIds: [], projectId: 0, hours: 0, mins: 0, description: "" });
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

        {/* ── Timer panel ── */}
        <div className="mb-6 p-4 rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-muted-foreground shrink-0" />
              <span className={cn("font-mono text-2xl font-semibold tabular-nums tracking-tight", timerRunning && "text-primary")}>
                {formatElapsed(elapsedSeconds)}
              </span>
              {timerRunning && <span className="text-xs text-primary animate-pulse font-medium">RUNNING</span>}
            </div>
            <div className="flex items-center gap-2">
              {!timerRunning ? (
                <Button type="button" size="sm" variant="outline" onClick={startTimer} disabled={noSetup} className="gap-1.5">
                  <Play size={13} /> Start
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={stopTimer} className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10">
                  <Square size={13} /> Stop
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={useTimerTime} disabled={elapsedSeconds === 0} className="gap-1.5 text-muted-foreground" title="Copy elapsed time to duration fields">
                <TimerReset size={13} /> Use Time
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={resetTimer} disabled={elapsedSeconds === 0} className="text-muted-foreground px-2" title="Reset timer">
                ✕
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Start the timer, then click <strong>Use Time</strong> to copy elapsed time into the duration fields below.
          </p>
        </div>

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
                    onChange={e => {
                      const orgId = Number(e.target.value);
                      field.onChange(orgId);
                      form.setValue("selectedDeptIds", []);
                      form.setValue("projectId", 0);
                    }}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                    disabled={noSetup}
                  >
                    <option value={0}>Select organization…</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FormControl>
              </FormItem>
            )} />

            {/* Departments */}
            <FormItem>
              <FormLabel>
                Department{filteredDepts.length !== 1 ? "s" : ""}
                {selectedDeptIds.length > 1 && (
                  <span className="ml-2 text-xs font-normal text-primary">
                    Time will be split equally across {selectedDeptIds.length} departments
                  </span>
                )}
              </FormLabel>
              {!selectedOrgId || filteredDepts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {selectedOrgId ? "No departments in this organization." : "Select an organization first."}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-1">
                  {filteredDepts.map(d => {
                    const checked = selectedDeptIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDept(d.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-md border text-sm font-medium transition-colors",
                          checked
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-input hover:bg-muted"
                        )}
                      >
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedDeptIds.length > 1 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Only projects assigned to <em>all</em> selected departments are shown below.
                </p>
              )}
            </FormItem>

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
                    disabled={selectedDeptIds.length === 0 || filteredProjects.length === 0}
                  >
                    <option value={0}>Select project…</option>
                    {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FormControl>
                {selectedDeptIds.length > 0 && filteredProjects.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No projects are assigned to all selected departments.
                  </p>
                )}
              </FormItem>
            )} />

            {/* Duration */}
            <div>
              <FormLabel>Duration <span className="text-xs font-normal text-muted-foreground">(total — split evenly if multiple depts)</span></FormLabel>
              <div className="flex items-center gap-2 mt-1.5">
                <Controller control={form.control} name="hours" render={({ field }) => (
                  <div className="flex items-center gap-1.5">
                    <Input data-testid="input-hours" type="number" min={0} max={23} className="w-20 text-center" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                    <span className="text-sm text-muted-foreground">h</span>
                  </div>
                )} />
                <Controller control={form.control} name="mins" render={({ field }) => (
                  <div className="flex items-center gap-1.5">
                    <Input data-testid="input-mins" type="number" min={0} max={59} className="w-20 text-center" {...field} onChange={e => field.onChange(Number(e.target.value))} />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                )} />
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

            {/* Make Recurring — only shown on new entries */}
            {editId === null && (
              <div className="pt-1 border-t border-border">
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => setMakeRecurring(v => !v)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      makeRecurring ? "bg-primary" : "bg-input"
                    )}
                    role="switch"
                    aria-checked={makeRecurring}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        makeRecurring ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <RefreshCw size={13} className="text-muted-foreground" />
                    Make this a recurring task
                  </span>
                </div>

                {makeRecurring && (
                  <div className="mt-3 ml-12">
                    <p className="text-xs text-muted-foreground mb-2">Repeat frequency</p>
                    <div className="flex gap-2">
                      {(["daily", "weekly", "monthly"] as RecurringFrequency[]).map(f => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setRecurFrequency(f)}
                          className={cn(
                            "px-3 py-1.5 rounded-md border text-sm font-medium transition-colors",
                            recurFrequency === f
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-foreground border-input hover:bg-muted"
                          )}
                        >
                          {FREQ_LABELS[f]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      A time entry with this org, dept, project, duration, and description will be auto-created on each {recurFrequency === "daily" ? "day" : recurFrequency === "weekly" ? "week" : "month"} when the app opens.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="submit" data-testid="button-submit-entry" disabled={createMut.isPending || updateMut.isPending || noSetup} className="gap-1.5">
                {saved ? <><CheckCircle2 size={15} /> Saved</> : editId ? "Update Entry" : <><Plus size={15} /> Log Time</>}
              </Button>
              {editId && (
                <Button variant="outline" onClick={cancelEdit} data-testid="button-cancel-edit">Cancel</Button>
              )}
            </div>
          </form>
        </Form>

        {/* ── Past-date confirmation dialog ── */}
        {pendingRecurPayload && (() => {
          const { recurPayload } = pendingRecurPayload;
          const rp = recurPayload as any;
          const freq: RecurringFrequency = rp.frequency;
          const startDate: string = rp.startDate;
          // Calculate how many back-filled entries will be created
          function countMissed(f: RecurringFrequency, start: string): number {
            const today = todayISO();
            if (start >= today) return 0;
            const toMs = (s: string) => new Date(s + "T00:00:00").getTime();
            const startMs = toMs(start);
            const todayMs = toMs(today);
            const cursor = new Date(startMs);
            let count = 1; // start date itself
            while (true) {
              if (f === "daily") cursor.setDate(cursor.getDate() + 1);
              else if (f === "weekly") cursor.setDate(cursor.getDate() + 7);
              else cursor.setMonth(cursor.getMonth() + 1);
              if (cursor.getTime() > todayMs) break;
              count++;
            }
            return count;
          }
          const missed = countMissed(freq, startDate);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-card border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
                <h3 className="text-base font-semibold mb-2">Start date is in the past</h3>
                <p className="text-sm text-muted-foreground mb-1">
                  You selected <strong>{formatDate(startDate)}</strong> as the start date for a <strong>{FREQ_LABELS[freq]}</strong> recurring task.
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  This will create <strong>{missed} time {missed === 1 ? "entry" : "entries"}</strong> — one for each {freq === "daily" ? "day" : freq === "weekly" ? "week" : "month"} from that date through today.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={cancelPastDate}>Cancel</Button>
                  <Button size="sm" onClick={confirmPastDate}>Yes, create {missed} {missed === 1 ? "entry" : "entries"}</Button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Recurring Tasks panel ── */}
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <RefreshCw size={15} className="text-muted-foreground" /> Recurring Tasks
          </h2>

          {recurLoading ? (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : recurringTasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
              <RefreshCw size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No recurring tasks yet</p>
              <p className="text-xs mt-1">Toggle "Make this a recurring task" when logging time to create one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recurringTasks.map(task => (
                <div
                  key={task.id}
                  className={cn(
                    "p-3 rounded-lg border bg-card",
                    task.enabled === 0 && "opacity-60"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="color-dot" style={{ background: projColor(task.projectId) }} />
                        <span className="text-sm font-medium truncate">{projName(task.projectId)}</span>
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded font-medium",
                          task.enabled === 1
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {task.enabled === 1 ? FREQ_LABELS[task.frequency] : "Paused"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono">{minutesToHHMM(task.minutes)}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <span className="color-dot" style={{ background: orgColor(task.organizationId) }} />
                          {orgName(task.organizationId)}
                        </span>
                        <span>·</span>
                        <span>{task.departmentIds.map(id => deptName(id)).join(", ")}</span>
                        <span>·</span>
                        <span>Started {formatDate(task.startDate)}</span>
                        {task.lastRun && (
                          <>
                            <span>·</span>
                            <span>Last run {formatDate(task.lastRun)}</span>
                          </>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{task.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Pause / Resume toggle */}
                      <button
                        title={task.enabled === 1 ? "Pause recurring task" : "Resume recurring task"}
                        onClick={() => updateRecurMut.mutate({ id: task.id, data: { enabled: task.enabled === 1 ? 0 : 1 } })}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {task.enabled === 1 ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button
                        title="Delete recurring task"
                        onClick={() => deleteRecurMut.mutate(task.id)}
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

      {/* ── Recent entries ── */}
      <div>
        <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
          <Clock size={16} className="text-muted-foreground" /> Recent Entries
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
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
                className={cn("p-3 rounded-lg border bg-card transition-colors", editId === entry.id && "border-primary/50 bg-accent/20")}
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
                      {entry.departmentIds.length > 1 && (
                        <>
                          <span>·</span>
                          <span className="text-primary font-medium">÷{entry.departmentIds.length} depts</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <span className="color-dot" style={{ background: orgColor(entry.organizationId) }} />
                        {orgName(entry.organizationId)}
                      </span>
                      <span>·</span>
                      <span>{entry.departmentIds.map(id => deptName(id)).join(", ")}</span>
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
