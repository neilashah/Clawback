-- Clawback: card anniversary (renewal) dates.

-- Next renewal date as printed on the issuer's notice. The app rolls it forward by
-- whole years, so it never needs re-entering. Drives ✦ resets, the card-year fee
-- recoup, and the 60/30-day renewal reminders.
alter table public.cards add column if not exists renews_on date;

-- One renewal reminder per card per renewal per milestone (60 or 30 days out).
-- Written only by the server (service role).
create table if not exists public.renewal_reminders_sent (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  card_id     uuid not null references public.cards on delete cascade,
  renews_on   date not null,
  days_before int not null,
  sent_at     timestamptz not null default now(),
  unique (card_id, renews_on, days_before)
);
alter table public.renewal_reminders_sent enable row level security;
create policy "read own renewal reminders" on public.renewal_reminders_sent for select to authenticated using (user_id = auth.uid());
