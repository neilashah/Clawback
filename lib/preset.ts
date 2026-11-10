import type { Freq } from "./types";

/**
 * Starter cards and credits (≈ mid-2026; verify with the issuer, they drift).
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
}
export interface PresetCard {
  key: string;
  name: string;
  color: string;
  annual_fee: number;
  benefits: PresetBenefit[];
}

export const PRESET: PresetCard[] = [
  {
    key: "csr",
    name: "Sapphire Reserve",
    color: "#1D4ED8",
    annual_fee: 795,
    benefits: [
      { name: "Travel credit ✦", value: 300, freq: "annual", terms: "travel credit" },
      { name: "The Edit hotel credit", value: 500, freq: "annual", terms: "the edit|edit credit" },
      { name: "Select hotel credit (2026)", value: 250, freq: "annual", terms: "select hotel" },
      { name: "Dining credit (Exclusive Tables)", value: 150, freq: "semiannual", terms: "dining credit|exclusive tables" },
      { name: "StubHub / viagogo credit", value: 150, freq: "semiannual", terms: "stubhub|viagogo" },
      { name: "DoorDash credit", value: 25, freq: "monthly", terms: "" },
      { name: "Lyft credit", value: 10, freq: "monthly", terms: "" },
      { name: "Peloton credit", value: 10, freq: "monthly", terms: "peloton" },
    ],
  },
  {
    key: "plat",
    name: "Amex Platinum",
    color: "#334155",
    annual_fee: 895,
    benefits: [
      { name: "Resy dining credit", value: 100, freq: "quarterly", terms: "resy" },
      { name: "Hotel credit (FHR / THC)", value: 300, freq: "semiannual", terms: "hotel credit|fine hotels|hotel collection" },
      { name: "lululemon credit", value: 75, freq: "quarterly", terms: "lululemon" },
      { name: "Digital entertainment credit", value: 25, freq: "monthly", terms: "digital entertainment" },
      { name: "Uber Cash", value: 15, freq: "monthly", terms: "" },
      { name: "Walmart+ credit", value: 13, freq: "monthly", terms: "walmart" },
      { name: "Airline fee credit", value: 200, freq: "annual", terms: "airline fee|airline incidental" },
      { name: "CLEAR Plus credit", value: 209, freq: "annual", terms: "clear plus|clearme|clear secure" },
      { name: "Equinox credit", value: 300, freq: "annual", terms: "equinox" },
      { name: "Uber One credit", value: 120, freq: "annual", terms: "uber one" },
      { name: "Oura Ring credit", value: 200, freq: "annual", terms: "oura" },
    ],
  },
  {
    key: "delta",
    name: "Delta Reserve",
    color: "#B91C1C",
    annual_fee: 650,
    benefits: [
      { name: "Resy credit", value: 20, freq: "monthly", terms: "resy" },
      { name: "Rideshare credit", value: 10, freq: "monthly", terms: "rideshare" },
      { name: "Companion Certificate ✦", value: 0, freq: "annual", terms: "" },
    ],
  },
];

export const CARD_COLORS = ["#0F6E4E", "#1D4ED8", "#7C3AED", "#B91C1C", "#B45309", "#0E7490", "#BE185D", "#4D7C0F", "#334155"];
