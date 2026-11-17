import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./email";
import { renderReminderEmail } from "./reminderEmail";
import { dueRenewals, dueReminders } from "./reminders";
import type { Benefit, Card, Claim } from "./types";

async function loadUser(admin: SupabaseClient, userId: string) {
  const [cards, benefits, claims, sent, sentRenewals] = await Promise.all([
    admin.from("cards").select("*").eq("user_id", userId),
    admin.from("benefits").select("*").eq("user_id", userId),
    admin.from("claims").select("benefit_id, period, amount, dismissed").eq("user_id", userId),
    admin.from("reminders_sent").select("benefit_id, period").eq("user_id", userId),
    admin.from("renewal_reminders_sent").select("card_id, renews_on, days_before").eq("user_id", userId),
  ]);
  for (const q of [cards, benefits, claims, sent]) if (q.error) throw q.error;
  // Before migration 0004 runs there are no renewal dates or table: skip renewals quietly.
  const renewalsReady = !sentRenewals.error;
  return {
    cards: (cards.data as Card[]).map((c) => (renewalsReady ? c : { ...c, renews_on: null })),
    benefits: benefits.data as Benefit[],
    claims: claims.data as Pick<Claim, "benefit_id" | "period" | "amount" | "dismissed">[],
    sent: sent.data as { benefit_id: string; period: string }[],
    sentRenewals: (sentRenewals.data ?? []) as { card_id: string; renews_on: string; days_before: number }[],
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
      const renewals = dueRenewals({ ...data, sent: data.sentRenewals, today });
      if (!due.length && !renewals.length) {
        results.push({ user: userId, sent: 0 });
        continue;
      }
      const mail = renderReminderEmail(due, appUrl, { renewals });
      await sendEmail({ to: await emailOf(admin, userId), subject: mail.subject, html: mail.html, text: mail.text });
      // Record only after a successful send, so a failure retries tomorrow.
      if (due.length) {
        const { error: insErr } = await admin
          .from("reminders_sent")
          .upsert(due.map((d) => ({ user_id: userId, benefit_id: d.benefit.id, period: d.period })), { onConflict: "benefit_id,period", ignoreDuplicates: true });
        if (insErr) throw insErr;
      }
      const renRows = renewals.flatMap((r) => r.milestones.map((m) => ({ user_id: userId, card_id: r.card.id, renews_on: r.renewsKey, days_before: m })));
      if (renRows.length) {
        const { error: renErr } = await admin
          .from("renewal_reminders_sent")
          .upsert(renRows, { onConflict: "card_id,renews_on,days_before", ignoreDuplicates: true });
        if (renErr) throw renErr;
      }
      results.push({ user: userId, sent: due.length + renewals.length });
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
  let renewals = dueRenewals({ ...data, sent: [], today });
  let intro: string | undefined;
  if (!items.length && !renewals.length) {
    renewals = dueRenewals({ ...data, sent: [], today, anyWindow: true }).slice(0, 3);
    items = dueReminders({ ...data, sent: [], today, anyWindow: true }).slice(0, 5);
    intro = items.length || renewals.length
      ? "Test email: nothing is in its reminder window today. These come up next:"
      : "Test email: every credit is used. Nice work!";
  } else {
    intro = "Test email: these are in their reminder window now:";
  }
  const mail = renderReminderEmail(items, appUrl, { intro, renewals });
  await sendEmail({ to: email, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text });
  return { items: items.length + renewals.length };
}
