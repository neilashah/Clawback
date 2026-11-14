/**
 * Which credits deserve a "use it before it resets" email today. Pure; tested.
 *
 * One heads-up per credit per period: monthly credits 5 days before reset, all
 * others 14 days before. "≤" (not "=") so a missed cron day still catches it.
 * Skipped: $0 placeholders, fully used credits, ✦ credits (they reset on the card
 * anniversary, not the calendar date the app uses), and anything already sent.
 */
import { daysUntil, nextReset, periodKey } from "./periods";
import type { Benefit, Card, Claim, Freq } from "./types";
import { remaining } from "./usage";

export const THRESHOLD_DAYS: Record<Freq, number> = { monthly: 5, quarterly: 14, semiannual: 14, annual: 14 };

export interface DueReminder {
  benefit: Benefit;
  card: Card;
  left: number;
  period: string;
  resetDate: Date;
  daysLeft: number;
}

export function dueReminders(args: {
  cards: Card[];
  benefits: Benefit[];
  claims: Pick<Claim, "benefit_id" | "period" | "amount" | "dismissed">[];
  sent: { benefit_id: string; period: string }[];
  today: Date;
  /** Ignore the per-period threshold (used for "what's next" in the test email). */
  anyWindow?: boolean;
}): DueReminder[] {
  const { cards, benefits, claims, sent, today } = args;
  const sentKeys = new Set(sent.map((s) => `${s.benefit_id}|${s.period}`));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const out: DueReminder[] = [];
  for (const b of benefits) {
    const card = cardById.get(b.card_id);
    if (!card || !(Number(b.value) > 0) || b.name.includes("✦")) continue;
    const period = periodKey(b.freq, today);
    if (sentKeys.has(`${b.id}|${period}`)) continue;
    const claim = claims.find((c) => c.benefit_id === b.id && c.period === period);
    const left = remaining(claim, b);
    if (left <= 0) continue;
    const resetDate = nextReset(b.freq, today);
    const daysLeft = daysUntil(resetDate, today);
    if (!args.anyWindow && daysLeft > THRESHOLD_DAYS[b.freq]) continue;
    out.push({ benefit: b, card, left, period, resetDate, daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || b.left - a.left);
}
