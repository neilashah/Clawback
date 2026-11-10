import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { plaid, plaidErrorCode } from "@/lib/plaid";

export async function POST() {
  const { user, error } = await requireUser();
  if (error) return error;
  try {
    const res = await plaid().link.createToken({
      client_name: "Clawback",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: user.id },
      products: ["transactions"],
      transactions: { days_requested: 730 },
      ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
      ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
    });
    return NextResponse.json({ link_token: res.link_token });
  } catch (e) {
    return NextResponse.json({ error: plaidErrorCode(e) }, { status: 502 });
  }
}
