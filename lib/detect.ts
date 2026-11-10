/**
 * Auto-detection: decide which benefits a card's statement credits belong to.
 *
 * Kept free of I/O so it can be unit-tested. The server feeds it rows from the
 * database and applies the returned changes.
 */
import { parseDay, periodKey } from "./periods";
import type { Benefit, Card, Claim, Txn } from "./types";

export function terms(matchTerms: string): string[] {
  return matchTerms
    .split("|")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function haystack(t: Pick<Txn, "name" | "merchant_name" | "original_description">): string {
  return [t.name, t.merchant_name, t.original_description].filter(Boolean).join(" ").toLowerCase();
}

/** A statement credit: money in, posted, and not a card payment. */
export function isStatementCredit(t: Txn): boolean {
  if (t.pending || t.amount >= 0) return false;
  const h = haystack(t);
  return !/\b(payment|autopay|thank you)\b/.test(h);
}

/**
 * For each unassigned, non-ignored statement credit on a linked account, find the
 * benefit on that card whose match term appears in the description. If several
 * match, the longest (most specific) term wins.
 */
export function matchTransactions(
  txns: Txn[],
  benefits: Benefit[],
  cards: Card[],
): { transaction_id: string; benefit_id: string }[] {
  const cardByAccount = new Map<string, string>();
  for (const c of cards) if (c.account_id) cardByAccount.set(c.account_id, c.id);

  const out: { transaction_id: string; benefit_id: string }[] = [];
  for (const t of txns) {
    if (t.benefit_id || t.ignored || !isStatementCredit(t)) continue;
    const cardId = cardByAccount.get(t.account_id);
    if (!cardId) continue;
    const h = haystack(t);
    let best: { id: string; len: number } | null = null;
    for (const b of benefits) {
      if (b.card_id !== cardId) continue;
      for (const term of terms(b.match_terms)) {
        if (h.includes(term) && (!best || term.length > best.len)) best = { id: b.id, len: term.length };
      }
    }
    if (best) out.push({ transaction_id: t.transaction_id, benefit_id: best.id });
  }
  return out;
}

export interface ClaimChanges {
  inserts: { benefit_id: string; period: string; amount: number }[];
  updates: { id: string; amount: number }[];
  deletes: string[];
}

/**
 * Bring auto-detected claims in line with assigned transactions.
 * - Manual and dismissed claims are never touched (the user's word wins).
 * - Auto claims whose transactions disappeared are deleted.
 */
export function reconcileClaims(txns: Txn[], benefits: Benefit[], existing: Claim[]): ClaimChanges {
  const benefitById = new Map(benefits.map((b) => [b.id, b]));
  const totals = new Map<string, { benefit_id: string; period: string; amount: number }>();
  for (const t of txns) {
    if (!t.benefit_id || t.ignored) continue;
    const b = benefitById.get(t.benefit_id);
    if (!b) continue;
    const period = periodKey(b.freq, parseDay(t.date));
    const key = `${b.id}|${period}`;
    const cur = totals.get(key) ?? { benefit_id: b.id, period, amount: 0 };
    cur.amount = round2(cur.amount + -t.amount);
    totals.set(key, cur);
  }

  const changes: ClaimChanges = { inserts: [], updates: [], deletes: [] };
  const existingByKey = new Map(existing.map((c) => [`${c.benefit_id}|${c.period}`, c]));

  for (const [key, g] of totals) {
    const c = existingByKey.get(key);
    if (!c) changes.inserts.push(g);
    else if (c.source === "auto" && Number(c.amount) !== g.amount) changes.updates.push({ id: c.id, amount: g.amount });
  }
  for (const c of existing) {
    if (c.source === "auto" && !c.dismissed && !totals.has(`${c.benefit_id}|${c.period}`)) changes.deletes.push(c.id);
  }
  return changes;
}

/** Dollars a claim counts toward the annual-fee recoup. */
export function claimWorth(c: Claim, b: Benefit): number {
  if (c.dismissed) return 0;
  const v = Number(b.value) || 0;
  if (c.source === "auto" && c.amount != null) return v > 0 ? Math.min(Number(c.amount), v) : 0;
  return v;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
