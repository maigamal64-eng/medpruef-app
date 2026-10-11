-- TR-11: invalidate derived explanations only when the answer key changes.
-- Apply off-peak: installing the triggers briefly locks public.questions.
-- No table rewrite or backfill. Existing stale caches need separate changesets.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.clear_ai_explanation_on_key_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  BEGIN
    NEW.ai_explanation := NULL;
    NEW.ai_explanation_generated_at := NULL;
    NEW.ai_explanation_lang := NULL;
  EXCEPTION WHEN OTHERS THEN
    -- Keep content fixes available; avoid logging question text or SQLERRM.
    RAISE WARNING 'TR-11 AI cache invalidation failed for question %, SQLSTATE %',
      NEW.id, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_explanation_translations_on_key_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  BEGIN
    -- The definer permits a question editor to invalidate the RLS-protected
    -- cache without granting that editor direct access to translations.
    DELETE FROM public.question_translations
    WHERE question_id = NEW.id
      AND field IN ('explanation', 'ai_explanation');
  EXCEPTION WHEN OTHERS THEN
    -- This subtransaction can fail without undoing the BEFORE trigger's clear.
    RAISE WARNING 'TR-11 translation invalidation failed for question %, SQLSTATE %',
      NEW.id, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_ai_explanation_on_key_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_explanation_translations_on_key_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_ai_explanation_on_key_change()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_explanation_translations_on_key_change()
  TO service_role;

CREATE OR REPLACE TRIGGER questions_clear_ai_explanation_on_key_change
BEFORE UPDATE ON public.questions
FOR EACH ROW
WHEN (OLD.answer IS DISTINCT FROM NEW.answer
      OR OLD.choices IS DISTINCT FROM NEW.choices)
EXECUTE FUNCTION public.clear_ai_explanation_on_key_change();

CREATE OR REPLACE TRIGGER questions_clear_explanation_translations_on_key_change
AFTER UPDATE ON public.questions
FOR EACH ROW
WHEN (OLD.answer IS DISTINCT FROM NEW.answer
      OR OLD.choices IS DISTINCT FROM NEW.choices)
EXECUTE FUNCTION public.clear_explanation_translations_on_key_change();

-- Aggregate only: no learner identifiers, report details, or question content.
-- All terminal states written by /api/suggestions count, including modified.
-- Exclude unresolved and malformed timestamp pairs. Units are elapsed seconds.
-- An empty population returns count 0 and NULL percentiles, never invented 0s.
CREATE OR REPLACE VIEW public.question_report_resolve_time
WITH (security_barrier = true)
AS
SELECT
  count(*) AS resolved_report_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY resolve_seconds)
    AS median_resolve_seconds,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY resolve_seconds)
    AS p90_resolve_seconds
FROM (
  SELECT EXTRACT(EPOCH FROM (resolved_at - created_at))::double precision
    AS resolve_seconds
  FROM public.question_suggestions
  WHERE status IN ('approved', 'rejected', 'modified')
    AND created_at IS NOT NULL
    AND resolved_at IS NOT NULL
    AND resolved_at >= created_at
) AS resolved_reports;

-- Supabase default privileges can grant new views to client roles implicitly.
-- The aggregate uses its owner's access and is readable only by service_role
-- (in addition to its database owner); it is not a public reporting endpoint.
REVOKE ALL ON public.question_report_resolve_time FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.question_report_resolve_time TO service_role;
COMMIT;
