# Clawback — SPEC (as of Oct 29, 2026, 10:46 AM ET)

> Living context document. Paste or point a new Claude Code / chat session at this file first.
> Append notable changes to `CHANGELOG.md` (append-only); keep this file current as the source of truth.

## Overview

**Clawback** is a personal web app for tracking premium credit-card benefits/statement credits — which have been used and which are still available — plus how much of each card's annual fee has been "recouped." Goal: stop leaving credits on the table across several premium travel cards.

It is a **single self-contained `index.html`**: vanilla JS + HTML + CSS, no framework, no build step, no runtime dependencies (Google Fonts load with a system fallback, so it works offline). Opens locally, hosts on any static host, installs to a phone home screen as a PWA.

## Current status

- App is named **Clawback** (browser title, in-app wordmark, PWA/home-screen name; green "$" icon).
- Core features complete: benefit grid, annual-fee recoup bars, optional Supabase sync.
- **Repo was accidentally deleted and is being recovered** (GitHub 90-day restore, or new repo + re-upload of `index.html` + re-enable Pages). Supabase data is unaffected.
- Supabase project + table already exist from a prior session; reconnecting is just re-entering URL/key/sync code (or pasting a device-link code).

## Tech stack & files

- `index.html` — the entire app (HTML + inline `<style>` + inline `<script>`). **Hard rule: keep it one file.**
- `SPEC.md` — this document.
- `CHANGELOG.md` — append-only history.
- Hosting: static only (GitHub Pages or Netlify). Sync runs through Supabase, so the host never needs a backend.

## Data model

```
data = {
  cards:    [ { id, name, color, annualFee } ],
  benefits: [ { id, cardId, name, value, freq, usage: {} } ],
  updatedAt: <ms timestamp>
}
```

- `freq` ∈ `monthly | quarterly | semiannual | annual`.
- `usage` is keyed by **period**: `2026-06` (monthly), `2026-Q2` (quarterly), `2026-H1` (semiannual), `2026` (annual). A benefit is "used" when the current period's key is `true`.
- **Reset is emergent**: a new period's key has no entry, so the item shows unclaimed again. No scheduler.
- **Fee recoup** = for each benefit, count `true` usage keys within the current calendar year × value, summed per card (a $25 monthly credit accrues $25 each month claimed).
- localStorage keys: `cc-benefits-data-v1` (data), `cc-sync-cfg-v1` (sync config).

## UI structure

- **Hero**: "$ still available to use" (sum of unclaimed current-period credits) + progress bar of claimed vs. total this cycle.
- **Annual fee recouped**: one bar per card, year-to-date claimed vs. fee; flips green "covered ✓" when exceeded.
- **Grid (main view)**: matrix with **cards as columns**, **reset frequency as rows**. Benefit = tile tinted by card color; tap toggles claimed. Reset countdown lives on each row label and turns amber within 7 days.
- **Filters**: Available / Claimed / All.
- **Edit mode** (pencil): tapping a tile opens its editor; a dashed **+** per cell adds a benefit to that card+frequency.
- **Cards sheet** (card icon): add/edit/delete cards (name, color, annual fee); reload presets.
- **Sync sheet** (cloud icon): status dot + Supabase sync setup.

## Cards & benefits (current ≈ mid-2026 — verify, they drift)

- **Chase Sapphire Reserve** — $795 fee
- **Amex Platinum** — $895 fee
- **Delta SkyMiles Reserve (Amex)** — $650 fee

22 benefits preloaded across the three at monthly/quarterly/semiannual/annual cadences. Deliberate special cases:
- **`✦` = anniversary-based reset** (Sapphire travel credit; Delta Companion Certificate). App resets "annual" on Jan 1, so these two are flagged to track by renewal date.
- **Companion Certificate value = $0** so its variable worth doesn't distort recoup math.
- **Excluded on purpose**: Amex Saks (ended Jun 30, 2026), Amex Global Entry (every 4 yrs, doesn't fit a yearly cycle), Sapphire Apple TV+/Music (comp subscription, not use-it-or-lose-it).

## Sync (optional, Supabase)

Layered on localStorage; app works fully offline without it.

- **Table:**
  ```sql
  create table if not exists benefits_state (
    id text primary key,
    data jsonb,
    updated_at timestamptz default now()
  );
  alter table benefits_state enable row level security;
  create policy "anon access" on benefits_state
    for all to anon using (true) with check (true);
  ```
- **Mechanism**: whole `data` blob stored as one row via raw PostgREST `fetch` (no SDK). Row `id` = user-chosen **sync code** (also the access secret). Pull on load and on tab-focus; debounced push (800 ms) on change. Conflict resolution = **last-write-wins** by `data.updatedAt` (fine for one person, multiple devices).
- **Config placement**: Supabase URL + anon key + sync code live only in each browser's localStorage, **never in the hosted file**. A **device-link bundle** (base64 of `{u,k,c}`, prefixed `CCB1:`) configures a second device in one paste.
- **Security tradeoff**: RLS policy is open; the three values together grant access, and the sync code is the real gate. A Supabase **Auth (email magic-link)** variant — per-account privacy via `auth.uid()` RLS — was discussed but not built.

## Build / run / validate / deploy

- **Run**: open `index.html` in any browser (works from `file://` or any static host).
- **Validate JS** (no build step): extract the inline script and syntax-check —
  ```bash
  node -e 'const fs=require("fs");fs.writeFileSync("/tmp/app.js",fs.readFileSync("index.html","utf8").match(/<script>([\s\S]*?)<\/script>/)[1])' && node --check /tmp/app.js
  ```
- **Deploy**: push to GitHub → **Settings → Pages → Deploy from a branch → `main` / root**. Or drag `index.html` to Netlify. Live URL (Pages): `https://<username>.github.io/<repo>/`.
- Sync config is tied to the browser origin (URL), so keeping the same username+repo name preserves a device's saved config; a new URL/device just reconnects (Supabase data intact).

## Conventions / working agreements

- **One file.** No framework, no bundler, no npm runtime deps. Libraries only if inlined.
- CSS lives in a single `<style>` block using CSS custom properties (`--paper`, `--vault`, etc.); icons are inline SVG strings.
- All dynamic text passes through `esc()` before insertion; the UI re-renders by rebuilding `innerHTML` with event delegation (`data-act` / `data-field`).
- To add a **benefit**: push `{id,cardId,name,value,freq,usage:{}}`; to add a **card**: `{id,name,color,annualFee}`. Preset data lives in `buildPreset()`.
- Prefer rendered/visual verification for UI changes (open in browser); prefer surgical edits over whole-file rewrites.
- Keep setup/docs simple and direct.

## Roadmap / open items

- Optional **Supabase Auth (magic-link)** sync for proper per-account security.
- Expiration **reminders/notifications** or a monthly review nudge (higher-leverage than auto-detection).
- Per-benefit **notes**; true **anniversary-date** resets (vs. calendar-year) for `✦` items.
- Keep benefit lists/fees current with issuer changes; add new cards as acquired.

## Caveats

- Benefit lists/fees reflect ~mid-2026 and will change; confirm with the issuer (several credits require activating the offer before posting).
- The recoup gauge credits the full value of anything marked claimed — it mirrors the user's taps, not verified statement credits, and counts by calendar year while real fees hit on the renewal date. Motivational, not accounting.
- **Auto-tracking of used credits was investigated and deprioritized**: true detection needs transaction data. CardPointers deliberately doesn't link accounts (its credit tracking is reminder+manual, like Clawback's); its **MCP API** (`mcp.cardpointers.com`) is the only programmatic hook but requires a backend/proxy + CardPointers+ and may not expose per-credit "used" state. Only account-linking apps (MaxRewards/Kudos) do real auto-detection. Not worth rebuilding in a single-file app.
