import type { Benefit, Card, Freq } from "./types";

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

/* ------------------------------------------------------------------ card anniversaries
 * A card's `renews_on` is the next renewal date as printed on the issuer's notice.
 * Every calculation rolls it by whole years, so it never needs re-entering.
 */

/** The card's anniversary in a given calendar year (Feb 29 → Feb 28 in non-leap years). */
export function anniversaryIn(renewsOn: string, year: number): Date {
  const r = parseDay(renewsOn);
  const last = new Date(year, r.getMonth() + 1, 0).getDate();
  return new Date(year, r.getMonth(), Math.min(r.getDate(), last));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Start of the card year containing `d` (the most recent anniversary on or before it). */
export function cardYearStart(renewsOn: string, d: Date = new Date()): Date {
  const a = anniversaryIn(renewsOn, d.getFullYear());
  return startOfDay(d) >= a ? a : anniversaryIn(renewsOn, d.getFullYear() - 1);
}

/** Next renewal on or after `today` (on the renewal day itself, that's today). */
export function nextRenewal(renewsOn: string, today: Date = new Date()): Date {
  const a = anniversaryIn(renewsOn, today.getFullYear());
  return startOfDay(today) <= a ? a : anniversaryIn(renewsOn, today.getFullYear() + 1);
}

type CardLike = Pick<Card, "renews_on"> | null | undefined;
type BenLike = Pick<Benefit, "freq" | "name">;

/** ✦ annual credits reset on the card anniversary once the card has a renewal date. */
export function isAnniversary(b: BenLike, card: CardLike): boolean {
  return b.freq === "annual" && b.name.includes("✦") && !!card?.renews_on;
}

/**
 * Claim period for a benefit on a date. Anniversary credits use the calendar year in
 * which the card year started (Delta renewing Feb 4: Feb 4 2026 – Feb 3 2027 → "2026"),
 * so existing plain-year claims keep working.
 */
export function benefitPeriod(b: BenLike, card: CardLike, d: Date = new Date()): string {
  if (isAnniversary(b, card)) return String(cardYearStart(card!.renews_on!, d).getFullYear());
  return periodKey(b.freq, d);
}

/** When a benefit next resets. */
export function benefitNextReset(b: BenLike, card: CardLike, d: Date = new Date()): Date {
  if (isAnniversary(b, card)) return anniversaryIn(card!.renews_on!, cardYearStart(card!.renews_on!, d).getFullYear() + 1);
  return nextReset(b.freq, d);
}

/** [start, end) of a claim period. */
export function periodRange(period: string, b: BenLike, card: CardLike): [Date, Date] {
  let m: RegExpMatchArray | null;
  if ((m = period.match(/^(\d{4})-(\d{2})$/))) return [new Date(+m[1], +m[2] - 1, 1), new Date(+m[1], +m[2], 1)];
  if ((m = period.match(/^(\d{4})-Q([1-4])$/))) return [new Date(+m[1], (+m[2] - 1) * 3, 1), new Date(+m[1], +m[2] * 3, 1)];
  if ((m = period.match(/^(\d{4})-H([12])$/))) return [new Date(+m[1], (+m[2] - 1) * 6, 1), new Date(+m[1], +m[2] * 6, 1)];
  const y = Number(period);
  if (isAnniversary(b, card)) return [anniversaryIn(card!.renews_on!, y), anniversaryIn(card!.renews_on!, y + 1)];
  return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
}

/** The fee year being tracked: the current card year, or the calendar year without a renewal date. */
export function feeYear(card: CardLike, today: Date = new Date()): [Date, Date] {
  if (card?.renews_on) {
    const s = cardYearStart(card.renews_on, today);
    return [s, anniversaryIn(card.renews_on, s.getFullYear() + 1)];
  }
  return [new Date(today.getFullYear(), 0, 1), new Date(today.getFullYear() + 1, 0, 1)];
}

/**
 * Does a claim count toward this fee year? A claim belongs to the fee year that holds
 * the middle of its period (so a calendar-year credit counts in the card year it mostly
 * overlaps, and a December monthly credit right after a Dec 14 renewal counts in the new year).
 */
export function countsTowardFee(period: string, b: BenLike, card: CardLike, today: Date = new Date()): boolean {
  const [ps, pe] = periodRange(period, b, card);
  const mid = new Date((ps.getTime() + pe.getTime()) / 2);
  const [s, e] = feeYear(card, today);
  return mid >= s && mid < e;
}

/** "Dec 14, 2026" */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** YYYY-MM-DD for a local date. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
