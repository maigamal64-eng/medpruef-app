-- Local performance hardening, NOT applied to production.
-- Keep the existing signature, access restrictions, filters and ordering.
-- Mode-specific statements permit anti/semi joins rather than wrapping
-- history predicates in CASE. Synthetic equivalence/performance evidence
-- lives in scripts/tests/test-study-rpc.py. Live plans/indexes remain a gate.
CREATE OR REPLACE FUNCTION public.get_study_question_ids(
  p_user_id uuid,
  p_mode text,
  p_exam_types text[],
  p_topics text[] DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_exam_dates text[] DEFAULT NULL,
  p_exam_year text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_mcq_only boolean DEFAULT false,
  p_exclude_ids integer[] DEFAULT NULL,
  p_allowed_ids integer[] DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (question_id integer)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_mode = 'unseen' THEN
    RETURN QUERY SELECT q.id
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
    AND NOT EXISTS (SELECT 1 FROM answer_history ah WHERE ah.user_id = p_user_id AND ah.question_id = q.id)
  ORDER BY q.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
  ELSIF p_mode = 'wrong' THEN
    RETURN QUERY SELECT q.id
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
    AND EXISTS (SELECT 1 FROM answer_history ah WHERE ah.user_id = p_user_id AND ah.question_id = q.id AND NOT ah.is_correct)
  ORDER BY q.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
  ELSIF p_mode = 'review' THEN
    RETURN QUERY SELECT q.id
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
    AND EXISTS (SELECT 1 FROM user_question_progress up WHERE up.user_id = p_user_id AND up.question_id = q.id AND up.next_review_at <= now())
  ORDER BY q.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 200))
  OFFSET greatest(0, coalesce(p_offset, 0));
 END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_study_question_ids(
  uuid, text, text[], text[], text[], text[], text[], text, boolean, integer[], integer[], integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_question_ids(
  uuid, text, text[], text[], text[], text[], text[], text, boolean, integer[], integer[], integer, integer
) TO service_role;


