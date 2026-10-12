-- TR-11: invalidate derived explanations only when the answer key changes.
-- Apply off-peak: installing the triggers briefly locks public.questions.
-- PostgreSQL 16 fast constant default: no table rewrite or historical backfill.
-- Release with the revision-checked AI/translation/regeneration writers.
-- Invalidations fail closed: a corrected key and its cache clear commit together.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS key_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.clear_ai_explanation_on_key_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.key_revision := OLD.key_revision + 1;
  NEW.ai_explanation := NULL;
  NEW.ai_explanation_generated_at := NULL;
  NEW.ai_explanation_lang := NULL;
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
  -- The definer lets editors invalidate the RLS-protected cache. Any failure
  -- (including a lock timeout with stale rows present) aborts the key edit.
  -- A missing cache table is also an error: repair schema drift before retrying.
  DELETE FROM public.question_translations
  WHERE question_id = NEW.id
    AND field IN ('explanation', 'ai_explanation');
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

-- Translation generation captures the revision AND exact source before its
-- provider call. Validate both under the parent row lock before inserting.
-- The lock lasts to transaction end, so a concurrent edit either runs first
-- (this write returns false) or runs second (its AFTER trigger deletes it).
CREATE OR REPLACE FUNCTION public.cache_question_translation_if_current(
  p_question_id integer,
  p_key_revision bigint,
  p_field text,
  p_source_text text,
  p_lang text,
  p_translated_text text,
  p_source_model text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_row public.questions%ROWTYPE;
  current_source text;
BEGIN
  IF p_field IS NULL OR p_field NOT IN ('explanation', 'ai_explanation') THEN
    RAISE EXCEPTION 'Unsupported translation field' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO source_row FROM public.questions
    WHERE id = p_question_id FOR NO KEY UPDATE;
  IF NOT FOUND OR p_key_revision IS DISTINCT FROM source_row.key_revision THEN
    RETURN false;
  END IF;
  current_source := CASE p_field
    WHEN 'explanation' THEN source_row.explanation
    WHEN 'ai_explanation' THEN source_row.ai_explanation
  END;
  IF current_source IS NULL OR current_source IS DISTINCT FROM p_source_text THEN
    RETURN false;
  END IF;
  INSERT INTO public.question_translations
    (question_id, lang, field, translated_text, source_model)
  VALUES (p_question_id, p_lang, p_field, p_translated_text, p_source_model)
  ON CONFLICT (question_id, lang, field) DO NOTHING;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.cache_question_translation_if_current(integer, bigint, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cache_question_translation_if_current(integer, bigint, text, text, text, text, text)
  TO service_role;

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
NOTIFY pgrst, 'reload schema';
COMMIT;
