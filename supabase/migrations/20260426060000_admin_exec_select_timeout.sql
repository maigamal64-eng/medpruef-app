-- review-2026-04-26-B4 · 10s statement_timeout on admin_exec_select.
--
-- Sentry caught 2 events of "canceling statement due to statement
-- timeout" between 2026-04-15 and 2026-04-26. The most likely culprit
-- is the /admin/sql route — it lets an admin paste an arbitrary
-- SELECT, and a poorly-indexed query against a 10k-row table can
-- easily blow past Supabase's default 30s pool timeout.
--
-- Suppressing the error isn't the goal — the goal is to fail fast
-- (10s instead of 30s) so the admin gets feedback and the connection
-- returns to the pool, instead of holding it until Vercel's lambda
-- platform timeout fires.
--
-- This migration alters the SECURITY DEFINER function to set a
-- per-transaction statement_timeout. SET LOCAL is scoped to the
-- function call only — doesn't affect other queries on the same
-- pool connection.

CREATE OR REPLACE FUNCTION public.admin_exec_select(sql_text text)
 RETURNS TABLE(row_json jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  cleaned text;
  head_word text;
  wrapped_sql text;
BEGIN
  -- 10-second per-call timeout. SET LOCAL is bound to the current
  -- transaction; PostgREST runs each function call in its own
  -- transaction so this doesn't bleed into other admin queries on
  -- the same connection.
  --
  -- Why 10s: median admin query lands < 200 ms; the 99p we'd want to
  -- support is ~3 s for a topic-rollup against questions. 10s leaves
  -- breathing room for legitimate slow queries while still failing
  -- fast on the hyper-slow ones that hit Sentry.
  SET LOCAL statement_timeout = '10s';

  cleaned := trim(regexp_replace(sql_text, '^(\s|/\*.*?\*/|--[^\n]*\n)+', '', 'g'));
  head_word := upper(substring(cleaned from '^(\w+)'));
  IF head_word IS NULL OR head_word NOT IN ('SELECT', 'WITH') THEN
    RAISE EXCEPTION 'admin_exec_select refuses: statement must begin with SELECT or WITH (got %)', head_word;
  END IF;

  cleaned := regexp_replace(cleaned, ';+\s*$', '');

  wrapped_sql := format(
    'SELECT to_jsonb(t.*) FROM (%s) t LIMIT 1000',
    cleaned
  );

  RETURN QUERY EXECUTE wrapped_sql;
END;
$function$;

COMMENT ON FUNCTION public.admin_exec_select(text) IS
  'Admin SELECT runner. SET LOCAL statement_timeout = ''10s'' caps any '
  'single query at 10 seconds — fails fast on poorly-indexed scans '
  'instead of holding the pool connection to the 30s default. See '
  'review-2026-04-26-B4.';
