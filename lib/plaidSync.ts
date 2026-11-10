import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plaid } from "plaid";
import { decrypt } from "./crypto";
import { matchTransactions, reconcileClaims } from "./detect";
import { plaid, plaidErrorCode } from "./plaid";
import type { Benefit, Card, Claim, Txn } from "./types";

interface ItemRow {
  item_id: string;
  user_id: string;
  access_token_enc: string;
  cursor: string | null;
}

export async function upsertAccounts(admin: SupabaseClient, userId: string, itemId: string, accounts: Plaid.AccountBase[]) {
  if (!accounts.length) return;
  const rows = accounts.map((a) => ({
    account_id: a.account_id,
    user_id: userId,
    item_id: itemId,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
  }));
  const { error } = await admin.from("plaid_accounts").upsert(rows);
  if (error) throw error;
}

/** Pull all new transactions for one Item via /transactions/sync, then re-run detection. */
export async function syncItem(admin: SupabaseClient, item: ItemRow) {
  const accessToken = decrypt(item.access_token_enc);
  const startCursor = item.cursor ?? undefined;

  let added: Plaid.Transaction[] = [];
  let modified: Plaid.Transaction[] = [];
  let removed: Plaid.RemovedTransaction[] = [];
  let accounts: Plaid.AccountBase[] = [];
  let cursor = startCursor;

  for (let attempt = 0; ; attempt++) {
    try {
      added = [];
      modified = [];
      removed = [];
      cursor = startCursor;
      for (;;) {
        const res = await plaid().transactions.sync({ access_token: accessToken, cursor, count: 500 });
        added.push(...res.added);
        modified.push(...res.modified);
        removed.push(...res.removed);
        accounts = res.accounts;
        cursor = res.next_cursor;
        if (!res.has_more) break;
      }
      break;
    } catch (e) {
      // Data changed mid-pagination: restart from the first cursor, per Plaid's guidance.
      if (plaidErrorCode(e) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 3) continue;
      await admin.from("plaid_items").update({ status: plaidErrorCode(e) }).eq("item_id", item.item_id);
      throw e;
    }
  }

  await upsertAccounts(admin, item.user_id, item.item_id, accounts);

  const rows = [...added, ...modified].map((t) => ({
    transaction_id: t.transaction_id,
    user_id: item.user_id,
    account_id: t.account_id,
    date: t.date,
    amount: t.amount,
    name: t.name,
    merchant_name: t.merchant_name ?? null,
    original_description: t.original_description ?? null,
    pending: t.pending,
  }));
  // Upsert without touching benefit_id/ignored so user assignments survive updates.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("transactions").upsert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  const removedIds = removed.map((r) => r.transaction_id).filter(Boolean) as string[];
  if (removedIds.length) await admin.from("transactions").delete().in("transaction_id", removedIds).eq("user_id", item.user_id);

  await admin
    .from("plaid_items")
    .update({ cursor, status: "ok", last_synced_at: new Date().toISOString() })
    .eq("item_id", item.item_id);

  await runDetection(admin, item.user_id);
  return { added: added.length, modified: modified.length, removed: removedIds.length };
}

export async function syncAllForUser(admin: SupabaseClient, userId: string) {
  const { data: items, error } = await admin
    .from("plaid_items")
    .select("item_id, user_id, access_token_enc, cursor")
    .eq("user_id", userId);
  if (error) throw error;
  const results = [];
  for (const item of items ?? []) results.push({ item_id: item.item_id, ...(await syncItem(admin, item)) });
  if (!items?.length) await runDetection(admin, userId);
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
      .upsert(ch.inserts.map((c) => ({ ...c, user_id: userId, source: "plaid" })), { onConflict: "benefit_id,period", ignoreDuplicates: true });
    if (error) throw error;
  }
  for (const u of ch.updates) await admin.from("claims").update({ amount: u.amount }).eq("id", u.id).eq("user_id", userId);
  if (ch.deletes.length) await admin.from("claims").delete().in("id", ch.deletes).eq("user_id", userId);

  return { matched: matches.length, ...{ inserted: ch.inserts.length, updated: ch.updates.length, deleted: ch.deletes.length } };
}
