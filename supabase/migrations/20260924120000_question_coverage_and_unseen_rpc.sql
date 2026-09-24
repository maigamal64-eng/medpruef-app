-- Return the answered question set for a learner within the active study
-- scope. Keeping this distinct and in Postgres avoids PostgREST's row cap
-- silently omitting older answers and resurfacing already-seen questions.
CREATE OR REPLACE FUNCTION public.get_user_answered_question_ids(
  p_user_id uuid,
  p_exam_type text,
  p_topics text[] DEFAULT NULL
)
RETURNS TABLE (question_id integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ah.question_id::integer
  FROM answer_history ah
  JOIN questions q ON q.id = ah.question_id
  WHERE ah.user_id = p_user_id
    AND q.exam_type = p_exam_type
    AND (
      p_topics IS NULL
      OR cardinality(p_topics) = 0
      OR q.topic = ANY(p_topics)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_answered_question_ids(uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_answered_question_ids(uuid, text, text[])
  TO service_role;

-- The quiz API asks for a small random batch directly instead of returning
-- thousands of answered IDs to the application (which made URLs too large
-- for learners with deep histories).
CREATE INDEX IF NOT EXISTS answer_history_user_question_id_idx
  ON public.answer_history (user_id, question_id);

CREATE OR REPLACE FUNCTION public.get_random_unseen_question_ids(
  p_user_id uuid,
  p_exam_types text[],
  p_topics text[] DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_exam_dates text[] DEFAULT NULL,
  p_exam_year text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_mcq_only boolean DEFAULT false,
  p_exclude_ids integer[] DEFAULT NULL,
  p_allowed_ids integer[] DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (question_id integer)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT q.id
  FROM questions q
  WHERE q.is_active = true
    AND q.exam_type = ANY(p_exam_types)
    AND (p_topics IS NULL OR cardinality(p_topics) = 0 OR q.topic = ANY(p_topics))
    AND (p_tags IS NULL OR cardinality(p_tags) = 0 OR q.tags @> p_tags)
    AND (p_exam_dates IS NULL OR cardinality(p_exam_dates) = 0 OR q.exam_dates && p_exam_dates)
    AND (p_exam_year IS NULL OR cardinality(p_exam_year) = 0 OR q.exam_dates && p_exam_year)
    AND (p_search IS NULL OR p_search = '' OR q.question ILIKE ('%' || replace(replace(p_search, '%', ' '), ',', ' ') || '%') OR q.answer ILIKE ('%' || replace(replace(p_search, '%', ' '), ',', ' ') || '%'))
    AND (NOT p_mcq_only OR q.choices IS NOT NULL)
    AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (q.id = ANY(p_exclude_ids)))
    AND (p_allowed_ids IS NULL OR cardinality(p_allowed_ids) = 0 OR q.id = ANY(p_allowed_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM answer_history ah
      WHERE ah.user_id = p_user_id
        AND ah.question_id = q.id
    )
  ORDER BY q.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 200));
$$;

REVOKE EXECUTE ON FUNCTION public.get_random_unseen_question_ids(
  uuid, text[], text[], text[], text[], text[], text, boolean, integer[], integer[], integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_random_unseen_question_ids(
  uuid, text[], text[], text[], text[], text[], text, boolean, integer[], integer[], integer
) TO service_role;

-- Keep the numerator aligned with get_topic_counts, which reports only
-- active questions. Retired questions remain in answer history but no longer
-- count as coverage of the available bank.
CREATE OR REPLACE FUNCTION public.get_user_topic_progress(
  p_user_id uuid,
  p_exam_type text
)
RETURNS TABLE (topic text, answered int, correct int, wrong int)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(nullif(q.topic, ''), 'Unknown') AS topic,
    count(DISTINCT ah.question_id)::int AS answered,
    count(DISTINCT ah.question_id) FILTER (WHERE ah.is_correct)::int AS correct,
    count(DISTINCT ah.question_id) FILTER (WHERE NOT ah.is_correct)::int AS wrong
  FROM answer_history ah
  JOIN questions q ON q.id = ah.question_id
  WHERE ah.user_id = p_user_id
    AND q.exam_type = p_exam_type
    AND q.is_active = true
  GROUP BY coalesce(nullif(q.topic, ''), 'Unknown');
$$;

CREATE OR REPLACE FUNCTION public.get_user_topic_attempt_stats(
  p_user_id uuid,
  p_exam_type text
)
RETURNS TABLE (topic text, attempts int, correct_attempts int)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(nullif(q.topic, ''), 'Unknown') AS topic,
    count(*)::int AS attempts,
    count(*) FILTER (WHERE ah.is_correct)::int AS correct_attempts
  FROM answer_history ah
  JOIN questions q ON q.id = ah.question_id
  WHERE ah.user_id = p_user_id
    AND q.exam_type = p_exam_type
  GROUP BY coalesce(nullif(q.topic, ''), 'Unknown');
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_topic_attempt_stats(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_topic_attempt_stats(uuid, text)
  TO service_role;
