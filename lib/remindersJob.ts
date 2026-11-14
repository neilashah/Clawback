import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./email";
import { renderReminderEmail } from "./reminderEmail";
import { dueReminders } from "./reminders";
import type { Benefit, Card, Claim } from "./types";

async function loadUser(admin: SupabaseClient, userId: string) {
  const [cards, benefits, claims, sent] = await Promise.all([
    admin.from("cards").select("*").eq("user_id", userId),
    admin.from("benefits").select("*").eq("user_id", userId),
    admin.from("claims").select("benefit_id, period, amount, dismissed").eq("user_id", userId),
    admin.from("reminders_sent").select("benefit_id, period").eq("user_id", userId),
  ]);
  for (const q of [cards, benefits, claims, sent]) if (q.error) throw q.error;
  return {
    cards: cards.data as Card[],
    benefits: benefits.data as Benefit[],
    claims: claims.data as Pick<Claim, "benefit_id" | "period" | "amount" | "dismissed">[],
    sent: sent.data as { benefit_id: string; period: string }[],
  };
}

async function emailOf(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("No email address for user");
  return data.user.email;
}

/** Daily: email each user about credits entering their reminder window. */
export async function runReminders(admin: SupabaseClient, appUrl: string, today = new Date()) {
  const { data: owners, error } = await admin.from("benefits").select("user_id");
  if (error) throw error;
  const userIds = [...new Set((owners ?? []).map((o) => o.user_id as string))];
  const { data: off } = await admin.from("user_settings").select("user_id").eq("reminders", false);
  const optedOut = new Set((off ?? []).map((o) => o.user_id as string));

  const results: { user: string; sent?: number; skipped?: string; error?: string }[] = [];
  for (const userId of userIds) {
    if (optedOut.has(userId)) {
      results.push({ user: userId, skipped: "off" });
      continue;
    }
    try {
      const data = await loadUser(admin, userId);
      const due = dueReminders({ ...data, today });
      if (!due.length) {
        results.push({ user: userId, sent: 0 });
        continue;
      }
      const mail = renderReminderEmail(due, appUrl);
      await sendEmail({ to: await emailOf(admin, userId), subject: mail.subject, html: mail.html, text: mail.text });
      // Record only after a successful send, so a failure retries tomorrow.
      const { error: insErr } = await admin
        .from("reminders_sent")
        .upsert(due.map((d) => ({ user_id: userId, benefit_id: d.benefit.id, period: d.period })), { onConflict: "benefit_id,period", ignoreDuplicates: true });
      if (insErr) throw insErr;
      results.push({ user: userId, sent: due.length });
    } catch (e) {
      results.push({ user: userId, error: (e as Error).message });
    }
  }
  return results;
}

/** "Send test email": what's due now, or the next few resets if nothing is. Never recorded. */
export async function sendTestReminder(admin: SupabaseClient, userId: string, email: string, appUrl: string, today = new Date()) {
  const data = await loadUser(admin, userId);
  let items = dueReminders({ ...data, sent: [], today });
  let intro: string | undefined;
  if (!items.length) {
    items = dueReminders({ ...data, sent: [], today, anyWindow: true }).slice(0, 5);
    intro = items.length
      ? "Test email: nothing is in its reminder window today. These reset next:"
      : "Test email: every credit is used. Nice work!";
  } else {
    intro = "Test email: these credits are in their reminder window now:";
  }
  const mail = renderReminderEmail(items, appUrl, { intro });
  await sendEmail({ to: email, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text });
  return { items: items.length };
}
