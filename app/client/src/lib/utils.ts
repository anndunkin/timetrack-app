import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function minutesToDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function hhmToMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** Format a Date as YYYY-MM-DD in local time (avoids UTC offset shifting the date). */
function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week start (Monday) */
export function getWeekRange(date: Date): { start: string; end: string } {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: localISO(monday),
    end: localISO(sunday),
  };
}

export function formatDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function todayISO(): string {
  return localISO(new Date());
}

/** Given a custom year start (month 1-12, day 1-31), compute the current year range */
export function getYearRange(yearStartMonth: number, yearStartDay: number): { start: string; end: string } {
  const today = new Date();
  const thisYear = today.getFullYear();
  const sm = yearStartMonth - 1; // 0-indexed
  const sd = yearStartDay;

  let start = new Date(thisYear, sm, sd);
  if (start > today) {
    start = new Date(thisYear - 1, sm, sd);
  }

  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);

  return {
    start: localISO(start),
    end: localISO(end),
  };
}

export function isoWeekDays(weekStart: string): string[] {
  const days: string[] = [];
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    days.push(localISO(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
