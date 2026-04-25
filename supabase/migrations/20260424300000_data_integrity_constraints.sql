-- Data integrity constraints (D-1 + D-3 from review-2026-04-24)
--
-- D-1: referrals must be UNIQUE on (referrer_user_id, referee_user_id).
-- The NOWPayments webhook qualifies referrals on the first paid sub of the
-- referee — but if the referee somehow gets two referrals rows pointing at
-- the same referrer (e.g. they used two different invite codes from the
-- same referrer over time, or a retry bug created a duplicate insert),
-- we'd double-credit. The schema today has a non-unique index on
-- referee_user_id and one on referrer_user_id but no compound UNIQUE,
-- so duplicates are technically possible.
--
-- This adds the constraint *partially* — only when both columns are
-- non-null. Pending referrals where the referee_user_id is NULL (the row
-- exists from a code-click-without-signup tracking event) are allowed
-- to repeat per referrer.
--
-- Approach: deduplicate first (keep the oldest row per pair, drop the rest),
-- then add the constraint. Idempotent via DO block.
--
-- D-3: webhook_attempts.subscription_id must FK to subscriptions(id) so
-- orphan attempt rows can't survive a subscription delete (currently
-- subscription_id is just a uuid column with no FK enforcement).

------------------------------------------------------------------------
-- D-1: referrals UNIQUE(referrer_user_id, referee_user_id)
------------------------------------------------------------------------

DO $$
BEGIN
  -- Deduplicate any existing pairs (defensive — there shouldn't be any
  -- but the table has been live for a few days so we play safe).
  DELETE FROM public.referrals a
  USING public.referrals b
  WHERE a.id <> b.id
    AND a.referrer_user_id = b.referrer_user_id
    AND a.referee_user_id  = b.referee_user_id
    AND a.referrer_user_id IS NOT NULL
    AND a.referee_user_id  IS NOT NULL
    AND a.created_at > b.created_at;
END$$;

-- Partial unique index — only enforces uniqueness for "real" referral
-- pairs (both sides resolved). Keeps the table flexible for tracking
-- click-only events.
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referrer_referee_uniq
  ON public.referrals (referrer_user_id, referee_user_id)
  WHERE referrer_user_id IS NOT NULL
    AND referee_user_id  IS NOT NULL;

------------------------------------------------------------------------
-- D-3: webhook_attempts.subscription_id → subscriptions(id) FK
------------------------------------------------------------------------

-- The webhook_attempts table was created in 20260424050000 with
-- subscription_id as plain uuid (no FK). Orphan rows would survive a
-- subscription DELETE, leaving misleading audit trails. Add the FK now.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'webhook_attempts'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'webhook_attempts_subscription_id_fkey'
  ) THEN
    -- Strip any orphan references first so the ALTER TABLE doesn't fail.
    UPDATE public.webhook_attempts
       SET subscription_id = NULL
     WHERE subscription_id IS NOT NULL
       AND subscription_id NOT IN (SELECT id FROM public.subscriptions);

    ALTER TABLE public.webhook_attempts
      ADD CONSTRAINT webhook_attempts_subscription_id_fkey
      FOREIGN KEY (subscription_id)
      REFERENCES public.subscriptions(id)
      ON DELETE SET NULL;
  END IF;
END$$;

------------------------------------------------------------------------
-- Grants — service_role only (everything in the audit-trail path is
-- server-side). RLS already deny-all on both tables; no changes needed.
------------------------------------------------------------------------

COMMENT ON INDEX public.referrals_referrer_referee_uniq IS
  'Prevents duplicate (referrer, referee) pairs once both sides are resolved. '
  'Pending click-only rows (referee NULL) are excluded. '
  'See review-2026-04-24-D-1.';

COMMENT ON CONSTRAINT webhook_attempts_subscription_id_fkey
  ON public.webhook_attempts IS
  'Ensures webhook_attempts.subscription_id always points at a real '
  'subscriptions row, or NULL when the attempt was rejected before '
  'subscription resolution. ON DELETE SET NULL keeps the audit row '
  'useful even after the subscription is purged. '
  'See review-2026-04-24-D-3.';
