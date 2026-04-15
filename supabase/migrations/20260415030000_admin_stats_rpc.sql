-- ═══════════════════════════════════════════════════════════════════
-- Admin stats RPCs — 2026-04-15
-- ═══════════════════════════════════════════════════════════════════
-- Context: Analytics audit P0-A3 + Backend audit BE-P1-008 found that
-- /api/stats/admin was computing DAU/WAU/MAU by SELECTing all
-- user_events rows for each window into JS and counting uniques in a
-- Set. Supabase's REST client silently caps at 1000 rows, so every
-- aggregate beyond ~1000 events was under-reporting.
--
-- Fix: move the aggregation to SECURITY DEFINER SQL functions that
-- run server-side where count(DISTINCT ...) is cheap and correct.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_admin_overview_counts()
RETURNS TABLE (
  total_users bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  questions_today bigint,
  questions_this_week bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM users) AS total_users,
    (SELECT count(DISTINCT user_id) FROM user_events
      WHERE created_at >= date_trunc('day', now())) AS dau,
    (SELECT count(DISTINCT user_id) FROM user_events
      WHERE created_at >= now() - interval '7 days') AS wau,
    (SELECT count(DISTINCT user_id) FROM user_events
      WHERE created_at >= now() - interval '30 days') AS mau,
    (SELECT count(*) FROM user_events
      WHERE event_type = 'question_answer'
        AND created_at >= date_trunc('day', now())) AS questions_today,
    (SELECT count(*) FROM user_events
      WHERE event_type = 'question_answer'
        AND created_at >= now() - interval '7 days') AS questions_this_week;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_daily_active_users(days_back int DEFAULT 30)
RETURNS TABLE (
  day date,
  active bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    date_trunc('day', created_at)::date AS day,
    count(DISTINCT user_id) AS active
  FROM user_events
  WHERE created_at >= now() - (days_back || ' days')::interval
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_overview_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_daily_active_users(int) TO service_role;
