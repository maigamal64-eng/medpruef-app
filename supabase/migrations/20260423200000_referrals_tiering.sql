-- ═══════════════════════════════════════════════════════════════════
-- Referrals tiering — 2026-04-23 (Lock #3)
-- ═══════════════════════════════════════════════════════════════════
-- Context: The original 2026-04-23 referrals migration set
-- `reward_credit_cents INT DEFAULT 4000` (€40 flat per qualified
-- referral). Lock #3 replaces that flat model with tiered payouts:
--
--   monthly          → €25
--   three_month      → €25
--   six_month        → €50
--   twelve_month     → €50
--   premium_pass_guaranteed (June 26 Cohort)
--                    → €75
--
-- Plus:
--   * 30-day payout hold after qualification (counters subscription
--     refund / chargeback fraud on high-value rewards)
--   * €600/year cap per referrer (60000 cents)
--
-- The per-row reward amount is stamped by the NOWPayments IPN webhook
-- based on the referee's tier (see src/lib/nowpayments.ts
-- referralPayoutCents). The DB default stays at 4000 so that any
-- INSERT-without-amount path (admin tooling, manual grant, etc.)
-- doesn't silently create zero-value referrals — but production writes
-- from the webhook always specify the amount explicitly.
--
-- Additive migration. No column drops. No destructive changes.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add the hold-expiry columns used by the /api/referrals/status
--    endpoint to split qualified rows into `in-hold` vs `claimable`.
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_reason text;
  -- hold_reason: 'subscription_refund' | 'annual_cap' | NULL

COMMENT ON COLUMN public.referrals.hold_expires_at IS
  '30-day payout hold after qualification. Claim becomes withdrawable once now() >= hold_expires_at.';
COMMENT ON COLUMN public.referrals.hold_reason IS
  'Nullable. Set to annual_cap when reward_credit_cents is 0 because the referrer already hit the €600/year cap.';

-- Partial index for fast lookup of qualified rows still in hold — used
-- by the admin payout-processor cron job to find rows that are now
-- releasable without a full table scan.
CREATE INDEX IF NOT EXISTS idx_referrals_hold_expires
  ON public.referrals(hold_expires_at)
  WHERE status = 'qualified';
