/**
 * ExportReportModal
 * Lets the user configure and download a monthly PDF report.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Organization } from "@shared/schema";
import { MONTH_NAMES_LONG } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button }   from "@/components/ui/button";
import { Label }    from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { FileDown, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportFields {
  summary:             boolean;
  projectBreakdown:    boolean;
  departmentBreakdown: boolean;
  dailyLog:            boolean;
  descriptions:        boolean;
  budgetComparison:    boolean;
}

interface Props {
  open:         boolean;
  onClose:      () => void;
  /** Pre-fill from the current Monthly view */
  defaultYear:  number;
  defaultMonth: number; // 1-12
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const YEAR_RANGE = (() => {
  const cur = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => cur - 3 + i);
})();

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExportReportModal({
  open,
  onClose,
  defaultYear,
  defaultMonth,
}: Props) {
  const { toast } = useToast();

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
  });

  // ── State ──────────────────────────────────────────────────────────────────
  const [orgId,       setOrgId]       = useState<string>("");
  const [year,        setYear]        = useState(defaultYear);
  const [month,       setMonth]       = useState(defaultMonth);
  const [timeFormat,  setTimeFormat]  = useState<"decimal" | "hhmm">("decimal");
  const [loading,     setLoading]     = useState(false);

  const [fields, setFields] = useState<ReportFields>({
    summary:             true,
    projectBreakdown:    true,
    departmentBreakdown: true,
    dailyLog:            true,
    descriptions:        true,
    budgetComparison:    true,
  });

  // Default orgId to first org once loaded
  useEffect(() => {
    if (orgs.length > 0 && !orgId) setOrgId(String(orgs[0].id));
  }, [orgs]);

  // Sync defaults when parent month/year changes
  useEffect(() => {
    setYear(defaultYear);
    setMonth(defaultMonth);
  }, [defaultYear, defaultMonth]);

  function toggleField(key: keyof ReportFields) {
    setFields(f => ({ ...f, [key]: !f[key] }));
  }

  // ── Download ───────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!orgId) {
      toast({ title: "Select an organization", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/report/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: Number(orgId), year, month, fields, timeFormat }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "Report generation failed");
      }

      // Send PDF to main process to write to temp dir and open with system viewer
      const arrayBuffer = await resp.arrayBuffer();
      const bytes  = new Uint8Array(arrayBuffer);
      let binary = "";
      // btoa in chunks to avoid call-stack overflow on large PDFs
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const chunk = bytes.subarray(i, i + CHUNK);
        for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
      }
      const base64 = btoa(binary);

      const org  = orgs.find(o => o.id === Number(orgId));
      const name = `TimeTrack-${(org?.name ?? "Report").replace(/\s+/g, "-")}-${year}-${String(month).padStart(2,"0")}.pdf`;

      const result = await (window as any).timetrackFiles.openPdf({ base64, filename: name });
      if (result?.error) throw new Error(result.error);

      toast({ title: "Report opened", description: name });
      onClose();
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedOrg = orgs.find(o => o.id === Number(orgId));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown size={18} />
            Export Monthly Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">

          {/* ── Organization ────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Organization</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger>
                <SelectValue placeholder="Select organization…">
                  {selectedOrg ? (
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: selectedOrg.color }}
                      />
                      {selectedOrg.name}
                    </span>
                  ) : "Select organization…"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {orgs.map(o => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: o.color }}
                      />
                      {o.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Month / Year ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Month</Label>
              <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES_LONG.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEAR_RANGE.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* ── Sections to include ──────────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Sections to include</Label>

            <FieldCheck
              id="summary"
              label="Summary totals"
              description="Total hours and per-organization boxes"
              checked={fields.summary}
              onToggle={() => toggleField("summary")}
            />
            <FieldCheck
              id="projectBreakdown"
              label="Project breakdown"
              description="Hours per project with bar chart"
              checked={fields.projectBreakdown}
              onToggle={() => toggleField("projectBreakdown")}
            />
            <FieldCheck
              id="budgetComparison"
              label="Budget vs actual"
              description="Show budget hours alongside actual (projects with a budget only)"
              checked={fields.budgetComparison}
              onToggle={() => toggleField("budgetComparison")}
              disabled={!fields.projectBreakdown}
            />
            <FieldCheck
              id="departmentBreakdown"
              label="Department breakdown"
              description="Hours per department with bar chart"
              checked={fields.departmentBreakdown}
              onToggle={() => toggleField("departmentBreakdown")}
            />
            <FieldCheck
              id="dailyLog"
              label="Daily log"
              description="Day-by-day entry list"
              checked={fields.dailyLog}
              onToggle={() => toggleField("dailyLog")}
            />
            <FieldCheck
              id="descriptions"
              label="Entry descriptions"
              description="Show description text within the daily log"
              checked={fields.descriptions}
              onToggle={() => toggleField("descriptions")}
              disabled={!fields.dailyLog}
            />
          </div>

          <Separator />

          {/* ── Time format ──────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Time format</Label>
            <RadioGroup
              value={timeFormat}
              onValueChange={v => setTimeFormat(v as "decimal" | "hhmm")}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="decimal" id="fmt-decimal" />
                <Label htmlFor="fmt-decimal" className="font-normal cursor-pointer">
                  Decimal <span className="text-muted-foreground text-xs">(1.5h)</span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="hhmm" id="fmt-hhmm" />
                <Label htmlFor="fmt-hhmm" className="font-normal cursor-pointer">
                  HH:MM <span className="text-muted-foreground text-xs">(1h 30m)</span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={loading || !orgId}>
            {loading
              ? <><Loader2 size={15} className="animate-spin mr-1.5" /> Generating…</>
              : <><FileDown size={15} className="mr-1.5" /> Open PDF</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-component: labelled checkbox row ──────────────────────────────────────

function FieldCheck({
  id,
  label,
  description,
  checked,
  onToggle,
  disabled = false,
}: {
  id:          string;
  label:       string;
  description: string;
  checked:     boolean;
  onToggle:    () => void;
  disabled?:   boolean;
}) {
  return (
    <div className={`flex items-start gap-3 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium cursor-pointer leading-none">
          {label}
        </label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}
