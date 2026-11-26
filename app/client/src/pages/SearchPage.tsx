import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { Organization, Department, ProjectWithParsedDepts, TimeEntry, RecurringTask } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Pencil, X, Building2, Layers, FolderKanban, Repeat } from "lucide-react";
import { minutesToHHMM, formatDate, sortByName } from "@/lib/utils";

type SearchResult = {
  query: string;
  entries: TimeEntry[];
  entryTotal: number;
  organizations: Organization[];
  departments: Department[];
  projects: ProjectWithParsedDepts[];
  recurring: RecurringTask[];
};

function SectionTitle({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold mt-6 mb-2">
      <Icon size={14} className="text-muted-foreground" /> {children}
    </h2>
  );
}

export default function SearchPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const urlQ = params.get("q") ?? "";

  const [q, setQ] = useState(urlQ);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [organizationId, setOrganizationId] = useState("");

  // Keep the box in sync when the quick-search bar navigates here.
  useEffect(() => { setQ(urlQ); }, [urlQ]);

  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: depts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: projects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("q", urlQ);
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    if (organizationId) p.set("organizationId", organizationId);
    return p.toString();
  }, [urlQ, start, end, organizationId]);

  const { data, isLoading } = useQuery<SearchResult>({
    queryKey: ["/api/search", qs],
    queryFn: () => apiRequest("GET", `/api/search?${qs}`),
    enabled: urlQ.trim().length > 0,
  });

  const orgOf = (id: number) => orgs.find(o => o.id === id);
  const deptName = (id: number) => depts.find(d => d.id === id)?.name ?? "—";
  const projOf = (id: number) => projects.find(p => p.id === id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  const noResults = data && data.entryTotal === 0 && !data.organizations.length &&
    !data.departments.length && !data.projects.length && !data.recurring.length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Search time entries, organizations, departments, projects and recurring tasks.
          Every word you type must match.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 mb-2 p-4 rounded-lg border bg-card">
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="search-q" className="block text-xs text-muted-foreground font-medium mb-1">Search for</label>
          <Input id="search-q" data-testid="input-search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Description, organization, project, date…" />
        </div>
        <div className="w-full sm:w-48">
          <label htmlFor="search-org" className="block text-xs text-muted-foreground font-medium mb-1">Organization</label>
          <select
            id="search-org"
            data-testid="select-search-organization"
            value={organizationId}
            onChange={e => setOrganizationId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          >
            <option value="">All organizations</option>
            {sortByName(orgs).map(o => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground font-medium mb-1">From</label>
          <Input data-testid="input-search-start" type="date" value={start} onChange={e => setStart(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground font-medium mb-1">To</label>
          <Input data-testid="input-search-end" type="date" value={end} onChange={e => setEnd(e.target.value)} className="w-40" />
        </div>
        <Button type="submit" size="sm" data-testid="button-search" className="gap-1.5"><Search size={14} /> Search</Button>
        {(start || end || organizationId) && (
          <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
            onClick={() => { setStart(""); setEnd(""); setOrganizationId(""); }}>
            <X size={14} /> Clear filters
          </Button>
        )}
      </form>

      {!urlQ.trim() && <p className="text-sm text-muted-foreground mt-6">Enter a search term to begin.</p>}
      {urlQ.trim() && isLoading && <p className="text-sm text-muted-foreground mt-6">Searching…</p>}
      {noResults && <p data-testid="text-search-empty" className="text-sm text-muted-foreground mt-6">No results for “{data!.query}”.</p>}

      {data && !noResults && (
        <div data-testid="search-results">
          {data.entryTotal > 0 && (
            <>
              <SectionTitle icon={Search}>
                Time entries ({data.entryTotal}{data.entryTotal > data.entries.length ? `, showing newest ${data.entries.length}` : ""})
              </SectionTitle>
              <div className="space-y-2">
                {data.entries.map(e => {
                  const org = orgOf(e.organizationId);
                  const proj = projOf(e.projectId);
                  return (
                    <div key={e.id} data-testid={`result-entry-${e.id}`} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="font-medium">{formatDate(e.date)}</span>
                          <span className="font-mono">{minutesToHHMM(e.minutes)}</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: org?.color ?? "#ccc" }} />{org?.name ?? "—"}</span>
                          <span className="text-muted-foreground">{e.departmentIds.map(deptName).join(", ")}</span>
                          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: proj?.color ?? "#ccc" }} />{proj?.name ?? "—"}</span>
                        </div>
                        {e.description && <p className="text-sm text-muted-foreground mt-1 break-words">{e.description}</p>}
                      </div>
                      <Button size="icon" variant="ghost" aria-label="Edit entry" onClick={() => navigate(`/?edit=${e.id}`)}>
                        <Pencil size={14} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {data.organizations.length > 0 && (
            <>
              <SectionTitle icon={Building2}>Organizations ({data.organizations.length})</SectionTitle>
              <div className="space-y-1.5">
                {data.organizations.map(o => (
                  <div key={o.id} className="flex items-center gap-2 p-3 rounded-lg border bg-card text-sm">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: o.color }} />{o.name}
                  </div>
                ))}
              </div>
            </>
          )}

          {data.departments.length > 0 && (
            <>
              <SectionTitle icon={Layers}>Departments ({data.departments.length})</SectionTitle>
              <div className="space-y-1.5">
                {data.departments.map(d => (
                  <div key={d.id} className="p-3 rounded-lg border bg-card text-sm">
                    {d.name} <span className="text-muted-foreground">· {orgOf(d.organizationId)?.name ?? "—"}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.projects.length > 0 && (
            <>
              <SectionTitle icon={FolderKanban}>Projects ({data.projects.length})</SectionTitle>
              <div className="space-y-1.5">
                {data.projects.map(p => (
                  <div key={p.id} className="p-3 rounded-lg border bg-card text-sm">
                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: p.color }} />{p.name}
                    <span className="text-muted-foreground"> · {p.departmentIds.map(deptName).join(", ")}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.recurring.length > 0 && (
            <>
              <SectionTitle icon={Repeat}>Recurring tasks ({data.recurring.length})</SectionTitle>
              <div className="space-y-1.5">
                {data.recurring.map(t => (
                  <div key={t.id} className="p-3 rounded-lg border bg-card text-sm">
                    <span className="capitalize">{t.frequency}</span> · {minutesToHHMM(t.minutes)} · {orgOf(t.organizationId)?.name ?? "—"} · {projOf(t.projectId)?.name ?? "—"}
                    {t.description && <p className="text-muted-foreground mt-1">{t.description}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
