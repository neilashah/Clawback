import type { Freq } from "./types";

/**
 * Known cards and credits. Last verified against issuer/press sources: Nov 14, 2026.
 * Issuers change these often. When you edit this list, users can pull the changes
 * into their own cards from Cards → "Check for benefit updates" (lib/presetSync.ts).
 *
 * `terms` are guesses at words that appear in each statement credit's description.
 * They are unverified until real transactions arrive. Credits applied inside a
 * partner app (Uber Cash, DoorDash, Lyft) never show up as statement credits, so
 * they stay manual (no terms).
 */
export interface PresetBenefit {
  name: string;
  value: number;
  freq: Freq;
  terms: string;
  /** Earlier names this credit had, so renames are recognized on existing cards. */
  aliases?: string[];
  /** Last day (YYYY-MM-DD) the credit exists; after it, the update check suggests removing it. */
  until?: string;
}
export interface PresetCard {
  key: string;
  /** Part of the "Load my 3 cards" starter set. Others are added from Cards → Add a known card. */
  starter?: boolean;
  name: string;
  color: string;
  annual_fee: number;
  benefits: PresetBenefit[];
}

export const PRESET: PresetCard[] = [
  {
    key: "csr",
    starter: true,
    name: "Sapphire Reserve",
    color: "#1D4ED8",
    annual_fee: 795,
    benefits: [
      { name: "Travel credit ✦", value: 300, freq: "annual", terms: "travel credit" },
      { name: "The Edit hotel credit", value: 500, freq: "annual", terms: "the edit|edit credit" },
      { name: "Select hotel credit (2026)", value: 250, freq: "annual", terms: "select hotel", until: "2026-12-31" },
      { name: "Dining credit (Exclusive Tables)", value: 150, freq: "semiannual", terms: "dining credit|exclusive tables" },
      { name: "StubHub / viagogo credit", value: 150, freq: "semiannual", terms: "stubhub|viagogo" },
      // $15 restaurant + two $10 non-restaurant promos since Oct 1, 2026 (was $5 + $10 + $10).
      { name: "DoorDash credit", value: 35, freq: "monthly", terms: "" },
      { name: "Lyft credit", value: 10, freq: "monthly", terms: "" },
      { name: "Peloton credit", value: 10, freq: "monthly", terms: "peloton" },
    ],
  },
  {
    key: "plat",
    starter: true,
    name: "Amex Platinum",
    color: "#334155",
    annual_fee: 895,
    benefits: [
      { name: "Resy dining credit", value: 100, freq: "quarterly", terms: "resy" },
      // Renamed "Lodging Credit" Oct 22, 2026; now also prepaid Airbnb Luxe (2+ nights) via Amex Travel.
      {
        name: "Lodging credit (FHR / THC / Airbnb Luxe)",
        value: 300,
        freq: "semiannual",
        terms: "lodging credit|hotel credit|fine hotels|hotel collection|airbnb luxe",
        aliases: ["Hotel credit (FHR / THC)"],
      },
      { name: "lululemon credit", value: 75, freq: "quarterly", terms: "lululemon" },
      { name: "Digital entertainment credit", value: 25, freq: "monthly", terms: "digital entertainment" },
      { name: "Uber Cash", value: 15, freq: "monthly", terms: "" },
      { name: "Walmart+ credit", value: 13, freq: "monthly", terms: "walmart" },
      { name: "Airline fee credit", value: 200, freq: "annual", terms: "airline fee|airline incidental" },
      { name: "CLEAR Plus credit", value: 219, freq: "annual", terms: "clear plus|clearme|clear secure" },
      { name: "Equinox credit", value: 300, freq: "annual", terms: "equinox" },
      { name: "Uber One credit", value: 120, freq: "annual", terms: "uber one" },
      { name: "Oura Ring credit", value: 200, freq: "annual", terms: "oura" },
    ],
  },
  {
    key: "delta",
    starter: true,
    name: "Delta Reserve",
    color: "#B91C1C",
    annual_fee: 650,
    benefits: [
      { name: "Resy credit", value: 20, freq: "monthly", terms: "resy" },
      { name: "Rideshare credit", value: 10, freq: "monthly", terms: "rideshare" },
      { name: "Delta Stays credit", value: 200, freq: "annual", terms: "delta stays" },
      { name: "Companion Certificate ✦", value: 0, freq: "annual", terms: "" },
    ],
  },
  {
    // Verified Nov 2026: $650 fee; $25/mo dining credit; annual Free Night Award (up to 85k pts)
    // after renewal. Left out on purpose: $100 Ritz/St. Regis property credit (per stay, not a
    // cycle) and Global Entry/TSA PreCheck (every 4 yrs).
    key: "brilliant",
    name: "Marriott Brilliant",
    color: "#BE185D",
    annual_fee: 650,
    benefits: [
      { name: "Dining credit", value: 25, freq: "monthly", terms: "dining credit|brilliant dining" },
      { name: "Free Night Award (85k) ✦", value: 0, freq: "annual", terms: "" },
    ],
  },
];

export const STARTER = PRESET.filter((p) => p.starter);

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A preset card's credits that still exist on `today`. */
export function activeBenefits(p: PresetCard, today: string = todayIso()): PresetBenefit[] {
  return p.benefits.filter((b) => !b.until || b.until >= today);
}

export const CARD_COLORS = ["#0F6E4E", "#1D4ED8", "#7C3AED", "#B91C1C", "#B45309", "#0E7490", "#BE185D", "#4D7C0F", "#334155"];
