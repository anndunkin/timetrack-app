import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  type Organization, type Department, type ProjectWithParsedDepts, type TimeEntry,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock, Pencil, Trash2, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn, minutesToHHMM, formatDate } from "@/lib/utils";

const PAGE_SIZE = 25;

type EntriesPage = { entries: TimeEntry[]; total: number; page: number; pageSize: number };

// Normalize departmentIds — older DB rows may return the legacy singular
// `departmentId`, or `departmentIds` as a JSON string instead of an array.
function normalizeEntry(e: any): TimeEntry {
  let dids: number[];
  if (Array.isArray(e.departmentIds)) dids = e.departmentIds;
  else if (typeof e.departmentIds === "string") {
    try { dids = JSON.parse(e.departmentIds); } catch { dids = []; }
  } else if (typeof e.departmentId === "number") dids = [e.departmentId];
  else dids = [];
  return { ...e, departmentIds: dids } as TimeEntry;
}

export default function HistoryPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Draft filter inputs (applied only when the user clicks "Apply").
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  // Applied filters that actually drive the query.
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(1);
  // ID of the entry pending delete confirmation (null = no dialog open).
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: allDepts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return params.toString();
  }, [page, start, end]);

  const { data, isLoading } = useQuery<EntriesPage>({
    queryKey: ["/api/time-entries", "history", qs],
    queryFn: () => apiRequest("GET", `/api/time-entries?${qs}`),
  });

  const entries = useMemo(() => (data?.entries ?? []).map(normalizeEntry), [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/time-entries/${id}`),
    onSuccess: () => {
      // Invalidate every time-entries query (Log Time, Weekly, History) so all
      // views reflect the deletion immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Entry deleted" });
      setDeleteId(null);
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the entry. Please try again.", variant: "destructive" });
      setDeleteId(null);
    },
  });

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? "—"; }
  function orgColor(id: number) { return orgs.find(o => o.id === id)?.color ?? "#ccc"; }
  function deptName(id: number) { return allDepts.find(d => d.id === id)?.name ?? "—"; }
  function projName(id: number) { return allProjects.find(p => p.id === id)?.name ?? "—"; }
  function projColor(id: number) { return allProjects.find(p => p.id === id)?.color ?? "#ccc"; }

  // Editing reuses the EXACT inline edit form on the Log Time page: navigate
  // there with ?edit=<id>, which opens that entry pre-filled in the same form.
  function editEntry(id: number) {
    navigate(`/?edit=${id}`);
  }

  function applyFilters() {
    setStart(draftStart);
    setEnd(draftEnd);
    setPage(1);
  }

  function clearFilters() {
    setDraftStart("");
    setDraftEnd("");
    setStart("");
    setEnd("");
    setPage(1);
  }

  const hasFilter = Boolean(start || end);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Entry History</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Browse and edit any time entry, including older ones. Click the pencil to edit on the Log Time page.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg border bg-card">
        <div>
          <label className="block text-xs text-muted-foreground font-medium mb-1">From</label>
          <Input
            data-testid="input-history-start"
            type="date"
            value={draftStart}
            onChange={e => setDraftStart(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground font-medium mb-1">To</label>
          <Input
            data-testid="input-history-end"
            type="date"
            value={draftEnd}
            onChange={e => setDraftEnd(e.target.value)}
            className="w-40"
          />
        </div>
        <Button onClick={applyFilters} size="sm" data-testid="button-history-apply" className="gap-1.5">
          <Search size={14} /> Apply
        </Button>
        {hasFilter && (
          <Button onClick={clearFilters} size="sm" variant="ghost" data-testid="button-history-clear" className="gap-1.5 text-muted-foreground">
            <X size={14} /> Clear
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground self-center" data-testid="text-history-total">
          {total} {total === 1 ? "entry" : "entries"}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-lg">
          <Clock size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">{hasFilter ? "No entries in this date range" : "No time entries yet"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div
              key={entry.id}
              data-testid={`card-history-${entry.id}`}
              className="p-3 rounded-lg border bg-card transition-colors"
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
                    data-testid={`button-edit-history-${entry.id}`}
                    onClick={() => editEntry(entry.id)}
                    title="Edit this entry"
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    data-testid={`button-delete-history-${entry.id}`}
                    onClick={() => setDeleteId(entry.id)}
                    title="Delete this entry"
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

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-6">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              data-testid="button-history-prev"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="gap-1"
            >
              <ChevronLeft size={16} /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-history-next"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="gap-1"
            >
              Next <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the time entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMut.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
