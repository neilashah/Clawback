import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { plaid, plaidErrorCode } from "@/lib/plaid";
import { syncItem, upsertAccounts } from "@/lib/plaidSync";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { public_token?: string; institution_name?: string };
  if (!body.public_token) return NextResponse.json({ error: "missing public_token" }, { status: 400 });

  const admin = createAdminClient();
  try {
    const ex = await plaid().item.exchangePublicToken({ public_token: body.public_token });
    const item = {
      item_id: ex.item_id,
      user_id: user.id,
      access_token_enc: encrypt(ex.access_token),
      institution_name: body.institution_name ?? null,
      cursor: null as string | null,
    };
    const { error: insErr } = await admin.from("plaid_items").upsert(item, { onConflict: "item_id" });
    if (insErr) throw insErr;

    const accts = await plaid().accounts.get({ access_token: ex.access_token });
    await upsertAccounts(admin, user.id, ex.item_id, accts.accounts);

    // First sync may return nothing if Plaid is still pulling history; the webhook catches up.
    const result = await syncItem(admin, item).catch(() => null);
    return NextResponse.json({ ok: true, item_id: ex.item_id, sync: result });
  } catch (e) {
    return NextResponse.json({ error: plaidErrorCode(e) }, { status: 502 });
  }
}
