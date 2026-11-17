/**
 * Which credits deserve a "use it before it resets" email today. Pure; tested.
 *
 * One heads-up per credit per period: monthly credits 5 days before reset, all
 * others 14 days before. "≤" (not "=") so a missed cron day still catches it.
 * Skipped: $0 placeholders, fully used credits, ✦ credits (they reset on the card
 * anniversary and are covered by the renewal reminders below), and anything already sent.
 */
import { benefitPeriod, daysUntil, nextRenewal, nextReset, periodKey, ymd } from "./periods";
import type { Benefit, Card, Claim, Freq } from "./types";
import { isFullyUsed, remaining } from "./usage";

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

/** Renewal heads-ups go out this many days before a card renews. */
export const RENEWAL_MILESTONES = [60, 30];

export interface DueRenewal {
  card: Card;
  renewsOn: Date;
  /** YYYY-MM-DD of this renewal (the key in renewal_reminders_sent). */
  renewsKey: string;
  daysLeft: number;
  /** Milestones to record as sent (the one being sent plus any larger ones skipped). */
  milestones: number[];
  /** ✦ credits on this card that reset at renewal and aren't fully used yet. */
  unused: { benefit: Benefit; left: number }[];
}

/**
 * Cards renewing within 60 days, then again within 30. If a date is entered late
 * (say 20 days out) one email goes out, and every milestone already passed is
 * recorded with it so none of them fires afterwards.
 */
export function dueRenewals(args: {
  cards: Card[];
  benefits: Benefit[];
  claims: Pick<Claim, "benefit_id" | "period" | "amount" | "dismissed">[];
  sent: { card_id: string; renews_on: string; days_before: number }[];
  today: Date;
  /** Ignore the windows (used for "what's next" in the test email). */
  anyWindow?: boolean;
}): DueRenewal[] {
  const { cards, benefits, claims, sent, today } = args;
  const sentKeys = new Set(sent.map((s) => `${s.card_id}|${s.renews_on}|${s.days_before}`));
  const out: DueRenewal[] = [];
  for (const card of cards) {
    if (!card.renews_on) continue;
    const renewsOn = nextRenewal(card.renews_on, today);
    const renewsKey = ymd(renewsOn);
    const daysLeft = daysUntil(renewsOn, today);
    const hit = RENEWAL_MILESTONES.filter((m) => daysLeft <= m).sort((a, b) => a - b);
    if (!args.anyWindow) {
      if (!hit.length || sentKeys.has(`${card.id}|${renewsKey}|${hit[0]}`)) continue;
    }
    const unused = benefits
      .filter((b) => b.card_id === card.id && b.freq === "annual" && b.name.includes("✦"))
      .map((b) => {
        const period = benefitPeriod(b, card, today);
        const claim = claims.find((c) => c.benefit_id === b.id && c.period === period);
        return { benefit: b, claim };
      })
      .filter(({ benefit, claim }) => !isFullyUsed(claim, benefit))
      .map(({ benefit, claim }) => ({ benefit, left: remaining(claim, benefit) }));
    out.push({ card, renewsOn, renewsKey, daysLeft, milestones: hit, unused });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
