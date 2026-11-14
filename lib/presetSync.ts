/**
 * Compare a user's cards/benefits with the preset catalog and list suggested changes.
 * Pure (no I/O) so it can be unit-tested; the dashboard applies the chosen changes.
 *
 * Rules
 * - Cards match presets by name (case-insensitive). Unmatched (custom) cards are ignored.
 * - Benefits match by current preset name or any alias. Custom benefits are never touched.
 * - Value, frequency and name differences are suggested as updates, except the value of
 *   `variable` credits (e.g. Companion Certificate), where the user's value always wins. Missing auto-detect
 *   phrases are added; the user's own phrases are always kept.
 * - Preset benefits missing from the card are suggested as additions.
 * - Benefits past their `until` date are suggested for removal.
 */
import { activeBenefits, type PresetBenefit, type PresetCard } from "./preset";
import type { Benefit, Card, Freq } from "./types";

export type PresetChange =
  | { kind: "fee"; key: string; cardId: string; cardName: string; from: number; to: number }
  | { kind: "add"; key: string; cardId: string; cardName: string; benefit: PresetBenefit }
  | {
      kind: "update";
      key: string;
      cardId: string;
      cardName: string;
      benefitId: string;
      name: string;
      patch: { name?: string; value?: number; freq?: Freq; match_terms?: string };
      notes: string[];
    }
  | { kind: "remove"; key: string; cardId: string; cardName: string; benefitId: string; name: string; until: string };

const norm = (s: string) => s.trim().toLowerCase();
const termList = (s: string) =>
  s
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
const FREQ_LABEL: Record<Freq, string> = { monthly: "monthly", quarterly: "quarterly", semiannual: "semiannual", annual: "annual" };
const usd = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function diffPresets(cards: Card[], benefits: Benefit[], preset: PresetCard[], today: string): PresetChange[] {
  const out: PresetChange[] = [];
  for (const card of cards) {
    const p = preset.find((x) => norm(x.name) === norm(card.name));
    if (!p) continue;
    const mine = benefits.filter((b) => b.card_id === card.id);
    const base = { cardId: card.id, cardName: card.name };

    if (Number(card.annual_fee) !== p.annual_fee) {
      out.push({ kind: "fee", key: `fee:${card.id}`, ...base, from: Number(card.annual_fee), to: p.annual_fee });
    }

    const active = new Set(activeBenefits(p, today));
    for (const pb of p.benefits) {
      const names = [pb.name, ...(pb.aliases ?? [])].map(norm);
      const found = mine.find((b) => names.includes(norm(b.name)));

      if (!active.has(pb)) {
        if (found) out.push({ kind: "remove", key: `remove:${found.id}`, ...base, benefitId: found.id, name: found.name, until: pb.until! });
        continue;
      }
      if (!found) {
        out.push({ kind: "add", key: `add:${card.id}:${norm(pb.name)}`, ...base, benefit: pb });
        continue;
      }

      const patch: { name?: string; value?: number; freq?: Freq; match_terms?: string } = {};
      const notes: string[] = [];
      if (found.name !== pb.name) {
        patch.name = pb.name;
        notes.push(`Renamed from “${found.name}”`);
      }
      if (!pb.variable && Number(found.value) !== pb.value) {
        patch.value = pb.value;
        notes.push(`Value ${usd(Number(found.value))} → ${usd(pb.value)}`);
      }
      if (found.freq !== pb.freq) {
        patch.freq = pb.freq;
        notes.push(`Resets ${FREQ_LABEL[found.freq]} → ${FREQ_LABEL[pb.freq]}`);
      }
      const have = termList(found.match_terms);
      const haveSet = new Set(have.map(norm));
      const missing = termList(pb.terms).filter((t) => !haveSet.has(norm(t)));
      if (missing.length) {
        patch.match_terms = [...have, ...missing].join("|");
        notes.push(`Adds auto-detect phrase${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
      }
      if (notes.length) {
        out.push({ kind: "update", key: `update:${found.id}`, ...base, benefitId: found.id, name: found.name, patch, notes });
      }
    }
  }
  return out;
}
