/**
 * Parse card-issuer CSV exports into Clawback transactions.
 *
 * Chase:  Transaction Date,Post Date,Description,Category,Type,Amount,Memo
 *         Amount: charges negative, credits/payments positive.
 * Amex:   Date,Description,Amount[,Extended Details,...,Reference,Category]
 *         Amount: charges positive, credits negative.
 *
 * Output uses Clawback's convention: negative = money in.
 */
import { createHash } from "node:crypto";

export type CsvFormat = "chase" | "amex";

export interface CsvTxn {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
}

/** RFC 4180-ish: quoted fields, escaped quotes, commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.trim().toLowerCase();

export function detectFormat(header: string[]): CsvFormat | null {
  const h = header.map(norm);
  if (h.includes("post date") && h.includes("type") && h.includes("amount")) return "chase";
  if (h.includes("date") && h.includes("description") && h.includes("amount")) return "amex";
  return null;
}

/** MM/DD/YYYY, M/D/YY, or YYYY-MM-DD → YYYY-MM-DD */
export function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function toNumber(s: string): number {
  const t = s.trim().replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[()]/g, ""));
  return neg ? -n : n;
}

export function csvToTxns(text: string): { format: CsvFormat; txns: CsvTxn[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("That file has no transactions.");
  const format = detectFormat(rows[0]);
  if (!format) {
    throw new Error("Unrecognized CSV. Download it from Chase or American Express as CSV (not Excel/QFX).");
  }
  const col = (name: string) => rows[0].map(norm).indexOf(name);
  const dateCol = format === "chase" ? col("post date") : col("date");
  const descCol = col("description");
  const amtCol = col("amount");
  const typeCol = col("type");

  const txns: CsvTxn[] = [];
  for (const r of rows.slice(1)) {
    const date = toIsoDate(r[dateCol] ?? "");
    const raw = toNumber(r[amtCol] ?? "");
    const description = (r[descCol] ?? "").trim();
    if (!date || !Number.isFinite(raw) || !description) continue;
    if (format === "chase" && norm(r[typeCol] ?? "") === "payment") continue;
    // Chase: credits positive. Amex: credits negative. Clawback: credits negative.
    const amount = format === "chase" ? -raw : raw;
    txns.push({ date, amount: Math.round(amount * 100) / 100, description });
  }
  return { format, txns };
}

/** Stable IDs so re-uploading the same file never creates duplicates. */
export function csvTxnIds(accountKey: string, txns: CsvTxn[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    const base = `${t.date}|${t.amount}|${t.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${accountKey}:csv:${createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 16)}`;
  });
}

/**
 * Drop CSV rows already present from a bank feed: same amount within ±3 days.
 * Each existing transaction can absorb at most one CSV row.
 */
export function dedupeAgainst<T extends { date: string; amount: number }>(
  incoming: T[],
  existing: { date: string; amount: number }[],
): T[] {
  const pool = existing.map((e) => ({ t: Date.parse(e.date), amount: Number(e.amount), used: false }));
  return incoming.filter((x) => {
    const t = Date.parse(x.date);
    const hit = pool.find((p) => !p.used && p.amount === x.amount && Math.abs(p.t - t) <= 3 * 86400000);
    if (hit) hit.used = true;
    return !hit;
  });
}
