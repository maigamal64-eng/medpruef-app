-- ADM-Q13 (extends TR-11 / b05): a question's derived caches follow every
-- content edit, not only answer-key edits. Requires 20261110090000 (b05).
--   * stem, answer, choices or manual explanation change: key_revision
--     advances and the cached AI explanation is cleared (it is generated from
--     all four), so in-flight revision-checked writers are rejected;
--   * translations whose source changed are deleted: 'question' on a stem
--     edit, 'explanation' on an explanation or key edit, 'ai_explanation'
--     whenever the AI text changes or is cleared (including regeneration);
--   * tag/topic/is_active-only updates keep the revision and every cache.
-- Invalidation stays fail closed: a cleanup failure aborts the content edit.
-- The b18 ratings trigger is widened (when installed) so that a trigger-made
-- AI cache clear also clears the votes that belonged to the replaced text.
-- Apply off-peak with b05: trigger replacement briefly locks public.questions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE TRIGGER questions_clear_ai_explanation_on_key_change
BEFORE UPDATE ON public.questions
FOR EACH ROW
WHEN (OLD.question IS DISTINCT FROM NEW.question
      OR OLD.answer IS DISTINCT FROM NEW.answer
      OR OLD.choices IS DISTINCT FROM NEW.choices
      OR OLD.explanation IS DISTINCT FROM NEW.explanation)
EXECUTE FUNCTION public.clear_ai_explanation_on_key_change();

CREATE OR REPLACE FUNCTION public.clear_explanation_translations_on_key_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  stale_fields text[] := ARRAY[]::text[];
BEGIN
  -- The definer lets editors invalidate the RLS-protected cache. Any failure
  -- (including a lock timeout with stale rows present) aborts the edit.
  -- A missing cache table is also an error: repair schema drift before retrying.
  IF OLD.answer IS DISTINCT FROM NEW.answer
     OR OLD.choices IS DISTINCT FROM NEW.choices
     OR OLD.explanation IS DISTINCT FROM NEW.explanation THEN
    stale_fields := stale_fields || ARRAY['explanation', 'ai_explanation'];
  END IF;
  IF OLD.question IS DISTINCT FROM NEW.question THEN
    stale_fields := stale_fields || ARRAY['question', 'ai_explanation'];
  END IF;
  IF OLD.ai_explanation IS DISTINCT FROM NEW.ai_explanation THEN
    stale_fields := stale_fields || ARRAY['ai_explanation'];
  END IF;
  DELETE FROM public.question_translations
  WHERE question_id = NEW.id
    AND field = ANY (stale_fields);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_explanation_translations_on_key_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_explanation_translations_on_key_change()
  TO service_role;

-- AFTER-trigger WHEN clauses see the row after BEFORE triggers ran, so the AI
-- text cleared above is visible here.
CREATE OR REPLACE TRIGGER questions_clear_explanation_translations_on_key_change
AFTER UPDATE ON public.questions
FOR EACH ROW
WHEN (OLD.question IS DISTINCT FROM NEW.question
      OR OLD.answer IS DISTINCT FROM NEW.answer
      OR OLD.choices IS DISTINCT FROM NEW.choices
      OR OLD.explanation IS DISTINCT FROM NEW.explanation
      OR OLD.ai_explanation IS DISTINCT FROM NEW.ai_explanation)
EXECUTE FUNCTION public.clear_explanation_translations_on_key_change();

-- b18 installed its ratings trigger as UPDATE OF <columns>, which ignores
-- columns changed by BEFORE triggers. Without a column list the WHEN clause
-- compares the final row, so a stem or key edit that clears the AI text also
-- clears its votes. Counter-only updates still do not match.
DO $ratings$
BEGIN
  IF to_regprocedure('public.clear_replaced_explanation_ratings()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS questions_clear_replaced_explanation_ratings ON public.questions;
    CREATE TRIGGER questions_clear_replaced_explanation_ratings
    AFTER UPDATE ON public.questions
    FOR EACH ROW WHEN (OLD.explanation IS DISTINCT FROM NEW.explanation
      OR OLD.ai_explanation IS DISTINCT FROM NEW.ai_explanation
      OR OLD.ai_explanation_generated_at IS DISTINCT FROM NEW.ai_explanation_generated_at)
    EXECUTE FUNCTION public.clear_replaced_explanation_ratings();
  END IF;
END
$ratings$;

COMMIT;
