import { createHash } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { NextResponse } from "next/server";
import { plaid } from "@/lib/plaid";
import { syncItem } from "@/lib/plaidSync";
import { createAdminClient } from "@/lib/supabase/admin";

const keyCache = new Map<string, JWK>();

/** Verify the Plaid-Verification JWT and the body hash it signs. */
async function verify(raw: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== "ES256" || !kid) return false;
    let jwk = keyCache.get(kid);
    if (!jwk) {
      const res = await plaid().webhook.getVerificationKey({ key_id: kid });
      if (res.key.expired_at) return false;
      jwk = res.key as unknown as JWK;
      keyCache.set(kid, jwk);
    }
    const { payload } = await jwtVerify(token, await importJWK(jwk, "ES256"), { maxTokenAge: "5 min" });
    const expected = createHash("sha256").update(raw).digest("hex");
    return payload.request_body_sha256 === expected;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("plaid-verification")))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const body = JSON.parse(raw) as { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string } };
  if (!body.item_id) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data: item } = await admin
    .from("plaid_items")
    .select("item_id, user_id, access_token_enc, cursor")
    .eq("item_id", body.item_id)
    .maybeSingle();
  if (!item) return NextResponse.json({ ok: true });

  if (body.webhook_type === "TRANSACTIONS" && body.webhook_code === "SYNC_UPDATES_AVAILABLE") {
    await syncItem(admin, item);
  } else if (body.webhook_type === "ITEM" && (body.webhook_code === "ERROR" || body.webhook_code === "PENDING_EXPIRATION" || body.webhook_code === "PENDING_DISCONNECT")) {
    await admin.from("plaid_items").update({ status: body.error?.error_code ?? body.webhook_code }).eq("item_id", item.item_id);
  }
  return NextResponse.json({ ok: true });
}
