import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  type Organization, type Department, type ProjectWithParsedDepts, type TimeEntry,
} from "@shared/schema";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  minutesToHHMM, minutesToDecimal, formatDate, todayISO,
  getMonthRange, currentYearMonth, MONTH_NAMES_LONG,
} from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** All calendar days in a month as YYYY-MM-DD strings. */
function monthDays(year: number, month: number): string[] {
  const days: string[] = [];
  const { start, end } = getMonthRange(year, month);
  const d = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (d <= last) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    days.push(`${y}-${mo}-${dy}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Group a list of YYYY-MM-DD strings into week rows (Sun–Sat). */
function groupIntoWeeks(days: string[]): string[][] {
  if (!days.length) return [];
  const weeks: string[][] = [];
  // Pad the first week with empty strings before the first day
  const firstDow = new Date(days[0] + "T00:00:00").getDay(); // 0=Sun
  let current: string[] = Array(firstDow).fill("");
  for (const day of days) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length) {
    while (current.length < 7) current.push("");
    weeks.push(current);
  }
  return weeks;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MonthlyPage() {
  const today = currentYearMonth();
  const [year, setYear]   = useState(today.year);
  const [month, setMonth] = useState(today.month);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }
  function thisMonth() {
    setYear(today.year);
    setMonth(today.month);
  }

  const { start: monthStart, end: monthEnd } = getMonthRange(year, month);

  const { data: orgs = [] }        = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] }    = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });
  const { data: rawEntries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries", monthStart, monthEnd],
    queryFn: () => apiRequest("GET", `/api/time-entries?start=${monthStart}&end=${monthEnd}`),
  });

  // Normalize departmentIds (same guard as Weekly/Annual)
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

  function orgName(id: number)   { return orgs.find(o => o.id === id)?.name  ?? "—"; }
  function orgColor(id: number)  { return orgs.find(o => o.id === id)?.color ?? "#ccc"; }
  function deptName(id: number)  { return allDepts.find(d => d.id === id)?.name  ?? "—"; }
  function projName(id: number)  { return allProjects.find(p => p.id === id)?.name  ?? "—"; }
  function projColor(id: number) { return allProjects.find(p => p.id === id)?.color ?? "#ccc"; }

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);

  // Per-org totals for top summary
  const byOrg = useMemo(() => {
    const map: Record<number, { name: string; color: string; minutes: number }> = {};
    for (const e of entries) {
      if (!map[e.organizationId]) {
        map[e.organizationId] = {
          name:    orgName(e.organizationId),
          color:   orgColor(e.organizationId),
          minutes: 0,
        };
      }
      map[e.organizationId].minutes += e.minutes;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, orgs]);

  // Entries indexed by date for O(1) lookup
  const byDay = useMemo(() => {
    const map: Record<string, TimeEntry[]> = {};
    for (const e of entries) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [entries]);

  // Project summary sidebar
  const byProject = useMemo(() => {
    const map: Record<number, { name: string; color: string; minutes: number; deptNames: string[] }> = {};
    for (const e of entries) {
      if (!map[e.projectId]) {
        map[e.projectId] = { name: projName(e.projectId), color: projColor(e.projectId), minutes: 0, deptNames: [] };
      }
      map[e.projectId].minutes += e.minutes;
      for (const dId of e.departmentIds) {
        const dn = deptName(dId);
        if (!map[e.projectId].deptNames.includes(dn)) map[e.projectId].deptNames.push(dn);
      }
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, allDepts, allProjects]);

  const days  = useMemo(() => monthDays(year, month), [year, month]);
  const weeks = useMemo(() => groupIntoWeeks(days), [days]);

  // Max daily minutes for relative bar widths
  const maxDayMins = useMemo(() =>
    Math.max(...days.map(d => (byDay[d] ?? []).reduce((s, e) => s + e.minutes, 0)), 1),
    [days, byDay]);

  const todayStr = todayISO();
  const isCurrentMonth = year === today.year && month === today.month;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Monthly Summary</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDate(monthStart)} — {formatDate(monthEnd)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={thisMonth} disabled={isCurrentMonth}>
            This month
          </Button>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Month + year label */}
      <h2 className="text-lg font-semibold mb-4">
        {MONTH_NAMES_LONG[month - 1]} {year}
      </h2>

      {/* Per-org totals */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
          <p className="text-sm font-semibold">Total Hours</p>
          <p className="text-xl font-semibold font-mono">{minutesToDecimal(totalMinutes)}h</p>
        </div>
        {byOrg.map(o => (
          <div key={o.name} className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <span className="color-dot shrink-0" style={{ background: o.color }} />
              <p className="text-sm font-medium truncate">{o.name}</p>
            </div>
            <p className="text-lg font-semibold font-mono tabular-nums shrink-0">{minutesToDecimal(o.minutes)}h</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <Clock size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No entries this month</p>
          <p className="text-sm">Log time on the Log Time page.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
          {/* Calendar grid + day entry list */}
          <div className="space-y-4">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 gap-1">
              {DAY_LABELS.map(d => (
                <div key={d} className="text-xs text-muted-foreground text-center py-1 font-medium">
                  {d}
                </div>
              ))}
            </div>

            {/* Week rows — mini calendar cells */}
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((day, di) => {
                  if (!day) return <div key={di} />;
                  const dayEntries = byDay[day] ?? [];
                  const dayMins = dayEntries.reduce((s, e) => s + e.minutes, 0);
                  const isToday = day === todayStr;
                  const barW = dayMins > 0 ? Math.max(4, Math.round((dayMins / maxDayMins) * 100)) : 0;
                  return (
                    <div
                      key={day}
                      className={`rounded-lg border bg-card overflow-hidden ${dayMins === 0 ? "opacity-50" : ""}`}
                    >
                      {/* Day header */}
                      <div className={`flex items-center justify-between px-2 py-1.5 border-b border-border/40 ${isToday ? "bg-primary/5" : ""}`}>
                        <span className={`text-xs font-medium ${isToday ? "text-primary" : ""}`}>
                          {parseInt(day.slice(8), 10)}
                          {isToday && <span className="ml-1 text-[10px] bg-primary/15 text-primary px-1 rounded">Today</span>}
                        </span>
                        {dayMins > 0 && (
                          <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                            {minutesToHHMM(dayMins)}
                          </span>
                        )}
                      </div>
                      {/* Mini bar */}
                      {barW > 0 && (
                        <div className="px-1.5 pt-1">
                          <div className="h-1 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${barW}%` }} />
                          </div>
                        </div>
                      )}
                      {/* Entry dots */}
                      {dayEntries.length > 0 && (
                        <div className="px-1.5 py-1 flex flex-wrap gap-0.5">
                          {dayEntries.map(e => (
                            <span
                              key={e.id}
                              className="inline-block w-1.5 h-1.5 rounded-full"
                              style={{ background: projColor(e.projectId) }}
                              title={`${projName(e.projectId)} — ${minutesToHHMM(e.minutes)}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Day-by-day entry list below calendar */}
            <div className="mt-4 space-y-3">
              {days
                .filter(day => (byDay[day] ?? []).length > 0)
                .map(day => {
                  const dayEntries = byDay[day];
                  const dayMins = dayEntries.reduce((s, e) => s + e.minutes, 0);
                  const isToday = day === todayStr;
                  const barWidth = dayMins > 0 ? Math.round((dayMins / maxDayMins) * 100) : 0;
                  const dow = new Date(day + "T00:00:00").getDay();
                  return (
                    <div key={day} className="rounded-lg border bg-card overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>
                            {DAY_LABELS[dow]}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatDate(day)}</span>
                          {isToday && (
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Today</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {barWidth > 0 && (
                            <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${barWidth}%` }} />
                            </div>
                          )}
                          <span className="text-sm font-mono font-medium tabular-nums w-16 text-right">
                            {minutesToHHMM(dayMins)}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-border/30">
                        {dayEntries.map(e => (
                          <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                            <span className="color-dot mt-1" style={{ background: projColor(e.projectId) }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="text-sm font-medium">{projName(e.projectId)}</span>
                                <span className="text-xs text-muted-foreground">
                                  {e.departmentIds.map(id => deptName(id)).join(", ")}
                                </span>
                              </div>
                              {e.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line line-clamp-2">
                                  {e.description}
                                </p>
                              )}
                            </div>
                            <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0 mt-0.5">
                              {minutesToHHMM(e.minutes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Project summary sidebar */}
          <div>
            <h2 className="text-sm font-semibold mb-3">By Project</h2>
            <div className="space-y-2">
              {byProject.map(p => (
                <div key={`${p.name}-${p.color}`} className="p-3 rounded-lg border bg-card">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="color-dot" style={{ background: p.color }} />
                    <span className="text-sm font-medium flex-1 truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{p.deptNames.join(", ")}</span>
                    <span className="text-sm font-mono font-medium tabular-nums">{minutesToDecimal(p.minutes)}h</span>
                  </div>
                  <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${totalMinutes > 0 ? Math.round((p.minutes / totalMinutes) * 100) : 0}%`,
                        background: p.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
