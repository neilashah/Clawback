"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { claimWorth, isStatementCredit } from "@/lib/detect";
import { FREQS, daysUntil, inYear, nextReset, periodKey, resetLabel } from "@/lib/periods";
import { CARD_COLORS, PRESET, STARTER, activeBenefits, todayIso, type PresetCard } from "@/lib/preset";
import { diffPresets, type PresetChange } from "@/lib/presetSync";
import { createClient } from "@/lib/supabase/client";
import { isFullyUsed, isPartlyUsed, remaining as remainingOf, usedAmount } from "@/lib/usage";
import type { BankAccount, BankConnection, Benefit, Card, Claim, Freq, Txn } from "@/lib/types";
import { Icon } from "./icons";
import ThemeToggle from "./ThemeToggle";

type Filter = "available" | "used" | "all";
type Modal =
  | { type: "benefit"; id: string | null; f: { name: string; value: string; freq: Freq; cardId: string; newCardName: string; match_terms: string } }
  | { type: "cards" }
  | { type: "cardEdit"; id: string | null; f: { name: string; annual_fee: string; color: string; account_id: string } }
  | { type: "bank" }
  | { type: "import"; bundle: string }
  | { type: "use"; benefitId: string; name: string; add: string }
  | { type: "updates"; changes: PresetChange[]; picked: Record<string, boolean> }
  | null;

const money = (n: number) => "$" + (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const hexA = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};
/** Card color as text on the surface; blends toward --ink in dark mode so dark card colors stay readable. */
const onSurface = (hex: string) => `color-mix(in srgb, ${hex} var(--accent-mix), var(--ink))`;
const acctLabel = (a: BankAccount) => [a.org, a.name ?? "Account"].filter(Boolean).join(" · ");

export default function Dashboard({ email }: { email: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [credits, setCredits] = useState<Txn[]>([]);
  /** Email reminders on/off; null until loaded (or if the settings table isn't set up yet). */
  const [reminders, setReminders] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("available");
  const [editMode, setEditMode] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [showHoldTip, setShowHoldTip] = useState(false);
  useEffect(() => {
    try {
      setShowHoldTip(localStorage.getItem("clawback-hold-tip") !== "dismissed");
    } catch {
      setShowHoldTip(true);
    }
  }, []);
  const dismissHoldTip = () => {
    setShowHoldTip(false);
    try {
      localStorage.setItem("clawback-hold-tip", "dismissed");
    } catch {}
  };

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const [c, b, cl, it, ac, tx] = await Promise.all([
      supabase.from("cards").select("*").order("sort").order("created_at"),
      supabase.from("benefits").select("*").order("sort").order("created_at"),
      supabase.from("claims").select("*"),
      supabase.from("bank_connections").select("id, kind, label, status, last_synced_at"),
      supabase.from("bank_accounts").select("*").order("created_at"),
      supabase.from("transactions").select("*").lt("amount", 0).gte("date", since).order("date", { ascending: false }).limit(300),
    ]);
    const firstErr = [c, b, cl, it, ac, tx].find((q) => q.error)?.error;
    if (firstErr) setErr(firstErr.message);
    setCards((c.data ?? []) as Card[]);
    setBenefits((b.data ?? []) as Benefit[]);
    setClaims((cl.data ?? []) as Claim[]);
    setConnections((it.data ?? []) as BankConnection[]);
    setAccounts((ac.data ?? []) as BankAccount[]);
    setCredits((tx.data ?? []) as Txn[]);
    setLoaded(true);
    // Separate so a missing settings table (migration 0003 not run yet) doesn't block the app.
    const st = await supabase.from("user_settings").select("reminders").maybeSingle();
    setReminders(st.error ? null : (st.data?.reminders ?? true));
  }, [supabase]);

  useEffect(() => {
    // Load, then quietly pull new transactions if the last sync is older than 12h.
    load().then(async () => {
      const r = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: true }) }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (j?.results?.some((x: { skipped?: boolean }) => !x.skipped)) load();
    });
    const onVis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  /* --------------------------------------------------------------- derived */
  const claimFor = (b: Benefit) => claims.find((c) => c.benefit_id === b.id && c.period === periodKey(b.freq));
  /** Fully used this period (partial uses stay "available"). */
  const isUsed = (b: Benefit) => isFullyUsed(claimFor(b), b);
  const isPartial = (b: Benefit) => isPartlyUsed(claimFor(b), b);
  const leftOf = (b: Benefit) => remainingOf(claimFor(b), b);
  const cardOfAccount = (accountId: string) => cards.find((c) => c.account_id === accountId);
  const unmatched = credits.filter((t) => !t.benefit_id && !t.ignored && isStatementCredit(t) && cardOfAccount(t.account_id));

  /* ------------------------------------------------------------ mutations */
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setErr("");
    try {
      return await fn();
    } catch (e) {
      setErr((e as Error).message || "Something went wrong");
    } finally {
      setBusy("");
    }
  }
  const check = <T,>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const api = async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { method: "POST", ...init });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
    return j;
  };

  async function toggle(b: Benefit) {
    const period = periodKey(b.freq);
    const c = claimFor(b);
    // Optimistic update first, then persist.
    if (!c) {
      const temp: Claim = { id: `tmp-${b.id}`, benefit_id: b.id, period, source: "manual", amount: null, dismissed: false };
      setClaims((xs) => [...xs, temp]);
      await run("", async () => {
        const row = check(await supabase.from("claims").insert({ benefit_id: b.id, period, source: "manual" }).select().single());
        setClaims((xs) => xs.map((x) => (x.id === temp.id ? (row as Claim) : x)));
      });
    } else if (c.dismissed) {
      setClaims((xs) => xs.map((x) => (x.id === c.id ? { ...x, dismissed: false } : x)));
      await run("", async () => check(await supabase.from("claims").update({ dismissed: false }).eq("id", c.id)));
    } else if (c.source === "auto") {
      // Keep the row so the next sync doesn't re-add it.
      setClaims((xs) => xs.map((x) => (x.id === c.id ? { ...x, dismissed: true } : x)));
      await run("", async () => check(await supabase.from("claims").update({ dismissed: true }).eq("id", c.id)));
    } else {
      setClaims((xs) => xs.filter((x) => x.id !== c.id));
      await run("", async () => check(await supabase.from("claims").delete().eq("id", c.id)));
    }
  }

  /** Replace the local copy of a claim with the saved row. */
  const putClaim = (row: Claim) => setClaims((xs) => [...xs.filter((x) => x.id !== row.id && !(x.benefit_id === row.benefit_id && x.period === row.period)), row]);

  async function addUse(b: Benefit, add: number) {
    if (!(add > 0)) return;
    const period = periodKey(b.freq);
    const c = claimFor(b);
    await run("Saving…", async () => {
      const total = Math.round((usedAmount(c, b) + add) * 100) / 100;
      const row = c
        ? check(await supabase.from("claims").update({ amount: total, source: "manual", dismissed: false }).eq("id", c.id).select().single())
        : check(await supabase.from("claims").insert({ benefit_id: b.id, period, source: "manual", amount: total }).select().single());
      putClaim(row as Claim);
      setModal(null);
    });
  }

  async function markFull(b: Benefit) {
    const period = periodKey(b.freq);
    const c = claimFor(b);
    await run("Saving…", async () => {
      const row = c
        ? check(await supabase.from("claims").update({ amount: null, source: "manual", dismissed: false }).eq("id", c.id).select().single())
        : check(await supabase.from("claims").insert({ benefit_id: b.id, period, source: "manual" }).select().single());
      putClaim(row as Claim);
      setModal(null);
    });
  }

  async function clearUse(b: Benefit) {
    const c = claimFor(b);
    if (!c) return setModal(null);
    await run("Saving…", async () => {
      if (c.source === "auto") {
        const row = check(await supabase.from("claims").update({ dismissed: true }).eq("id", c.id).select().single());
        putClaim(row as Claim);
      } else {
        check(await supabase.from("claims").delete().eq("id", c.id));
        setClaims((xs) => xs.filter((x) => x.id !== c.id));
      }
      setModal(null);
    });
  }

  const openUse = (b: Benefit) => setModal({ type: "use", benefitId: b.id, name: b.name, add: "" });

  // Press-and-hold detection for tiles.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const holdProps = (b: Benefit) => {
    if (editMode || !(Number(b.value) > 0)) return {};
    const cancel = () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      holdTimer.current = null;
    };
    return {
      onPointerDown: () => {
        held.current = false;
        cancel();
        holdTimer.current = setTimeout(() => {
          held.current = true;
          openUse(b);
        }, 500);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        cancel();
        held.current = true;
        openUse(b);
      },
    };
  };
  const tapTile = (b: Benefit) => {
    if (held.current) {
      held.current = false;
      return;
    }
    if (editMode) return openBenefit(b);
    if (isPartial(b)) return openUse(b);
    toggle(b);
  };

  async function insertCards(rows: Omit<Card, "id" | "account_id">[]) {
    return check(await supabase.from("cards").insert(rows).select()) as Card[];
  }

  async function loadPreset() {
    await run("Loading cards…", async () => {
      const made = await insertCards(STARTER.map((p, i) => ({ name: p.name, color: p.color, annual_fee: p.annual_fee, sort: i })));
      const rows = STARTER.flatMap((p, i) =>
        activeBenefits(p).map((b, j) => ({ card_id: made[i].id, name: b.name, value: b.value, freq: b.freq, match_terms: b.terms, sort: j })),
      );
      check(await supabase.from("benefits").insert(rows));
      await load();
    });
  }

  async function addPresetCard(p: PresetCard) {
    await run(`Adding ${p.name}…`, async () => {
      const [card] = await insertCards([{ name: p.name, color: p.color, annual_fee: p.annual_fee, sort: cards.length }]);
      const rows = activeBenefits(p).map((b, j) => ({ card_id: card.id, name: b.name, value: b.value, freq: b.freq, match_terms: b.terms, sort: j }));
      check(await supabase.from("benefits").insert(rows));
      await load();
    });
  }

  async function toggleReminders() {
    const next = !(reminders ?? true);
    setReminders(next);
    await run("", async () => {
      check(await supabase.from("user_settings").upsert({ reminders: next, updated_at: new Date().toISOString() }));
    });
  }

  async function sendTestEmail() {
    const j = await run("Sending test email…", async () => (await api("/api/reminders/test")) as { to: string });
    if (j) alert(`Test email sent to ${j.to}. Check your inbox (and spam) in a minute.`);
  }

  function checkUpdates() {
    const changes = diffPresets(cards, benefits, PRESET, todayIso());
    setModal({ type: "updates", changes, picked: Object.fromEntries(changes.map((c) => [c.key, true])) });
  }

  async function applyUpdates(changes: PresetChange[]) {
    await run("Updating benefits…", async () => {
      let termsChanged = false;
      for (const c of changes) {
        if (c.kind === "fee") {
          check(await supabase.from("cards").update({ annual_fee: c.to }).eq("id", c.cardId));
        } else if (c.kind === "add") {
          const sort = Math.max(-1, ...benefits.filter((b) => b.card_id === c.cardId).map((b) => b.sort ?? 0)) + 1;
          check(await supabase.from("benefits").insert({ card_id: c.cardId, name: c.benefit.name, value: c.benefit.value, freq: c.benefit.freq, match_terms: c.benefit.terms, sort }));
          termsChanged ||= !!c.benefit.terms;
        } else if (c.kind === "update") {
          check(await supabase.from("benefits").update(c.patch).eq("id", c.benefitId));
          termsChanged ||= c.patch.match_terms != null;
        } else if (c.kind === "remove") {
          check(await supabase.from("benefits").delete().eq("id", c.benefitId));
        }
      }
      setModal({ type: "cards" });
      if (termsChanged && accounts.length) await api("/api/detect");
      await load();
    });
  }

  async function importLegacy(bundle: string) {
    await run("Importing…", async () => {
      let cfg: { u: string; k: string; c: string };
      try {
        cfg = JSON.parse(decodeURIComponent(escape(atob(bundle.trim().replace(/^CCB1:/, "")))));
      } catch {
        throw new Error("That device-link code wasn’t valid. Copy it again from the old app’s Sync screen.");
      }
      const r = await fetch(`${cfg.u.replace(/\/+$/, "")}/rest/v1/benefits_state?id=eq.${encodeURIComponent(cfg.c)}&select=data`, {
        headers: { apikey: cfg.k, Authorization: `Bearer ${cfg.k}` },
      });
      if (!r.ok) throw new Error(`Couldn’t read old data (${r.status})`);
      const old = (await r.json())[0]?.data as
        | { cards: { id: string; name: string; color: string; annualFee?: number }[]; benefits: { cardId: string; name: string; value: number; freq: Freq; usage?: Record<string, boolean> }[] }
        | undefined;
      if (!old?.cards?.length) throw new Error("No saved data found for that code.");

      const made = await insertCards(old.cards.map((c, i) => ({ name: c.name, color: c.color, annual_fee: Number(c.annualFee) || 0, sort: i })));
      const idMap = new Map(old.cards.map((c, i) => [c.id, made[i].id]));
      const termsByName = new Map(PRESET.flatMap((p) => p.benefits.map((b) => [`${p.name}|${b.name}`, b.terms] as const)));
      const benefitRows = old.benefits
        .filter((b) => idMap.has(b.cardId))
        .map((b, j) => {
          const cardName = old.cards.find((c) => c.id === b.cardId)!.name;
          return { card_id: idMap.get(b.cardId)!, name: b.name, value: Number(b.value) || 0, freq: b.freq, match_terms: termsByName.get(`${cardName}|${b.name}`) ?? "", sort: j };
        });
      const newBenefits = check(await supabase.from("benefits").insert(benefitRows).select()) as Benefit[];
      const oldKept = old.benefits.filter((b) => idMap.has(b.cardId));
      const claimRows = oldKept.flatMap((b, i) =>
        Object.entries(b.usage ?? {})
          .filter(([, v]) => v)
          .map(([period]) => ({ benefit_id: newBenefits[i].id, period, source: "manual" })),
      );
      if (claimRows.length) check(await supabase.from("claims").insert(claimRows));
      setModal(null);
      await load();
    });
  }

  async function saveBenefit() {
    if (modal?.type !== "benefit") return;
    const f = modal.f;
    if (!f.name.trim()) return;
    await run("Saving…", async () => {
      let cardId = f.cardId;
      if (cardId === "__new" || !cards.length) {
        if (!f.newCardName.trim()) throw new Error("Name the new card.");
        const [c] = await insertCards([{ name: f.newCardName.trim(), color: CARD_COLORS[cards.length % CARD_COLORS.length], annual_fee: 0, sort: cards.length }]);
        cardId = c.id;
      }
      const row = { name: f.name.trim(), value: Number(f.value) || 0, freq: f.freq, card_id: cardId, match_terms: f.match_terms.trim() };
      if (modal.id) check(await supabase.from("benefits").update(row).eq("id", modal.id));
      else check(await supabase.from("benefits").insert(row));
      setModal(null);
      if (row.match_terms && accounts.length) await api("/api/detect");
      await load();
    });
  }

  async function delBenefit(id: string) {
    await run("Deleting…", async () => {
      check(await supabase.from("benefits").delete().eq("id", id));
      setModal(null);
      await load();
    });
  }

  async function saveCard() {
    if (modal?.type !== "cardEdit") return;
    const f = modal.f;
    if (!f.name.trim()) return;
    await run("Saving…", async () => {
      const row = { name: f.name.trim(), color: f.color, annual_fee: Number(f.annual_fee) || 0, account_id: f.account_id || null };
      if (modal.id) check(await supabase.from("cards").update(row).eq("id", modal.id));
      else check(await supabase.from("cards").insert({ ...row, sort: cards.length }));
      setModal({ type: "cards" });
      if (row.account_id) await api("/api/detect");
      await load();
    });
  }

  async function delCard(c: Card) {
    if (!confirm(`Delete "${c.name}" and its benefits?`)) return;
    await run("Deleting…", async () => {
      check(await supabase.from("cards").delete().eq("id", c.id));
      await load();
    });
  }

  async function syncNow() {
    await run("Syncing transactions…", async () => {
      await api("/api/sync");
      await load();
    });
  }

  async function disconnect(c: BankConnection) {
    if (!confirm("Remove the SimpleFIN connection? Its downloaded transactions are deleted here; ticks you made by hand stay. To fully revoke access, also delete the app connection on simplefin.org.")) return;
    await run("Disconnecting…", async () => {
      await api(`/api/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      await load();
    });
  }

  async function connectSimplefin(token: string) {
    await run("Connecting to SimpleFIN and downloading this year’s transactions (can take a minute)…", async () => {
      await api("/api/simplefin/connect", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      await load();
      setModal({ type: "cards" });
    });
  }

  async function uploadCsv(cardId: string, file: File) {
    const j = await run("Importing CSV…", async () => {
      const csv = await file.text();
      const res = await api("/api/import-csv", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card_id: cardId, csv }) });
      await load();
      return res as { imported: number; rows: number; matched: number };
    });
    if (j) alert(`Imported ${j.imported} of ${j.rows} transactions. ${j.matched} credit${j.matched === 1 ? "" : "s"} matched to benefits.`);
  }

  async function assign(t: Txn, benefitId: string, remember: boolean) {
    await run("Saving…", async () => {
      check(await supabase.from("transactions").update({ benefit_id: benefitId }).eq("transaction_id", t.transaction_id));
      if (remember) {
        const b = benefits.find((x) => x.id === benefitId);
        const phrase = (t.original_description || t.name || "").toLowerCase().replace(/[0-9#*]+/g, " ").replace(/\s+/g, " ").trim();
        if (b && phrase && !b.match_terms.toLowerCase().split("|").includes(phrase)) {
          const next = [b.match_terms, phrase].filter(Boolean).join("|");
          check(await supabase.from("benefits").update({ match_terms: next }).eq("id", b.id));
        }
      }
      await api("/api/detect");
      await load();
    });
  }

  async function ignore(t: Txn) {
    await run("", async () => {
      check(await supabase.from("transactions").update({ ignored: true }).eq("transaction_id", t.transaction_id));
      setCredits((xs) => xs.map((x) => (x.transaction_id === t.transaction_id ? { ...x, ignored: true } : x)));
    });
  }

  /* --------------------------------------------------------------- render */
  if (!loaded) return <div className="bt-wrap"><div className="bt-none">Loading…</div></div>;

  const openBenefit = (b: Benefit | null, cardId?: string, freq?: Freq) =>
    setModal({
      type: "benefit",
      id: b?.id ?? null,
      f: b
        ? { name: b.name, value: String(b.value), freq: b.freq, cardId: b.card_id, newCardName: "", match_terms: b.match_terms }
        : { name: "", value: "", freq: freq ?? "monthly", cardId: cardId ?? cards[0]?.id ?? "__new", newCardName: "", match_terms: "" },
    });
  const openCard = (c: Card | null) =>
    setModal({
      type: "cardEdit",
      id: c?.id ?? null,
      f: { name: c?.name ?? "", annual_fee: c ? String(c.annual_fee) : "", color: c?.color ?? CARD_COLORS[0], account_id: c?.account_id ?? "" },
    });

  const status = (busy || err) && (
    <div className={err ? "bt-error" : "bt-hint"} style={{ maxWidth: "none", margin: "0 0 14px" }}>
      {err || busy}
    </div>
  );

  let page: React.ReactNode;
  if (!cards.length && !benefits.length) {
    page = (
      <div className="bt-wrap">
        {status}
        <div className="bt-empty">
          <div className="bt-empty-mark">$</div>
          <h2>Track every credit before it expires</h2>
          <p>Load your Sapphire Reserve, Amex Platinum, and Delta Reserve with their 2026 credits filled in, then connect the card accounts so used credits tick themselves off.</p>
          <button className="bt-add" onClick={loadPreset} disabled={!!busy}>
            <Icon name="plus" size={18} /> Load my 3 cards
          </button>
          <button className="bt-link" onClick={() => setModal({ type: "import", bundle: "" })}>
            Import from the old Clawback
          </button>
          <button className="bt-link" onClick={() => openBenefit(null)}>
            Start from scratch instead
          </button>
        </div>
        <Footer email={email} reminders={reminders} busy={!!busy} onToggle={toggleReminders} onTest={sendTestEmail} />
      </div>
    );
  } else {
    let total = 0;
    let used = 0;
    const remaining: Record<string, number> = {};
    const recouped: Record<string, number> = {};
    const year = new Date().getFullYear();
    for (const b of benefits) {
      const v = Number(b.value) || 0;
      total += v;
      used += usedAmount(claimFor(b), b);
      const left = leftOf(b);
      if (left > 0) remaining[b.card_id] = (remaining[b.card_id] ?? 0) + left;
    }
    for (const c of claims) {
      const b = benefits.find((x) => x.id === c.benefit_id);
      if (b && inYear(c.period, year)) recouped[b.card_id] = (recouped[b.card_id] ?? 0) + claimWorth(c, b);
    }
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    const cols = `repeat(${cards.length},1fr)`;
    const cellBenefits = (freq: Freq, cardId: string) =>
      benefits
        .filter((b) => b.freq === freq && b.card_id === cardId)
        .filter((b) => editMode || filter === "all" || (filter === "available" ? !isUsed(b) : isUsed(b)))
        .sort((a, b) => (isUsed(a) !== isUsed(b) ? (isUsed(a) ? 1 : -1) : leftOf(b) - leftOf(a) || (Number(b.value) || 0) - (Number(a.value) || 0)));
    const linkedCount = cards.filter((c) => c.account_id).length;

    page = (
      <div className="bt-wrap">
        <header className="bt-head">
          <div className="bt-eyebrow">Clawback</div>
          <div className="bt-head-actions">
            <ThemeToggle />
            <button className="bt-iconbtn" onClick={() => setModal({ type: "bank" })} title="Bank connections">
              <Icon name="bank" size={17} color={accounts.length ? "var(--vault)" : "var(--muted)"} />
            </button>
            <button className={`bt-mini ${editMode ? "on" : ""}`} onClick={() => setEditMode(!editMode)}>
              <Icon name="pencil" size={14} /> {editMode ? "Done" : "Edit"}
            </button>
            <button className="bt-mini" onClick={() => setModal({ type: "cards" })}>
              <Icon name="card" size={15} /> Cards
            </button>
          </div>
        </header>
        {status}

        {accounts.length === 0 ? (
          <div className="bt-banner">
            <span>Connect your card accounts to tick off credits automatically.</span>
            <button className="bt-fee-set" onClick={() => setModal({ type: "bank" })}>Connect</button>
          </div>
        ) : unmatched.length > 0 ? (
          <div className="bt-banner">
            <span>
              <b>{unmatched.length}</b> statement credit{unmatched.length === 1 ? "" : "s"} to review
            </span>
            <button className="bt-fee-set" onClick={() => setModal({ type: "bank" })}>Review</button>
          </div>
        ) : linkedCount < cards.length ? (
          <div className="bt-banner">
            <span>{cards.length - linkedCount} card{cards.length - linkedCount === 1 ? " isn’t" : "s aren’t"} linked to an account yet.</span>
            <button className="bt-fee-set" onClick={() => setModal({ type: "cards" })}>Link</button>
          </div>
        ) : null}

        <section className="bt-hero">
          <div className="bt-hero-num">{money(total - used)}</div>
          <div className="bt-hero-label">still available to use</div>
          <div className="bt-bar">
            <div className="bt-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="bt-hero-sub">
            You&rsquo;ve claimed {money(used)} of {money(total)} this cycle
          </div>
        </section>

        <section className="bt-fees">
          <div className="bt-fees-title">Annual fee recouped this year</div>
          {cards.map((c) => {
            const fee = Number(c.annual_fee) || 0;
            const got = recouped[c.id] ?? 0;
            const p = fee > 0 ? Math.min(100, Math.round((got / fee) * 100)) : 0;
            const covered = fee > 0 && got >= fee;
            return (
              <div className="bt-fee-row" key={c.id}>
                <div className="bt-fee-top">
                  <span className="bt-fee-name">
                    <span className="bt-dot" style={{ background: c.color }} />
                    {c.name}
                  </span>
                  {fee > 0 ? (
                    <span className="bt-fee-num">
                      {money(got)} / {money(fee)}
                      {covered ? <span className="bt-fee-covered"> &middot; covered &#10003;</span> : <span className="bt-fee-pct"> &middot; {p}%</span>}
                    </span>
                  ) : (
                    <button className="bt-fee-set" onClick={() => openCard(c)}>Set fee</button>
                  )}
                </div>
                {fee > 0 && (
                  <div className="bt-fee-bar">
                    <div className="bt-fee-fill" style={{ width: `${p}%`, background: covered ? "var(--vault)" : c.color }} />
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <div className="bt-filters">
          {(
            [
              ["available", "Available"],
              ["used", "Claimed"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`bt-chip ${filter === id ? "on" : ""} ${editMode ? "dim" : ""}`} disabled={editMode} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>

        {!editMode && showHoldTip && (
          <div className="bt-hint bt-hint-row">
            <span>Tip: press and hold a credit to record a partial use, like $120 of a $300 hotel credit.</span>
            <button className="bt-hint-x" onClick={dismissHoldTip} aria-label="Dismiss tip">
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        {editMode && <div className="bt-hint">Edit mode: tap a benefit to change it or set its auto-detect phrases, or tap + to add one.</div>}

        <div className="bt-matrix">
          <div className="bt-cols" style={{ gridTemplateColumns: cols }}>
            {cards.map((c) => (
              <div className="bt-colhead" key={c.id}>
                <span className="bt-dot" style={{ background: c.color }} />
                <span className="bt-colname">{c.name}</span>
                <span className="bt-colsum">{money(remaining[c.id] ?? 0)} left</span>
              </div>
            ))}
          </div>
          {FREQS.map((f) => {
            const band = cards.map((c) => cellBenefits(f.id, c.id));
            if (!editMode && !band.some((a) => a.length)) return null;
            const urgent = daysUntil(nextReset(f.id)) <= 7;
            return (
              <div className="bt-band" key={f.id}>
                <div className={`bt-bandlabel ${urgent ? "urgent" : ""}`}>
                  <span>{f.label}</span>
                  <span className="bt-bandreset">{resetLabel(f.id)}</span>
                </div>
                <div className="bt-cells" style={{ gridTemplateColumns: cols }}>
                  {cards.map((c, ci) => (
                    <div className="bt-cell" key={c.id}>
                      {band[ci].map((b) => {
                        const u = isUsed(b);
                        const part = isPartial(b);
                        const cl = claimFor(b);
                        const auto = (u || part) && cl?.source === "auto";
                        const spent = usedAmount(cl, b);
                        return (
                          <button
                            key={b.id}
                            className={`bt-tile ${u ? "used" : ""}`}
                            style={u ? { background: c.color, borderColor: c.color } : { background: hexA(c.color, 0.09), borderColor: hexA(c.color, 0.22) }}
                            onClick={() => tapTile(b)}
                            {...holdProps(b)}
                            title={
                              part
                                ? `${money(spent)} of ${money(b.value)} used`
                                : auto
                                  ? "Detected from a statement credit. Tap to undo."
                                  : undefined
                            }
                          >
                            <span className="bt-tile-val" style={{ color: u ? "#fff" : onSurface(c.color) }}>{money(part ? leftOf(b) : b.value)}</span>
                            <span className="bt-tile-name">{b.name}</span>
                            {part && (
                              <span className="bt-tile-progress" aria-label={`${money(spent)} of ${money(b.value)} used`}>
                                <span style={{ width: `${Math.round((spent / (Number(b.value) || 1)) * 100)}%`, background: onSurface(c.color) }} />
                              </span>
                            )}
                            {u && !editMode && (
                              <span className="bt-tile-check">
                                <Icon name="check" size={11} color="#fff" />
                              </span>
                            )}
                            {auto && <span className="bt-tile-auto" style={{ color: u ? "#fff" : onSurface(c.color) }}>auto</span>}
                            {editMode && (
                              <span className="bt-tile-edit">
                                <Icon name="pencil" size={11} color={u ? "#fff" : onSurface(c.color)} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {editMode ? (
                        <button className="bt-addtile" onClick={() => openBenefit(null, c.id, f.id)}>
                          <Icon name="plus" size={14} />
                        </button>
                      ) : (
                        band[ci].length === 0 && <span className="bt-cell-empty">&middot;</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {!editMode && (
          <button className="bt-add" onClick={() => openBenefit(null)}>
            <Icon name="plus" size={18} /> Add benefit
          </button>
        )}
        <Footer email={email} reminders={reminders} busy={!!busy} onToggle={toggleReminders} onTest={sendTestEmail} />
      </div>
    );
  }

  return (
    <>
      {page}
      {modal && (
        <Sheet
          title={modalTitle(modal)}
          back={modal.type === "cardEdit"}
          onClose={() => setModal(modal.type === "cardEdit" ? { type: "cards" } : null)}
          onDismiss={() => setModal(null)}
        >
          {modal.type === "benefit" && (
            <BenefitForm
              modal={modal}
              cards={cards}
              setModal={setModal}
              onSave={saveBenefit}
              onDelete={() => modal.id && delBenefit(modal.id)}
              busy={!!busy}
            />
          )}
          {modal.type === "cards" && (
            <>
              {!cards.length && <div className="bt-none">No cards yet.</div>}
              {cards.map((c) => {
                const n = benefits.filter((b) => b.card_id === c.id).length;
                const acct = accounts.find((a) => a.account_id === c.account_id);
                return (
                  <div className="bt-card-row" key={c.id}>
                    <span className="bt-dot lg" style={{ background: c.color }} />
                    <div className="bt-card-info">
                      <div className="bt-card-name">{c.name}</div>
                      <div className="bt-card-count">
                        {n} benefit{n === 1 ? "" : "s"}
                        {c.annual_fee ? ` · ${money(c.annual_fee)}/yr` : ""}
                        {acct ? ` · linked to ${acctLabel(acct)}` : " · not linked"}
                      </div>
                    </div>
                    <button className="bt-edit" onClick={() => openCard(c)} aria-label="Edit card">
                      <Icon name="pencil" size={15} />
                    </button>
                    <button className="bt-edit danger" onClick={() => delCard(c)} aria-label="Delete card">
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                );
              })}
              <button className="bt-primary" onClick={() => openCard(null)}>
                <Icon name="plus" size={16} /> Add card
              </button>
              {cards.length > 0 && (
                <button className="bt-secondary" onClick={checkUpdates} disabled={!!busy}>
                  <Icon name="refresh" size={15} /> Check for benefit updates
                </button>
              )}
              {cards.length > 0 &&
                (() => {
                  const have = new Set(cards.map((c) => c.name.trim().toLowerCase()));
                  const missing = PRESET.filter((p) => !have.has(p.name.toLowerCase()));
                  if (!missing.length) return null;
                  return (
                    <>
                      <div className="bt-section-title">Add a known card</div>
                      <p className="bt-help">Comes with its credits and auto-detect phrases filled in.</p>
                      {missing.map((p) => (
                        <button key={p.key} className="bt-secondary" onClick={() => addPresetCard(p)} disabled={!!busy}>
                          <span className="bt-dot" style={{ background: p.color }} />
                          {p.name} &middot; {money(p.annual_fee)}/yr &middot; {activeBenefits(p).length} credit{activeBenefits(p).length === 1 ? "" : "s"}
                        </button>
                      ))}
                    </>
                  );
                })()}
              {!cards.length && (
                <button className="bt-link" style={{ marginTop: 16 }} onClick={loadPreset}>
                  Load my 3 preset cards
                </button>
              )}
            </>
          )}
          {modal.type === "cardEdit" && (
            <>
              <label className="bt-f-label">Card name</label>
              <input className="bt-input" placeholder="e.g. Sapphire Reserve" value={modal.f.name} onChange={(e) => setModal({ ...modal, f: { ...modal.f, name: e.target.value } })} />
              <label className="bt-f-label">Annual fee</label>
              <div className="bt-money-input">
                <span>$</span>
                <input className="bt-input bare" type="number" inputMode="decimal" placeholder="0" value={modal.f.annual_fee} onChange={(e) => setModal({ ...modal, f: { ...modal.f, annual_fee: e.target.value } })} />
              </div>
              <label className="bt-f-label">Linked account (for auto-detect)</label>
              <select className="bt-input" value={modal.f.account_id} onChange={(e) => setModal({ ...modal, f: { ...modal.f, account_id: e.target.value } })}>
                <option value="">Not linked</option>
                {accounts
                  .filter((a) => !a.account_id.startsWith("csv:") || a.account_id === modal.f.account_id)
                  .map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {acctLabel(a)}
                    </option>
                  ))}
              </select>
              {!accounts.length && <p className="bt-help" style={{ marginTop: 8 }}>Connect SimpleFIN from the bank screen first, or upload a CSV there (that links the card automatically).</p>}
              <label className="bt-f-label">Color</label>
              <div className="bt-swatches">
                {CARD_COLORS.map((col) => (
                  <button key={col} className={`bt-swatch ${modal.f.color === col ? "on" : ""}`} style={{ background: col }} onClick={() => setModal({ ...modal, f: { ...modal.f, color: col } })} aria-label={col} />
                ))}
              </div>
              <button className="bt-primary" onClick={saveCard} disabled={!!busy}>
                {modal.id ? "Save card" : "Add card"}
              </button>
            </>
          )}
          {modal.type === "bank" && (
            <BankSheet
              connections={connections}
              accounts={accounts}
              cards={cards}
              benefits={benefits}
              unmatched={unmatched}
              busy={!!busy}
              onConnect={connectSimplefin}
              onSync={syncNow}
              onDisconnect={disconnect}
              onUpload={uploadCsv}
              onAssign={assign}
              onIgnore={ignore}
            />
          )}
          {modal.type === "use" &&
            (() => {
              const b = benefits.find((x) => x.id === modal.benefitId);
              if (!b) return null;
              const card = cards.find((x) => x.id === b.card_id);
              const spent = usedAmount(claimFor(b), b);
              const v = Number(b.value) || 0;
              const add = Number(modal.add);
              return (
                <>
                  <div className="bt-use-summary">
                    Used so far: <b>{money(spent)}</b> of {money(v)} &middot; {money(v - spent)} left
                  </div>
                  <div className="bt-bar" style={{ margin: "10px 0 4px" }}>
                    <div className="bt-bar-fill" style={{ width: `${v ? Math.round((spent / v) * 100) : 0}%`, background: card ? onSurface(card.color) : undefined }} />
                  </div>
                  <label className="bt-f-label">Add a use</label>
                  <div className="bt-money-input">
                    <span>$</span>
                    <input
                      className="bt-input bare"
                      type="number"
                      inputMode="decimal"
                      placeholder={String(Math.max(0, v - spent))}
                      value={modal.add}
                      autoFocus
                      onChange={(e) => setModal({ ...modal, add: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && add > 0 && addUse(b, add)}
                    />
                  </div>
                  <button className="bt-primary" onClick={() => addUse(b, add)} disabled={!!busy || !(add > 0)}>
                    Add {add > 0 ? money(add) : ""}
                  </button>
                  {spent < v && (
                    <button className="bt-secondary" onClick={() => markFull(b)} disabled={!!busy}>
                      <Icon name="check" size={15} /> Mark fully used
                    </button>
                  )}
                  {spent > 0 && (
                    <button className="bt-danger" onClick={() => clearUse(b)} disabled={!!busy}>
                      <Icon name="trash" size={15} /> Clear this period
                    </button>
                  )}
                  <p className="bt-help" style={{ marginTop: 12 }}>
                    Uses add up within this period and count toward your annual fee recouped. The credit stays under Available until it&rsquo;s fully used.
                  </p>
                </>
              );
            })()}
          {modal.type === "updates" &&
            (() => {
              const { changes, picked } = modal;
              if (!changes.length) {
                return (
                  <>
                    <div className="bt-none">
                      <Icon name="check" size={22} />
                      <div style={{ marginTop: 8 }}>Everything matches the latest known benefits.</div>
                    </div>
                    <p className="bt-help">Cards and credits you added yourself aren&rsquo;t checked.</p>
                  </>
                );
              }
              const chosen = changes.filter((c) => picked[c.key]);
              const label = (c: PresetChange) =>
                c.kind === "fee"
                  ? "Annual fee"
                  : c.kind === "add"
                    ? `New: ${c.benefit.name}`
                    : c.kind === "remove"
                      ? `Remove: ${c.name}`
                      : c.patch.name ?? c.name;
              const detail = (c: PresetChange) =>
                c.kind === "fee"
                  ? [`${money(c.from)} → ${money(c.to)}`]
                  : c.kind === "add"
                    ? [`${money(c.benefit.value)}, resets ${c.benefit.freq}${c.benefit.terms ? ", auto-detected" : ""}`]
                    : c.kind === "remove"
                      ? [`Ended ${c.until}. Removing it also deletes its claim history.`]
                      : c.notes;
              const groups = [...new Set(changes.map((c) => c.cardName))];
              return (
                <>
                  <p className="bt-help">Pick the updates to apply. Anything you leave unticked stays as it is (it&rsquo;ll be suggested again next time).</p>
                  {groups.map((g) => (
                    <div key={g}>
                      <div className="bt-section-title">{g}</div>
                      {changes
                        .filter((c) => c.cardName === g)
                        .map((c) => (
                          <label key={c.key} className="bt-update">
                            <input type="checkbox" checked={!!picked[c.key]} onChange={(e) => setModal({ ...modal, picked: { ...picked, [c.key]: e.target.checked } })} />
                            <span>
                              <span className={`bt-update-title ${c.kind === "remove" ? "danger" : ""}`}>{label(c)}</span>
                              {detail(c).map((d) => (
                                <span key={d} className="bt-update-note">
                                  {d}
                                </span>
                              ))}
                            </span>
                          </label>
                        ))}
                    </div>
                  ))}
                  <button className="bt-primary" onClick={() => applyUpdates(chosen)} disabled={!!busy || !chosen.length}>
                    Apply {chosen.length} update{chosen.length === 1 ? "" : "s"}
                  </button>
                </>
              );
            })()}
          {modal.type === "import" && (
            <>
              <p className="bt-help">
                In the old single-file Clawback, open the cloud (Sync) screen, tap <b>Copy device-link code</b>, and paste it here. Your cards, credits, and claim history are copied over.
              </p>
              <textarea className="bt-input bt-codebox" placeholder="CCB1:…" value={modal.bundle} onChange={(e) => setModal({ ...modal, bundle: e.target.value })} />
              <button className="bt-primary" onClick={() => importLegacy(modal.bundle)} disabled={!!busy || !modal.bundle.trim()}>
                Import
              </button>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}

function modalTitle(m: NonNullable<Modal>) {
  switch (m.type) {
    case "benefit":
      return m.id ? "Edit benefit" : "Add benefit";
    case "cards":
      return "Your cards";
    case "cardEdit":
      return m.id ? "Edit card" : "New card";
    case "bank":
      return "Bank data";
    case "import":
      return "Import old data";
    case "use":
      return m.name;
    case "updates":
      return "Benefit updates";
  }
}

function Sheet({ title, back, onClose, onDismiss, children }: { title: string; back: boolean; onClose: () => void; onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div className="bt-overlay" onClick={onDismiss}>
      <div className="bt-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="bt-sheet-head">
          <h3>{title}</h3>
          <button className="bt-x" onClick={onClose} aria-label={back ? "Back" : "Close"}>
            <Icon name={back ? "chevron" : "x"} size={20} />
          </button>
        </div>
        <div className="bt-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function BenefitForm({
  modal,
  cards,
  setModal,
  onSave,
  onDelete,
  busy,
}: {
  modal: Extract<Modal, { type: "benefit" }>;
  cards: Card[];
  setModal: (m: Modal) => void;
  onSave: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const f = modal.f;
  const set = (patch: Partial<typeof f>) => setModal({ ...modal, f: { ...f, ...patch } });
  const creatingCard = f.cardId === "__new" || !cards.length;
  return (
    <>
      <label className="bt-f-label">Benefit</label>
      <input className="bt-input" placeholder="e.g. Dining credit" value={f.name} onChange={(e) => set({ name: e.target.value })} />
      <label className="bt-f-label">Value</label>
      <div className="bt-money-input">
        <span>$</span>
        <input className="bt-input bare" type="number" inputMode="decimal" placeholder="0" value={f.value} onChange={(e) => set({ value: e.target.value })} />
      </div>
      <label className="bt-f-label">Resets</label>
      <div className="bt-seg">
        {FREQS.map((x) => (
          <button key={x.id} className={`bt-seg-btn ${f.freq === x.id ? "on" : ""}`} onClick={() => set({ freq: x.id })}>
            {x.label}
          </button>
        ))}
      </div>
      <label className="bt-f-label">Card</label>
      <select className="bt-input" value={f.cardId} onChange={(e) => set({ cardId: e.target.value })}>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__new">+ New card&hellip;</option>
      </select>
      {creatingCard && <input className="bt-input" style={{ marginTop: 8 }} placeholder="New card name" value={f.newCardName} onChange={(e) => set({ newCardName: e.target.value })} />}
      <label className="bt-f-label">Auto-detect phrases</label>
      <input className="bt-input" placeholder="e.g. digital entertainment|streaming credit" value={f.match_terms} onChange={(e) => set({ match_terms: e.target.value })} />
      <p className="bt-help" style={{ marginTop: 8 }}>
        A statement credit on this card whose description contains any of these phrases (separated by |) marks this benefit claimed. Leave blank for credits applied inside an app, like Uber Cash.
      </p>
      <button className="bt-primary" onClick={onSave} disabled={busy}>
        {modal.id ? "Save changes" : "Add benefit"}
      </button>
      {modal.id && (
        <button className="bt-danger" onClick={onDelete} disabled={busy}>
          <Icon name="trash" size={15} /> Delete benefit
        </button>
      )}
    </>
  );
}

function BankSheet(props: {
  connections: BankConnection[];
  accounts: BankAccount[];
  cards: Card[];
  benefits: Benefit[];
  unmatched: Txn[];
  busy: boolean;
  onConnect: (token: string) => void;
  onSync: () => void;
  onDisconnect: (c: BankConnection) => void;
  onUpload: (cardId: string, file: File) => void;
  onAssign: (t: Txn, benefitId: string, remember: boolean) => void;
  onIgnore: (t: Txn) => void;
}) {
  const { connections, accounts, cards, benefits, unmatched, busy } = props;
  const [token, setToken] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [csvCard, setCsvCard] = useState(cards[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);

  return (
    <>
      <div className="bt-section-title" style={{ marginTop: 0 }}>Automatic (SimpleFIN)</div>
      {connections.map((c) => (
        <div className="bt-card-row" key={c.id}>
          <Icon name="bank" size={18} />
          <div className="bt-card-info">
            <div className="bt-card-name">{c.label ?? "SimpleFIN Bridge"}</div>
            <div className="bt-card-count">
              {accounts.filter((a) => a.account_id.startsWith(`sf:${c.id}:`)).map(acctLabel).join(", ") || "No accounts yet"}
              {" · "}
              {c.status === "ok" ? (c.last_synced_at ? `synced ${new Date(c.last_synced_at).toLocaleString()}` : "not synced yet") : <span className="bt-err-text">{c.status}</span>}
            </div>
          </div>
          <button className="bt-edit danger" onClick={() => props.onDisconnect(c)} aria-label="Remove connection">
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}
      {connections.length > 0 ? (
        <>
          <button className="bt-secondary" onClick={props.onSync} disabled={busy}>
            <Icon name="refresh" size={15} /> Sync now
          </button>
          <p className="bt-help" style={{ marginTop: 12 }}>
            Clawback checks for new transactions once a day and whenever you open it. Added a bank on simplefin.org? Tap Sync now, then link it under <b>Cards</b>.
          </p>
        </>
      ) : (
        <>
          <p className="bt-help">
            Paste the <b>setup token</b> from SimpleFIN Bridge (simplefin.org → your account → <b>New app connection</b>). It works once.
          </p>
          <textarea className="bt-input bt-codebox" placeholder="aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0v…" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="bt-primary" style={{ marginTop: 12 }} disabled={busy || !token.trim()} onClick={() => props.onConnect(token)}>
            <Icon name="bank" size={16} /> Connect
          </button>
        </>
      )}

      <div className="bt-section-title">Manual (CSV upload)</div>
      <p className="bt-help">Download transactions from Chase or Amex as a <b>CSV</b> file, then upload it here for that card. Re-uploading the same file is safe.</p>
      <select className="bt-input" value={csvCard} onChange={(e) => setCsvCard(e.target.value)}>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input className="bt-input" style={{ marginTop: 8 }} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="bt-secondary" disabled={busy || !file || !csvCard} onClick={() => file && props.onUpload(csvCard, file)}>
        Upload CSV
      </button>

      {unmatched.length > 0 && (
        <>
          <div className="bt-section-title">Credits to review</div>
          <p className="bt-help">These credits didn&rsquo;t match any benefit. Assign one, or ignore it if it&rsquo;s a refund.</p>
          <label className="bt-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember the description for next time
          </label>
          {unmatched.map((t) => {
            const card = cards.find((c) => c.account_id === t.account_id);
            const options = benefits.filter((b) => b.card_id === card?.id);
            return (
              <div className="bt-txn" key={t.transaction_id}>
                <div className="bt-txn-top">
                  <span className="bt-txn-name">{t.original_description || t.name}</span>
                  <span className="bt-txn-amt">+{money(-t.amount)}</span>
                </div>
                <div className="bt-txn-meta">
                  {t.date} &middot; {card?.name}
                </div>
                <div className="bt-txn-actions">
                  <select className="bt-input" value={pick[t.transaction_id] ?? ""} onChange={(e) => setPick({ ...pick, [t.transaction_id]: e.target.value })}>
                    <option value="">Assign to benefit&hellip;</option>
                    {options.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button className="bt-mini" disabled={!pick[t.transaction_id] || busy} onClick={() => props.onAssign(t, pick[t.transaction_id], remember)}>
                    Save
                  </button>
                  <button className="bt-mini" disabled={busy} onClick={() => props.onIgnore(t)}>
                    Ignore
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function Footer(props: { email: string; reminders: boolean | null; busy: boolean; onToggle: () => void; onTest: () => void }) {
  const on = props.reminders ?? true;
  return (
    <>
      <div className="bt-reminders">
        <span className="bt-reminders-label">
          Email reminders
          <span className="bt-help" style={{ margin: 0 }}>
            {props.reminders === null ? "Not set up yet" : on ? "5 days before monthly credits reset, 14 days for others" : "Off"}
          </span>
        </span>
        {props.reminders !== null && (
          <button className={`bt-switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label="Email reminders" onClick={props.onToggle} disabled={props.busy}>
            <span />
          </button>
        )}
      </div>
      {props.reminders !== false && (
        <button className="bt-link" style={{ marginTop: 6 }} onClick={props.onTest} disabled={props.busy}>
          Send a test reminder email
        </button>
      )}
      <div className="bt-foot">
        <span className="bt-help" style={{ margin: 0 }}>{props.email}</span>
        <form action="/auth/signout" method="post">
          <button className="bt-link" style={{ margin: 0 }}>Sign out</button>
        </form>
      </div>
    </>
  );
}
