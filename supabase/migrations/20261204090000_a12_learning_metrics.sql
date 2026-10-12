-- 20261204090000_a12_learning_metrics.sql  (a12 state contracts, UX-GLOBAL-06)
-- UNAPPLIED changeset. Local proof: npm run test:db:a12 (throwaway PostgreSQL 16).
-- Rollback: scripts/sql/track-a/a12-state-contracts/down.sql
--
-- "zuletzt richtig" per topic: the share of distinct answered questions whose
-- NEWEST attempt was correct, computed once in the database so Home,
-- Fortschritt and Statistik read the same value. The newest attempt is the
-- latest created_at, ties broken by the highest id. Scoped to one exam_type,
-- inner-joined to questions (no is_active filter, same as
-- get_user_topic_progress). Read-only, SECURITY INVOKER, service_role only.

CREATE OR REPLACE FUNCTION public.get_user_topic_last_correct(
  p_user_id uuid,
  p_exam_type text
)
RETURNS TABLE (topic text, answered int, last_correct int)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH newest AS (
    SELECT DISTINCT ON (ah.question_id)
      ah.question_id,
      ah.is_correct,
      coalesce(nullif(q.topic, ''), 'Unknown') AS topic
    FROM answer_history ah
    JOIN questions q ON q.id = ah.question_id
    WHERE ah.user_id = p_user_id
      AND q.exam_type = p_exam_type
    ORDER BY ah.question_id, ah.created_at DESC, ah.id DESC
  )
  SELECT topic,
         count(*)::int AS answered,
         count(*) FILTER (WHERE is_correct)::int AS last_correct
  FROM newest
  GROUP BY topic;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_topic_last_correct(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_topic_last_correct(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.get_user_topic_last_correct(uuid, text) IS
  'a12 UX-GLOBAL-06: per-topic distinct answered questions and how many had a correct newest attempt.';
