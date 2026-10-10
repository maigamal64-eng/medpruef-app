-- 20261014100000_study_rpc_perf.sql  (W2-DB1, written 2026-10-10)
--
-- STATUS: NOT APPLIED. Held for [name]'s explicit yes (plan gate). Additive:
-- two new indexes plus one CREATE OR REPLACE of get_study_question_ids
-- (same signature, same results, one redundant predicate added). No table,
-- column, policy or data change.
--
-- Why (read-only EXPLAIN, no ANALYZE, on prod 2026-10-10; full notes in
-- reports/plan-2026-10-10/overnight/W2-DB1/explain-findings.md):
--
-- 1. The free-slice select (/api/questions, /api/offline/questions) and
--    get_study_question_ids (unseen / wrong / review) both read
--    "WHERE is_active AND exam_type = X ORDER BY id LIMIT n". The planner
--    walks questions_pkey and filters, assuming each exam is spread evenly
--    over the id range. It is not: kmp_innsbruck ids all sit above the
--    kenntnispruefung and pharma ids, so a kmp request fetches ~7,900 wide
--    heap rows (69 MB heap, ~1.2 rows per page) before the first match.
--    That is the ~6k buffers per call behind the 8 s statement timeouts.
--    (exam_type, is_active, id) gives an ordered index range per exam.
--    It is deliberately NOT a partial index: PostgREST may run the free
--    slice as a generic plan with "is_active = $1", which cannot match a
--    "WHERE is_active" index predicate. INCLUDE (topic) lets
--    get_user_topic_progress build its per-exam hash from the index alone
--    instead of a bitmap heap scan of every active row of the exam.
--
-- 2. admin_user_directory computes max(user_events.created_at) per user.
--    With only idx_user_events_created available, the plan walks the
--    whole event log backwards once per user (~1.3M buffers per call).
--    (user_id, created_at DESC) turns that into one index probe per user.
--
-- Locking: plain CREATE INDEX (not CONCURRENTLY, because the migration
-- runner wraps each file in a transaction). It holds a SHARE lock that
-- blocks INSERT/UPDATE/DELETE on the table while it builds. Sizes on
-- 2026-10-10: questions ~11k rows, user_events ~72k rows, so each build is
-- expected to take well under a few seconds; inserts into user_events
-- (analytics tracking) and question edits wait for that time. Apply
-- outside peak study hours.
--
-- 3. get_study_question_ids filters "exam_type = ANY(p_exam_types)". With
--    an array the planner (PG16 locally) still prefers the pkey walk even
--    with the new index. The replaced function repeats a single exam type
--    as a plain equality (v_single_exam), which the planner turns into an
--    ordered index range. Results are identical: the extra predicate is
--    implied by ANY() when there is exactly one type, and is skipped
--    (NULL) for zero or several types. Body otherwise copied verbatim from
--    pg_get_functiondef on prod 2026-10-10.
--    The function also gets SET plan_cache_mode = force_custom_plan: in a
--    generic plan v_single_exam is a parameter and the planner falls back
--    to the pkey walk (measured locally: 8.3k buffers generic vs 18
--    custom). Planning these statements costs well under a millisecond.
--
-- Grants: indexes carry no privileges. The function keeps its exact prod
-- ACL {postgres=X, service_role=X} (read from pg_proc.proacl 2026-10-10);
-- CREATE OR REPLACE preserves it, and the REVOKE/GRANT below restate it
-- explicitly (Supabase 30 Oct explicit-grant rule).
--
-- Rollback (if ever needed):
--   DROP INDEX IF EXISTS public.questions_exam_active_id_idx;
--   DROP INDEX IF EXISTS public.user_events_user_created_idx;
--   and re-run the get_study_question_ids body from
--   20261007090000_study_rpc_mode_plans.sql (prod-equal before this file).

SET lock_timeout = '3s';

CREATE INDEX IF NOT EXISTS questions_exam_active_id_idx
  ON public.questions USING btree (exam_type, is_active, id)
  INCLUDE (topic);

COMMENT ON INDEX public.questions_exam_active_id_idx IS
  'W2-DB1 2026-10-10: ordered per-exam id range for the free slice and get_study_question_ids; INCLUDE topic for get_user_topic_progress.';

CREATE INDEX IF NOT EXISTS user_events_user_created_idx
  ON public.user_events USING btree (user_id, created_at DESC);

COMMENT ON INDEX public.user_events_user_created_idx IS
  'W2-DB1 2026-10-10: one probe per user for max(created_at) in admin_user_directory.';

-- 3. Study id picker: single exam type as an equality (see header).
CREATE OR REPLACE FUNCTION public.get_study_question_ids(p_user_id uuid, p_mode text, p_exam_types text[], p_topics text[] DEFAULT NULL::text[], p_tags text[] DEFAULT NULL::text[], p_exam_dates text[] DEFAULT NULL::text[], p_exam_year text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_mcq_only boolean DEFAULT false, p_exclude_ids integer[] DEFAULT NULL::integer[], p_allowed_ids integer[] DEFAULT NULL::integer[], p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(question_id integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  -- One exam type (every learner request today): repeat it as a plain
  -- equality so the planner can read (exam_type, is_active, id) in id
  -- order instead of walking questions_pkey. NULL for 0 or 2+ types,
  -- which keeps the previous behaviour.
  v_single_exam text := CASE WHEN cardinality(p_exam_types) = 1 THEN p_exam_types[1] END;
BEGIN
  IF p_mode = 'unseen' THEN
    RETURN QUERY SELECT q.id
  FROM questions q
  WHERE q.is_active = true
    AND q.exam_type = ANY(p_exam_types)
    AND (v_single_exam IS NULL OR q.exam_type = v_single_exam)
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
    AND (v_single_exam IS NULL OR q.exam_type = v_single_exam)
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
    AND (v_single_exam IS NULL OR q.exam_type = v_single_exam)
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
$function$;

REVOKE ALL ON FUNCTION public.get_study_question_ids(
  uuid, text, text[], text[], text[], text[], text[], text, boolean, integer[], integer[], integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_question_ids(
  uuid, text, text[], text[], text[], text[], text[], text, boolean, integer[], integer[], integer, integer
) TO service_role;

RESET lock_timeout;
