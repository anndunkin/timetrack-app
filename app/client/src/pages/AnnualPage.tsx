import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  type Organization, type Department, type ProjectWithParsedDepts, type TimeEntry, type Settings,
} from "@shared/schema";
import { Clock, TrendingUp, Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { minutesToHHMM, minutesToDecimal, getYearRange, formatDate } from "@/lib/utils";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Elapsed-period helpers ───────────────────────────────────────────────────
function elapsedWeeks(yearStart: string): number {
  const start = new Date(yearStart + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((today.getTime() - start.getTime() + 1) / msPerWeek));
}

function elapsedMonths(yearStart: string): number {
  const start = new Date(yearStart + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return 1;
  const months =
    (today.getFullYear() - start.getFullYear()) * 12 +
    (today.getMonth() - start.getMonth()) +
    (today.getDate() >= start.getDate() ? 1 : 0);
  return Math.max(1, months);
}

// ── Small metric box ────────────────────────────────────────────────────────
function MetricBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-2.5 rounded-lg border bg-muted/40 min-w-[110px] text-center">
      <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
      <p className="text-lg font-semibold font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Drill-down entry list ─────────────────────────────────────────────────────
function EntryList({
  entries,
  projName,
  projColor,
}: {
  entries: TimeEntry[];
  projName: (id: number) => string;
  projColor: (id: number) => string;
}) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="mt-2 ml-4 border-l-2 border-primary/20 pl-3 space-y-1">
      {sorted.map(e => (
        <div key={e.id} className="flex items-start justify-between gap-2 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2 min-w-0">
            <span className="color-dot shrink-0" style={{ background: projColor(e.projectId) }} />
            <span className="text-xs font-medium truncate">{projName(e.projectId)}</span>
            {e.description && (
              <span className="text-xs text-muted-foreground truncate">— {e.description}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
            <span>{formatDate(e.date)}</span>
            <span className="font-mono tabular-nums text-foreground">{minutesToHHMM(e.minutes)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnnualPage() {
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });

  const yearStartMonth = settings?.yearStartMonth ?? 1;
  const yearStartDay = settings?.yearStartDay ?? 1;
  const { start: yearStart, end: yearEnd } = getYearRange(yearStartMonth, yearStartDay);

  const { data: rawEntries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries/annual", yearStart, yearEnd],
    queryFn: () => apiRequest("GET", `/api/time-entries?start=${yearStart}&end=${yearEnd}`),
    enabled: !!settings,
  });
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

  // Drill-down open state: "dept-<id>" or "proj-<id>"
  const [openKey, setOpenKey] = useState<string | null>(null);
  function toggle(key: string) {
    setOpenKey(prev => prev === key ? null : key);
  }

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? "—"; }
  function orgColor(id: number) { return orgs.find(o => o.id === id)?.color ?? "#ccc"; }
  function deptName(id: number) { return allDepts.find(d => d.id === id)?.name ?? "—"; }
  function projName(id: number) { return allProjects.find(p => p.id === id)?.name ?? "—"; }
  function projColor(id: number) { return allProjects.find(p => p.id === id)?.color ?? "#ccc"; }

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
  const weeks  = elapsedWeeks(yearStart);
  const months = elapsedMonths(yearStart);

  const byMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      const mo = e.date.slice(0, 7);
      map[mo] = (map[mo] ?? 0) + e.minutes;
    }
    return map;
  }, [entries]);

  const monthList = useMemo(() => {
    const list: string[] = [];
    const d = new Date(yearStart + "T00:00:00");
    while (d.toISOString().slice(0, 10) <= yearEnd) {
      const key = d.toISOString().slice(0, 7);
      if (!list.includes(key)) list.push(key);
      d.setMonth(d.getMonth() + 1);
    }
    return list;
  }, [yearStart, yearEnd]);

  const byOrg = useMemo(() => {
    const map: Record<number, { name: string; color: string; minutes: number }> = {};
    for (const e of entries) {
      if (!map[e.organizationId]) {
        map[e.organizationId] = { name: orgName(e.organizationId), color: orgColor(e.organizationId), minutes: 0 };
      }
      map[e.organizationId].minutes += e.minutes;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, orgs]);

  // By dept — split time equally; also keep a map of deptId → entries that touch it
  const byDept = useMemo(() => {
    const map: Record<number, { id: number; name: string; minutes: number; orgName: string }> = {};
    for (const e of entries) {
      const deptCount = e.departmentIds.length || 1;
      const splitMins = e.minutes / deptCount;
      for (const dId of e.departmentIds) {
        if (!map[dId]) map[dId] = { id: dId, name: deptName(dId), minutes: 0, orgName: orgName(e.organizationId) };
        map[dId].minutes += splitMins;
      }
    }
    return Object.values(map)
      .map(d => ({ ...d, minutes: Math.round(d.minutes) }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [entries, allDepts]);

  // By project — full time; keep projectId for drill-down lookup
  const byProject = useMemo(() => {
    const map: Record<number, { id: number; name: string; color: string; minutes: number; budgetHours?: number | null }> = {};
    for (const e of entries) {
      if (!map[e.projectId]) {
        const proj = allProjects.find(p => p.id === e.projectId);
        map[e.projectId] = { id: e.projectId, name: projName(e.projectId), color: projColor(e.projectId), minutes: 0, budgetHours: proj?.budgetHours };
      }
      map[e.projectId].minutes += e.minutes;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, allProjects]);

  // Entries keyed by deptId and projectId for drill-down
  const entriesByDept = useMemo(() => {
    const map: Record<number, TimeEntry[]> = {};
    for (const e of entries) {
      for (const dId of e.departmentIds) {
        if (!map[dId]) map[dId] = [];
        map[dId].push(e);
      }
    }
    return map;
  }, [entries]);

  const entriesByProject = useMemo(() => {
    const map: Record<number, TimeEntry[]> = {};
    for (const e of entries) {
      if (!map[e.projectId]) map[e.projectId] = [];
      map[e.projectId].push(e);
    }
    return map;
  }, [entries]);

  const maxMonthMins = Math.max(...Object.values(byMonth), 1);
  const maxProjectMins = Math.max(...byProject.map(p => p.minutes), 1);

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Annual Summary</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            <Calendar size={12} className="inline mr-1" />
            {formatDate(yearStart)} — {formatDate(yearEnd)}
          </p>
        </div>
      </div>

      {/* KPI rows — org name on left, three metric boxes on right */}
      <div className="space-y-2 mb-8">

        {/* Overall row */}
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-card" data-testid="annual-total-row">
          <p className="text-sm font-semibold flex-1">All Organizations</p>
          <div className="flex items-center gap-2">
            <MetricBox label="Total Hours" value={`${minutesToDecimal(totalMinutes)}h`} />
            <MetricBox label="Avg / Week"  value={`${minutesToDecimal(Math.round(totalMinutes / weeks))}h`}  sub={`over ${weeks} wk${weeks !== 1 ? "s" : ""}`} />
            <MetricBox label="Avg / Month" value={`${minutesToDecimal(Math.round(totalMinutes / months))}h`} sub={`over ${months} mo${months !== 1 ? "s" : ""}`} />
          </div>
        </div>

        {/* Per-org rows */}
        {byOrg.map(o => (
          <div key={o.name} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="color-dot shrink-0" style={{ background: o.color }} />
              <p className="text-sm font-medium truncate">{o.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <MetricBox label="Total Hours" value={`${minutesToDecimal(o.minutes)}h`} />
              <MetricBox label="Avg / Week"  value={`${minutesToDecimal(Math.round(o.minutes / weeks))}h`} />
              <MetricBox label="Avg / Month" value={`${minutesToDecimal(Math.round(o.minutes / months))}h`} />
            </div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <Clock size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No entries for this year</p>
          <p className="text-sm">Log time on the Log Time page.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Monthly bar chart */}
          <section>
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <TrendingUp size={15} /> Monthly Breakdown
            </h2>
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-end gap-1.5 h-32">
                {monthList.map(mo => {
                  const mins = byMonth[mo] ?? 0;
                  const height = mins > 0 ? Math.max(4, Math.round((mins / maxMonthMins) * 100)) : 0;
                  const [y, m] = mo.split("-").map(Number);
                  return (
                    <div key={mo} className="flex-1 flex flex-col items-center gap-1 group">
                      <div className="w-full flex flex-col justify-end h-24 relative">
                        {mins > 0 && (
                          <div
                            className="w-full rounded-t bg-primary/80 group-hover:bg-primary transition-all"
                            style={{ height: `${height}%` }}
                            title={`${MONTH_NAMES[m-1]} ${y}: ${minutesToDecimal(mins)}h`}
                          />
                        )}
                        {mins === 0 && <div className="w-full h-0.5 bg-border rounded" />}
                      </div>
                      <span className="text-xs text-muted-foreground">{MONTH_NAMES[m-1]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* By Organization */}
            {byOrg.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3">By Organization</h2>
                <div className="space-y-2">
                  {byOrg.map(o => (
                    <div key={o.name} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="color-dot" style={{ background: o.color }} />
                          <span className="text-sm font-medium">{o.name}</span>
                        </div>
                        <span className="text-sm font-mono tabular-nums">{minutesToDecimal(o.minutes)}h</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((o.minutes / totalMinutes) * 100)}%`, background: o.color }} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{Math.round((o.minutes / totalMinutes) * 100)}% of total</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* By Department — drillable */}
            {byDept.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3">
                  By Department
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(time split equally for multi-dept entries)</span>
                </h2>
                <div className="space-y-2">
                  {byDept.map(d => {
                    const key = `dept-${d.id}`;
                    const isOpen = openKey === key;
                    const deptEntries = entriesByDept[d.id] ?? [];
                    return (
                      <div key={d.id} className="rounded-lg border bg-card overflow-hidden">
                        {/* Clickable header row */}
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          className="w-full p-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              {isOpen
                                ? <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                                : <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                              }
                              <span className="text-sm font-medium">{d.name}</span>
                              <span className="text-xs text-muted-foreground">{d.orgName}</span>
                              <span className="text-xs text-muted-foreground">({deptEntries.length} {deptEntries.length === 1 ? "entry" : "entries"})</span>
                            </div>
                            <span className="text-sm font-mono tabular-nums">{minutesToDecimal(d.minutes)}h</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${Math.round((d.minutes / totalMinutes) * 100)}%` }} />
                          </div>
                        </button>
                        {/* Drill-down list */}
                        {isOpen && (
                          <div className="px-3 pb-3">
                            <EntryList
                              entries={deptEntries}
                              projName={projName}
                              projColor={projColor}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {/* By Project — drillable */}
          <section>
            <h2 className="text-sm font-semibold mb-3">By Project</h2>
            <div className="space-y-2">
              {byProject.map(p => {
                const key = `proj-${p.id}`;
                const isOpen = openKey === key;
                const projEntries = entriesByProject[p.id] ?? [];
                const budgetMins = p.budgetHours ? p.budgetHours * 60 : null;
                const pct = budgetMins ? Math.min(100, Math.round((p.minutes / budgetMins) * 100)) : null;
                const overBudget = budgetMins ? p.minutes > budgetMins : false;
                return (
                  <div key={p.id} className="rounded-lg border bg-card overflow-hidden">
                    {/* Clickable header row */}
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="w-full p-3 text-left hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        {isOpen
                          ? <ChevronDown size={13} className="text-muted-foreground shrink-0" />
                          : <ChevronRight size={13} className="text-muted-foreground shrink-0" />
                        }
                        <span className="color-dot shrink-0" style={{ background: p.color }} />
                        <span className="text-sm font-medium flex-1">{p.name}</span>
                        <span className="text-xs text-muted-foreground">({projEntries.length} {projEntries.length === 1 ? "entry" : "entries"})</span>
                        <span className="text-sm font-mono tabular-nums">{minutesToDecimal(p.minutes)}h</span>
                        {p.budgetHours && (
                          <span className={`text-xs font-mono tabular-nums ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
                            / {p.budgetHours}h
                          </span>
                        )}
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden ml-5">
                        {pct !== null ? (
                          <div className={`h-full rounded-full transition-all ${overBudget ? "bg-destructive" : "bg-primary/70"}`} style={{ width: `${pct}%` }} />
                        ) : (
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((p.minutes / maxProjectMins) * 100)}%`, background: p.color }} />
                        )}
                      </div>
                      {pct !== null && (
                        <p className={`text-xs mt-1 ml-5 ${overBudget ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {overBudget ? `${pct - 100}% over budget` : `${pct}% of budget used`}
                        </p>
                      )}
                    </button>
                    {/* Drill-down list */}
                    {isOpen && (
                      <div className="px-3 pb-3">
                        <EntryList
                          entries={projEntries}
                          projName={projName}
                          projColor={projColor}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
