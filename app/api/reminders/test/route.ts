import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sendTestReminder } from "@/lib/remindersJob";
import { createAdminClient } from "@/lib/supabase/admin";

/** Email the signed-in user a sample reminder right now. */
export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  if (!user.email) return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email isn’t set up yet: add RESEND_API_KEY in Vercel, redeploy, and try again." }, { status: 503 });
  }
  try {
    const r = await sendTestReminder(createAdminClient(), user.id, user.email, new URL(req.url).origin);
    return NextResponse.json({ ok: true, to: user.email, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
