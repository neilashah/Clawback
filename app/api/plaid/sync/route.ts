import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { plaidErrorCode } from "@/lib/plaid";
import { syncAllForUser } from "@/lib/plaidSync";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const { user, error } = await requireUser();
  if (error) return error;
  try {
    const results = await syncAllForUser(createAdminClient(), user.id);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: plaidErrorCode(e) }, { status: 502 });
  }
}
