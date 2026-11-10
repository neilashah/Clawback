-- Clawback v2 schema. Run in the Supabase SQL editor (or `supabase db push`).
-- Every row belongs to a user; RLS restricts each user to their own rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- cards
create table if not exists public.cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  name             text not null,
  color            text not null default '#0F6E4E',
  annual_fee       numeric not null default 0,
  plaid_account_id text,            -- Plaid account this card maps to (nullable)
  sort             int not null default 0,
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------- benefits
create table if not exists public.benefits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  card_id     uuid not null references public.cards on delete cascade,
  name        text not null,
  value       numeric not null default 0,
  freq        text not null check (freq in ('monthly','quarterly','semiannual','annual')),
  -- "|"-separated, case-insensitive phrases matched against statement-credit descriptions.
  match_terms text not null default '',
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- claims
-- One row per benefit per period (e.g. 2026-06, 2026-Q2, 2026-H1, 2026).
create table if not exists public.claims (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  benefit_id uuid not null references public.benefits on delete cascade,
  period     text not null,
  source     text not null default 'manual' check (source in ('manual','plaid')),
  amount     numeric,              -- actual credited $ for plaid claims
  dismissed  boolean not null default false, -- user un-ticked an auto-detected claim
  created_at timestamptz not null default now(),
  unique (benefit_id, period)
);

-- ---------------------------------------------------------- plaid_items
create table if not exists public.plaid_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  item_id          text not null unique,
  access_token_enc text not null,  -- AES-256-GCM, never readable by the browser
  institution_name text,
  cursor           text,
  status           text not null default 'ok',
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------- plaid_accounts
create table if not exists public.plaid_accounts (
  account_id    text primary key,
  user_id       uuid not null references auth.users on delete cascade,
  item_id       text not null references public.plaid_items(item_id) on delete cascade,
  name          text,
  official_name text,
  mask          text,
  type          text,
  subtype       text
);

-- --------------------------------------------------------- transactions
create table if not exists public.transactions (
  transaction_id       text primary key,
  user_id              uuid not null references auth.users on delete cascade,
  account_id           text not null references public.plaid_accounts on delete cascade,
  date                 date not null,
  amount               numeric not null,  -- Plaid sign: negative = money in (credits)
  name                 text,
  merchant_name        text,
  original_description text,
  pending              boolean not null default false,
  benefit_id           uuid references public.benefits on delete set null,
  ignored              boolean not null default false
);
create index if not exists transactions_user_date on public.transactions (user_id, date desc);

-- ------------------------------------------------------------------ RLS
alter table public.cards          enable row level security;
alter table public.benefits       enable row level security;
alter table public.claims         enable row level security;
alter table public.plaid_items    enable row level security;
alter table public.plaid_accounts enable row level security;
alter table public.transactions   enable row level security;

create policy "own cards"    on public.cards    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own benefits" on public.benefits for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own claims"   on public.claims   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Plaid tables are written only by the server (service role). Users may read their own rows.
create policy "read own items"    on public.plaid_items    for select to authenticated using (user_id = auth.uid());
create policy "read own accounts" on public.plaid_accounts for select to authenticated using (user_id = auth.uid());
create policy "read own txns"     on public.transactions   for select to authenticated using (user_id = auth.uid());
-- Users can assign/ignore their own transactions from the review list.
create policy "update own txns"   on public.transactions   for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Hide the encrypted token column from the browser entirely.
revoke select on public.plaid_items from authenticated, anon;
grant select (id, user_id, item_id, institution_name, status, last_synced_at, created_at)
  on public.plaid_items to authenticated;
revoke update on public.transactions from authenticated, anon;
grant update (benefit_id, ignored) on public.transactions to authenticated;
