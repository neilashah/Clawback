import { describe, expect, it } from "vitest";
import { renderReminderEmail } from "@/lib/reminderEmail";
import { dueRenewals, dueReminders } from "@/lib/reminders";
import type { Benefit, Card } from "@/lib/types";

const card: Card = { id: "c", name: "Amex Platinum", color: "#334155", annual_fee: 895, account_id: null, sort: 0 };
const ben = (id: string, value: number, freq: Benefit["freq"], name = id): Benefit => ({ id, card_id: "c", name, value, freq, match_terms: "", sort: 0 });
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
type Args = Parameters<typeof dueReminders>[0];
const run = (benefits: Benefit[], today: Date, extra: Partial<Args> = {}) =>
  dueReminders({ cards: [card], benefits, claims: [], sent: [], today, ...extra }).map((r) => r.benefit.id);

const monthly = ben("dig", 25, "monthly");
const annual = ben("air", 200, "annual");
const quarterly = ben("resy", 100, "quarterly");

describe("dueReminders", () => {
  it("monthly credits are due 5 days before reset, not 6", () => {
    expect(run([monthly], day(2026, 11, 26))).toEqual(["dig"]); // resets Dec 1
    expect(run([monthly], day(2026, 11, 25))).toEqual([]);
    expect(run([monthly], day(2026, 11, 30))).toEqual(["dig"]); // still caught if a day was missed
  });

  it("other credits are due 14 days before reset", () => {
    expect(run([annual, quarterly], day(2026, 12, 18))).toEqual(["air", "resy"]); // both reset Jan 1
    expect(run([annual], day(2026, 12, 17))).toEqual([]);
    expect(run([quarterly], day(2026, 9, 17))).toEqual(["resy"]); // Q3 resets Oct 1
  });

  it("skips fully used, keeps partly used with what's left", () => {
    const today = day(2026, 11, 28);
    expect(run([monthly], today, { claims: [{ benefit_id: "dig", period: "2026-11", amount: null, dismissed: false }] })).toEqual([]);
    const partial = dueReminders({ cards: [card], benefits: [monthly], claims: [{ benefit_id: "dig", period: "2026-11", amount: 10, dismissed: false }], sent: [], today });
    expect(partial[0].left).toBe(15);
    // dismissed claims don't count as used
    expect(run([monthly], today, { claims: [{ benefit_id: "dig", period: "2026-11", amount: null, dismissed: true }] })).toEqual(["dig"]);
  });

  it("skips $0 placeholders, ✦ anniversary credits, and anything already sent this period", () => {
    const today = day(2026, 12, 20);
    expect(run([ben("cert", 0, "annual"), ben("trav", 300, "annual", "Travel credit ✦")], today)).toEqual([]);
    expect(run([annual], today, { sent: [{ benefit_id: "air", period: "2026" }] })).toEqual([]);
    expect(run([annual], today, { sent: [{ benefit_id: "air", period: "2025" }] })).toEqual(["air"]);
  });

  it("sorts by soonest reset, then most money left", () => {
    const today = day(2026, 12, 28);
    const big = ben("hotel", 300, "semiannual");
    expect(run([annual, monthly, big], today)).toEqual(["hotel", "air", "dig"]);
  });

  it("anyWindow lists upcoming credits regardless of threshold", () => {
    expect(run([annual], day(2026, 6, 1), { anyWindow: true })).toEqual(["air"]);
  });
});

describe("renderReminderEmail", () => {
  it("totals the money left and groups by last day of use", () => {
    const items = dueReminders({ cards: [card], benefits: [monthly, annual, ben("x", 12.5, "monthly", "Walmart+ <credit>")], claims: [], sent: [], today: day(2026, 12, 28) });
    const m = renderReminderEmail(items, "https://example.app");
    expect(m.subject).toBe("Clawback: $237.50 in credits reset soon");
    expect(m.text).toContain("Use by Thu, Dec 31:");
    expect(m.html).toContain("Walmart+ &lt;credit&gt;");
    expect(m.html).toContain('href="https://example.app"');
    expect(m.text).toContain("- Amex Platinum: air, $200 left");
  });
});

describe("dueRenewals", () => {
  const delta: Card = { id: "d", name: "Delta Reserve", color: "#B91C1C", annual_fee: 650, account_id: null, sort: 1, renews_on: "2027-02-04" };
  const cert: Benefit = { id: "cert", card_id: "d", name: "Companion Certificate ✦", value: 0, freq: "annual", match_terms: "", sort: 0 };
  const stays: Benefit = { id: "stays", card_id: "d", name: "Delta Stays credit", value: 200, freq: "annual", match_terms: "", sort: 1 };
  type RArgs = Parameters<typeof dueRenewals>[0];
  const ren = (today: Date, extra: Partial<RArgs> = {}) => dueRenewals({ cards: [card, delta], benefits: [cert, stays], claims: [], sent: [], today, ...extra });

  it("fires 60 days out, then 30, and not in between", () => {
    expect(ren(day(2026, 12, 5))).toEqual([]); // 61 days
    const r60 = ren(day(2026, 12, 6)); // 60 days
    expect(r60.map((r) => [r.card.id, r.renewsKey, r.daysLeft, r.milestones])).toEqual([["d", "2027-02-04", 60, [60]]]);
    const sent60 = [{ card_id: "d", renews_on: "2027-02-04", days_before: 60 }];
    expect(ren(day(2026, 12, 20), { sent: sent60 })).toEqual([]);
    expect(ren(day(2027, 1, 5), { sent: sent60 }).map((r) => r.milestones)).toEqual([[30, 60]]);
  });

  it("a late entry sends once and records every passed milestone", () => {
    const r = ren(day(2027, 1, 20));
    expect(r[0].milestones).toEqual([30, 60]);
    const sent = r[0].milestones.map((m) => ({ card_id: "d", renews_on: r[0].renewsKey, days_before: m }));
    expect(ren(day(2027, 1, 21), { sent })).toEqual([]);
  });

  it("lists ✦ credits not yet used this card year, including $0 placeholders", () => {
    expect(ren(day(2026, 12, 6))[0].unused.map((u) => u.benefit.id)).toEqual(["cert"]);
    const used = [{ benefit_id: "cert", period: "2026", amount: null, dismissed: false }];
    expect(ren(day(2026, 12, 6), { claims: used })[0].unused).toEqual([]);
  });

  it("cards without a renewal date never fire", () => {
    expect(dueRenewals({ cards: [card], benefits: [], claims: [], sent: [], today: day(2026, 12, 6), anyWindow: true })).toEqual([]);
  });

  it("renders a renewal-only email", () => {
    const m = renderReminderEmail([], "https://example.app", { renewals: ren(day(2026, 12, 6)) });
    expect(m.subject).toBe("Clawback: Delta Reserve renews Feb 4, 2027");
    expect(m.text).toContain("- Delta Reserve renews Feb 4, 2027 for $650 (in 60 days)");
    expect(m.text).toContain("still unused: Companion Certificate ✦, not marked used");
  });
});
