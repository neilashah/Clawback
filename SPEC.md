# Clawback — SPEC (as of Nov 10, 2026, 8:47 AM ET)

> Living context document. Paste or point a new Claude Code / chat session at this file first.
> Append notable changes to `CHANGELOG.md` (append-only); keep this file current as the source of truth.

## Overview

**Clawback** is a personal web app for tracking premium credit-card benefits/statement credits — which have been used and which are still available — plus how much of each card's annual fee has been "recouped." Goal: stop leaving credits on the table across several premium travel cards.

**v2 (current)** is a Next.js app with login and **Plaid** integration that auto-detects used credits from card transactions. v1 (single-file `index.html`, localStorage + optional Supabase blob sync) is kept in `legacy/` for reference.

## Current status

- v2 code complete on branch `claude/peaceful-carson-fbum4j`; typecheck, unit tests, and production build pass; UI verified against a mocked Supabase.
- **Not yet deployed.** Needs: Supabase migration run, env vars, Vercel project, Plaid account (Sandbox first; Production access requires applying to Plaid; Chase additionally needs OAuth registration).
- Audience: just the owner + family (`ALLOWED_EMAILS` allowlist; disable Supabase sign-ups after first logins).
- Old data migrates via **Import from the old Clawback** (paste v1 device-link `CCB1:` code).

## Tech stack & files

- **Next.js 16** (App Router, TypeScript, React 19). Note: Next 16 uses `proxy.ts` (renamed from `middleware.ts`).
- **Supabase**: magic-link Auth + Postgres with RLS. `@supabase/ssr` for cookie sessions.
- **Plaid** `plaid` SDK v51 (new `PlaidClient` API: `plaid.link.createToken`, `plaid.transactions.sync`, …) + `react-plaid-link`.
- **Hosting**: Vercel (server routes required for Plaid secrets/webhooks).

```
app/
  page.tsx                 server: auth gate → <Dashboard>
  login/, auth/callback/, auth/signout/   magic-link flow
  oauth/                   Plaid OAuth return (Chase)
  api/plaid/link-token     create Link token
  api/plaid/exchange       public_token → encrypted access_token, accounts, first sync
  api/plaid/sync           manual "Sync now" (all items)
  api/plaid/webhook        verified Plaid webhook → syncItem on SYNC_UPDATES_AVAILABLE
  api/plaid/items/[itemId] DELETE: disconnect bank
  api/plaid/sandbox-credit sandbox-only: inject a fake statement credit
  api/detect               re-run matching + claim reconciliation
components/Dashboard.tsx   main UI (port of v1 grid/hero/fee bars + bank sheet + review list)
components/ConnectBank.tsx Plaid Link button + OAuth resume
lib/detect.ts              pure matching/reconcile logic (unit-tested in tests/)
lib/plaidSync.ts           transactions/sync loop, upserts, runDetection
lib/periods.ts, preset.ts, crypto.ts, plaid.ts, auth.ts, allowlist.ts, supabase/*
supabase/migrations/0001_init.sql
legacy/index.html          v1 app
```

## Data model (Postgres, all RLS `user_id = auth.uid()`)

- `cards(id, name, color, annual_fee, plaid_account_id, sort)`
- `benefits(id, card_id, name, value, freq, match_terms, sort)` — `freq ∈ monthly|quarterly|semiannual|annual`; `match_terms` = `|`-separated, case-insensitive phrases.
- `claims(id, benefit_id, period, source manual|plaid, amount, dismissed)` — unique `(benefit_id, period)`. Period keys: `2026-06`, `2026-Q2`, `2026-H1`, `2026`. Benefit is "used" when the current period's claim exists and is not dismissed. **Reset is emergent** (no scheduler).
- `plaid_items(item_id, access_token_enc, institution_name, cursor, status, last_synced_at)` — token AES-256-GCM encrypted with `PLAID_TOKEN_KEY`; token column not granted to `authenticated`.
- `plaid_accounts(account_id, item_id, name, mask, type, subtype)` — read-only to users.
- `transactions(transaction_id, account_id, date, amount, name, merchant_name, original_description, pending, benefit_id, ignored)` — users may update only `benefit_id`, `ignored`.

## Auto-detection rules (`lib/detect.ts`)

1. Candidate = posted, `amount < 0` (Plaid: negative = money in), not a payment ("payment/autopay/thank you"), on an account linked to a card.
2. Match = benefit on that card whose phrase appears in name/merchant/original description; longest phrase wins.
3. Claims reconciled per (benefit, period): sum of matched credits. **Manual and dismissed claims are never overwritten**; orphaned plaid claims are deleted.
4. Tapping an auto tile sets `dismissed=true` (so re-sync doesn't resurrect it); tapping again restores.
5. Unmatched credits on linked accounts show in **Credits to review**: assign (optionally remembering the description as a phrase) or ignore.
6. **Fee recoup**: manual claim = benefit value; plaid claim = credited amount capped at value; calendar year.

Preset phrases in `lib/preset.ts` are **unverified guesses** — tune them from real descriptors via the review list. In-app credits (Uber Cash, DoorDash, Lyft) and the Companion Certificate have no phrases (manual only).

## UI structure

Same visual language as v1 (CSS ported to `app/globals.css`: `--paper`, `--vault`, `bt-*` classes).
- Header: bank icon (connections), Edit, Cards.
- Banner: connect prompt → review-credits count → unlinked-cards prompt.
- Hero ($ still available), Annual fee recouped bars, filters, cards × frequency grid. Auto-claimed tiles show **AUTO**.
- Sheets: benefit editor (adds auto-detect phrases), cards list, card editor (adds Linked account), bank connections (connect/sync/disconnect, review list, sandbox fake-credit tool), import-from-v1.

## Build / run / validate / deploy

```bash
npm install
cp .env.example .env.local   # fill in
npm run dev
npm test && npm run typecheck && npm run build
```
Deploy: Vercel with the same env vars; set `PLAID_WEBHOOK_URL=https://<app>/api/plaid/webhook`, Supabase redirect URLs, and (production) `PLAID_REDIRECT_URI=https://<app>/oauth`. Full steps in `README.md`.

## Conventions / working agreements

- Detection logic stays pure in `lib/detect.ts` with tests in `tests/`; I/O lives in `lib/plaidSync.ts`.
- Never log Plaid SDK errors whole (headers contain the secret) — use `plaidErrorCode()`.
- Server routes call `requireUser()`; admin (service-role) queries always filter by `user_id`.
- Prefer visual verification for UI changes; prefer surgical edits.

## Roadmap / open items

- Deploy + run against Plaid Sandbox end to end; then apply for Production.
- Verify/tune real statement-credit descriptors for each benefit.
- True **anniversary-date** resets for `✦` items; per-benefit notes.
- Expiration reminders (email digest via Supabase cron or Vercel cron).
- Optional: detect *qualifying purchases* (e.g. a Resy charge before the credit posts) as "pending" hints.

## Caveats

- Benefit lists/fees reflect ~mid-2026; confirm with issuers.
- Plaid Production access, pricing, and Chase OAuth approval are outside the app's control.
- Statement-credit descriptors vary; merchant refunds on a linked card can false-match a phrase (dismiss or ignore them).
- Fee recoup counts by calendar year while real fees hit on the renewal date.
