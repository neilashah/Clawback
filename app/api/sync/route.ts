import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncUser } from "@/lib/bankSync";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Body { auto: true } = opportunistic sync on app open (skips if synced in the last 12h).
 * Otherwise a manual "Sync now" (skips if synced in the last 10 minutes).
 */
export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const { auto } = (await req.json().catch(() => ({}))) as { auto?: boolean };
  try {
    const results = await syncUser(createAdminClient(), user.id, auto ? 12 * 3600000 : 10 * 60000);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
