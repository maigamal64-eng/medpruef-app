-- Allow the notes Telegram-gated free trial to ride the subscriptions table.
--
-- P5 of the Notes feature. The free 1-week Pro trial (/api/trial/activate) sets
-- users.tier='pro' + tier_expires_at AND inserts a subscriptions row so the
-- EXISTING trial-reminder cron's expiry sweep flips users.tier back to 'free'
-- at expiry — the same proven reversion path every subscription uses (instead
-- of a bespoke expiry mechanism that the tier-trusting `isPaidAccess` would miss).
--
-- Additive + safe: adds ONE allowed tier value to the existing CHECK. The trial
-- row carries amount_cents=0 (no revenue-report impact), and the cron's REMINDER
-- sweep is restricted to the paid intro tiers (first_month_19 / first_3mo_27), so
-- a free trial is never sent a paid-renewal reminder. The cron's EXPIRY sweep is
-- tier-agnostic, so it still reverts the trial.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier = ANY (ARRAY[
    'premium_pass_guaranteed'::text,
    'monthly'::text,
    'three_month'::text,
    'six_month'::text,
    'twelve_month'::text,
    'first_month_19'::text,
    'first_3mo_27'::text,
    'notes_free_trial'::text
  ]));
