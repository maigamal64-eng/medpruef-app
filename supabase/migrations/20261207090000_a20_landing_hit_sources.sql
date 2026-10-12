-- a20 (ADM-18 A, 2026-10-12): count landing arrivals per tag in the database.
--
-- The admin Growth "Sources" table needs arrivals per utm_source and
-- utm_campaign. landing_hits is written by an anonymous beacon, so reading
-- its rows into the app does not scale (and PostgREST caps a read at 1000
-- rows). This function returns the grouped counts instead: one row per
-- lower-cased, trimmed (source, campaign) pair since p_since (NULL = all
-- time), the 499 largest pairs and one '(other)' row with the rest, so the
-- total always adds up and the result stays far below the row cap.
-- Counts only; landing_hits holds no identity.
--
-- SECURITY INVOKER, EXECUTE for service_role only (the admin API's client).
-- Rollback: scripts/sql/track-a/a20-admin-growth-cleanup/down-landing-hit-sources.sql
-- Proof:    npm run test:db:a20 (throwaway PostgreSQL 16)
-- UNAPPLIED: production application is a release GO (pick-admin-schema-go A).
-- Until it is applied the Growth API falls back to a paged read.
CREATE OR REPLACE FUNCTION public.admin_landing_hit_sources(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (utm_source text, utm_campaign text, hits bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH grouped AS (
    SELECT nullif(lower(btrim(h.utm_source)), '') AS s,
           nullif(lower(btrim(h.utm_campaign)), '') AS c,
           count(*)::bigint AS n
    FROM public.landing_hits h
    WHERE p_since IS NULL OR h.at >= p_since
    GROUP BY 1, 2
  ), ranked AS (
    SELECT s, c, n, row_number() OVER (ORDER BY n DESC, s NULLS LAST, c NULLS LAST) AS rn
    FROM grouped
  )
  SELECT left(s, 200), left(c, 200), n FROM ranked WHERE rn < 500
  UNION ALL
  SELECT '(other)', NULL, sum(n)::bigint FROM ranked WHERE rn >= 500 HAVING count(*) > 0;
$$;

REVOKE ALL ON FUNCTION public.admin_landing_hit_sources(timestamptz) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_landing_hit_sources(timestamptz) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.admin_landing_hit_sources(timestamptz) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_landing_hit_sources(timestamptz) TO service_role;
  END IF;
END
$$;
