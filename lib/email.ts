import "server-only";

/** Send an email through Resend's REST API (no SDK). */
export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set in Vercel. Add it, redeploy, and try again.");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.REMINDER_FROM || "Clawback <onboarding@resend.dev>", ...msg }),
    cache: "no-store",
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Email failed (${r.status})${j.message ? `: ${j.message}` : ""}`);
  }
  return (await r.json()) as { id: string };
}
