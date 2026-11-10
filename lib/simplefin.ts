/**
 * SimpleFIN Bridge client (https://www.simplefin.org/protocol.html).
 *
 * Flow: the user pastes a one-time *setup token* (base64 of a claim URL). We POST
 * to the claim URL once and get back a long-lived *access URL* with embedded
 * credentials, which we store encrypted. GET {access}/accounts returns accounts
 * with their transactions.
 *
 * Sign convention: SimpleFIN amounts are positive for money in. Clawback stores
 * the opposite (negative = money in), so amounts are negated on the way in.
 */

export interface SfTransaction {
  id: string;
  posted: number; // unix seconds; 0 while pending
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
}
export interface SfAccount {
  id: string;
  name: string;
  org?: { name?: string; domain?: string };
  transactions?: SfTransaction[];
}
export interface SfAccountSet {
  errors?: string[];
  accounts: SfAccount[];
}

const ALLOWED_HOST = /(^|\.)simplefin\.org$/i;

/** Decode a setup token into its claim URL, rejecting anything not on simplefin.org. */
export function claimUrlFromToken(token: string): URL {
  let decoded: string;
  try {
    decoded = Buffer.from(token.trim(), "base64").toString("utf8").trim();
  } catch {
    throw new Error("That doesn’t look like a SimpleFIN setup token.");
  }
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    throw new Error("That doesn’t look like a SimpleFIN setup token.");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOST.test(url.hostname)) {
    throw new Error("Setup token must point to simplefin.org.");
  }
  return url;
}

/** Exchange a setup token for an access URL. Each token works once. */
export async function claimAccessUrl(token: string): Promise<string> {
  const claim = claimUrlFromToken(token);
  const r = await fetch(claim, { method: "POST", headers: { "Content-Length": "0" }, cache: "no-store" });
  if (r.status === 403) throw new Error("That setup token was already used or expired. Create a new one in SimpleFIN.");
  if (!r.ok) throw new Error(`SimpleFIN claim failed (${r.status})`);
  const access = (await r.text()).trim();
  const u = new URL(access);
  if (u.protocol !== "https:" || !ALLOWED_HOST.test(u.hostname)) throw new Error("Unexpected access URL from SimpleFIN.");
  return access;
}

/** fetch() refuses URLs with credentials, so move them into a Basic auth header. */
export function splitAccessUrl(access: string): { base: string; auth: string } {
  const u = new URL(access);
  const auth = "Basic " + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  u.username = "";
  u.password = "";
  return { base: u.toString().replace(/\/+$/, ""), auth };
}

export async function fetchAccounts(access: string, start: Date, end: Date): Promise<SfAccountSet> {
  const { base, auth } = splitAccessUrl(access);
  const qs = new URLSearchParams({
    "start-date": String(Math.floor(start.getTime() / 1000)),
    "end-date": String(Math.floor(end.getTime() / 1000)),
  });
  const r = await fetch(`${base}/accounts?${qs}`, { headers: { Authorization: auth }, cache: "no-store" });
  if (r.status === 403) throw new Error("SimpleFIN access was revoked. Reconnect with a new setup token.");
  if (r.status === 402) throw new Error("SimpleFIN subscription needs payment.");
  if (!r.ok) throw new Error(`SimpleFIN request failed (${r.status})`);
  return (await r.json()) as SfAccountSet;
}

/** Split [start, end] into windows of at most `days` days (Bridge limits range per request). */
export function windows(start: Date, end: Date, days = 60): [Date, Date][] {
  const out: [Date, Date][] = [];
  let s = start.getTime();
  const step = days * 86400000;
  while (s < end.getTime()) {
    const e = Math.min(s + step, end.getTime());
    out.push([new Date(s), new Date(e)]);
    s = e;
  }
  return out;
}

export const sfAccountKey = (connectionId: string, accountId: string) => `sf:${connectionId}:${accountId}`;

/** Map a SimpleFIN transaction to a Clawback row (null for pending ones). */
export function toTxnRow(userId: string, accountKey: string, t: SfTransaction) {
  if (t.pending || !t.posted) return null;
  const amount = -Number(t.amount);
  if (!Number.isFinite(amount)) return null;
  return {
    transaction_id: `${accountKey}:${t.id}`,
    user_id: userId,
    account_id: accountKey,
    date: new Date(t.posted * 1000).toISOString().slice(0, 10),
    amount,
    name: t.description || t.payee || null,
    merchant_name: t.payee || null,
    original_description: t.memo ? `${t.description} ${t.memo}`.trim() : null,
    pending: false,
  };
}
