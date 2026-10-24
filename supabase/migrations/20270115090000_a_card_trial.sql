-- a-card-trial-build-1024 (decision whop-card-trial-1024, [name] 24 Oct 2026).
-- UNAPPLIED: track-A applies by hand, before the first deploy that can start
-- the 3-day card trial (CARD_TRIAL_ENABLED=true). Rollback:
-- scripts/sql/track-a/a-card-trial/down.sql. Proof: npm run test:db:card-trial
-- on a throwaway PostgreSQL 16.
--
-- One change: subscriptions_tier_check also allows 'flex_month_trial', the
-- 3-day card trial on the hidden Whop plan WHOP_PLAN_FLEX_TRIAL (0 EUR today,
-- then 24 EUR every 30 days). /api/whop/trial/verify and the Whop webhook
-- write that tier at the trial start and its renewals extend the same row;
-- without this the insert fails with 23514 and the learner gets no access.
--
-- The list is the production list of 20270103090000_a_pricing_v2 (fourteen
-- tiers) plus flex_month_trial; seed_seat (20270105090000, unapplied) adds
-- itself and keeps flex_month_trial in its own list. The abuse limits of the
-- card trial need no schema change (src/lib/card-trial.ts cardTrialRefusal).
-- The ALTER validates every existing row under the stronger lock; the table
-- is small (hundreds of rows), so it is instant.
SET lock_timeout = '3s';

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
    'notes_pro_trial'::text,
    'flex_month'::text,
    'sitting_pass'::text,
    'half_year'::text,
    'guarantee_ticket'::text,
    'reverse_trial'::text,
    'flex_month_trial'::text
  ]));

RESET lock_timeout;
