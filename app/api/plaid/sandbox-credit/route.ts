import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { PLAID_ENV, plaid, plaidErrorCode } from "@/lib/plaid";
import { syncItem } from "@/lib/plaidSync";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sandbox only: inject a fake statement credit so detection can be tested end to end.
 * Requires the Item to have been linked with the `user_transactions_dynamic` test user.
 */
export async function POST(req: Request) {
  if (PLAID_ENV !== "sandbox") return NextResponse.json({ error: "sandbox only" }, { status: 404 });
  const { user, error } = await requireUser();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { account_id?: string; description?: string; amount?: number };
  if (!body.account_id || !body.description) return NextResponse.json({ error: "account_id and description required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: acct } = await admin.from("plaid_accounts").select("item_id").eq("account_id", body.account_id).eq("user_id", user.id).maybeSingle();
  if (!acct) return NextResponse.json({ error: "unknown account" }, { status: 404 });
  const { data: item } = await admin.from("plaid_items").select("item_id, user_id, access_token_enc, cursor").eq("item_id", acct.item_id).single();
  if (!item) return NextResponse.json({ error: "unknown item" }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  try {
    await plaid().sandbox.createTransactions({
      access_token: decrypt(item.access_token_enc),
      transactions: [
        { date_transacted: today, date_posted: today, amount: -Math.abs(body.amount ?? 10), description: body.description, account_id: body.account_id },
      ],
    });
    // Sandbox makes new transactions available after a refresh.
    await plaid().transactions.refresh({ access_token: decrypt(item.access_token_enc) }).catch(() => undefined);
    const result = await syncItem(admin, item);
    return NextResponse.json({ ok: true, sync: result });
  } catch (e) {
    return NextResponse.json({ error: plaidErrorCode(e) }, { status: 502 });
  }
}
