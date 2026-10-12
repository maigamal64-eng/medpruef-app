-- ADM-Q13 (extends TR-11 / b05), [name]'s 2026-10-12 rule (answer edits only).
-- Requires 20261110090000 (b05).
--   * The saved AI explanation, its revision and (via b18) its votes follow
--     the answer key only: b05's BEFORE trigger, unchanged here, advances
--     key_revision and clears ai_explanation* when `answer` or `choices`
--     changes. `choices` compares as jsonb, so a correct-flag flip, an option
--     text edit or an option reorder counts; a pure JSON key-order difference
--     does not (jsonb normalizes objects). Stem or manual explanation wording
--     edits keep the AI explanation, its revision and its votes.
--   * Translations are cleared field by field, only where the source text
--     changed: 'question' on a stem edit, 'explanation' on a manual
--     explanation edit, 'ai_explanation' whenever the AI text changes or is
--     cleared (an answer/choices edit, or a regeneration).
--   * tag/topic/is_active-only updates keep the revision and every cache.
-- Invalidation stays fail closed: a cleanup failure aborts the content edit.
-- The b18 ratings trigger is widened (when installed) so that a trigger-made
-- AI cache clear also clears the votes that belonged to the replaced text.
-- Apply off-peak with b05: trigger replacement briefly locks public.questions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- key_revision is trigger-maintained. A direct write could move it back and
-- let a delayed writer match again, so reject it. Trigger names fire in
-- alphabetical order: this guard sees the caller's row before b05's clear
-- trigger advances the revision.
CREATE OR REPLACE FUNCTION public.reject_manual_key_revision_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'questions.key_revision is maintained by the cache invalidation trigger'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_manual_key_revision_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_manual_key_revision_change()
  TO service_role;

CREATE OR REPLACE TRIGGER questions_aa_guard_key_revision
BEFORE UPDATE ON public.questions
FOR EACH ROW
WHEN (OLD.key_revision IS DISTINCT FROM NEW.key_revision)
EXECUTE FUNCTION public.reject_manual_key_revision_change();

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
  IF OLD.question IS DISTINCT FROM NEW.question THEN
    stale_fields := stale_fields || 'question'::text;
  END IF;
  IF OLD.explanation IS DISTINCT FROM NEW.explanation THEN
    stale_fields := stale_fields || 'explanation'::text;
  END IF;
  IF OLD.ai_explanation IS DISTINCT FROM NEW.ai_explanation THEN
    stale_fields := stale_fields || 'ai_explanation'::text;
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
-- text cleared by b05 on an answer/choices edit is visible here.
CREATE OR REPLACE TRIGGER questions_clear_explanation_translations_on_key_change
AFTER UPDATE ON public.questions
FOR EACH ROW
WHEN (OLD.question IS DISTINCT FROM NEW.question
      OR OLD.explanation IS DISTINCT FROM NEW.explanation
      OR OLD.ai_explanation IS DISTINCT FROM NEW.ai_explanation)
EXECUTE FUNCTION public.clear_explanation_translations_on_key_change();

-- b18 installed its ratings trigger as UPDATE OF <columns>, which ignores
-- columns changed by BEFORE triggers. Without a column list the WHEN clause
-- compares the final row, so an answer/choices edit that clears the AI text
-- also clears its votes. b18's own WHEN (explanation, AI text, AI timestamp)
-- is unchanged. Counter-only updates still do not match.
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
