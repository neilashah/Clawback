import { NextResponse } from "next/server";
import { syncConnection } from "@/lib/bankSync";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** Daily Vercel Cron job (see vercel.json). Vercel sends Authorization: Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("bank_connections").select("id, user_id, access_url_enc, last_synced_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const c of data ?? []) {
    try {
      results.push({ id: c.id, ...(await syncConnection(admin, c)) });
    } catch (e) {
      results.push({ id: c.id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ok: true, results });
}
