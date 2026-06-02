-- ═══════════════════════════════════════════════════════════════════
-- €27 / 3-month entry tier — 2026-04-28
-- ═══════════════════════════════════════════════════════════════════
-- Phase 1 of the 2026-04-28 pricing reset (Compass decision queue
-- items `medpruef-pricing-phase1` + `integrator-9eur-cap`):
--   - drop the entry price from €19/1mo to €9-effective/3mo
--   - bill it as a single €27 invoice (NOWPayments has no recurring
--     billing — and Stripe Atlas hasn't cleared yet)
--   - cap the entry tier to ONE purchase per user, enforced at
--     application level in /api/checkout/nowpayments by checking
--     subscriptions for an existing first_3mo_27 row with
--     started_at IS NOT NULL
--
-- Why no DB-level UNIQUE constraint? A `UNIQUE(user_id, tier)` would
-- block the user from ever retrying after a `failed` row (e.g. a
-- NOWPayments timeout). The right semantic is "one CONFIRMED purchase
-- per user", which depends on `started_at` (set only when payment is
-- confirmed). Application-level checks let pending/failed rows retry
-- naturally without polluting the constraint.
--
-- This migration:
--   1. Extends the subscriptions.tier CHECK constraint to include
--      'first_3mo_27' alongside the existing tier ids. Strict superset
--      of every prior tier — no data change.
--
-- No data change — purely additive guardrails.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
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
      'first_month_19',
      'first_3mo_27'
    ));
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;
