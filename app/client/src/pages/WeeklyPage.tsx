import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  type Organization, type Department, type ProjectWithParsedDepts, type TimeEntry,
} from "@shared/schema";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  minutesToHHMM, minutesToDecimal, getWeekRange, isoWeekDays, DAY_NAMES, formatDate, todayISO,
} from "@/lib/utils";

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  // Use local date parts to avoid UTC offset shifting the date
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

export default function WeeklyPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekRange(new Date()).start);

  const weekDays = isoWeekDays(weekStart);
  const weekEnd = weekDays[6];

  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });
  const { data: rawEntries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries", weekStart, weekEnd],
    queryFn: () => apiRequest("GET", `/api/time-entries?start=${weekStart}&end=${weekEnd}`),
  });

  // Normalize departmentIds — older DB rows may come back with the legacy
  // singular `departmentId` field instead of the `departmentIds` array, or
  // with departmentIds as a JSON string rather than a parsed array. Handle
  // all three cases so the weekly view never crashes on legacy entries.
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

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? "—"; }
  function orgColor(id: number) { return orgs.find(o => o.id === id)?.color ?? "#ccc"; }
  function deptName(id: number) { return allDepts.find(d => d.id === id)?.name ?? "—"; }
  function projName(id: number) { return allProjects.find(p => p.id === id)?.name ?? "—"; }
  function projColor(id: number) { return allProjects.find(p => p.id === id)?.color ?? "#ccc"; }

  const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);

  // Group by organisation for top summary
  const byOrg = useMemo(() => {
    const map: Record<number, { name: string; color: string; minutes: number }> = {};
    for (const e of entries) {
      if (!map[e.organizationId]) {
        map[e.organizationId] = {
          name: orgName(e.organizationId),
          color: orgColor(e.organizationId),
          minutes: 0,
        };
      }
      map[e.organizationId].minutes += e.minutes;
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, orgs]);

  // Group by day
  const byDay: Record<string, TimeEntry[]> = {};
  for (const day of weekDays) byDay[day] = [];
  for (const e of entries) {
    if (byDay[e.date]) byDay[e.date].push(e);
  }

  // Group by project for summary
  const byProject = useMemo(() => {
    const map: Record<number, { name: string; color: string; minutes: number; deptNames: string[] }> = {};
    for (const e of entries) {
      if (!map[e.projectId]) {
        map[e.projectId] = {
          name: projName(e.projectId),
          color: projColor(e.projectId),
          minutes: 0,
          deptNames: [],
        };
      }
      map[e.projectId].minutes += e.minutes;
      for (const dId of e.departmentIds) {
        const dn = deptName(dId);
        if (!map[e.projectId].deptNames.includes(dn)) map[e.projectId].deptNames.push(dn);
      }
    }
    return Object.values(map).sort((a, b) => b.minutes - a.minutes);
  }, [entries, allDepts, allProjects]);

  const maxDayMins = Math.max(...weekDays.map(d => byDay[d].reduce((s, e) => s + e.minutes, 0)), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Weekly Summary</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDate(weekStart)} — {formatDate(weekEnd)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))} data-testid="button-prev-week">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(getWeekRange(new Date()).start)} data-testid="button-this-week">
            This week
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))} data-testid="button-next-week">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Totals — per organisation */}
      <div className="space-y-2 mb-6">
        {/* Overall */}
        <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
          <p className="text-sm font-semibold">Total Hours</p>
          <p className="text-xl font-semibold font-mono" data-testid="text-total-hours">{minutesToDecimal(totalMinutes)}h</p>
        </div>
        {/* Per-org */}
        {byOrg.map(o => (
          <div key={o.name} className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <span className="color-dot shrink-0" style={{ background: o.color }} />
              <p className="text-sm font-medium truncate">{o.name}</p>
              {totalMinutes > 0 && (
                <p className="text-xs text-muted-foreground shrink-0">{Math.round((o.minutes / totalMinutes) * 100)}%</p>
              )}
            </div>
            <p className="text-lg font-semibold font-mono tabular-nums shrink-0">{minutesToDecimal(o.minutes)}h</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <Clock size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No entries this week</p>
          <p className="text-sm">Log time on the Log Time page.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
          {/* Day-by-day breakdown */}
          <div className="space-y-3">
            {weekDays.map((day, idx) => {
              const dayEntries = byDay[day];
              const dayMins = dayEntries.reduce((s, e) => s + e.minutes, 0);
              const isToday = day === todayISO();
              const barWidth = dayMins > 0 ? Math.round((dayMins / maxDayMins) * 100) : 0;

              return (
                <div key={day} className={`rounded-lg border bg-card overflow-hidden ${dayMins === 0 ? "opacity-50" : ""}`}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>
                        {DAY_NAMES[idx]}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(day)}</span>
                      {isToday && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Today</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {barWidth > 0 && (
                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      )}
                      <span className="text-sm font-mono font-medium tabular-nums w-16 text-right">
                        {dayMins > 0 ? minutesToHHMM(dayMins) : "—"}
                      </span>
                    </div>
                  </div>

                  {dayEntries.length > 0 && (
                    <div className="divide-y divide-border/30">
                      {dayEntries.map(e => (
                        <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="color-dot mt-1" style={{ background: projColor(e.projectId) }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <span className="text-sm font-medium">{projName(e.projectId)}</span>
                              <span className="text-xs text-muted-foreground">{e.departmentIds.map(id => deptName(id)).join(", ")}</span>
                            </div>
                            {e.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line line-clamp-2">
                                {e.description}
                              </p>
                            )}
                          </div>
                          <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0 mt-0.5">{minutesToHHMM(e.minutes)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
                        width: `${Math.round((p.minutes / totalMinutes) * 100)}%`,
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
