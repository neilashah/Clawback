import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDetection } from "@/lib/bankSync";
import { createAdminClient } from "@/lib/supabase/admin";

/** Remove a SimpleFIN connection and its accounts/transactions. Manual ticks are kept. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const { data: accts } = await admin.from("bank_accounts").select("account_id").eq("connection_id", id).eq("user_id", user.id);
  const ids = (accts ?? []).map((a) => a.account_id);
  if (ids.length) await admin.from("cards").update({ account_id: null }).in("account_id", ids).eq("user_id", user.id);
  const { error: delErr } = await admin.from("bank_connections").delete().eq("id", id).eq("user_id", user.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  await runDetection(admin, user.id);
  return NextResponse.json({ ok: true });
}
