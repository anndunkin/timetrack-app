import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { type TimeEntry, type Organization, type Department, type ProjectWithParsedDepts } from "@shared/schema";
import { AlertTriangle, Trash2, Database, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, minutesToHHMM } from "@/lib/utils";
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
import { useToast } from "@/hooks/use-toast";

export default function DatabasePage() {
  const { toast } = useToast();

  // Warning gate — user must acknowledge before seeing the table
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);

  // ID of the entry pending deletion confirmation
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/time-entries"],
    enabled: warningAcknowledged,
  });

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
    enabled: warningAcknowledged,
  });
  const { data: allDepts = [] } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    enabled: warningAcknowledged,
  });
  const { data: allProjects = [] } = useQuery<ProjectWithParsedDepts[]>({
    queryKey: ["/api/projects"],
    enabled: warningAcknowledged,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/time-entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      toast({ title: "Entry deleted", description: "The time entry has been permanently removed." });
      setDeleteId(null);
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the entry. Please try again.", variant: "destructive" });
      setDeleteId(null);
    },
  });

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? `Org #${id}`; }
  function deptNames(ids: number[]) {
    return ids.map(id => allDepts.find(d => d.id === id)?.name ?? `Dept #${id}`).join(", ");
  }
  function projName(id: number) { return allProjects.find(p => p.id === id)?.name ?? `Project #${id}`; }

  // ── Warning gate ──────────────────────────────────────────────────────────
  if (!warningAcknowledged) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full border border-destructive/40 bg-destructive/5 rounded-xl p-8 text-center space-y-5">
          <div className="flex justify-center">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
              <ShieldAlert size={28} className="text-destructive" />
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold mb-2">Direct Database Access</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">This is not recommended.</strong> Directly removing entries bypasses normal
              application safeguards. Changes are permanent and cannot be undone. Only proceed if you are sure you
              want to delete raw time entries from the database.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="destructive"
              onClick={() => setWarningAcknowledged(true)}
              data-testid="button-acknowledge-warning"
            >
              I understand — show the database
            </Button>
            <Button
              variant="outline"
              onClick={() => window.history.back()}
              data-testid="button-cancel-db-access"
            >
              Go back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main table view ───────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database size={18} className="text-muted-foreground" />
            <h1 className="text-xl font-semibold">Database — Time Entries</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Raw view of all time entries. Use with caution — deletions are permanent.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/20">
          <AlertTriangle size={12} />
          Direct access
        </span>
      </div>

      {/* Warning banner (persistent reminder) */}
      <div className="flex items-center gap-3 mb-5 px-4 py-3 rounded-lg border border-amber-400/40 bg-amber-50/50 dark:bg-amber-900/10 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle size={15} className="shrink-0" />
        <span>Deleting entries here is immediate and irreversible. This view is intended for troubleshooting only.</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <Database size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No time entries in this database</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-db-entries">
              <thead>
                <tr className="bg-muted/50 border-b text-left">
                  <th className="px-3 py-2.5 font-medium text-muted-foreground w-12">ID</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Date</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Duration</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Organization</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Department(s)</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Project</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground">Description</th>
                  <th className="px-3 py-2.5 font-medium text-muted-foreground w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {entries.map(e => (
                  <tr
                    key={e.id}
                    className="hover:bg-muted/30 transition-colors"
                    data-testid={`row-entry-${e.id}`}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{e.id}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatDate(e.date)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">{minutesToHHMM(e.minutes)}</td>
                    <td className="px-3 py-2.5">{orgName(e.organizationId)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{deptNames(e.departmentIds)}</td>
                    <td className="px-3 py-2.5">{projName(e.projectId)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">
                      {e.description ?? <span className="italic opacity-40">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteId(e.id)}
                        data-testid={`button-delete-entry-${e.id}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t bg-muted/20 text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} total
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Entry #{deleteId} will be permanently deleted from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
