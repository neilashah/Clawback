import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncConnection } from "@/lib/bankSync";
import { encrypt } from "@/lib/crypto";
import { claimAccessUrl } from "@/lib/simplefin";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/** Claim a SimpleFIN setup token, store the access URL encrypted, and run the first sync. */
export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token?.trim()) return NextResponse.json({ error: "Paste your SimpleFIN setup token." }, { status: 400 });

  const admin = createAdminClient();
  try {
    const access = await claimAccessUrl(token);
    const { data: conn, error: insErr } = await admin
      .from("bank_connections")
      .insert({ user_id: user.id, kind: "simplefin", access_url_enc: encrypt(access), label: "SimpleFIN Bridge" })
      .select("id, user_id, access_url_enc, last_synced_at")
      .single();
    if (insErr) throw insErr;
    const result = await syncConnection(admin, conn);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
