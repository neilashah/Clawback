# Changelog

Append-only. Newest at the bottom.

## 2026 (pre-Nov) — v1
- Single-file `index.html`: benefit grid, annual-fee recoup bars, optional Supabase blob sync, PWA install. Now in `legacy/index.html`.

## Nov 10, 2026, 8:47 AM ET — v2 rewrite
- Rewrote as a Next.js 16 + TypeScript app hosted on Vercel.
- Added Supabase magic-link login with per-user RLS tables (`cards`, `benefits`, `claims`) and an `ALLOWED_EMAILS` allowlist.
- Added Plaid Transactions integration: Link, encrypted access tokens, `/transactions/sync` with cursor, verified webhooks, disconnect.
- Added auto-detection of used credits from statement-credit descriptions (per-benefit phrases), a review list for unmatched credits, and dismissible auto claims.
- Added import from v1 via device-link code, plus a sandbox tool to post fake statement credits.
- Unit tests for detection (`npm test`).

## Nov 10, 2026, 2:54 PM ET — Security policy
- Added `SECURITY.md`: written information security policy (access control, encryption, secrets, monitoring, incident response, retention).

## Nov 10, 2026, 3:51 PM ET — Replace Plaid with SimpleFIN + CSV
- Removed Plaid (routes, SDK, OAuth page). Production approval required a business-grade security review.
- Added SimpleFIN Bridge: paste a setup token, access URL stored encrypted, sync on app open (12h throttle), "Sync now", and a daily Vercel Cron job.
- Added CSV upload for Chase and Amex exports, with stable IDs and dedupe against SimpleFIN rows.
- Migration `0002_simplefin_csv.sql`: drops Plaid tables; adds `bank_connections`, `bank_accounts`, `transactions`; renames `cards.plaid_account_id` → `account_id`; claim source `plaid` → `auto`.
- Updated README, SECURITY.md, `.env.example` (`ENCRYPTION_KEY`, `CRON_SECRET`). Tests: 22 passing.

## Nov 10, 2026, 9:14 PM ET — Dark mode
- Added a dark theme. Follows the system setting by default; a header button cycles system → light → dark, and the choice is saved per device.
- A small script in `<head>` applies a saved choice before first paint, so there is no light flash on load.
- Replaced hard-coded whites and reds in `globals.css` with theme tokens; card colors used as text blend toward the ink color in dark mode so dark card colors (e.g. slate) stay readable.
- Browser chrome color follows the system scheme (brand green in light, near-black in dark).
