-- Allow the Whop card-on-file Pro trial to ride the subscriptions table.
--
-- 2026-07-01 pivot: the Notes Pro trial moves from the free Telegram-gated
-- path (notes_free_trial) to a Whop card-trial — the user links a working card
-- (€0 now), gets 7 days of full Pro, and Whop auto-charges €19/month afterwards
-- unless they cancel. The trial rides the SAME Whop plan (plan_redactedec56d4df,
-- plan_type=renewal, trial_period_days=7, renewal_price=€19) so conversion +
-- renewals are native to Whop.
--
-- We give it its own tier id `notes_pro_trial` (NOT first_month_19) so revenue
-- reporting can distinguish a trial-sourced recurring sub from a one-time €19
-- purchase. Grant duration is 1 month per charge (see TIERS); the trial-start
-- grant carries a short self-limiting expiry so a never-charged trial lapses on
-- its own even if a cancellation webhook is missed.
--
-- Additive + safe: adds ONE allowed tier value to the existing CHECK; keeps the
-- old notes_free_trial value so historical rows stay valid.
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
    'notes_free_trial'::text,
    'notes_pro_trial'::text
  ]));
