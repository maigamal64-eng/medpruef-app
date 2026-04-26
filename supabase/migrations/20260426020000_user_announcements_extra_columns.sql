-- review-2026-04-26-A3 · server-side gate state for FeedbackWidget +
-- WhatsNewModal so they don't re-fire across devices.
--
-- The central useAnnouncementGate() hook already arbitrates the
-- orientation modal, cohort banner, and referral floater via per-user
-- columns on user_announcements. But the FeedbackWidget self-gates on
-- localStorage.medpruef_survey_v1_completed, and WhatsNewModal on
-- localStorage.medpruef_whats_new_seen. That means a returning user on
-- a fresh browser/incognito sees both modals again — which is the same
-- bug class as A2 (onboarding) but for less-priority surfaces.
--
-- Cosmetic state (sidebar collapsed, theme, cookie consent) stays
-- localStorage-only by design — those are per-device-session, not
-- per-user.

ALTER TABLE public.user_announcements
  ADD COLUMN IF NOT EXISTS feedback_survey_shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_survey_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS whats_new_seen_at timestamptz;

-- Backfill: every user with ≥5 answer_history rows has been around
-- long enough that they've seen the survey + whats-new at least once.
-- Stamp the shown timestamps so we don't bombard the existing base.
DO $$
BEGIN
  UPDATE public.user_announcements ua
  SET
    feedback_survey_shown_at = COALESCE(
      ua.feedback_survey_shown_at,
      ua.last_session_at,
      ua.created_at,
      now()
    ),
    whats_new_seen_at = COALESCE(
      ua.whats_new_seen_at,
      ua.last_session_at,
      ua.created_at,
      now()
    )
  WHERE ua.user_id IN (
    SELECT user_id
    FROM public.answer_history
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING count(*) >= 5
  );
END$$;

COMMENT ON COLUMN public.user_announcements.feedback_survey_shown_at IS
  'When we last showed the FeedbackWidget survey prompt to this user. '
  'Cross-device gate — replaces localStorage.medpruef_survey_v1_completed '
  '(review-2026-04-26-A3).';

COMMENT ON COLUMN public.user_announcements.feedback_survey_dismissed_at IS
  'When user dismissed the survey without responding. Treated equally to '
  'shown_at by the gate — both prevent re-firing.';

COMMENT ON COLUMN public.user_announcements.whats_new_seen_at IS
  'When we last showed the WhatsNewModal version-summary to this user. '
  'Cross-device gate — replaces localStorage.medpruef_whats_new_seen.';
