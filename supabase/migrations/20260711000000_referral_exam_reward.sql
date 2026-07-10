-- Referral exam reward — 2026-07-11 (Praxis synthesis, workflow wdtk7s53t).
-- The €40/tiered-cash referral program (see 20260423200000_referrals_tiering.sql)
-- is PAUSED for new/enrolled users, not deleted — legacy `referrals` rows keep
-- their cash shape. The new mechanic is non-cash: a referrer who gets N=2
-- colleagues to sign up with their code AND each answer >=20 distinct
-- questions across >=2 distinct days earns free Pro through the next sitting
-- of their own active_exam (+14 day buffer), never a cash payout. See
-- MEDPRUF-SOT.md §2.x "Referral reward — Pro through the exam window" for
-- the full business-fact block.
--
-- This column distinguishes the new activity-qualified rows from legacy
-- cash rows explicitly, rather than inferring "new mechanic" from
-- reward_credit_cents = 0 (which is ALSO the pending-row default and would
-- be an unreliable signal to branch UI/admin logic on).
--
-- Additive only. No drops, no backfill of existing rows beyond the
-- column default (every pre-existing row is implicitly 'cash', which is
-- correct — they were all created under the cash program).
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS reward_type text NOT NULL DEFAULT 'cash'
    CHECK (reward_type IN ('cash', 'pro_until_exam'));

COMMENT ON COLUMN public.referrals.reward_type IS
  'cash = legacy €25-75 tiered payout (program paused 2026-06-25 for new/enrolled users, code retained for historical rows). pro_until_exam = the 2026-07-11 activity-qualified reward: free Pro through the referrers next active_exam sitting +14d, granted only via POST /api/admin/referrals/grant-exam-reward after a human reviews farm signals. Default cash so every pre-existing row is correctly classified without a backfill.';
