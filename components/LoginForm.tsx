"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  not_allowed: "That email isn’t on this Clawback’s guest list.",
  link: "That sign-in link expired or was already used. Request a new one.",
};

export default function LoginForm({ error }: { error?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState(error ? ERRORS[error] ?? "Something went wrong." : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMsg(error.message);
    } else {
      setState("sent");
      setMsg("");
    }
  }

  return (
    <div className="bt-wrap">
      <div className="bt-empty">
        <div className="bt-empty-mark">$</div>
        <h2>Sign in to Clawback</h2>
        {state === "sent" ? (
          <p>
            Check <strong>{email}</strong> for a sign-in link. You can close this tab.
          </p>
        ) : (
          <>
            <p>We&rsquo;ll email you a one-tap sign-in link. No password needed.</p>
            <form onSubmit={submit} style={{ maxWidth: 340, margin: "0 auto", textAlign: "left" }}>
              <input
                className="bt-input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="bt-primary" disabled={state === "sending"}>
                {state === "sending" ? "Sending…" : "Email me a link"}
              </button>
            </form>
          </>
        )}
        {msg && <div className="bt-error">{msg}</div>}
      </div>
    </div>
  );
}
