import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  insertOrganizationSchema,
  insertDepartmentSchema,
  insertProjectSchema,
  type Organization,
  type Department,
  type ProjectWithParsedDepts,
} from "@shared/schema";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Building2, Layers, FolderKanban, Clock } from "lucide-react";
import { cn, minutesToDecimal } from "@/lib/utils";

// ─── Color picker ─────────────────────────────────────────────
const PALETTE = [
  "#01696F","#20808D","#006494","#437A22","#964219",
  "#A12C7B","#7A39BB","#A13544","#D19900","#DA7101",
  "#4F98A3","#6DAA45","#5591C7","#BB653B","#D163A7",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {PALETTE.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "w-6 h-6 rounded-full transition-transform hover:scale-110",
            value === c && "ring-2 ring-offset-2 ring-ring scale-110"
          )}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
    </div>
  );
}

// ─── Org Form ─────────────────────────────────────────────────
function OrgForm({ org, onDone }: { org?: Organization; onDone: () => void }) {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof insertOrganizationSchema>>({
    resolver: zodResolver(insertOrganizationSchema),
    defaultValues: { name: org?.name ?? "", color: org?.color ?? "#01696F" },
  });

  const mut = useMutation({
    mutationFn: (data: z.infer<typeof insertOrganizationSchema>) =>
      org
        ? apiRequest("PUT", `/api/organizations/${org.id}`, data)
        : apiRequest("POST", "/api/organizations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      toast({ title: org ? "Organization updated" : "Organization created" });
      onDone();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mut.mutate(d))} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input data-testid="input-org-name" placeholder="e.g. Acme Corp" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="color" render={({ field }) => (
          <FormItem>
            <FormLabel>Color</FormLabel>
            <FormControl><ColorPicker value={field.value} onChange={field.onChange} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" disabled={mut.isPending} data-testid="button-save-org">
          {mut.isPending ? "Saving…" : org ? "Update" : "Create"}
        </Button>
      </form>
    </Form>
  );
}

// ─── Dept Form ─────────────────────────────────────────────────
function DeptForm({ dept, orgs, onDone }: { dept?: Department; orgs: Organization[]; onDone: () => void }) {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof insertDepartmentSchema>>({
    resolver: zodResolver(insertDepartmentSchema),
    defaultValues: { name: dept?.name ?? "", organizationId: dept?.organizationId ?? orgs[0]?.id ?? 0 },
  });

  const mut = useMutation({
    mutationFn: (data: z.infer<typeof insertDepartmentSchema>) =>
      dept
        ? apiRequest("PUT", `/api/departments/${dept.id}`, data)
        : apiRequest("POST", "/api/departments", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({ title: dept ? "Department updated" : "Department created" });
      onDone();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mut.mutate(d))} className="space-y-4">
        <FormField control={form.control} name="organizationId" render={({ field }) => (
          <FormItem>
            <FormLabel>Organization</FormLabel>
            <FormControl>
              <select
                data-testid="select-dept-org"
                value={field.value}
                onChange={e => field.onChange(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Department Name</FormLabel>
            <FormControl><Input data-testid="input-dept-name" placeholder="e.g. Engineering" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit" disabled={mut.isPending} data-testid="button-save-dept">
          {mut.isPending ? "Saving…" : dept ? "Update" : "Create"}
        </Button>
      </form>
    </Form>
  );
}

// ─── Project Form ─────────────────────────────────────────────
const projectFormSchema = insertProjectSchema.extend({
  budgetHoursStr: z.string().optional(),
});

function ProjectForm({ project, depts, onDone }: {
  project?: ProjectWithParsedDepts;
  depts: Department[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [selectedDepts, setSelectedDepts] = useState<number[]>(project?.departmentIds ?? []);

  const form = useForm({
    defaultValues: {
      name: project?.name ?? "",
      color: project?.color ?? "#20808D",
      budgetHoursStr: project?.budgetHours ? String(project.budgetHours) : "",
      departmentIds: project?.departmentIds ?? [],
    },
  });

  const mut = useMutation({
    mutationFn: (data: z.infer<typeof insertProjectSchema>) =>
      project
        ? apiRequest("PUT", `/api/projects/${project.id}`, data)
        : apiRequest("POST", "/api/projects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: project ? "Project updated" : "Project created" });
      onDone();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSubmit(vals: any) {
    if (selectedDepts.length === 0) {
      toast({ title: "Select at least one department", variant: "destructive" });
      return;
    }
    mut.mutate({
      name: vals.name,
      color: vals.color,
      budgetHours: vals.budgetHoursStr ? Number(vals.budgetHoursStr) : null,
      departmentIds: selectedDepts,
    });
  }

  function toggleDept(id: number) {
    setSelectedDepts(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Project Name</FormLabel>
            <FormControl><Input data-testid="input-project-name" placeholder="e.g. Website Redesign" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div>
          <FormLabel>Departments</FormLabel>
          <p className="text-xs text-muted-foreground mb-2">This project will appear in every selected department's time-entry dropdown.</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {depts.map(d => (
              <button
                type="button"
                key={d.id}
                data-testid={`toggle-dept-${d.id}`}
                onClick={() => toggleDept(d.id)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs border transition-colors",
                  selectedDepts.includes(d.id)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-primary/60"
                )}
              >
                {d.name}
              </button>
            ))}
            {depts.length === 0 && <span className="text-xs text-muted-foreground">No departments yet. Create one first.</span>}
          </div>
        </div>

        <FormField control={form.control} name="budgetHoursStr" render={({ field }) => (
          <FormItem>
            <FormLabel>Budget Hours <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
            <FormControl><Input data-testid="input-budget-hours" type="number" min="0" step="0.5" placeholder="e.g. 120" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="color" render={({ field }) => (
          <FormItem>
            <FormLabel>Color</FormLabel>
            <FormControl><ColorPicker value={field.value} onChange={field.onChange} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" disabled={mut.isPending} data-testid="button-save-project">
          {mut.isPending ? "Saving…" : project ? "Update" : "Create"}
        </Button>
      </form>
    </Form>
  );
}

// ─── Delete button ─────────────────────────────────────────────
function DeleteBtn({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-destructive">Sure?</span>
        <button onClick={onConfirm} className="text-xs text-destructive hover:underline">Yes</button>
        <button onClick={() => setConfirm(false)} className="text-xs text-muted-foreground hover:underline">No</button>
      </div>
    );
  }
  return (
    <button
      data-testid={`button-delete-${label}`}
      onClick={() => setConfirm(true)}
      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
      aria-label={`Delete ${label}`}
    >
      <Trash2 size={14} />
    </button>
  );
}

// ─── Main ──────────────────────────────────────────────────────
export default function AdminPage() {
  const { toast } = useToast();
  const [orgDialog, setOrgDialog] = useState<{ open: boolean; org?: Organization }>({ open: false });
  const [deptDialog, setDeptDialog] = useState<{ open: boolean; dept?: Department }>({ open: false });
  const [projDialog, setProjDialog] = useState<{ open: boolean; project?: ProjectWithParsedDepts }>({ open: false });

  const { data: orgs = [] } = useQuery<Organization[]>({ queryKey: ["/api/organizations"] });
  const { data: depts = [] } = useQuery<Department[]>({ queryKey: ["/api/departments"] });
  const { data: projects = [] } = useQuery<ProjectWithParsedDepts[]>({ queryKey: ["/api/projects"] });

  const deleteOrg = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/organizations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/organizations"] }),
  });
  const deleteDept = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/departments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/departments"] }),
  });
  const deleteProject = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
  });

  function orgName(id: number) { return orgs.find(o => o.id === id)?.name ?? "—"; }
  function deptName(id: number) { return depts.find(d => d.id === id)?.name ?? "Unknown"; }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Administration</h1>
      <p className="text-sm text-muted-foreground mb-6">Manage organizations, departments, and projects.</p>

      <Tabs defaultValue="orgs">
        <TabsList className="mb-6">
          <TabsTrigger value="orgs" data-testid="tab-orgs"><Building2 size={14} className="mr-1.5" />Organizations</TabsTrigger>
          <TabsTrigger value="depts" data-testid="tab-depts"><Layers size={14} className="mr-1.5" />Departments</TabsTrigger>
          <TabsTrigger value="projects" data-testid="tab-projects"><FolderKanban size={14} className="mr-1.5" />Projects</TabsTrigger>
        </TabsList>

        {/* ── ORGANIZATIONS ── */}
        <TabsContent value="orgs">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{orgs.length} organization{orgs.length !== 1 ? "s" : ""}</p>
            <Dialog open={orgDialog.open} onOpenChange={o => setOrgDialog({ open: o })}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-org" onClick={() => setOrgDialog({ open: true })}>
                  <Plus size={14} className="mr-1" /> New Organization
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{orgDialog.org ? "Edit Organization" : "New Organization"}</DialogTitle></DialogHeader>
                <OrgForm org={orgDialog.org} onDone={() => setOrgDialog({ open: false })} />
              </DialogContent>
            </Dialog>
          </div>

          {orgs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Building2 size={32} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No organizations yet</p>
              <p className="text-sm">Create your first organization to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgs.map(org => (
                <div key={org.id} data-testid={`card-org-${org.id}`} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <span className="color-dot" style={{ background: org.color }} />
                  <span className="flex-1 font-medium text-sm">{org.name}</span>
                  <span className="text-xs text-muted-foreground">{depts.filter(d => d.organizationId === org.id).length} dept{depts.filter(d => d.organizationId === org.id).length !== 1 ? "s" : ""}</span>
                  <button
                    data-testid={`button-edit-org-${org.id}`}
                    onClick={() => setOrgDialog({ open: true, org })}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <DeleteBtn label={`org-${org.id}`} onConfirm={() => deleteOrg.mutate(org.id)} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── DEPARTMENTS ── */}
        <TabsContent value="depts">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{depts.length} department{depts.length !== 1 ? "s" : ""}</p>
            <Dialog open={deptDialog.open} onOpenChange={o => setDeptDialog({ open: o })}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-dept" disabled={orgs.length === 0} onClick={() => setDeptDialog({ open: true })}>
                  <Plus size={14} className="mr-1" /> New Department
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{deptDialog.dept ? "Edit Department" : "New Department"}</DialogTitle></DialogHeader>
                <DeptForm dept={deptDialog.dept} orgs={orgs} onDone={() => setDeptDialog({ open: false })} />
              </DialogContent>
            </Dialog>
          </div>

          {orgs.length === 0 && (
            <div className="mb-4 p-3 rounded-md bg-muted text-sm text-muted-foreground">
              Create an organization first before adding departments.
            </div>
          )}

          {depts.length === 0 && orgs.length > 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Layers size={32} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No departments yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgs.map(org => {
                const orgDepts = depts.filter(d => d.organizationId === org.id);
                if (orgDepts.length === 0) return null;
                return (
                  <div key={org.id}>
                    <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
                      <span className="color-dot" style={{ background: org.color }} />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{org.name}</span>
                    </div>
                    <div className="space-y-1.5 pl-4">
                      {orgDepts.map(dept => (
                        <div key={dept.id} data-testid={`card-dept-${dept.id}`} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                          <Layers size={14} className="text-muted-foreground" />
                          <span className="flex-1 font-medium text-sm">{dept.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {projects.filter(p => p.departmentIds.includes(dept.id)).length} project{projects.filter(p => p.departmentIds.includes(dept.id)).length !== 1 ? "s" : ""}
                          </span>
                          <button
                            data-testid={`button-edit-dept-${dept.id}`}
                            onClick={() => setDeptDialog({ open: true, dept })}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <DeleteBtn label={`dept-${dept.id}`} onConfirm={() => deleteDept.mutate(dept.id)} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── PROJECTS ── */}
        <TabsContent value="projects">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
            <Dialog open={projDialog.open} onOpenChange={o => setProjDialog({ open: o })}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-new-project" disabled={depts.length === 0} onClick={() => setProjDialog({ open: true })}>
                  <Plus size={14} className="mr-1" /> New Project
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{projDialog.project ? "Edit Project" : "New Project"}</DialogTitle></DialogHeader>
                <ProjectForm project={projDialog.project} depts={depts} onDone={() => setProjDialog({ open: false })} />
              </DialogContent>
            </Dialog>
          </div>

          {depts.length === 0 && (
            <div className="mb-4 p-3 rounded-md bg-muted text-sm text-muted-foreground">
              Create departments first before adding projects.
            </div>
          )}

          {projects.length === 0 && depts.length > 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FolderKanban size={32} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No projects yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map(proj => (
                <div key={proj.id} data-testid={`card-project-${proj.id}`} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                  <span className="color-dot mt-1" style={{ background: proj.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{proj.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {proj.departmentIds.map(did => (
                        <Badge key={did} variant="secondary" className="text-xs">{deptName(did)}</Badge>
                      ))}
                    </div>
                    {proj.budgetHours && (
                      <p className="text-xs text-muted-foreground mt-1"><Clock size={10} className="inline mr-0.5" />{proj.budgetHours}h budget</p>
                    )}
                  </div>
                  <button
                    data-testid={`button-edit-project-${proj.id}`}
                    onClick={() => setProjDialog({ open: true, project: proj })}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <DeleteBtn label={`project-${proj.id}`} onConfirm={() => deleteProject.mutate(proj.id)} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
