/**
 * How much of a benefit has been used this period. Single source of truth for
 * tiles, totals, filters, and the annual-fee recoup.
 *
 * Claim.amount semantics:
 *   null   → fully used (a plain tap)
 *   number → dollars used so far (partial use, or an auto-detected credit), capped at value
 */
import type { Benefit, Claim } from "./types";

type B = Pick<Benefit, "value">;
type C = Pick<Claim, "amount" | "dismissed"> | undefined | null;

export function usedAmount(c: C, b: B): number {
  if (!c || c.dismissed) return 0;
  const v = Number(b.value) || 0;
  if (c.amount == null) return v;
  return Math.max(0, Math.min(Number(c.amount) || 0, v));
}

export function isFullyUsed(c: C, b: B): boolean {
  const v = Number(b.value) || 0;
  if (v <= 0) return !!c && !c.dismissed;
  return usedAmount(c, b) >= v;
}

export function isPartlyUsed(c: C, b: B): boolean {
  return usedAmount(c, b) > 0 && !isFullyUsed(c, b);
}

export function remaining(c: C, b: B): number {
  return Math.max(0, (Number(b.value) || 0) - usedAmount(c, b));
}
