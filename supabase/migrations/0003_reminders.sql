-- Clawback: email reminders for credits about to reset.

-- Per-user preferences. No row = reminders on.
create table if not exists public.user_settings (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  reminders  boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One reminder per benefit per period. Written only by the server (service role).
create table if not exists public.reminders_sent (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  benefit_id uuid not null references public.benefits on delete cascade,
  period     text not null,
  sent_at    timestamptz not null default now(),
  unique (benefit_id, period)
);
alter table public.reminders_sent enable row level security;
create policy "read own reminders" on public.reminders_sent for select to authenticated using (user_id = auth.uid());
