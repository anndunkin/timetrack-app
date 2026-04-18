import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  type Organization, type Department, type ProjectWithParsedDepts, type TimeEntry, type Settings,
} from "@shared/schema";
import { Clock, TrendingUp, Calendar } from "lucide-react";
import { minutesToHHMM, minutesToDecimal, getYearRange, formatDate } from "@/lib/utils";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Elapsed-period helpers ───────────────────────────────────────────────────

/**
 * Count the number of elapsed complete + partial weeks between yearStart and
 * today (inclusive). Always at least 1.
 */
function elapsedWeeks(yearStart: string): number {
  const start = new Date(yearStart + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return 1;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((today.getTime() - start.getTime() + 1) / msPerWeek));
}

/**
 * Count the number of elapsed months (complete + partial) between yearStart
 * and today. Always at least 1.
 */
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

export default function AnnualPage() {
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });

  const yearStartMonth = settings?.yearStartMonth ?? 1;
  const yearStartDay = settings?.yearStartDay ?? 1;
  const { start: yearStart, end: yearEnd } = getYearRange(yearStartMonth, yearStartDay);

  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries/annual", yearStart, yearEnd],
    queryFn: () => apiRequest("GET", `/api/time-entries?start=${yearStart}&end=${yearEnd}`),
    enabled: !!settings,
  });

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? "—"; }
  function orgColor(id: number) { return orgs.find(o => o.id === id)?.color ?? "#ccc"; }
  function deptName(id: number) { return allDepts.find(d => d.id === id)?.name ?? "—"; }
  function projName(id: number) { return allProjects.find(p => p.id === id)?.name ?? "—"; }
  function projColor(id: number) { return allProjects.find(p => p.id === id)?.color ?? "#ccc"; }

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);

  // Elapsed periods (capped to the year — don't go beyond yearEnd)
  const weeks  = elapsedWeeks(yearStart);
  const months = elapsedMonths(yearStart);

  // By month (use ISO month of entry date)
  const byMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      const mo = e.date.slice(0, 7);
      map[mo] = (map[mo] ?? 0) + e.minutes;
    }
    return map;
  }, [entries]);

  // Build ordered months list for the custom year
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

  // By org — entries count at face value (no split by dept here)
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

  // By dept — split time equally when entry covers multiple departments.
  // e.g. 60 min across 2 depts → 30 min each.
  const byDept = useMemo(() => {
    const map: Record<number, { name: string; minutes: number; orgName: string }> = {};
    for (const e of entries) {
      const deptCount = e.departmentIds.length || 1;
      const splitMins = e.minutes / deptCount;
      for (const dId of e.departmentIds) {
        if (!map[dId]) {
          map[dId] = { name: deptName(dId), minutes: 0, orgName: orgName(e.organizationId) };
        }
        map[dId].minutes += splitMins;
      }
    }
    // Round to nearest minute for display
    return Object.values(map)
      .map(d => ({ ...d, minutes: Math.round(d.minutes) }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [entries, allDepts]);

  // By project — full time (not split)
  const byProject = useMemo(() => {
    const map: Record<number, { name: string; color: string; minutes: number; budgetHours?: number | null }> = {};
    for (const e of entries) {
      if (!map[e.projectId]) {
        const proj = allProjects.find(p => p.id === e.projectId);
        map[e.projectId] = { name: projName(e.projectId), color: projColor(e.projectId), minutes: 0, budgetHours: proj?.budgetHours };
      }
      map[e.projectId].minutes += e.minutes;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, allProjects]);

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

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-lg border bg-card">
          <p className="text-xs text-muted-foreground mb-1">Total Hours</p>
          <p className="text-xl font-semibold font-mono" data-testid="annual-total-hours">{minutesToDecimal(totalMinutes)}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <p className="text-xs text-muted-foreground mb-1">Entries</p>
          <p className="text-xl font-semibold">{entries.length}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <p className="text-xs text-muted-foreground mb-1">Avg / Week</p>
          <p className="text-xl font-semibold font-mono">
            {minutesToDecimal(Math.round(totalMinutes / weeks))}h
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">over {weeks} wk{weeks !== 1 ? "s" : ""}</p>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <p className="text-xs text-muted-foreground mb-1">Avg / Month</p>
          <p className="text-xl font-semibold font-mono">
            {minutesToDecimal(Math.round(totalMinutes / months))}h
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">over {months} mo{months !== 1 ? "s" : ""}</p>
        </div>
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

            {/* By Department — time split equally for multi-dept entries */}
            {byDept.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3">
                  By Department
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(time split equally for multi-dept entries)</span>
                </h2>
                <div className="space-y-2">
                  {byDept.map(d => (
                    <div key={d.name} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between mb-1.5">
                        <div>
                          <span className="text-sm font-medium">{d.name}</span>
                          <span className="text-xs text-muted-foreground ml-1.5">{d.orgName}</span>
                        </div>
                        <span className="text-sm font-mono tabular-nums">{minutesToDecimal(d.minutes)}h</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${Math.round((d.minutes / totalMinutes) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* By Project with budget */}
          <section>
            <h2 className="text-sm font-semibold mb-3">By Project</h2>
            <div className="space-y-2">
              {byProject.map(p => {
                const budgetMins = p.budgetHours ? p.budgetHours * 60 : null;
                const pct = budgetMins ? Math.min(100, Math.round((p.minutes / budgetMins) * 100)) : null;
                const overBudget = budgetMins ? p.minutes > budgetMins : false;
                return (
                  <div key={p.name} className="p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="color-dot" style={{ background: p.color }} />
                      <span className="text-sm font-medium flex-1">{p.name}</span>
                      <span className="text-sm font-mono tabular-nums">{minutesToDecimal(p.minutes)}h</span>
                      {p.budgetHours && (
                        <span className={`text-xs font-mono tabular-nums ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
                          / {p.budgetHours}h
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      {pct !== null ? (
                        <div className={`h-full rounded-full transition-all ${overBudget ? "bg-destructive" : "bg-primary/70"}`} style={{ width: `${pct}%` }} />
                      ) : (
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((p.minutes / maxProjectMins) * 100)}%`, background: p.color }} />
                      )}
                    </div>
                    {pct !== null && (
                      <p className={`text-xs mt-1 ${overBudget ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {overBudget ? `${pct - 100}% over budget` : `${pct}% of budget used`}
                      </p>
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
