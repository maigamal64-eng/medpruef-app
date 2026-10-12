-- a16 admin people (ADM-07 A, ADM-15 A, UX-ADM-19). track-A candidate, UNAPPLIED.
-- Production application needs the admin schema GO (pick-admin-schema-go A).
-- Proven on a throwaway PostgreSQL 16 cluster by `npm run test:db:a16`.
-- Rollback: scripts/sql/track-a/a16-admin-people/down.sql.
--
-- Additive only: three new read functions, service-role only. Nothing is
-- dropped or rewritten; admin_user_directory (v1) stays for the app until
-- this changeset is applied, the route falls back to it.
--
-- 1. admin_user_directory_v2: the Users list with
--    - last_active = latest answer, learner event or session start. Never
--      users.updated_at (the 7 Sep 2026 bulk update stamped 133 of 181
--      learners) and never events written by webhooks, crons or admins. The
--      event list mirrors src/lib/admin/learner-activity.ts; a unit test
--      keeps them equal. Learners with no activity sort last, status 'none'.
--    - p_segment: never_answered, onboarding_incomplete, no_exam_date,
--      pro_inactive_7d, exam_30d. Segments list learners only (role admin
--      excluded). Dates are Vienna calendar days.
-- 2. admin_user_segment_counts: one count per segment, same predicates.
-- 3. admin_ops_decisions: Ops approvals, rejections and executions for the
--    audit page and the learner Admin history (ops_audit is not readable by
--    service_role by design, so this is a named definer function that
--    re-checks the actor's admin permission).

SET lock_timeout = '3s';

-- Shared predicate ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_is_learner_event(p_event_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_event_type IS NOT NULL AND btrim(p_event_type) <> ''
    AND p_event_type NOT IN (
      'trial_expired', 'puyp_extension_granted', 'puyp_attempt_rejected', 'referral_reward',
      'referral_first_qualify_email_sent', 'referral_qualify_insert',
      'referral_qualify_update', 'referral_qualify_unexpected',
      'referral_reverse_update', 'referral_reverse_unexpected')
    AND NOT starts_with(p_event_type, 'whop_')
    AND NOT starts_with(p_event_type, 'nowpayments_')
    AND NOT starts_with(p_event_type, 'cron_')
    AND NOT starts_with(p_event_type, 'subscription_')
    AND NOT starts_with(p_event_type, 'trial_reminder')
    AND NOT starts_with(p_event_type, 'trial_precharge');
$$;

REVOKE ALL ON FUNCTION public.admin_is_learner_event(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_is_learner_event(text) TO service_role;

-- 1. Directory v2 ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_directory_v2(
  p_q text DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_auth text DEFAULT NULL,
  p_segment text DEFAULT NULL,
  p_sort text DEFAULT 'last_active',
  p_order text DEFAULT 'desc',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_today date := (now() AT TIME ZONE 'Europe/Vienna')::date;
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid pagination' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_sort, 'last_active') NOT IN ('name', 'role', 'tier', 'status', 'xp', 'streak', 'questions_answered', 'accuracy', 'last_active', 'created_at') THEN
    RAISE EXCEPTION 'Invalid sort key' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_order, 'desc') NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Invalid sort order' USING ERRCODE = '22023';
  END IF;
  IF p_segment IS NOT NULL AND p_segment NOT IN ('all', 'never_answered', 'onboarding_incomplete', 'no_exam_date', 'pro_inactive_7d', 'exam_30d') THEN
    RAISE EXCEPTION 'Invalid segment' USING ERRCODE = '22023';
  END IF;

  WITH directory AS (
    SELECT
      u.id, u.telegram_id, u.email, u.first_name, u.last_name, u.telegram_username,
      u.photo_url, u.role, u.tier, u.tier_expires_at, u.exam_date,
      u.onboarding_completed_at, u.onboarding_skipped_at, u.created_at,
      g.total_xp, g.current_streak, g.total_questions_answered, g.total_correct,
      g.daily_questions_today, g.last_study_date,
      ah.answer_count, ah.correct_count, ah.last_answer_at,
      ev.last_event_at, se.last_session_at
    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT ug.total_xp, ug.current_streak, ug.total_questions_answered,
        ug.total_correct, ug.daily_questions_today, ug.last_study_date
      FROM public.user_gamification ug WHERE ug.user_id = u.id LIMIT 1
    ) g ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS answer_count, count(*) FILTER (WHERE a.is_correct) AS correct_count,
        max(a.created_at) AS last_answer_at
      FROM public.answer_history a WHERE a.user_id = u.id
    ) ah ON true
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS last_event_at
      FROM public.user_events e
      WHERE e.user_id = u.id::text AND public.admin_is_learner_event(e.event_type)
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT max(s.started_at) AS last_session_at
      FROM public.user_sessions s WHERE s.user_id = u.id::text
    ) se ON true
    WHERE (p_tier IS NULL OR p_tier = 'all' OR u.tier = p_tier)
      AND (p_auth IS NULL OR p_auth = 'all'
        OR (p_auth = 'email' AND u.email IS NOT NULL)
        OR (p_auth = 'telegram' AND u.telegram_id IS NOT NULL))
      AND (p_q IS NULL OR trim(p_q) = '' OR concat_ws(' ', u.email, u.first_name, u.last_name, u.telegram_username) ILIKE '%' || p_q || '%' OR u.id::text ILIKE '%' || p_q || '%')
  ), enriched AS (
    SELECT
      d.*,
      coalesce(nullif(d.total_questions_answered, 0), d.answer_count, 0)::bigint AS questions_answered,
      CASE WHEN coalesce(nullif(d.total_questions_answered, 0), d.answer_count, 0) > 0
        THEN round(100.0 * coalesce(nullif(d.total_correct, 0), d.correct_count, 0) /
          coalesce(nullif(d.total_questions_answered, 0), d.answer_count, 0))::integer
        ELSE 0 END AS accuracy,
      greatest(d.last_answer_at, d.last_event_at, d.last_session_at) AS last_active
    FROM directory d
  ), classified AS (
    SELECT e.*,
      CASE WHEN e.last_active IS NULL THEN 'none'
        WHEN e.last_active >= now() - interval '1 day' THEN 'active'
        WHEN e.last_active >= now() - interval '7 days' THEN 'recent'
        ELSE 'inactive' END AS status
    FROM enriched e
  ), segmented AS (
    SELECT c.* FROM classified c
    WHERE p_segment IS NULL OR p_segment = 'all' OR (
      coalesce(c.role, 'user') <> 'admin' AND (
        (p_segment = 'never_answered' AND c.questions_answered = 0)
        OR (p_segment = 'onboarding_incomplete' AND c.onboarding_completed_at IS NULL AND c.onboarding_skipped_at IS NULL)
        OR (p_segment = 'no_exam_date' AND c.exam_date IS NULL)
        OR (p_segment = 'pro_inactive_7d' AND c.tier = 'pro'
            AND (c.tier_expires_at IS NULL OR c.tier_expires_at > now())
            AND (c.last_active IS NULL OR c.last_active < now() - interval '7 days'))
        OR (p_segment = 'exam_30d' AND c.exam_date BETWEEN v_today AND v_today + 30)
      ))
  ), ordered AS (
    SELECT s.*, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'name' AND p_order = 'asc' THEN lower(coalesce(nullif(concat_ws(' ', s.first_name, s.last_name), ''), s.email, s.telegram_username, '')) END ASC NULLS LAST,
      CASE WHEN p_sort = 'name' AND p_order = 'desc' THEN lower(coalesce(nullif(concat_ws(' ', s.first_name, s.last_name), ''), s.email, s.telegram_username, '')) END DESC NULLS LAST,
      CASE WHEN p_sort = 'role' AND p_order = 'asc' THEN s.role END ASC NULLS LAST,
      CASE WHEN p_sort = 'role' AND p_order = 'desc' THEN s.role END DESC NULLS LAST,
      CASE WHEN p_sort = 'tier' AND p_order = 'asc' THEN s.tier END ASC NULLS LAST,
      CASE WHEN p_sort = 'tier' AND p_order = 'desc' THEN s.tier END DESC NULLS LAST,
      CASE WHEN p_sort = 'status' AND p_order = 'asc' THEN CASE s.status WHEN 'active' THEN 1 WHEN 'recent' THEN 2 WHEN 'inactive' THEN 3 ELSE 4 END END ASC,
      CASE WHEN p_sort = 'status' AND p_order = 'desc' THEN CASE s.status WHEN 'active' THEN 1 WHEN 'recent' THEN 2 WHEN 'inactive' THEN 3 ELSE 4 END END DESC,
      CASE WHEN p_sort = 'xp' AND p_order = 'asc' THEN coalesce(s.total_xp, 0) END ASC NULLS LAST,
      CASE WHEN p_sort = 'xp' AND p_order = 'desc' THEN coalesce(s.total_xp, 0) END DESC NULLS LAST,
      CASE WHEN p_sort = 'streak' AND p_order = 'asc' THEN coalesce(s.current_streak, 0) END ASC NULLS LAST,
      CASE WHEN p_sort = 'streak' AND p_order = 'desc' THEN coalesce(s.current_streak, 0) END DESC NULLS LAST,
      CASE WHEN p_sort = 'questions_answered' AND p_order = 'asc' THEN s.questions_answered END ASC NULLS LAST,
      CASE WHEN p_sort = 'questions_answered' AND p_order = 'desc' THEN s.questions_answered END DESC NULLS LAST,
      CASE WHEN p_sort = 'accuracy' AND p_order = 'asc' THEN s.accuracy END ASC NULLS LAST,
      CASE WHEN p_sort = 'accuracy' AND p_order = 'desc' THEN s.accuracy END DESC NULLS LAST,
      CASE WHEN p_sort = 'last_active' AND p_order = 'asc' THEN s.last_active END ASC NULLS LAST,
      CASE WHEN p_sort = 'last_active' AND p_order = 'desc' THEN s.last_active END DESC NULLS LAST,
      CASE WHEN p_sort = 'created_at' AND p_order = 'asc' THEN s.created_at END ASC NULLS LAST,
      CASE WHEN p_sort = 'created_at' AND p_order = 'desc' THEN s.created_at END DESC NULLS LAST,
      s.id
    ) AS sort_position
    FROM segmented s
  ), page AS (
    SELECT * FROM ordered
    WHERE sort_position > p_offset AND sort_position <= p_offset + p_limit
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM segmented),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'telegram_id', p.telegram_id,
      'email', p.email,
      'name', coalesce(nullif(concat_ws(' ', p.first_name, p.last_name), ''), p.telegram_username, p.email, 'Anonymous'),
      'first_name', p.first_name,
      'last_name', p.last_name,
      'username', p.telegram_username,
      'photo_url', p.photo_url,
      'role', coalesce(p.role, 'user'),
      'tier', coalesce(p.tier, 'free'),
      'status', p.status,
      'created_at', p.created_at,
      'xp', coalesce(p.total_xp, 0),
      'streak', coalesce(p.current_streak, 0),
      'questions_answered', p.questions_answered,
      'accuracy', p.accuracy,
      'daily_today', coalesce(p.daily_questions_today, 0),
      'last_study', p.last_study_date,
      'last_active', p.last_active,
      'exam_date', p.exam_date
    ) ORDER BY p.sort_position) FROM page p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_directory_v2(text, text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_directory_v2(text, text, text, text, text, text, integer, integer) TO service_role;

-- 2. Segment counts --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_segment_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH learners AS (
    SELECT u.id, u.tier, u.tier_expires_at, u.exam_date,
      u.onboarding_completed_at, u.onboarding_skipped_at,
      coalesce(nullif(g.total_questions_answered, 0), ah.answer_count, 0) AS answered,
      greatest(ah.last_answer_at, ev.last_event_at, se.last_session_at) AS last_active
    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT ug.total_questions_answered FROM public.user_gamification ug WHERE ug.user_id = u.id LIMIT 1
    ) g ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS answer_count, max(a.created_at) AS last_answer_at
      FROM public.answer_history a WHERE a.user_id = u.id
    ) ah ON true
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS last_event_at FROM public.user_events e
      WHERE u.tier = 'pro' AND e.user_id = u.id::text AND public.admin_is_learner_event(e.event_type)
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT max(s.started_at) AS last_session_at FROM public.user_sessions s
      WHERE u.tier = 'pro' AND s.user_id = u.id::text
    ) se ON true
    WHERE coalesce(u.role, 'user') <> 'admin'
  ), today AS (SELECT (now() AT TIME ZONE 'Europe/Vienna')::date AS d)
  SELECT jsonb_build_object(
    'learners', count(*),
    'never_answered', count(*) FILTER (WHERE answered = 0),
    'onboarding_incomplete', count(*) FILTER (WHERE onboarding_completed_at IS NULL AND onboarding_skipped_at IS NULL),
    'no_exam_date', count(*) FILTER (WHERE exam_date IS NULL),
    'pro_inactive_7d', count(*) FILTER (WHERE tier = 'pro'
      AND (tier_expires_at IS NULL OR tier_expires_at > now())
      AND (last_active IS NULL OR last_active < now() - interval '7 days')),
    'exam_30d', count(*) FILTER (WHERE exam_date BETWEEN (SELECT d FROM today) AND (SELECT d FROM today) + 30)
  )
  FROM learners;
$$;

REVOKE ALL ON FUNCTION public.admin_user_segment_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_segment_counts() TO service_role;

-- 3. Ops decisions ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ops_decisions(
  p_actor_id uuid,
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- The full feed is a system read; one learner's history is a users read.
  IF NOT public.admin_actor_has_permission(p_actor_id, CASE WHEN p_user_id IS NULL THEN 'system.read' ELSE 'users.read' END) THEN
    RAISE EXCEPTION 'Admin permission required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid limit' USING ERRCODE = '22023';
  END IF;

  WITH decisions AS (
    SELECT oa.id, oa.created_at, oa.event, oa.actor_id, act.operation, act.status,
      act.payload, pr.name AS principal_name, u.email AS actor_email
    FROM public.ops_audit oa
    JOIN public.ops_actions act ON act.id = oa.action_id
    LEFT JOIN public.ops_principals pr ON pr.id = act.principal_id
    LEFT JOIN public.users u ON u.id = oa.actor_id
    WHERE oa.event IN ('action.approved', 'action.rejected', 'action.succeeded')
      AND (p_user_id IS NULL OR act.payload->>'user_id' = p_user_id::text)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM decisions WHERE p_before IS NULL OR created_at < p_before),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', d.id,
      'at', d.created_at,
      'event', d.event,
      'operation', d.operation,
      'status', d.status,
      'actor_email', d.actor_email,
      'principal', d.principal_name,
      'user_id', d.payload->>'user_id',
      'feedback_id', d.payload->>'feedback_id',
      'days', d.payload->>'days',
      'decision', coalesce(d.payload->>'status', d.payload->>'decision'),
      'reason', left(d.payload->>'reason', 500)
    ) ORDER BY d.created_at DESC, d.id DESC)
    FROM (SELECT * FROM decisions
          WHERE p_before IS NULL OR created_at < p_before
          ORDER BY created_at DESC, id DESC LIMIT p_limit) d), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ops_decisions(uuid, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ops_decisions(uuid, uuid, integer, timestamptz) TO service_role;
