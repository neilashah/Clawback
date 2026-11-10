-- Clawback: replace Plaid with SimpleFIN Bridge + CSV upload.
-- Safe to run once after 0001. Drops the (unused) Plaid tables.

-- ------------------------------------------------ remove Plaid tables
drop table if exists public.transactions;
drop table if exists public.plaid_accounts;
drop table if exists public.plaid_items;

-- -------------------------------------------- cards: generic account link
alter table public.cards rename column plaid_account_id to account_id;

-- ------------------------------------------- claims: 'plaid' -> 'auto'
alter table public.claims drop constraint if exists claims_source_check;
update public.claims set source = 'auto' where source = 'plaid';
alter table public.claims add constraint claims_source_check check (source in ('manual','auto'));

-- ---------------------------------------------------- bank_connections
-- One row per SimpleFIN Bridge access URL (it covers every bank you add there).
create table if not exists public.bank_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  kind           text not null default 'simplefin' check (kind in ('simplefin')),
  access_url_enc text not null,   -- AES-256-GCM; contains credentials, never readable by the browser
  label          text,
  status         text not null default 'ok',
  last_synced_at timestamptz,
  created_at     timestamptz not null default now()
);

-- -------------------------------------------------------- bank_accounts
-- account_id is "sf:<connection id>:<simplefin account id>" or "csv:<card id>".
create table if not exists public.bank_accounts (
  account_id    text primary key,
  user_id       uuid not null references auth.users on delete cascade,
  connection_id uuid references public.bank_connections on delete cascade,  -- null for CSV
  name          text,
  org           text,
  created_at    timestamptz not null default now()
);

-- --------------------------------------------------------- transactions
create table if not exists public.transactions (
  transaction_id       text primary key,
  user_id              uuid not null references auth.users on delete cascade,
  account_id           text not null references public.bank_accounts on delete cascade,
  date                 date not null,
  amount               numeric not null,  -- negative = money in (credits), positive = charges
  name                 text,
  merchant_name        text,
  original_description text,
  pending              boolean not null default false,
  benefit_id           uuid references public.benefits on delete set null,
  ignored              boolean not null default false
);
create index if not exists transactions_user_date on public.transactions (user_id, date desc);

-- ------------------------------------------------------------------ RLS
alter table public.bank_connections enable row level security;
alter table public.bank_accounts    enable row level security;
alter table public.transactions     enable row level security;

create policy "read own connections" on public.bank_connections for select to authenticated using (user_id = auth.uid());
create policy "read own accounts"    on public.bank_accounts    for select to authenticated using (user_id = auth.uid());
create policy "read own txns"        on public.transactions     for select to authenticated using (user_id = auth.uid());
create policy "update own txns"      on public.transactions     for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke select on public.bank_connections from authenticated, anon;
grant select (id, user_id, kind, label, status, last_synced_at, created_at) on public.bank_connections to authenticated;
revoke update on public.transactions from authenticated, anon;
grant update (benefit_id, ignored) on public.transactions to authenticated;
