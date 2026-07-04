-- 2026-07-04: the free trial becomes NO-CARD and available to EMAIL users too
-- (was Telegram-only, which forced email users onto the leaky Whop card trial,
-- the Sam funnel leak). telegram_id was the NOT-NULL primary key, so an email
-- user (no telegram) could not hold a trial record. Move the PK to a surrogate
-- id; keep telegram_id as a partial-unique wall (one telegram = one trial) and
-- user_id UNIQUE stays the per-account wall. Existing rows backfill id automatically.
alter table public.trials drop constraint if exists trials_pkey;
alter table public.trials alter column telegram_id drop not null;
alter table public.trials add column if not exists id bigint generated always as identity;
alter table public.trials add primary key (id);
create unique index if not exists trials_telegram_uniq on public.trials (telegram_id) where telegram_id is not null;
