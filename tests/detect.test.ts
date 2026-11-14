import { describe, expect, it } from "vitest";
import { claimWorth, isStatementCredit, matchTransactions, reconcileClaims } from "@/lib/detect";
import { periodKey } from "@/lib/periods";
import type { Benefit, Card, Claim, Txn } from "@/lib/types";

const card = (id: string, acct: string | null): Card => ({ id, name: id, color: "#000000", annual_fee: 0, account_id: acct, sort: 0 });
const ben = (id: string, card_id: string, match_terms: string, freq: Benefit["freq"] = "monthly", value = 25): Benefit => ({
  id, card_id, name: id, value, freq, match_terms, sort: 0,
});
const txn = (id: string, p: Partial<Txn>): Txn => ({
  transaction_id: id, account_id: "acct-plat", date: "2026-06-14", amount: -25, name: "", merchant_name: null,
  original_description: null, pending: false, benefit_id: null, ignored: false, ...p,
});

const cards = [card("plat", "acct-plat"), card("csr", "acct-csr"), card("unlinked", null)];
const benefits = [
  ben("dig", "plat", "digital entertainment"),
  ben("resy", "plat", "resy", "quarterly", 100),
  ben("hotel", "plat", "hotel credit|fine hotels", "semiannual", 300),
  ben("travel", "csr", "travel credit", "annual", 300),
  ben("uber", "plat", ""),
];

describe("isStatementCredit", () => {
  it("accepts posted credits and rejects charges, pending, and payments", () => {
    expect(isStatementCredit(txn("a", { name: "Platinum Digital Entertainment Credit" }))).toBe(true);
    expect(isStatementCredit(txn("b", { amount: 25 }))).toBe(false);
    expect(isStatementCredit(txn("c", { pending: true }))).toBe(false);
    expect(isStatementCredit(txn("d", { amount: -1200, name: "ONLINE PAYMENT - THANK YOU" }))).toBe(false);
  });
});

describe("matchTransactions", () => {
  it("matches by phrase, case-insensitively, only on the card's own account", () => {
    const out = matchTransactions(
      [
        txn("t1", { name: "PLATINUM DIGITAL ENTERTAINMENT CREDIT" }),
        txn("t2", { account_id: "acct-csr", name: "TRAVEL CREDIT $300/YEAR", amount: -84.5 }),
        txn("t3", { account_id: "acct-csr", name: "Digital Entertainment Credit" }), // wrong card
        txn("t4", { account_id: "acct-other", name: "Resy credit" }), // unlinked account
        txn("t5", { name: "Amex Resy Credit", merchant_name: "Resy" }),
      ],
      benefits,
      cards,
    );
    expect(out).toEqual([
      { transaction_id: "t1", benefit_id: "dig" },
      { transaction_id: "t2", benefit_id: "travel" },
      { transaction_id: "t5", benefit_id: "resy" },
    ]);
  });

  it("skips already-assigned and ignored transactions, and benefits without phrases", () => {
    const out = matchTransactions(
      [
        txn("a", { name: "digital entertainment", benefit_id: "dig" }),
        txn("b", { name: "digital entertainment", ignored: true }),
        txn("c", { name: "Uber credit" }),
      ],
      benefits,
      cards,
    );
    expect(out).toEqual([]);
  });

  it("prefers the longest matching phrase", () => {
    const bs = [ben("x", "plat", "credit"), ben("y", "plat", "hotel credit")];
    expect(matchTransactions([txn("t", { name: "FHR hotel credit" })], bs, cards)).toEqual([{ transaction_id: "t", benefit_id: "y" }]);
  });
});

describe("reconcileClaims", () => {
  const claim = (p: Partial<Claim>): Claim => ({ id: "c", benefit_id: "dig", period: "2026-06", source: "auto", amount: 25, dismissed: false, ...p });

  it("inserts a claim per benefit+period, summing partial credits", () => {
    const ch = reconcileClaims(
      [
        txn("a", { benefit_id: "hotel", date: "2026-02-03", amount: -120 }),
        txn("b", { benefit_id: "hotel", date: "2026-05-20", amount: -80.25 }),
        txn("c", { benefit_id: "hotel", date: "2026-08-01", amount: -300 }),
      ],
      benefits,
      [],
    );
    expect(ch.inserts).toEqual([
      { benefit_id: "hotel", period: "2026-H1", amount: 200.25 },
      { benefit_id: "hotel", period: "2026-H2", amount: 300 },
    ]);
  });

  it("never overrides manual or dismissed claims", () => {
    const t = [txn("a", { benefit_id: "dig" })];
    expect(reconcileClaims(t, benefits, [claim({ source: "manual", amount: null })])).toEqual({ inserts: [], updates: [], deletes: [] });
    expect(reconcileClaims([], benefits, [claim({ dismissed: true })])).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it("updates changed amounts and deletes orphaned auto claims", () => {
    const ch = reconcileClaims([txn("a", { benefit_id: "dig", amount: -20 })], benefits, [
      claim({ id: "keep", amount: 25 }),
      claim({ id: "gone", benefit_id: "resy", period: "2026-Q2", amount: 100 }),
    ]);
    expect(ch.updates).toEqual([{ id: "keep", amount: 20 }]);
    expect(ch.deletes).toEqual(["gone"]);
  });

  it("ignores ignored transactions", () => {
    expect(reconcileClaims([txn("a", { benefit_id: "dig", ignored: true })], benefits, []).inserts).toEqual([]);
  });
});

describe("claimWorth", () => {
  const b = ben("dig", "plat", "", "monthly", 25);
  it("counts manual claims at full value and auto claims at the credited amount, capped", () => {
    expect(claimWorth({ id: "1", benefit_id: "dig", period: "x", source: "manual", amount: null, dismissed: false }, b)).toBe(25);
    expect(claimWorth({ id: "1", benefit_id: "dig", period: "x", source: "auto", amount: 12.5, dismissed: false }, b)).toBe(12.5);
    expect(claimWorth({ id: "1", benefit_id: "dig", period: "x", source: "auto", amount: 40, dismissed: false }, b)).toBe(25);
    expect(claimWorth({ id: "1", benefit_id: "dig", period: "x", source: "auto", amount: 25, dismissed: true }, b)).toBe(0);
    expect(claimWorth({ id: "1", benefit_id: "dig", period: "x", source: "manual", amount: 10, dismissed: false }, b)).toBe(10);
  });
});

describe("periodKey", () => {
  it("buckets dates", () => {
    const d = new Date(2026, 6, 4);
    expect(periodKey("monthly", d)).toBe("2026-07");
    expect(periodKey("quarterly", d)).toBe("2026-Q3");
    expect(periodKey("semiannual", d)).toBe("2026-H2");
    expect(periodKey("annual", d)).toBe("2026");
  });
});
