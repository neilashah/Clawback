# Clawback — SPEC (as of Nov 14, 2026, 12:22 AM ET)

> Living context document. Paste or point a new Claude Code / chat session at this file first.
> Append notable changes to `CHANGELOG.md` (append-only); keep this file current as the source of truth.

## Overview

**Clawback** is a personal web app for tracking premium credit-card benefits/statement credits — which have been used and which are still available — plus how much of each card's annual fee has been "recouped." Goal: stop leaving credits on the table across several premium travel cards.

**v2 (current)** is a Next.js app with login. It auto-detects used credits from card transactions pulled from **SimpleFIN Bridge** (automatic) or **CSV uploads** (manual). v1 (single-file `index.html`) is kept in `legacy/` for reference.

## Current status

- Deployed at **https://clawbackbenefits.vercel.app** (Vercel, from `main`). Supabase migration `0001` run; magic-link login working; preset cards loaded.
- **Plaid was dropped** (Nov 10, 2026): Production approval required a business-grade security questionnaire. Replaced by SimpleFIN Bridge (consumer sign-up, ~$15/yr, Chase + Amex confirmed supported) plus CSV upload. The Plaid application was abandoned.
- Pending: run migration `0002_simplefin_csv.sql`, add `CRON_SECRET` (and optionally `ENCRYPTION_KEY`) in Vercel, remove `PLAID_*` vars, sign up for SimpleFIN and paste a setup token, link cards.
- Audience: owner + family (`ALLOWED_EMAILS`). Supabase's built-in email only reaches the Supabase account owner's address; family members need custom SMTP or invites.
- Dark mode with a system/light/dark toggle (`lib/theme.ts`, `components/ThemeToggle.tsx`).
- `SECURITY.md` was removed from the repo after Plaid was dropped.

## Tech stack & files

- **Next.js 16** (App Router, TypeScript, React 19). Next 16 uses `proxy.ts` (renamed from `middleware.ts`).
- **Supabase**: magic-link Auth + Postgres with RLS; `@supabase/ssr` cookie sessions.
- **SimpleFIN Bridge** via plain `fetch` (no SDK). **Vercel Cron** daily sync (`vercel.json`).

```
app/
  page.tsx                   server: auth gate → <Dashboard>
  login/, auth/callback/, auth/signout/
  api/simplefin/connect      claim setup token → encrypted access URL → first sync
  api/sync                   {auto:true} on app open (12h throttle) or manual (10 min throttle)
  api/cron/sync              daily, Bearer CRON_SECRET
  api/import-csv             {card_id, csv} → transactions → detection
  api/connections/[id]       DELETE a SimpleFIN connection
  api/detect                 re-run matching + claim reconciliation
components/Dashboard.tsx     main UI (grid/hero/fee bars, bank-data sheet, review list)
lib/detect.ts                pure matching/reconcile (tests/detect.test.ts)
lib/simplefin.ts             token claim, access-URL auth, fetch, mapping (tests/simplefin.test.ts)
lib/csv.ts                   Chase/Amex CSV parsing, stable IDs, dedupe (tests/csv.test.ts)
lib/bankSync.ts              syncConnection / syncUser / runDetection (I/O)
lib/periods.ts, preset.ts, crypto.ts, auth.ts, allowlist.ts, supabase/*
supabase/migrations/0001_init.sql, 0002_simplefin_csv.sql
README.md, legacy/index.html
```

## Data model (Postgres, all RLS `user_id = auth.uid()`)

- `cards(id, name, color, annual_fee, account_id, sort)`
- `benefits(id, card_id, name, value, freq, match_terms, sort)` — `freq ∈ monthly|quarterly|semiannual|annual`; `match_terms` = `|`-separated, case-insensitive phrases.
- `claims(id, benefit_id, period, source manual|auto, amount, dismissed)` — unique `(benefit_id, period)`. Period keys: `2026-06`, `2026-Q2`, `2026-H1`, `2026`. **Reset is emergent.**
  - **`amount` semantics** (`lib/usage.ts`): `null` = fully used; a number = dollars used so far (partial use or auto-detected credit), capped at value. A benefit is *fully used* when used ≥ value (value-0 benefits: claim exists). Partly used credits stay under **Available** showing what's left; hero/column totals use remaining dollars; fee recoup counts used dollars.
- `bank_connections(id, kind 'simplefin', access_url_enc, label, status, last_synced_at)` — access URL AES-256-GCM encrypted (`ENCRYPTION_KEY`, falls back to `PLAID_TOKEN_KEY`); column not granted to `authenticated`.
- `bank_accounts(account_id, connection_id, name, org)` — ids `sf:<connection>:<simplefin id>` or `csv:<card id>`.
- `transactions(transaction_id, account_id, date, amount, name, merchant_name, original_description, pending, benefit_id, ignored)` — **amount sign: negative = money in (credits)**. SimpleFIN amounts are negated on import; Chase CSV negated; Amex CSV kept. Users may update only `benefit_id`, `ignored`.

## Auto-detection rules (`lib/detect.ts`)

1. Candidate = posted, `amount < 0`, not a payment ("payment/autopay/thank you"), on an account linked to a card.
2. Match = benefit on that card whose phrase appears in the description; longest phrase wins.
3. Claims reconciled per (benefit, period) as the sum of matched credits. **Manual and dismissed claims are never overwritten**; orphaned auto claims are deleted.
4. Tapping an AUTO tile sets `dismissed=true`; tapping again restores.
4a. **Partial use:** press-and-hold a tile (or right-click) opens a "record a use" sheet: add an amount (uses add up within the period), mark fully used, or clear. Tapping a partly used tile opens the same sheet. Recording a use converts an auto claim to manual so the user's number wins over later syncs.
5. Unmatched credits → **Credits to review** (assign + optionally remember the description, or ignore).
6. Fee recoup: manual claim = benefit value; auto claim = credited amount capped at value; calendar year.

Presets (`lib/preset.ts`): the `starter` set (Sapphire Reserve, Amex Platinum, Delta Reserve) loads via "Load my 3 cards"; other presets (currently **Marriott Brilliant**: $650 fee, $25/mo dining credit, Free Night Award ✦; property credit and Global Entry excluded) are added from **Cards → Add a known card**. Preset phrases are **unverified guesses** — tune from real descriptors via the review list. Uber Cash, DoorDash, Lyft, and Companion Certificate are manual only.

**Benefit updates** (`lib/presetSync.ts`): Cards → *Check for benefit updates* diffs the user's cards (matched to presets by name) against the catalog and lists suggested changes with checkboxes: annual fee, value/frequency, renames (via preset `aliases`), merged auto-detect phrases (user phrases kept), new credits, and removal of credits past their `until` date. Custom cards/credits are never touched. Presets marked `variable` (Companion Certificate ✦, Free Night Award ✦) never get value suggestions: their $0 is a placeholder and the user's own value wins. When an issuer changes a benefit: edit `lib/preset.ts` (add an alias on renames, `until` on endings), and the user applies it in-app. Presets last verified **Nov 14, 2026** (CSR DoorDash $35/mo; Plat CLEAR $219, Hotel → Lodging credit incl. Airbnb Luxe; Delta Stays $200 added; CSR Select hotel credit ends 2026-12-31).

## Sync behavior

- SimpleFIN first sync: from Jan 1 of the current year in 60-day windows; later syncs overlap 14 days. Pending transactions are skipped. Bridge allows ~24 requests/day and updates about daily.
- CSV: Chase (`Transaction Date,Post Date,Description,Category,Type,Amount,Memo`; Payment rows dropped) and Amex (`Date,Description,Amount,...`). Stable SHA-1 IDs; rows matching a SimpleFIN transaction on the same account (same amount, ±3 days) are skipped. Uploading for an unlinked card creates and links a `csv:<card>` account.

## Email reminders

- Daily, inside `/api/cron/sync` (after the bank sync): `runReminders` (`lib/remindersJob.ts`) emails each user whose credits entered their window, via Resend (`lib/email.ts`, plain fetch; `RESEND_API_KEY`, optional `REMINDER_FROM`).
- Rules (`lib/reminders.ts`, tested): remaining > 0, value > 0, no ✦ in the name, days until reset ≤ 5 (monthly) or ≤ 14 (others), and not already in `reminders_sent` for that benefit+period. One email per user per day; rows are recorded only after a successful send.
- Tables (`0003_reminders.sql`): `user_settings(user_id, reminders default true)`, `reminders_sent(benefit_id, period unique)`.
- UI: footer switch (Email reminders on/off) and **Send a test reminder email** (`/api/reminders/test`, not recorded).
- Resend without a verified domain only delivers to the Resend account's own email.

## UI structure

Same visual language as v1 (`app/globals.css`, `bt-*` classes). Header: bank icon (Bank data sheet), Edit, Cards. Banner: connect prompt → review count → unlinked cards. Hero, fee bars, filters, cards × frequency grid (AUTO badge). Sheets: benefit editor (phrases), cards, card editor (linked account), bank data (SimpleFIN connect/sync/remove, CSV upload, review list), import-from-v1.

## Build / run / validate / deploy

```bash
npm install && cp .env.example .env.local
npm run dev
npm test && npm run typecheck && npm run build
```
Deploy: merge to `main` → Vercel auto-deploys. Env vars per `.env.example`.

## Conventions / working agreements

- Pure logic in `lib/detect.ts`, `lib/csv.ts`, `lib/simplefin.ts` with tests; I/O in `lib/bankSync.ts` and routes.
- Never log the SimpleFIN access URL.
- Server routes call `requireUser()`; service-role queries always filter by `user_id`.
- Prefer visual verification for UI changes; prefer surgical edits.
- The owner prefers step-by-step, ELI5 instructions, one step at a time.

## Roadmap / open items

- Finish SimpleFIN setup; tune phrases from real credit descriptions.
- True **anniversary-date** resets for `✦` items; per-benefit notes.
- Expiration reminders (email digest via the daily cron).
- Optional authenticator-app MFA (Supabase TOTP).

## Caveats

- Benefit lists/fees reflect ~mid-2026; confirm with issuers.
- SimpleFIN history depth depends on the bank via MX; use CSV to backfill older credits.
- Merchant refunds on a linked card can false-match a phrase (dismiss or ignore).
- Fee recoup counts by calendar year while real fees hit on the renewal date.
