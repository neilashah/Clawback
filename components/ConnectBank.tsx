"use client";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { Icon } from "./icons";

const TOKEN_KEY = "clawback-plaid-link-token";

async function exchange(publicToken: string | null, meta: PlaidLinkOnSuccessMetadata) {
  if (!publicToken) throw new Error("Plaid didn\u2019t return a token. Try again.");
  const r = await fetch("/api/plaid/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_token: publicToken, institution_name: meta.institution?.name }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn’t link that account");
}

/** "Connect a card" button: fetches a Link token on demand, then opens Plaid Link. */
export default function ConnectBank({ onLinked, onError }: { onLinked: () => void; onError: (m: string) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (publicToken: string | null, meta: PlaidLinkOnSuccessMetadata) => {
      setBusy(true);
      try {
        await exchange(publicToken, meta);
        onLinked();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setBusy(false);
        setToken(null);
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {}
      }
    },
    [onLinked, onError],
  );

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit: () => setToken(null) });
  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  async function start() {
    setBusy(true);
    try {
      const r = await fetch("/api/plaid/link-token", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn’t start Plaid");
      try {
        localStorage.setItem(TOKEN_KEY, j.link_token); // needed if an OAuth bank (e.g. Chase) redirects back
      } catch {}
      setToken(j.link_token);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="bt-primary" onClick={start} disabled={busy}>
      <Icon name="bank" size={16} /> {busy ? "Working…" : "Connect a card account"}
    </button>
  );
}

/** Rendered on /oauth: resumes Link after an OAuth bank redirects back. */
export function OAuthResume() {
  const [token] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [msg, setMsg] = useState("Finishing up…");
  const done = () => window.location.replace("/");
  const { open, ready } = usePlaidLink({
    token,
    receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined,
    onSuccess: async (pt, meta) => {
      try {
        await exchange(pt, meta);
      } catch (e) {
        setMsg((e as Error).message);
        return;
      }
      done();
    },
    onExit: done,
  });
  useEffect(() => {
    if (!token) setMsg("Link session expired. Start again from the bank screen.");
    else if (ready) open();
  }, [token, ready, open]);
  return (
    <div className="bt-wrap">
      <div className="bt-empty">
        <div className="bt-empty-mark">$</div>
        <p>{msg}</p>
      </div>
    </div>
  );
}
