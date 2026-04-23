-- admin_exec_select — SECURITY DEFINER SELECT runner for /admin/sql.
-- §2.8 of the April 23 admin revamp sprint.
--
-- Applied via Supabase MCP on 2026-04-23.
-- Wraps caller SQL with LIMIT 1000 and refuses anything that doesn't
-- begin with SELECT or WITH (belt-and-braces — the TS guard in
-- src/lib/admin/sql-guard.ts is the first gate).
CREATE OR REPLACE FUNCTION public.admin_exec_select(sql_text text)
RETURNS TABLE (row_json jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  cleaned text;
  head_word text;
  wrapped_sql text;
BEGIN
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
$$;

REVOKE ALL ON FUNCTION public.admin_exec_select(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_exec_select(text) TO service_role;

COMMENT ON FUNCTION public.admin_exec_select(text) IS
  'SELECT-only runner for /admin/sql. Invoked by service_role only; caller validates SQL via src/lib/admin/sql-guard.ts. Wraps caller SQL with LIMIT 1000.';
