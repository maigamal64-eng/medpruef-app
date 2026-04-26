-- review-2026-04-26-A2 · server-side onboarding state for users
--
-- Real users (Aml, [name], Obai) re-saw the onboarding flow every time
-- they signed in from a new browser/incognito session because the
-- "completed" flag lived only in localStorage.medpruef_onboarding.
-- That cleared on every fresh device → re-shown.
--
-- This migration adds three fields:
--   onboarding_completed_at — primary "have they finished?" stamp
--   onboarding_skipped_at  — for users who tap "skip" / X out
--   onboarding_data        — jsonb snapshot of the user's stated
--                            exam_date / exam / daily_goal / language
--                            for analytics + future re-personalization
--
-- The redirect logic in src/app/page.tsx now reads onboarding_completed_at
-- (returned via /api/auth → sanitizeUser) BEFORE falling back to
-- localStorage.
--
-- Backfill: every user who has answered ≥5 questions is treated as
-- "implicitly completed" — they're returning users, the flow would be
-- friction. Stamp from last_active_date or created_at.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO blocks for the backfill so
-- re-applying is a no-op.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_data jsonb;

CREATE INDEX IF NOT EXISTS idx_users_onboarding_completed_at
  ON public.users (onboarding_completed_at)
  WHERE onboarding_completed_at IS NOT NULL;

-- Backfill: any user with ≥5 answer_history rows (i.e. has actually
-- engaged with the product) and a NULL onboarding_completed_at is
-- treated as having completed onboarding before this migration. Use
-- their last_active_date if set, else created_at, as the stamp.
DO $$
BEGIN
  UPDATE public.users u
  SET onboarding_completed_at = COALESCE(
        u.last_active_date::timestamptz,
        u.created_at,
        now()
      )
  WHERE u.onboarding_completed_at IS NULL
    AND u.id IN (
      SELECT user_id
      FROM public.answer_history
      WHERE user_id IS NOT NULL
      GROUP BY user_id
      HAVING count(*) >= 5
    );
END$$;

COMMENT ON COLUMN public.users.onboarding_completed_at IS
  'Set when user finishes onboarding flow. Cross-device source of truth — '
  'localStorage.medpruef_onboarding is now a redundant cache. '
  'Backfilled 2026-04-26 for users with ≥5 answer_history rows. '
  'See review-2026-04-26-A2.';

COMMENT ON COLUMN public.users.onboarding_skipped_at IS
  'Set when user dismisses onboarding without completing. Treated as "do not '
  're-show" by the redirect logic; same effect as completed_at for the gate. '
  'Tracked separately so we can analyse drop-off.';

COMMENT ON COLUMN public.users.onboarding_data IS
  'Snapshot of stated exam_date / exam / daily_goal / language at the moment '
  'of completion. Useful for re-personalization and analytics.';
