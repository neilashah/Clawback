import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto";
import { matchTransactions, reconcileClaims } from "./detect";
import { fetchAccounts, sfAccountKey, toTxnRow, windows } from "./simplefin";
import type { Benefit, Card, Claim, Txn } from "./types";

interface ConnectionRow {
  id: string;
  user_id: string;
  access_url_enc: string;
  last_synced_at: string | null;
}

const DAY = 86400000;

export async function upsertTxns(admin: SupabaseClient, rows: Record<string, unknown>[]) {
  // Upsert leaves benefit_id/ignored alone, so user assignments survive re-syncs.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("transactions").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}

/** Pull transactions from SimpleFIN for one connection, then re-run detection. */
export async function syncConnection(admin: SupabaseClient, conn: ConnectionRow) {
  const access = decrypt(conn.access_url_enc);
  const end = new Date();
  // First sync: back to Jan 1 (fee recoup is per calendar year; Bridge returns what it has).
  // Later syncs overlap 14 days to catch late-posting credits.
  const start = conn.last_synced_at
    ? new Date(Date.parse(conn.last_synced_at) - 14 * DAY)
    : new Date(end.getFullYear(), 0, 1);

  const errors = new Set<string>();
  let count = 0;
  try {
    for (const [s, e] of windows(start, end, 60)) {
      const set = await fetchAccounts(access, s, e);
      (set.errors ?? []).forEach((x) => errors.add(x));
      const accts = set.accounts.map((a) => ({
        account_id: sfAccountKey(conn.id, a.id),
        user_id: conn.user_id,
        connection_id: conn.id,
        name: a.name,
        org: a.org?.name ?? a.org?.domain ?? null,
      }));
      if (accts.length) {
        const { error } = await admin.from("bank_accounts").upsert(accts);
        if (error) throw error;
      }
      const rows = set.accounts.flatMap((a) =>
        (a.transactions ?? []).map((t) => toTxnRow(conn.user_id, sfAccountKey(conn.id, a.id), t)).filter((x) => x !== null),
      );
      await upsertTxns(admin, rows);
      count += rows.length;
    }
  } catch (e) {
    await admin.from("bank_connections").update({ status: (e as Error).message.slice(0, 200) }).eq("id", conn.id);
    throw e;
  }

  await admin
    .from("bank_connections")
    .update({ status: errors.size ? [...errors].join(" ").slice(0, 200) : "ok", last_synced_at: end.toISOString() })
    .eq("id", conn.id);
  await runDetection(admin, conn.user_id);
  return { transactions: count, errors: [...errors] };
}

/**
 * Sync every connection for a user.
 * minAgeMs: skip connections synced more recently (SimpleFIN Bridge allows ~24 requests/day).
 */
export async function syncUser(admin: SupabaseClient, userId: string, minAgeMs: number) {
  const { data, error } = await admin.from("bank_connections").select("id, user_id, access_url_enc, last_synced_at").eq("user_id", userId);
  if (error) throw error;
  const results = [];
  for (const c of data ?? []) {
    if (c.last_synced_at && Date.now() - Date.parse(c.last_synced_at) < minAgeMs) {
      results.push({ id: c.id, skipped: true });
      continue;
    }
    results.push({ id: c.id, ...(await syncConnection(admin, c)) });
  }
  return results;
}

/** Assign unmatched credits to benefits, then reconcile auto-detected claims. */
export async function runDetection(admin: SupabaseClient, userId: string) {
  const [cardsQ, benefitsQ, txnsQ, claimsQ] = await Promise.all([
    admin.from("cards").select("*").eq("user_id", userId),
    admin.from("benefits").select("*").eq("user_id", userId),
    admin.from("transactions").select("*").eq("user_id", userId).lt("amount", 0),
    admin.from("claims").select("*").eq("user_id", userId),
  ]);
  for (const q of [cardsQ, benefitsQ, txnsQ, claimsQ]) if (q.error) throw q.error;
  const cards = cardsQ.data as Card[];
  const benefits = benefitsQ.data as Benefit[];
  const txns = txnsQ.data as Txn[];
  const claims = claimsQ.data as Claim[];

  const matches = matchTransactions(txns, benefits, cards);
  for (const m of matches) {
    await admin.from("transactions").update({ benefit_id: m.benefit_id }).eq("transaction_id", m.transaction_id).eq("user_id", userId);
    const t = txns.find((x) => x.transaction_id === m.transaction_id);
    if (t) t.benefit_id = m.benefit_id;
  }

  const ch = reconcileClaims(txns, benefits, claims);
  if (ch.inserts.length) {
    const { error } = await admin
      .from("claims")
      .upsert(ch.inserts.map((c) => ({ ...c, user_id: userId, source: "auto" })), { onConflict: "benefit_id,period", ignoreDuplicates: true });
    if (error) throw error;
  }
  for (const u of ch.updates) await admin.from("claims").update({ amount: u.amount }).eq("id", u.id).eq("user_id", userId);
  if (ch.deletes.length) await admin.from("claims").delete().in("id", ch.deletes).eq("user_id", userId);

  return { matched: matches.length, inserted: ch.inserts.length, updated: ch.updates.length, deleted: ch.deletes.length };
}
