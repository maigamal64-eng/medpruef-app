-- a39 (MUX-84): why a mentor purchase failed, so the checkout return screen
-- can say what happened instead of one generic line.
--
-- failure_reason is written only from the provider ledger or a permanent grant
-- failure (src/lib/mentor/credits/verify.ts), never guessed:
--   declined      the payment row shows failed/declined (processor-confirmed)
--   refunded      the payment row shows a refund or dispute
--   needs_manual  a paid payment that cannot be granted automatically
-- NULL keeps the generic "we are checking, do not pay again" copy.
--
-- Requires 20261022100000_mentor_ledger.sql (ai_mentor_purchase). Unapplied;
-- until it is applied the app reads NULL and writes the status alone
-- (purchases.ts falls back when the column is missing). Service role only,
-- like the table (RLS deny-all is unchanged). Idempotent.
-- Rollback: scripts/sql/track-a/a39-mentor-surfaces/down.sql.

ALTER TABLE public.ai_mentor_purchase
  ADD COLUMN IF NOT EXISTS failure_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_mentor_purchase_failure_reason_check'
      AND conrelid = 'public.ai_mentor_purchase'::regclass
  ) THEN
    ALTER TABLE public.ai_mentor_purchase
      ADD CONSTRAINT ai_mentor_purchase_failure_reason_check
      CHECK (failure_reason IS NULL OR (failure_reason IN ('declined', 'refunded', 'needs_manual') AND status IN ('failed', 'refunded')));
  END IF;
END $$;

COMMENT ON COLUMN public.ai_mentor_purchase.failure_reason IS
  'a39 MUX-84: declined | refunded | needs_manual, from the provider ledger only; NULL = unknown.';
