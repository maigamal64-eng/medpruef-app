-- ═══════════════════════════════════════════════════════════════════
-- €19 first-month trial tier — 2026-04-24
-- ═══════════════════════════════════════════════════════════════════
-- Context (from the 2026-04-24 post-launch audit §2): €29/mo is too
-- high a first ask with crypto friction + weak trust signals at
-- launch. Introduce a ONE-TIME €19 first-month tier that gives 30
-- days of full access and does NOT auto-renew. "Try it for real for
-- less than a textbook chapter."
--
-- This migration:
--   1. Adds a CHECK constraint on subscriptions.tier enumerating
--      every known tier id (including the new first_month_19). The
--      table historically had no CHECK on this column, so writes
--      used to be free-form text. Lock it down now, before the new
--      tier lands in production, so we catch typos in ANY tier id
--      from now on.
--   2. Adds `subscriptions.trial_reminder_sent_at timestamptz` so
--      the /api/cron/trial-reminder endpoint can stamp a row after
--      it fires, preventing duplicate day-25 reminder sends on retry.
--
-- No data change — purely additive guardrails.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Tier CHECK constraint ─────────────────────────────────────
DO $$
BEGIN
  -- Drop the old one first if it exists — this is idempotent and
  -- safe because the tier list below is a strict superset of every
  -- historical tier that has ever shipped (premium_pass_guaranteed
  -- plus the four Stripe-pending tiers, plus the new first_month_19).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_tier_check'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      DROP CONSTRAINT subscriptions_tier_check;
  END IF;

  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_tier_check
    CHECK (tier IN (
      'premium_pass_guaranteed',
      'monthly',
      'three_month',
      'six_month',
      'twelve_month',
      'first_month_19'
    ));
EXCEPTION
  WHEN undefined_object THEN
    -- Defensive: if the table or column disappeared between the
    -- existence check and the ALTER, skip silently. Shouldn't happen
    -- in practice — the crypto_payments_and_referrals migration
    -- created the table.
    NULL;
END $$;

-- ── 2. trial_reminder_sent_at column ─────────────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.subscriptions.trial_reminder_sent_at IS
  'Set by the /api/cron/trial-reminder job when the day-25 email has been sent for a first_month_19 subscription. Used to prevent duplicate sends on cron retries.';
