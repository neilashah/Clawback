/** Render the reminder email (pure). */
import type { DueRenewal, DueReminder } from "./reminders";

const money = (n: number) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** The last day you can still use a credit (the day before it resets). */
const lastDay = (reset: Date) => new Date(Date.UTC(reset.getFullYear(), reset.getMonth(), reset.getDate() - 1));

const fullDate = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const inDays = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const renewalLine = (r: DueRenewal) =>
  `${r.card.name} renews ${fullDate(r.renewsOn)}${Number(r.card.annual_fee) > 0 ? ` for ${money(Number(r.card.annual_fee))}` : ""} (${inDays(r.daysLeft)})`;
const unusedLabel = (u: DueRenewal["unused"][number]) => (u.left > 0 ? `${u.benefit.name}, ${money(u.left)} left` : `${u.benefit.name}, not marked used`);

export function renderReminderEmail(items: DueReminder[], appUrl: string, opts: { intro?: string; renewals?: DueRenewal[] } = {}) {
  const renewals = opts.renewals ?? [];
  const total = items.reduce((s, i) => s + i.left, 0);
  const subject = items.length || !renewals.length
    ? `Clawback: ${money(total)} in credits reset soon${renewals.length ? ` + ${renewals.length} card renewal${renewals.length === 1 ? "" : "s"}` : ""}`
    : renewals.length === 1
      ? `Clawback: ${renewals[0].card.name} renews ${fullDate(renewals[0].renewsOn)}`
      : `Clawback: ${renewals.length} cards renew soon`;
  const groups = new Map<string, DueReminder[]>();
  for (const i of items) {
    const k = dayLabel(lastDay(i.resetDate));
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  const rows = [...groups]
    .map(
      ([day, list]) =>
        `<tr><td colspan="3" style="padding:14px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#67726B">Use by ${esc(day)}</td></tr>` +
        list
          .map(
            (i) =>
              `<tr><td style="padding:6px 8px 6px 0;color:#67726B;font-size:13px;white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(i.card.color)};margin-right:6px"></span>${esc(i.card.name)}</td>` +
              `<td style="padding:6px 8px;font-size:14px">${esc(i.benefit.name)}</td>` +
              `<td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;white-space:nowrap">${money(i.left)} left</td></tr>`,
          )
          .join(""),
    )
    .join("");

  const renewalRows = renewals.length
    ? `<tr><td colspan="3" style="padding:14px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#67726B">Card renewals</td></tr>` +
      renewals
        .map(
          (r) =>
            `<tr><td colspan="3" style="padding:6px 0;font-size:14px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(r.card.color)};margin-right:6px"></span><b>${esc(renewalLine(r))}</b>` +
            (r.unused.length
              ? `<div style="color:#67726B;font-size:13px;margin:3px 0 0 14px">Resets at renewal, still unused: ${r.unused.map((u) => esc(unusedLabel(u))).join("; ")}</div>`
              : "") +
            `</td></tr>`,
        )
        .join("")
    : "";

  const intro = opts.intro ?? (items.length || !renewals.length ? "These credits still have money left and reset soon:" : "Heads-up on upcoming card renewals:");
  const headline = items.length || !renewals.length ? money(total) : renewals.length === 1 ? `Renews ${fullDate(renewals[0].renewsOn)}` : `${renewals.length} renewals`;
  const html = `<!doctype html><html><body style="margin:0;background:#F2F4F3;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15211C">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0F6E4E;margin-bottom:14px">Clawback</div>
<div style="background:#fff;border:1px solid #E2E7E3;border-radius:16px;padding:20px">
<div style="font-size:28px;font-weight:700">${esc(headline)}</div>
<div style="color:#67726B;font-size:14px;margin:4px 0 6px">${esc(intro)}</div>
<table role="presentation" style="width:100%;border-collapse:collapse">${rows}${renewalRows}</table>
<a href="${esc(appUrl)}" style="display:block;text-align:center;background:#0F6E4E;color:#fff;text-decoration:none;font-weight:600;border-radius:12px;padding:13px;margin-top:18px">Open Clawback</a>
</div>
<p style="color:#67726B;font-size:12px;text-align:center;margin-top:14px">You get one heads-up per credit each period, and two (60 and 30 days out) before each card renews. Turn reminders off at the bottom of the app.</p>
</div></body></html>`;

  const text = [
    subject,
    intro,
    ...[...groups].flatMap(([day, list]) => [``, `Use by ${day}:`, ...list.map((i) => `- ${i.card.name}: ${i.benefit.name}, ${money(i.left)} left`)]),
    ...(renewals.length
      ? [``, `Card renewals:`, ...renewals.flatMap((r) => [`- ${renewalLine(r)}`, ...r.unused.map((u) => `  still unused: ${unusedLabel(u)}`)])]
      : []),
    ``,
    `Open Clawback: ${appUrl}`,
  ].join("\n");

  return { subject, html, text, total };
}
