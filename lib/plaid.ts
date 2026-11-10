import "server-only";
import { PlaidClient, PlaidEnvironment } from "plaid";

export const PLAID_ENV = process.env.PLAID_ENV === "production" ? "production" : "sandbox";

let client: PlaidClient | null = null;

export function plaid(): PlaidClient {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET are not set");
  }
  client ??= new PlaidClient({
    environment: PLAID_ENV === "production" ? PlaidEnvironment.Production : PlaidEnvironment.Sandbox,
    clientId: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    maxRetries: 2,
  });
  return client;
}

/** Pull a readable Plaid error code out of an SDK error, without leaking headers. */
export function plaidErrorCode(e: unknown): string {
  const body = (e as { body?: { error_code?: string; error_message?: string } })?.body;
  return body?.error_code ?? (e instanceof Error ? e.message : "PLAID_ERROR");
}
