/**
 * Monthly Report PDF generation
 * POST /api/report/monthly
 *
 * Body:
 *   orgId        number          – which organisation to report on
 *   year         number
 *   month        number          – 1-12
 *   fields       ReportFields    – which sections to include
 *   timeFormat   "hhmm" | "decimal"
 */

import PDFDocument from "pdfkit";
import type { Express, Response } from "express";
import { storage } from "./storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReportFields {
  summary: boolean;         // total hours + per-org summary boxes
  projectBreakdown: boolean;
  departmentBreakdown: boolean;
  dailyLog: boolean;
  descriptions: boolean;    // show entry descriptions inside daily log
  budgetComparison: boolean; // budget vs actual (only when budgetHours exist)
}

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Parse "#rrggbb" → [r, g, b] 0-255 */
function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.substring(0, 2), 16),
    parseInt(c.substring(2, 4), 16),
    parseInt(c.substring(4, 6), 16),
  ];
}

/** Luminance-based contrast: returns "white" or "black" for text on a bg */
function contrastText(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#1a1a1a" : "#ffffff";
}

/** Lighten a hex colour toward white by `amount` 0-1 */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const l = (v: number) => Math.round(v + (255 - v) * amount);
  return `#${l(r).toString(16).padStart(2, "0")}${l(g).toString(16).padStart(2, "0")}${l(b).toString(16).padStart(2, "0")}`;
}

// ── Time formatting ───────────────────────────────────────────────────────────

function fmtHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function fmtDecimal(minutes: number): string {
  return (minutes / 60).toFixed(1) + "h";
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function monthRange(year: number, month: number): { start: string; end: string } {
  const last = new Date(year, month, 0).getDate(); // day 0 of next month = last of this
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${year}-${pad(month)}-01`,
    end:   `${year}-${pad(month)}-${pad(last)}`,
  };
}

function monthDays(year: number, month: number): string[] {
  const { start, end } = monthRange(year, month);
  const days: string[] = [];
  const d = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (d <= last) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

// ── PDF layout constants ──────────────────────────────────────────────────────

const PAGE_W    = 612; // US Letter points
const PAGE_H    = 792;
const MARGIN    = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY   = "#1a2744";
const MUTED  = "#6b7280";
const BORDER = "#e5e7eb";
const BG     = "#f9fafb";

// ── PDF builder ───────────────────────────────────────────────────────────────

export function buildMonthlyReportPdf(
  res: Response,
  orgId: number,
  year: number,
  month: number,
  fields: ReportFields,
  timeFormat: "hhmm" | "decimal"
): void {
  const fmt = timeFormat === "hhmm" ? fmtHHMM : fmtDecimal;

  // ── Gather data ─────────────────────────────────────────────────────────────
  const orgs     = storage.getOrganizations();
  const org      = orgs.find(o => o.id === orgId);
  if (!org) { res.status(404).json({ error: "Organisation not found" }); return; }

  const { start, end } = monthRange(year, month);
  const allEntries  = storage.getTimeEntriesByDateRange(start, end);

  // Normalise departmentIds
  const entries = allEntries
    .filter(e => e.organizationId === orgId)
    .map((e: any) => {
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
      return { ...e, departmentIds: dids };
    });

  const depts    = storage.getDepartments();
  const projects = storage.getProjects();
  const days     = monthDays(year, month);

  const deptName = (id: number) => depts.find(d => d.id === id)?.name ?? "—";
  const projName = (id: number) => projects.find(p => p.id === id)?.name ?? "—";
  const projColor = (id: number) => projects.find(p => p.id === id)?.color ?? "#6366f1";
  const projBudget = (id: number) => projects.find(p => p.id === id)?.budgetHours ?? null;

  const totalMins = entries.reduce((s: number, e: any) => s + e.minutes, 0);

  // Per-project
  const byProject: Record<number, { name: string; color: string; minutes: number; deptNames: string[]; budget: number | null }> = {};
  for (const e of entries) {
    if (!byProject[e.projectId]) {
      byProject[e.projectId] = {
        name:      projName(e.projectId),
        color:     projColor(e.projectId),
        minutes:   0,
        deptNames: [],
        budget:    projBudget(e.projectId),
      };
    }
    byProject[e.projectId].minutes += e.minutes;
    for (const did of e.departmentIds) {
      const dn = deptName(did);
      if (!byProject[e.projectId].deptNames.includes(dn)) byProject[e.projectId].deptNames.push(dn);
    }
  }
  const projList = Object.values(byProject).sort((a, b) => b.minutes - a.minutes);

  // Per-department
  const byDept: Record<number, { name: string; minutes: number }> = {};
  for (const e of entries) {
    for (const did of e.departmentIds) {
      if (!byDept[did]) byDept[did] = { name: deptName(did), minutes: 0 };
      byDept[did].minutes += e.minutes;
    }
  }
  const deptList = Object.values(byDept).sort((a, b) => b.minutes - a.minutes);

  // Per-day
  const byDay: Record<string, typeof entries> = {};
  for (const e of entries) {
    if (!byDay[e.date]) byDay[e.date] = [];
    byDay[e.date].push(e);
  }
  const activeDays = days.filter(d => (byDay[d] ?? []).length > 0);

  // ── Create PDF ──────────────────────────────────────────────────────────────
  const doc = new PDFDocument({
    size:        "LETTER",
    bufferPages: true,
    margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN },
    info: {
      Title:    `TimeTrack Monthly Report — ${org.name} — ${MONTH_NAMES[month - 1]} ${year}`,
      Author:   "TimeTrack",
      Subject:  "Monthly Time Report",
      Creator:  "TimeTrack",
    },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="TimeTrack-${org.name.replace(/\s+/g, "-")}-${year}-${String(month).padStart(2,"0")}.pdf"`
  );
  doc.pipe(res);

  // Track cursor y position
  let y = MARGIN;

  // ── Helper: ensure enough space, add page if not ──────────────────────────
  function ensureSpace(needed: number) {
    if (y + needed > PAGE_H - MARGIN - 40) {
      doc.addPage();
      y = MARGIN;
    }
  }

  // ── Helper: horizontal rule ───────────────────────────────────────────────
  function hr(yy?: number) {
    const lineY = yy ?? y;
    doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_W, lineY)
       .strokeColor(BORDER).lineWidth(0.5).stroke();
  }

  // ── Helper: section heading ───────────────────────────────────────────────
  function sectionHeading(label: string) {
    ensureSpace(36);
    y += 16;
    doc.fontSize(9).fillColor(MUTED).font("Helvetica-Bold")
       .text(label.toUpperCase(), MARGIN, y, { characterSpacing: 0.8 });
    y += 14;
    hr();
    y += 8;
  }

  // ── Helper: horizontal bar (for breakdowns) ───────────────────────────────
  function barRow(
    label: string, subLabel: string, minutes: number, maxMins: number,
    color: string, budget: number | null = null
  ) {
    const rowH = subLabel ? 32 : 24;
    ensureSpace(rowH + 4);
    const pct   = maxMins > 0 ? minutes / maxMins : 0;
    const BAR_H = 8;
    // Layout: label 32% | bar 42% | value 26%
    const LABEL_W = CONTENT_W * 0.32;
    const BAR_W   = CONTENT_W * 0.42;
    const VAL_W   = CONTENT_W * 0.24;
    const barX    = MARGIN + LABEL_W + 6;
    const valX    = barX + BAR_W + 6;
    const barY    = y + 3;

    const hours = fmt(minutes);
    const budgetLabel = budget != null
      ? `${hours} / ${fmt(Math.round(budget * 60))}`
      : hours;

    // Label + sub-label
    doc.fontSize(9).fillColor("#111827").font("Helvetica-Bold")
       .text(label, MARGIN, y, { width: LABEL_W, lineBreak: false });
    if (subLabel) {
      doc.fontSize(7.5).fillColor(MUTED).font("Helvetica")
         .text(subLabel, MARGIN, y + 12, { width: LABEL_W, lineBreak: false });
    }

    // Bar track + fill
    doc.roundedRect(barX, barY, BAR_W, BAR_H, 3).fillColor("#e5e7eb").fill();
    if (pct > 0) {
      doc.roundedRect(barX, barY, Math.max(6, BAR_W * pct), BAR_H, 3)
         .fillColor(color).fill();
    }

    // Budget indicator line
    if (budget != null && maxMins > 0) {
      const budgetPct = Math.min((budget * 60) / maxMins, 1);
      const bx = barX + BAR_W * budgetPct;
      doc.moveTo(bx, barY - 2).lineTo(bx, barY + BAR_H + 2)
         .strokeColor("#374151").lineWidth(1.2).dash(2, { space: 2 }).stroke().undash();
    }

    // Hours / budget label — right-aligned in val column
    doc.fontSize(8).fillColor("#111827").font("Helvetica-Bold")
       .text(budgetLabel, valX, y + 1, { width: VAL_W - 2, align: "right", lineBreak: false });

    y += rowH;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEADER BLOCK
  // ══════════════════════════════════════════════════════════════════════════

  // Org colour bar (full width)
  doc.rect(0, 0, PAGE_W, 5).fillColor(org.color).fill();

  // Org name + report title
  y = 24;
  doc.fontSize(20).fillColor(NAVY).font("Helvetica-Bold")
     .text(org.name, MARGIN, y);
  y += 26;
  doc.fontSize(12).fillColor(MUTED).font("Helvetica")
     .text(`Monthly Time Report  ·  ${MONTH_NAMES[month - 1]} ${year}`, MARGIN, y);
  y += 14;
  doc.fontSize(8).fillColor(MUTED).font("Helvetica")
     .text(`${formatDate(start)} – ${formatDate(end)}  ·  Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, MARGIN, y);
  y += 16;
  hr();
  y += 16;

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY BOXES
  // ══════════════════════════════════════════════════════════════════════════

  if (fields.summary) {
    const BOX_H = 56;
    const BOX_PAD = 8;
    const GAP = 8;

    // Build org totals across all orgs (so multi-org summary is possible)
    const orgTotals: { name: string; color: string; minutes: number }[] = [];
    for (const o of orgs) {
      const mins = entries
        .filter((e: any) => e.organizationId === o.id)
        .reduce((s: number, e: any) => s + e.minutes, 0);
      if (mins > 0) orgTotals.push({ name: o.name, color: o.color, minutes: mins });
    }

    const boxCount = 1 + orgTotals.length;
    const boxW = Math.min(130, (CONTENT_W - GAP * (boxCount - 1)) / boxCount);

    ensureSpace(BOX_H + 24);

    const drawBox = (bx: number, label: string, value: string, color: string) => {
      const textColor = contrastText(color);
      doc.roundedRect(bx, y, boxW, BOX_H, 6).fillColor(color).fill();
      doc.fontSize(7.5).fillColor(textColor).font("Helvetica").text(label, bx + BOX_PAD, y + BOX_PAD, { width: boxW - BOX_PAD * 2, align: "center" });
      doc.fontSize(18).fillColor(textColor).font("Helvetica-Bold").text(value, bx + BOX_PAD, y + BOX_PAD + 14, { width: boxW - BOX_PAD * 2, align: "center" });
    };

    drawBox(MARGIN, "Total Hours", fmt(totalMins), NAVY);
    orgTotals.forEach((o, i) => {
      drawBox(MARGIN + (boxW + GAP) * (i + 1), o.name, fmt(o.minutes), o.color);
    });

    y += BOX_H + 20;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROJECT BREAKDOWN
  // ══════════════════════════════════════════════════════════════════════════

  if (fields.projectBreakdown && projList.length > 0) {
    sectionHeading("Project Breakdown");
    const maxMins = projList[0].minutes;
    for (const p of projList) {
      barRow(p.name, p.deptNames.join(", "), p.minutes, maxMins, p.color,
             fields.budgetComparison ? p.budget : null);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DEPARTMENT BREAKDOWN
  // ══════════════════════════════════════════════════════════════════════════

  if (fields.departmentBreakdown && deptList.length > 0) {
    sectionHeading("Department Breakdown");
    const maxMins = deptList[0].minutes;
    for (const d of deptList) {
      barRow(d.name, "", d.minutes, maxMins, org.color);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DAILY LOG
  // ══════════════════════════════════════════════════════════════════════════

  if (fields.dailyLog && activeDays.length > 0) {
    sectionHeading("Daily Log");
    const maxDayMins = Math.max(...activeDays.map(d => byDay[d].reduce((s: number, e: any) => s + e.minutes, 0)));

    for (const day of activeDays) {
      const dayEntries = byDay[day];
      const dayMins    = dayEntries.reduce((s: number, e: any) => s + e.minutes, 0);
      const dow        = new Date(day + "T00:00:00").getDay();
      const dayLabel   = `${DAY_NAMES[dow]}, ${formatDate(day)}`;

      // Estimate row height
      let needed = 30;
      for (const e of dayEntries) {
        needed += 22;
        if (fields.descriptions && e.description) needed += 14;
      }
      ensureSpace(needed + 10);

      // Day header row
      doc.roundedRect(MARGIN, y, CONTENT_W, 22, 3).fillColor(BG).fill();
      doc.fontSize(8.5).fillColor("#111827").font("Helvetica-Bold")
         .text(dayLabel, MARGIN + 8, y + 6, { width: CONTENT_W * 0.55, lineBreak: false });

      // Mini bar
      const DAY_BAR_W = CONTENT_W * 0.22;
      const dayBarX   = MARGIN + CONTENT_W - DAY_BAR_W - 8 - 54;
      const barPct    = dayMins / maxDayMins;
      doc.roundedRect(dayBarX, y + 8, DAY_BAR_W, 6, 2).fillColor("#e5e7eb").fill();
      if (barPct > 0) {
        doc.roundedRect(dayBarX, y + 8, Math.max(4, DAY_BAR_W * barPct), 6, 2)
           .fillColor(org.color).fill();
      }
      doc.fontSize(8.5).fillColor("#111827").font("Helvetica-Bold")
         .text(fmt(dayMins), MARGIN + CONTENT_W - 54, y + 6, { width: 50, align: "right", lineBreak: false });

      y += 26;

      // Entries
      for (const e of dayEntries) {
        const eColor = projColor(e.projectId);
        const eName  = projName(e.projectId);
        const dNames = e.departmentIds.map((id: number) => deptName(id)).join(", ");

        doc.circle(MARGIN + 12, y + 5, 3).fillColor(eColor).fill();
        doc.fontSize(8.5).fillColor("#111827").font("Helvetica-Bold")
           .text(eName, MARGIN + 22, y + 1, { width: CONTENT_W * 0.52, lineBreak: false });
        doc.fontSize(8).fillColor(MUTED).font("Helvetica")
           .text(fmt(e.minutes), MARGIN + CONTENT_W - 54, y + 1, { width: 50, align: "right", lineBreak: false });

        if (dNames) {
          y += 13;
          doc.fontSize(7.5).fillColor(MUTED).font("Helvetica")
             .text(dNames, MARGIN + 22, y, { width: CONTENT_W * 0.55, lineBreak: false });
          y += 10;
        } else {
          y += 16;
        }

        if (fields.descriptions && e.description) {
          const desc = e.description.length > 200 ? e.description.slice(0, 200) + "…" : e.description;
          doc.fontSize(7.5).fillColor(MUTED).font("Helvetica")
             .text(desc, MARGIN + 22, y, { width: CONTENT_W - 76, lineBreak: false });
          y += 12;
        }

        y += 2; // entry gap
      }

      // Thin separator
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y)
         .strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 8;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FOOTER (on every page) — must run after all content, before doc.end()
  // ══════════════════════════════════════════════════════════════════════════

  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  const footerText = (n: number) =>
    `Generated by TimeTrack  ·  Ann Dunkin — Dunkin Global Advisors  ·  Page ${n} of ${totalPages}`;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(range.start + i);
    // Draw footer rule using canvas save/restore (avoids triggering auto page breaks)
    doc.save();
    doc.moveTo(MARGIN, PAGE_H - 34)
       .lineTo(MARGIN + CONTENT_W, PAGE_H - 34)
       .strokeColor(BORDER).lineWidth(0.5).stroke();
    // Render footer text via canvas directly
    doc.fontSize(7).fillColor(MUTED).font("Helvetica");
    const txt = footerText(i + 1);
    const txtW = doc.widthOfString(txt);
    doc.text(txt, MARGIN + (CONTENT_W - txtW) / 2, PAGE_H - 26, { lineBreak: false });
    doc.restore();
  }

  doc.end();
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerReportRoute(app: Express): void {
  app.post("/api/report/monthly", (req, res) => {
    const {
      orgId,
      year,
      month,
      fields,
      timeFormat = "decimal",
    } = req.body as {
      orgId: number;
      year: number;
      month: number;
      fields: ReportFields;
      timeFormat?: "hhmm" | "decimal";
    };

    if (!orgId || !year || !month || !fields) {
      return res.status(400).json({ error: "orgId, year, month, and fields are required" });
    }

    try {
      buildMonthlyReportPdf(res, orgId, year, month, fields, timeFormat);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message ?? "Report generation failed" });
      }
    }
  });
}
