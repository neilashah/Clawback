import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runDetection } from "@/lib/plaidSync";
import { createAdminClient } from "@/lib/supabase/admin";

/** Re-run matching + claim reconciliation (after editing match terms or assigning a credit). */
export async function POST() {
  const { user, error } = await requireUser();
  if (error) return error;
  const result = await runDetection(createAdminClient(), user.id);
  return NextResponse.json({ ok: true, ...result });
}
