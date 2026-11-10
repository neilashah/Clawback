"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { claimWorth, isStatementCredit } from "@/lib/detect";
import { FREQS, daysUntil, inYear, nextReset, periodKey, resetLabel } from "@/lib/periods";
import { CARD_COLORS, PRESET } from "@/lib/preset";
import { createClient } from "@/lib/supabase/client";
import type { Benefit, Card, Claim, Freq, PlaidAccount, PlaidItem, Txn } from "@/lib/types";
import ConnectBank from "./ConnectBank";
import { Icon } from "./icons";

type Filter = "available" | "used" | "all";
type Modal =
  | { type: "benefit"; id: string | null; f: { name: string; value: string; freq: Freq; cardId: string; newCardName: string; match_terms: string } }
  | { type: "cards" }
  | { type: "cardEdit"; id: string | null; f: { name: string; annual_fee: string; color: string; plaid_account_id: string } }
  | { type: "bank" }
  | { type: "import"; bundle: string }
  | null;

const money = (n: number) => "$" + (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const hexA = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};
const acctLabel = (a: PlaidAccount) => `${a.name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`;

export default function Dashboard({ email, plaidEnv }: { email: string; plaidEnv: "sandbox" | "production" }) {
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [credits, setCredits] = useState<Txn[]>([]);
  const [filter, setFilter] = useState<Filter>("available");
  const [editMode, setEditMode] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const [c, b, cl, it, ac, tx] = await Promise.all([
      supabase.from("cards").select("*").order("sort").order("created_at"),
      supabase.from("benefits").select("*").order("sort").order("created_at"),
      supabase.from("claims").select("*"),
      supabase.from("plaid_items").select("id, item_id, institution_name, status, last_synced_at"),
      supabase.from("plaid_accounts").select("*"),
      supabase.from("transactions").select("*").lt("amount", 0).gte("date", since).order("date", { ascending: false }).limit(300),
    ]);
    const firstErr = [c, b, cl, it, ac, tx].find((q) => q.error)?.error;
    if (firstErr) setErr(firstErr.message);
    setCards((c.data ?? []) as Card[]);
    setBenefits((b.data ?? []) as Benefit[]);
    setClaims((cl.data ?? []) as Claim[]);
    setItems((it.data ?? []) as PlaidItem[]);
    setAccounts((ac.data ?? []) as PlaidAccount[]);
    setCredits((tx.data ?? []) as Txn[]);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    load();
    const onVis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  /* --------------------------------------------------------------- derived */
  const claimFor = (b: Benefit) => claims.find((c) => c.benefit_id === b.id && c.period === periodKey(b.freq));
  const isUsed = (b: Benefit) => {
    const c = claimFor(b);
    return !!c && !c.dismissed;
  };
  const cardOfAccount = (accountId: string) => cards.find((c) => c.plaid_account_id === accountId);
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
    } else if (c.source === "plaid") {
      // Keep the row so the next sync doesn't re-add it.
      setClaims((xs) => xs.map((x) => (x.id === c.id ? { ...x, dismissed: true } : x)));
      await run("", async () => check(await supabase.from("claims").update({ dismissed: true }).eq("id", c.id)));
    } else {
      setClaims((xs) => xs.filter((x) => x.id !== c.id));
      await run("", async () => check(await supabase.from("claims").delete().eq("id", c.id)));
    }
  }

  async function insertCards(rows: Omit<Card, "id" | "plaid_account_id">[]) {
    return check(await supabase.from("cards").insert(rows).select()) as Card[];
  }

  async function loadPreset() {
    await run("Loading cards…", async () => {
      const made = await insertCards(PRESET.map((p, i) => ({ name: p.name, color: p.color, annual_fee: p.annual_fee, sort: i })));
      const rows = PRESET.flatMap((p, i) =>
        p.benefits.map((b, j) => ({ card_id: made[i].id, name: b.name, value: b.value, freq: b.freq, match_terms: b.terms, sort: j })),
      );
      check(await supabase.from("benefits").insert(rows));
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
      if (row.match_terms && items.length) await api("/api/detect");
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
      const row = { name: f.name.trim(), color: f.color, annual_fee: Number(f.annual_fee) || 0, plaid_account_id: f.plaid_account_id || null };
      if (modal.id) check(await supabase.from("cards").update(row).eq("id", modal.id));
      else check(await supabase.from("cards").insert({ ...row, sort: cards.length }));
      setModal({ type: "cards" });
      if (row.plaid_account_id) await api("/api/detect");
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
      await api("/api/plaid/sync");
      await load();
    });
  }

  async function disconnect(item: PlaidItem) {
    if (!confirm(`Disconnect ${item.institution_name ?? "this bank"}? Its transactions are deleted; claims you ticked by hand stay.`)) return;
    await run("Disconnecting…", async () => {
      await api(`/api/plaid/items/${encodeURIComponent(item.item_id)}`, { method: "DELETE" });
      await load();
    });
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

  async function simulateCredit(accountId: string, description: string, amount: number) {
    await run("Creating sandbox credit…", async () => {
      await api("/api/plaid/sandbox-credit", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, description, amount }),
      });
      await load();
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
      f: { name: c?.name ?? "", annual_fee: c ? String(c.annual_fee) : "", color: c?.color ?? CARD_COLORS[0], plaid_account_id: c?.plaid_account_id ?? "" },
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
        <Footer email={email} />
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
      if (isUsed(b)) used += v;
      else remaining[b.card_id] = (remaining[b.card_id] ?? 0) + v;
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
        .sort((a, b) => (isUsed(a) !== isUsed(b) ? (isUsed(a) ? 1 : -1) : (Number(b.value) || 0) - (Number(a.value) || 0)));
    const linkedCount = cards.filter((c) => c.plaid_account_id).length;

    page = (
      <div className="bt-wrap">
        <header className="bt-head">
          <div className="bt-eyebrow">Clawback</div>
          <div className="bt-head-actions">
            <button className="bt-iconbtn" onClick={() => setModal({ type: "bank" })} title="Bank connections">
              <Icon name="bank" size={17} color={items.length ? "var(--vault)" : "var(--muted)"} />
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

        {items.length === 0 ? (
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
                        const auto = u && claimFor(b)?.source === "plaid";
                        return (
                          <button
                            key={b.id}
                            className={`bt-tile ${u ? "used" : ""}`}
                            style={u ? { background: c.color, borderColor: c.color } : { background: hexA(c.color, 0.09), borderColor: hexA(c.color, 0.22) }}
                            onClick={() => (editMode ? openBenefit(b) : toggle(b))}
                            title={auto ? "Detected from a statement credit. Tap to undo." : undefined}
                          >
                            <span className="bt-tile-val" style={{ color: u ? "#fff" : c.color }}>{money(b.value)}</span>
                            <span className="bt-tile-name">{b.name}</span>
                            {u && !editMode && (
                              <span className="bt-tile-check">
                                <Icon name="check" size={11} color="#fff" />
                              </span>
                            )}
                            {auto && <span className="bt-tile-auto" style={{ color: "#fff" }}>auto</span>}
                            {editMode && (
                              <span className="bt-tile-edit">
                                <Icon name="pencil" size={11} color={u ? "#fff" : c.color} />
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
        <Footer email={email} />
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
                const acct = accounts.find((a) => a.account_id === c.plaid_account_id);
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
              <select className="bt-input" value={modal.f.plaid_account_id} onChange={(e) => setModal({ ...modal, f: { ...modal.f, plaid_account_id: e.target.value } })}>
                <option value="">Not linked</option>
                {accounts
                  .filter((a) => a.type === "credit" || a.account_id === modal.f.plaid_account_id)
                  .map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {acctLabel(a)}
                    </option>
                  ))}
              </select>
              {!accounts.length && <p className="bt-help" style={{ marginTop: 8 }}>Connect a bank from the bank screen first.</p>}
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
              items={items}
              accounts={accounts}
              cards={cards}
              benefits={benefits}
              unmatched={unmatched}
              plaidEnv={plaidEnv}
              busy={!!busy}
              onLinked={() => {
                setModal({ type: "cards" });
                load();
              }}
              onError={setErr}
              onSync={syncNow}
              onDisconnect={disconnect}
              onAssign={assign}
              onIgnore={ignore}
              onSimulate={simulateCredit}
            />
          )}
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
      return "Bank connections";
    case "import":
      return "Import old data";
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
  items: PlaidItem[];
  accounts: PlaidAccount[];
  cards: Card[];
  benefits: Benefit[];
  unmatched: Txn[];
  plaidEnv: "sandbox" | "production";
  busy: boolean;
  onLinked: () => void;
  onError: (m: string) => void;
  onSync: () => void;
  onDisconnect: (i: PlaidItem) => void;
  onAssign: (t: Txn, benefitId: string, remember: boolean) => void;
  onIgnore: (t: Txn) => void;
  onSimulate: (accountId: string, description: string, amount: number) => void;
}) {
  const { items, accounts, cards, benefits, unmatched, plaidEnv, busy } = props;
  const [pick, setPick] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [sim, setSim] = useState({ account: "", description: "Platinum Digital Entertainment Credit", amount: "25" });
  const linkedAccounts = accounts.filter((a) => cards.some((c) => c.plaid_account_id === a.account_id));

  return (
    <>
      {plaidEnv === "sandbox" && (
        <div className="bt-hint">
          Sandbox mode: fake banks only. In Link, pick any bank and sign in as <b>user_transactions_dynamic</b> (any password) to test.
        </div>
      )}
      {items.map((it) => (
        <div className="bt-card-row" key={it.item_id}>
          <Icon name="bank" size={18} />
          <div className="bt-card-info">
            <div className="bt-card-name">{it.institution_name ?? "Bank"}</div>
            <div className="bt-card-count">
              {accounts.filter((a) => a.item_id === it.item_id).map(acctLabel).join(", ") || "No accounts"}
              {" · "}
              {it.status === "ok" ? (it.last_synced_at ? `synced ${new Date(it.last_synced_at).toLocaleString()}` : "waiting for first sync") : <span style={{ color: "#B91C1C" }}>{it.status}</span>}
            </div>
          </div>
          <button className="bt-edit danger" onClick={() => props.onDisconnect(it)} aria-label="Disconnect">
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}
      <ConnectBank onLinked={props.onLinked} onError={props.onError} />
      {items.length > 0 && (
        <button className="bt-secondary" onClick={props.onSync} disabled={busy}>
          <Icon name="refresh" size={15} /> Sync now
        </button>
      )}
      <p className="bt-help" style={{ marginTop: 12 }}>
        After connecting, open <b>Cards</b> and link each card to its account. New statement credits are matched automatically when Plaid reports them.
      </p>

      {unmatched.length > 0 && (
        <>
          <div className="bt-section-title">Credits to review</div>
          <p className="bt-help">These credits didn&rsquo;t match any benefit. Assign one, or ignore it if it&rsquo;s a refund.</p>
          <label className="bt-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember the description for next time
          </label>
          {unmatched.map((t) => {
            const card = cards.find((c) => c.plaid_account_id === t.account_id);
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

      {plaidEnv === "sandbox" && linkedAccounts.length > 0 && (
        <>
          <div className="bt-section-title">Test: fake a statement credit</div>
          <select className="bt-input" value={sim.account} onChange={(e) => setSim({ ...sim, account: e.target.value })}>
            <option value="">Choose a linked account&hellip;</option>
            {linkedAccounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {acctLabel(a)}
              </option>
            ))}
          </select>
          <input className="bt-input" style={{ marginTop: 8 }} value={sim.description} onChange={(e) => setSim({ ...sim, description: e.target.value })} />
          <div className="bt-money-input" style={{ marginTop: 8 }}>
            <span>$</span>
            <input className="bt-input bare" type="number" value={sim.amount} onChange={(e) => setSim({ ...sim, amount: e.target.value })} />
          </div>
          <button className="bt-secondary" disabled={!sim.account || busy} onClick={() => props.onSimulate(sim.account, sim.description, Number(sim.amount) || 0)}>
            Post fake credit and sync
          </button>
        </>
      )}
    </>
  );
}

function Footer({ email }: { email: string }) {
  return (
    <div className="bt-foot">
      <span className="bt-help" style={{ margin: 0 }}>{email}</span>
      <form action="/auth/signout" method="post">
        <button className="bt-link" style={{ margin: 0 }}>Sign out</button>
      </form>
    </div>
  );
}
