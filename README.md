# Clawback

Track premium credit-card statement credits, auto-detect the ones you've used from your card transactions (via Plaid), and see how much of each annual fee you've earned back.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (magic-link auth + Postgres with row-level security) · Plaid Transactions · hosted on Vercel.

## Setup

### 1. Supabase
1. Use your existing Supabase project (or create one).
2. **SQL editor:** run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. **Authentication → URL Configuration:** set *Site URL* to your deployed URL and add `http://localhost:3000/**` and `https://<your-app>.vercel.app/**` to *Redirect URLs*.
4. **Authentication → Sign In / Providers:** keep Email enabled. Once you and your family have each signed in once, turn off **Allow new users to sign up**. `ALLOWED_EMAILS` also blocks anyone not on the list.
5. Copy the project URL, anon key, and service-role key from **Project Settings → API**.

### 2. Plaid
1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com) and copy your **Sandbox** client ID and secret.
2. Sandbox only has fake banks. To connect your real Chase and Amex accounts, request **Production** access in the dashboard (Chase also requires OAuth registration; set `PLAID_REDIRECT_URI` to `https://<your-app>/oauth` and add it under *Allowed redirect URIs*).

### 3. Environment
```bash
cp .env.example .env.local   # fill in every value
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → PLAID_TOKEN_KEY
```

### 4. Run
```bash
npm install
npm run dev        # http://localhost:3000
npm test           # detection unit tests
npm run typecheck
```

### 5. Deploy (Vercel)
Import the repo in Vercel, add the same environment variables, deploy. Set `PLAID_WEBHOOK_URL` to `https://<your-app>.vercel.app/api/plaid/webhook` so new transactions arrive without pressing *Sync now*.

## Using it
1. Sign in with the emailed link → **Load my 3 cards** (or **Import from the old Clawback** with your old device-link code).
2. Bank icon → **Connect a card account** → sign in to Amex / Chase through Plaid.
   *Sandbox:* pick any bank, user `user_transactions_dynamic`, any password.
3. **Cards** → edit each card → choose its **Linked account**.
4. Statement credits whose description contains a benefit's **auto-detect phrases** tick that benefit off (tiles show **AUTO**). Unmatched credits appear under **Credits to review**, where you assign them once and Clawback remembers the description.
5. Tapping an auto-claimed tile un-ticks it and keeps it un-ticked across future syncs.

## How detection works
- Only **posted credits** (negative Plaid amounts, excluding payments) on an account linked to a card are considered.
- A credit matches the benefit on that card with the longest matching phrase (`|`-separated, case-insensitive).
- Each benefit gets one claim per period (`2026-11`, `2026-Q4`, `2026-H2`, `2026`); partial credits in the same period are summed.
- Auto claims count their actual credited amount (capped at the benefit value) toward the annual-fee bar; manual claims count full value.
- Credits applied inside partner apps (Uber Cash, DoorDash, Lyft) never appear on the statement, so those stay manual.

## Security notes
- Plaid access tokens are AES-256-GCM encrypted (`PLAID_TOKEN_KEY`) and the column is not readable by the browser.
- All tables use RLS scoped to `auth.uid()`; Plaid tables are written only by server routes using the service role.
- The webhook verifies Plaid's signed JWT and body hash.
