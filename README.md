# Clawback

Track premium credit-card statement credits, auto-detect the ones you've used from your card transactions, and see how much of each annual fee you've earned back.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (magic-link auth + Postgres with row-level security) · SimpleFIN Bridge (bank transactions) and/or CSV upload · hosted on Vercel.

## Setup

### 1. Supabase
1. **SQL editor:** run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), then [`0002_simplefin_csv.sql`](supabase/migrations/0002_simplefin_csv.sql).
2. **Authentication → URL Configuration:** set *Site URL* to your deployed URL and add `https://<your-app>.vercel.app/**` to *Redirect URLs*.
3. Once everyone has signed in, turn off **Allow new users to sign up**. `ALLOWED_EMAILS` also blocks anyone not on the list.

### 2. Vercel
Import the repo and set the variables from [`.env.example`](.env.example). `vercel.json` schedules a daily sync at `/api/cron/sync`, authorized with `CRON_SECRET`.

### 3. Bank data
- **SimpleFIN Bridge** (automatic, ~$15/yr): sign up at simplefin.org, add your banks there, create a **setup token**, and paste it into Clawback's bank screen. It's claimed once and stored encrypted.
- **CSV** (manual, free): download transactions from Chase or Amex as CSV and upload them on the bank screen for that card.

Then open **Cards** and link each card to its account (CSV uploads link automatically).

## Local development
```bash
npm install
cp .env.example .env.local   # fill in
npm run dev
npm test && npm run typecheck && npm run build
```

## How detection works
- Only **posted credits** (money in, excluding payments) on an account linked to a card are considered.
- A credit matches the benefit on that card with the longest matching phrase (`|`-separated, case-insensitive).
- Each benefit gets one claim per period (`2026-11`, `2026-Q4`, `2026-H2`, `2026`); partial credits in a period are summed.
- Auto claims count their credited amount (capped at the benefit value) toward the annual-fee bar; manual claims count full value.
- Unmatched credits show under **Credits to review**. Assigning one can remember its description for next time.
- Credits applied inside partner apps (Uber Cash, DoorDash, Lyft) never appear on statements, so those stay manual.

## Sync details
- First SimpleFIN sync requests transactions from Jan 1 in 60-day windows; later syncs overlap 14 days. Bridge allows roughly 24 requests a day, so app-open syncs are throttled to every 12h and **Sync now** to every 10 minutes.
- CSV rows get stable IDs (re-uploading is safe), and rows already present from SimpleFIN (same amount within ±3 days) are skipped.

## Security
See [`SECURITY.md`](SECURITY.md).
