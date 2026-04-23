-- ═══════════════════════════════════════════════════════════════════
-- user_announcements — server-side gate state for the five marketing
-- surface classes (GuestMigrationBanner, CohortCountdownBanner,
-- OrientationModal, ReferralShareFloater, PaywallUpgradeModal).
--
-- Context: the soft-launch shipped with three of these stacking at
-- first-touch, plus two of them pitching the same €25-75 referral
-- bounty. Reads as spammy. Post-soft-launch sprint §1.4 replaces the
-- localStorage-only gate with a server-side row so cross-device users
-- get a coherent cadence.
--
-- Cadence rules (enforced in src/lib/announcements/useAnnouncementGate.ts):
--   Session 1, <5 Qs answered          → NOTHING
--   Session 1, ≥5 Qs                   → CohortCountdownBanner
--   Session 2+, modal not yet seen     → OrientationModal
--   Session 3+ OR ≥25 Qs AND orient    → ReferralShareFloater eligible
--     modal seen AND banner dismissed
--   Any session, hits 150Q cap         → PaywallUpgradeModal (caller-triggered)
--
-- PK on user_id — one row per user. session_count bumps when
-- last_session_at is > 30 min old (handled by /api/announcements/state).
-- qs_answered_total is incremented by /api/answer on every insert.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_announcements (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  -- Per-surface dismiss/seen timestamps. NULL means "never seen".
  orientation_modal_seen_at timestamptz,
  cohort_banner_dismissed_at timestamptz,
  referral_floater_dismissed_at timestamptz,

  -- Cumulative behavior signals the gate reads.
  qs_answered_total int NOT NULL DEFAULT 0,
  session_count int NOT NULL DEFAULT 1,
  last_session_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS deny-all — every read/write goes through /api/announcements/*
-- with the service-role key. Mirrors the post-2026-04-15 lockdown.
ALTER TABLE public.user_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all user_announcements" ON public.user_announcements;
CREATE POLICY "deny all user_announcements" ON public.user_announcements
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Touch updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.set_user_announcements_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_announcements_updated_at ON public.user_announcements;
CREATE TRIGGER trg_user_announcements_updated_at
  BEFORE UPDATE ON public.user_announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_announcements_updated_at();

-- Backfill: every existing non-guest user gets a row with
-- session_count=1, qs_answered_total inferred from answer_history.
-- We mark them as if they just finished session 1 at onboarding so
-- returning users land on OrientationModal next visit, not nothing.
INSERT INTO public.user_announcements (user_id, qs_answered_total, session_count, last_session_at, created_at)
SELECT
  u.id,
  COALESCE((SELECT COUNT(*) FROM public.answer_history ah WHERE ah.user_id = u.id), 0),
  1,
  COALESCE(u.last_active_date::timestamptz, u.created_at, now()),
  now()
FROM public.users u
WHERE u.id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
