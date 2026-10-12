-- Mentor free beta preparation (track-A chain job mentor-beta-prep, 2026-10-12).
-- UNAPPLIED changeset. It extends the unapplied mentor ledger
-- (20261022100000_mentor_ledger.sql) and must be applied after it and after
-- 20261022120000_mentor_admin_rollup.sql. Nothing here enables the mentor:
-- MENTOR_ENABLED, AI_FEATURES_ENABLED, the DB flag "mentor" and a per-user
-- allowlist entry are all still required.
--
--  1. Two new lot sources:
--       free_taste  <user_id>                  5 credits once per verified free
--                                              user ([name] pick MUX-20 A,
--                                              2026-10-11), facts mode only,
--                                              behind MENTOR_FREE_ENABLED.
--       beta_grant  beta-2026-10:<user_id>     one-time admin beta grant,
--                                              idempotent per user and key.
--  2. Two catalogue rows (never sold, never buyable): free_taste and beta_grant.
--     beta_grant has grant_micro 0 so it can only fund a lot through an
--     explicit amount from the admin beta tool.
--  3. mentor_beta_usage(uuid[], timestamptz): per-user messages, failures,
--     credits used and true cost for the admin beta usage view. Read-only,
--     service_role only.
--
-- All spend from these lots is ordinary ledger consumption, so it counts
-- against the global spend breaker (ai_spend_month) like any other credit.

SET lock_timeout = '5s';

-- ─── 1. Lot sources ─────────────────────────────────────────────────────
-- The ledger declares the source CHECK inline, so PostgreSQL names it
-- ai_credit_lot_source_check. The loop is a fallback for a differently named
-- copy and only matches the source-list CHECK itself.
ALTER TABLE public.ai_credit_lot DROP CONSTRAINT IF EXISTS ai_credit_lot_source_check;
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ai_credit_lot'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE 'CHECK ((source = ANY%whop_payment%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_credit_lot DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.ai_credit_lot ADD CONSTRAINT ai_credit_lot_source_check CHECK (source IN
  ('whop_payment', 'pro_included', 'trial_taste', 'admin_gift', 'referral_reward',
   'admin_included', 'unknown_included', 'admin_adjust', 'free_taste', 'beta_grant'));

-- ─── 2. Catalogue rows ──────────────────────────────────────────────────
INSERT INTO public.ai_credit_package
  (package_id, kind, grant_micro, period_days, expiry_days, price_eur_cents, active, provisional, sort, note)
VALUES
  ('free_taste', 'trial', 25000, NULL, 30, NULL, true, false, 51,
   '[name] pick MUX-20 A (2026-10-11): 5 credits once per verified free user, facts only, behind MENTOR_FREE_ENABLED (default off).'),
  ('beta_grant', 'gift', 0, NULL, 30, NULL, false, false, 62,
   'Free mentor beta ([name], 12 Oct 2026): amount chosen per grant in the admin beta tool; lot valid 30 days.')
ON CONFLICT (package_id) DO NOTHING;

-- ─── 3. Beta usage read ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_mentor_turn_user_time ON public.ai_mentor_turn (user_id, created_at);

CREATE OR REPLACE FUNCTION public.mentor_beta_usage(p_users uuid[], p_since timestamptz)
RETURNS TABLE (
  user_id            uuid,
  messages           bigint,
  failures           bigint,
  blocked            bigint,
  credits_used_micro bigint,
  cost_micro         bigint,
  beta_granted_micro bigint,
  remaining_micro    bigint,
  last_turn_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT DISTINCT u AS user_id FROM unnest(p_users) AS u
     WHERE u IS NOT NULL AND cardinality(p_users) <= 200
  )
  SELECT
    ids.user_id,
    (SELECT count(*) FROM public.ai_mentor_turn t
      WHERE t.user_id = ids.user_id AND t.created_at >= p_since
        AND t.outcome IN ('answered', 'refused', 'replaced_partial', 'notice_only')),
    (SELECT count(*) FROM public.ai_mentor_turn t
      WHERE t.user_id = ids.user_id AND t.created_at >= p_since AND t.outcome = 'error'),
    (SELECT count(*) FROM public.ai_mentor_turn t
      WHERE t.user_id = ids.user_id AND t.created_at >= p_since
        AND t.outcome IN ('blocked_402', 'blocked_429', 'blocked_cap')),
    (SELECT COALESCE(SUM(-g.delta_micro_usd), 0)::bigint FROM public.ai_usage_ledger g
      WHERE g.user_id = ids.user_id AND g.created_at >= p_since AND g.kind = 'settle' AND g.delta_micro_usd < 0),
    (SELECT COALESCE(SUM(g.cost_micro), 0)::bigint FROM public.ai_usage_ledger g
      WHERE g.user_id = ids.user_id AND g.created_at >= p_since
        AND g.kind IN ('settle', 'house_cost') AND g.cost_micro IS NOT NULL),
    (SELECT COALESCE(SUM(l.granted_micro), 0)::bigint FROM public.ai_credit_lot l
      WHERE l.user_id = ids.user_id AND l.source = 'beta_grant'),
    (SELECT COALESCE(SUM(l.granted_micro - l.spent_micro - l.clawed_back_micro), 0)::bigint FROM public.ai_credit_lot l
      WHERE l.user_id = ids.user_id AND l.status = 'live' AND l.starts_at <= now() AND l.expires_at > now()),
    (SELECT max(t.created_at) FROM public.ai_mentor_turn t
      WHERE t.user_id = ids.user_id AND t.created_at >= p_since)
  FROM ids;
$$;

REVOKE ALL ON FUNCTION public.mentor_beta_usage(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_beta_usage(uuid[], timestamptz) TO service_role;
COMMENT ON FUNCTION public.mentor_beta_usage(uuid[], timestamptz) IS
  'Admin beta usage: per-user messages, failures, blocked turns, credits used, true API cost, beta grant and live balance. Read-only, at most 200 users, service_role only.';

RESET lock_timeout;
