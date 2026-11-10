import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDetection, upsertTxns } from "@/lib/bankSync";
import { csvToTxns, csvTxnIds, dedupeAgainst } from "@/lib/csv";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Body: { card_id, csv } (CSV text, ≤ 2 MB). Rows go onto the card's linked account,
 * or a new "csv:<card id>" account that gets linked to the card.
 */
export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { card_id, csv } = (await req.json().catch(() => ({}))) as { card_id?: string; csv?: string };
  if (!card_id || !csv) return NextResponse.json({ error: "Choose a card and a CSV file." }, { status: 400 });
  if (csv.length > 2_000_000) return NextResponse.json({ error: "File too large (max 2 MB)." }, { status: 413 });

  const admin = createAdminClient();
  const { data: card } = await admin.from("cards").select("id, name, account_id").eq("id", card_id).eq("user_id", user.id).maybeSingle();
  if (!card) return NextResponse.json({ error: "Unknown card." }, { status: 404 });

  let parsed;
  try {
    parsed = csvToTxns(csv);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  let accountKey: string = card.account_id;
  if (!accountKey) {
    accountKey = `csv:${card.id}`;
    const { error: aErr } = await admin.from("bank_accounts").upsert({ account_id: accountKey, user_id: user.id, connection_id: null, name: `${card.name} (CSV)`, org: null });
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    await admin.from("cards").update({ account_id: accountKey }).eq("id", card.id).eq("user_id", user.id);
  }

  const ids = csvTxnIds(accountKey, parsed.txns);
  let rows = parsed.txns.map((t, i) => ({
    transaction_id: ids[i],
    user_id: user.id,
    account_id: accountKey,
    date: t.date,
    amount: t.amount,
    name: t.description,
    merchant_name: null,
    original_description: null,
    pending: false,
  }));

  // If this account also gets a bank feed, skip rows the feed already has.
  if (accountKey.startsWith("sf:") && rows.length) {
    const dates = rows.map((r) => r.date).sort();
    const { data: existing } = await admin
      .from("transactions")
      .select("transaction_id, date, amount")
      .eq("account_id", accountKey)
      .eq("user_id", user.id)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1]);
    const feed = (existing ?? []).filter((e) => !e.transaction_id.includes(":csv:"));
    rows = dedupeAgainst(rows, feed);
  }

  await upsertTxns(admin, rows);
  const detection = await runDetection(admin, user.id);
  return NextResponse.json({ ok: true, format: parsed.format, rows: parsed.txns.length, imported: rows.length, ...detection });
}
