import type { Freq } from "./types";

export const FREQS: { id: Freq; label: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "semiannual", label: "Semiannual" },
  { id: "annual", label: "Annual" },
];

/** Parse a Plaid "YYYY-MM-DD" date as a local calendar date (no TZ shift). */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function periodKey(freq: Freq, d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  if (freq === "monthly") return `${y}-${String(m + 1).padStart(2, "0")}`;
  if (freq === "quarterly") return `${y}-Q${Math.floor(m / 3) + 1}`;
  if (freq === "semiannual") return `${y}-H${m < 6 ? 1 : 2}`;
  return String(y);
}

export function nextReset(freq: Freq, d: Date = new Date()): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  if (freq === "monthly") return new Date(y, m + 1, 1);
  if (freq === "quarterly") return new Date(y, (Math.floor(m / 3) + 1) * 3, 1);
  if (freq === "semiannual") return new Date(y, m < 6 ? 6 : 12, 1);
  return new Date(y + 1, 0, 1);
}

export function daysUntil(date: Date, from: Date = new Date()): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function resetLabel(freq: Freq, from: Date = new Date()): string {
  const n = daysUntil(nextReset(freq, from), from);
  if (n <= 0) return "Resets today";
  if (n === 1) return "Resets tomorrow";
  if (n <= 31) return `Resets in ${n} days`;
  return `Resets in ~${Math.round(n / 30)} mo`;
}

export function inYear(period: string, year: number): boolean {
  const y = String(year);
  return period === y || period.startsWith(`${y}-`);
}
