import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { plaid } from "@/lib/plaid";
import { runDetection } from "@/lib/plaidSync";
import { createAdminClient } from "@/lib/supabase/admin";

/** Disconnect a bank: revoke at Plaid, then delete its accounts and transactions. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { itemId } = await ctx.params;
  const admin = createAdminClient();
  const { data: item } = await admin
    .from("plaid_items")
    .select("item_id, access_token_enc")
    .eq("item_id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  await plaid().item.remove({ access_token: decrypt(item.access_token_enc) }).catch(() => undefined);
  const { data: accts } = await admin.from("plaid_accounts").select("account_id").eq("item_id", itemId);
  const ids = (accts ?? []).map((a) => a.account_id);
  if (ids.length) await admin.from("cards").update({ plaid_account_id: null }).in("plaid_account_id", ids).eq("user_id", user.id);
  await admin.from("plaid_items").delete().eq("item_id", itemId).eq("user_id", user.id); // cascades
  await runDetection(admin, user.id);
  return NextResponse.json({ ok: true });
}
