/**
 * ExportReportModal
 * Lets the user configure and download a monthly PDF report.
 *
 * fields and timeFormat are lifted to the parent so they survive
 * Dialog close/reopen cycles (Radix unmounts portal children on close).
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
import { Input }    from "@/components/ui/input";
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

export interface ReportFields {
  summary:             boolean;
  projectBreakdown:    boolean;
  departmentBreakdown: boolean;
  dailyLog:            boolean;
  descriptions:        boolean;
  budgetComparison:    boolean;
}

export const DEFAULT_REPORT_FIELDS: ReportFields = {
  summary:             true,
  projectBreakdown:    true,
  departmentBreakdown: true,
  dailyLog:            true,
  descriptions:        true,
  budgetComparison:    true,
};

interface Props {
  open:         boolean;
  onClose:      () => void;
  /** Pre-fill from the current Monthly view */
  defaultYear:  number;
  defaultMonth: number; // 1-12
  /** Lifted state – survives Dialog unmount on close */
  fields:       ReportFields;
  onFieldsChange: (f: ReportFields) => void;
  timeFormat:   "decimal" | "hhmm";
  onTimeFormatChange: (f: "decimal" | "hhmm") => void;
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
  fields,
  onFieldsChange,
  timeFormat,
  onTimeFormatChange,
}: Props) {
  const { toast } = useToast();

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
  });

  // ── Local ephemeral state ─────────────────────────────────────────────────
  const [orgId,   setOrgId]   = useState<string>("");
  const [year,    setYear]    = useState(defaultYear);
  const [month,   setMonth]   = useState(defaultMonth);
  const [mode,    setMode]    = useState<"monthly" | "custom">("monthly");
  const [start,   setStart]   = useState("");
  const [end,     setEnd]     = useState("");
  const [loading, setLoading] = useState(false);

  // Default orgId to first org once loaded
  useEffect(() => {
    if (orgs.length > 0 && !orgId) setOrgId(String(orgs[0].id));
  }, [orgs]);

  // Sync year/month from parent when modal opens fresh, and seed the custom
  // range with the selected month so it starts from a sensible default.
  useEffect(() => {
    setYear(defaultYear);
    setMonth(defaultMonth);
    const last = new Date(defaultYear, defaultMonth, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    setStart(`${defaultYear}-${pad(defaultMonth)}-01`);
    setEnd(`${defaultYear}-${pad(defaultMonth)}-${pad(last)}`);
  }, [defaultYear, defaultMonth]);

  function toggleField(key: keyof ReportFields) {
    onFieldsChange({ ...fields, [key]: !fields[key] });
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!orgId) {
      toast({ title: "Select an organization", variant: "destructive" });
      return;
    }

    if (mode === "custom") {
      if (!start || !end) {
        toast({ title: "Select a start and end date", variant: "destructive" });
        return;
      }
      if (start > end) {
        toast({ title: "Start date must be on or before end date", variant: "destructive" });
        return;
      }
    }

    const body = mode === "custom"
      ? { orgId: Number(orgId), start, end, fields, timeFormat }
      : { orgId: Number(orgId), year, month, fields, timeFormat };

    setLoading(true);
    try {
      const resp = await fetch("/api/report/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "Report generation failed");
      }

      // Convert to base64 in chunks to avoid call-stack overflow on large PDFs
      const arrayBuffer = await resp.arrayBuffer();
      const bytes  = new Uint8Array(arrayBuffer);
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const chunk = bytes.subarray(i, i + CHUNK);
        for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
      }
      const base64 = btoa(binary);

      const org  = orgs.find(o => o.id === Number(orgId));
      const slug = (org?.name ?? "Report").replace(/\s+/g, "-");
      const name = mode === "custom"
        ? `TimeTrack-${slug}-${start}_to_${end}.pdf`
        : `TimeTrack-${slug}-${year}-${String(month).padStart(2,"0")}.pdf`;

      // Send to main process — writes to temp dir and opens in system PDF viewer
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
            Export Report
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

          {/* ── Report period mode ───────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label>Report period</Label>
            <RadioGroup
              value={mode}
              onValueChange={v => setMode(v as "monthly" | "custom")}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="monthly" id="mode-monthly" />
                <Label htmlFor="mode-monthly" className="font-normal cursor-pointer">Monthly</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="custom" id="mode-custom" />
                <Label htmlFor="mode-custom" className="font-normal cursor-pointer">Custom range</Label>
              </div>
            </RadioGroup>
          </div>

          {/* ── Month / Year (monthly mode) ──────────────────────────────── */}
          {mode === "monthly" ? (
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
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="report-start">Start date</Label>
                <Input
                  id="report-start"
                  type="date"
                  value={start}
                  max={end || undefined}
                  onChange={e => setStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-end">End date</Label>
                <Input
                  id="report-end"
                  type="date"
                  value={end}
                  min={start || undefined}
                  onChange={e => setEnd(e.target.value)}
                />
              </div>
            </div>
          )}

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
              onValueChange={v => onTimeFormatChange(v as "decimal" | "hhmm")}
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
        disabled={disabled}
        className="mt-0.5"
      />
      <div>
        <label htmlFor={id} className={`text-sm font-medium leading-none ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
          {label}
        </label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}
