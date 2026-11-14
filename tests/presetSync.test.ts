import { describe, expect, it } from "vitest";
import type { PresetCard } from "@/lib/preset";
import { activeBenefits } from "@/lib/preset";
import { diffPresets } from "@/lib/presetSync";
import type { Benefit, Card } from "@/lib/types";

const preset: PresetCard[] = [
  {
    key: "plat",
    name: "Amex Platinum",
    color: "#000000",
    annual_fee: 895,
    benefits: [
      { name: "Lodging credit", value: 300, freq: "semiannual", terms: "lodging credit|hotel credit", aliases: ["Hotel credit"] },
      { name: "CLEAR Plus credit", value: 219, freq: "annual", terms: "clear plus" },
      { name: "Old credit", value: 50, freq: "annual", terms: "", until: "2026-12-31" },
      { name: "New credit", value: 200, freq: "annual", terms: "new thing" },
    ],
  },
];
const card = (id: string, name: string, fee = 895): Card => ({ id, name, color: "#000000", annual_fee: fee, account_id: null, sort: 0 });
const ben = (id: string, card_id: string, name: string, value: number, freq: Benefit["freq"], match_terms = ""): Benefit => ({
  id, card_id, name, value, freq, match_terms, sort: 0,
});

describe("diffPresets", () => {
  const cards = [card("p", "amex platinum"), card("x", "My Custom Card")];
  const benefits = [
    ben("h", "p", "Hotel credit", 300, "semiannual", "hotel credit|my own phrase"),
    ben("c", "p", "CLEAR Plus credit", 209, "annual", "clear plus"),
    ben("o", "p", "Old credit", 50, "annual"),
    ben("z", "p", "Something I added", 10, "monthly"),
    ben("k", "x", "Custom", 5, "monthly"),
  ];

  it("suggests renames, value changes, phrase merges and additions before the end date", () => {
    const ch = diffPresets(cards, benefits, preset, "2026-11-14");
    const byKind = (k: string) => ch.filter((c) => c.kind === k);
    expect(byKind("fee")).toEqual([]);
    const upd = byKind("update") as Extract<(typeof ch)[number], { kind: "update" }>[];
    const hotel = upd.find((u) => u.benefitId === "h")!;
    expect(hotel.patch).toEqual({ name: "Lodging credit", match_terms: "hotel credit|my own phrase|lodging credit" });
    expect(hotel.notes[0]).toMatch(/Renamed from/);
    expect(upd.find((u) => u.benefitId === "c")!.patch).toEqual({ value: 219 });
    expect(byKind("add").map((a) => (a as { benefit: { name: string } }).benefit.name)).toEqual(["New credit"]);
    expect(byKind("remove")).toEqual([]);
    // custom card and custom benefit untouched
    expect(ch.some((c) => c.cardId === "x")).toBe(false);
    expect(ch.some((c) => "benefitId" in c && c.benefitId === "z")).toBe(false);
  });

  it("suggests removing expired credits and never re-adds them", () => {
    const ch = diffPresets(cards, benefits, preset, "2027-01-01");
    expect(ch.filter((c) => c.kind === "remove").map((c) => ("benefitId" in c ? c.benefitId : ""))).toEqual(["o"]);
    const noOld = diffPresets(cards, benefits.filter((b) => b.id !== "o"), preset, "2027-01-01");
    expect(noOld.some((c) => c.kind === "add" && c.benefit.name === "Old credit")).toBe(false);
  });

  it("flags annual fee differences and is empty when everything matches", () => {
    expect(diffPresets([card("p", "Amex Platinum", 695)], [], preset, "2026-11-14").find((c) => c.kind === "fee")).toMatchObject({ from: 695, to: 895 });
    const synced = [
      ben("1", "p", "Lodging credit", 300, "semiannual", "lodging credit|hotel credit"),
      ben("2", "p", "CLEAR Plus credit", 219, "annual", "clear plus"),
      ben("3", "p", "Old credit", 50, "annual"),
      ben("4", "p", "New credit", 200, "annual", "new thing"),
    ];
    expect(diffPresets([card("p", "Amex Platinum")], synced, preset, "2026-11-14")).toEqual([]);
  });
});

describe("activeBenefits", () => {
  it("drops credits after their until date", () => {
    expect(activeBenefits(preset[0], "2026-12-31").map((b) => b.name)).toContain("Old credit");
    expect(activeBenefits(preset[0], "2027-01-01").map((b) => b.name)).not.toContain("Old credit");
  });
});
