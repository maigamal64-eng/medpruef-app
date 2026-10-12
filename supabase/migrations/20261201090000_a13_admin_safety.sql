-- a13 admin safety (ADM-06, ADM-19, ADM-21). track-A candidate, UNAPPLIED.
-- Production application needs [name]'s GO (pick-admin-schema-go,
-- pick-access-schema-go). Proven on a throwaway PostgreSQL 16 cluster by
-- `npm run test:db:a13`. Rollback: scripts/sql/track-a/a13-admin-safety/down.sql.
--
-- 1. admin_grant_entitlement: a dated grant never replaces permanent Pro
--    (tier='pro' with no expiry). Same signature and ACL; body otherwise as
--    20260928231024_admin_rbac.sql.
-- 2. find_duplicate_questions: server-side duplicate grouping over every
--    active question (the PostgREST 1000-row cap hid 232 of 235 groups).
--    Same key as the route: first 200 characters of the trimmed, lowercased
--    stem, stems shorter than 20 characters skipped. Read-only.
-- 3. admin_puyp_approve: one guarded transaction for single and bulk PUYP
--    approval. Never shortens the subscription or the learner's access,
--    keeps permanent Pro, checks owner/status/cap, writes the extension
--    record, the verification and the audit row in the same step.
--
-- Grants: every function is service_role only (Supabase 30 Oct explicit
-- grant rule); PUBLIC, anon and authenticated are revoked explicitly.

SET lock_timeout = '3s';

-- 1. Permanent-Pro guard ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_entitlement(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_days integer,
  p_reason text,
  p_audit_context jsonb DEFAULT '{}'::jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user record;
  v_actor_email text;
  v_new_expiry timestamptz;
BEGIN
  IF NOT public.admin_actor_has_permission(p_actor_id, 'users.entitlements.write') THEN
    RAISE EXCEPTION 'users.entitlements.write permission required' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Grant days must be between 1 and 365' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'A reason between 5 and 500 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, email, role, tier, tier_expires_at INTO v_user
  FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002'; END IF;
  IF v_user.role = 'admin' OR v_user.tier = 'admin' THEN
    RAISE EXCEPTION 'Admin accounts cannot be changed through learner entitlement grants' USING ERRCODE = '23514';
  END IF;
  -- a13: permanent Pro would become dated Pro (shorter access).
  IF v_user.tier = 'pro' AND v_user.tier_expires_at IS NULL THEN
    RAISE EXCEPTION 'Learner already has permanent Pro; a dated grant would shorten it' USING ERRCODE = '55000';
  END IF;

  v_new_expiry := greatest(coalesce(v_user.tier_expires_at, now()), now()) + make_interval(days => p_days);
  UPDATE public.users
  SET tier = 'pro', tier_expires_at = v_new_expiry, updated_at = now()
  WHERE id = p_target_user_id;

  SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor_id;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'grant_free_access', 'user', p_target_user_id,
    jsonb_build_object(
      'days', p_days,
      'reason', trim(p_reason),
      'new_expiry', v_new_expiry,
      'previous_expiry', v_user.tier_expires_at,
      'previous_tier', v_user.tier,
      'target_email', v_user.email
    ) || coalesce(p_audit_context, '{}'::jsonb));
  RETURN v_new_expiry;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_entitlement(uuid, uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_entitlement(uuid, uuid, integer, text, jsonb) TO service_role;

-- 2. Duplicate grouping -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_duplicate_questions(
  p_exam_type text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH keyed AS (
    SELECT q.id, q.topic, q.exam_type, q.exam_dates, q.anki_note_id,
      left(lower(regexp_replace(coalesce(q.question, ''), '^\s+|\s+$', '', 'g')), 200) AS k
    FROM public.questions q
    WHERE q.is_active
      AND (p_exam_type IS NULL OR q.exam_type = p_exam_type)
  ), grouped AS (
    SELECT k, count(*) AS n, min(id) AS first_id,
      jsonb_agg(jsonb_build_object(
        'id', id, 'topic', topic, 'exam_type', exam_type,
        'exam_dates', exam_dates, 'anki_note_id', anki_note_id
      ) ORDER BY id) AS questions
    FROM keyed
    WHERE length(k) >= 20
    GROUP BY k
    HAVING count(*) >= 2
  ), ranked AS (
    SELECT g.*, row_number() OVER (ORDER BY n DESC, first_id) AS position
    FROM grouped g
  )
  SELECT jsonb_build_object(
    'source', 'database',
    'examType', p_exam_type,
    'totalGroups', (SELECT count(*) FROM ranked),
    'totalExtraCopies', coalesce((SELECT sum(n - 1) FROM ranked), 0),
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'text', CASE WHEN length(k) > 100 THEN left(k, 100) || '...' ELSE k END,
        'count', n,
        'questions', questions
      ) ORDER BY position)
      FROM ranked
      WHERE position <= greatest(1, least(coalesce(p_limit, 50), 200))
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.find_duplicate_questions(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_duplicate_questions(text, integer) TO service_role;

-- 3. Guarded PUYP approval --------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_puyp_approve(
  p_actor_id uuid,
  p_attempt_id uuid,
  p_new_expires_at timestamptz,
  p_via text,
  p_max_extensions integer,
  p_audit_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempt record;
  v_sub record;
  v_user record;
  v_actor_email text;
  v_sub_expiry timestamptz;
  v_user_expiry timestamptz;
  v_user_action text;
  v_used integer;
BEGIN
  IF NOT public.admin_actor_has_permission(p_actor_id, 'revenue.manage') THEN
    RAISE EXCEPTION 'revenue.manage permission required' USING ERRCODE = '42501';
  END IF;
  IF p_via IS NULL OR p_via NOT IN ('single', 'bulk') THEN
    RAISE EXCEPTION 'via must be single or bulk' USING ERRCODE = '22023';
  END IF;
  IF p_max_extensions IS NULL OR p_max_extensions < 1 OR p_max_extensions > 10 THEN
    RAISE EXCEPTION 'Invalid extension cap' USING ERRCODE = '22023';
  END IF;
  IF p_new_expires_at IS NULL OR p_new_expires_at <= now() THEN
    RAISE EXCEPTION 'The new access end must be in the future' USING ERRCODE = '22023';
  END IF;

  SELECT id, user_id, subscription_id, exam_type, result, verified_at, rejection_reason
  INTO v_attempt
  FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002'; END IF;
  IF v_attempt.verified_at IS NOT NULL OR v_attempt.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'This attempt has already been decided' USING ERRCODE = '55000';
  END IF;
  IF v_attempt.result IS DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'Only failed attempts can be approved' USING ERRCODE = '55000';
  END IF;
  IF v_attempt.subscription_id IS NULL THEN
    RAISE EXCEPTION 'Attempt has no linked subscription' USING ERRCODE = '55000';
  END IF;

  SELECT id, user_id, status, expires_at, puyp_extensions_used
  INTO v_sub
  FROM public.subscriptions WHERE id = v_attempt.subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found' USING ERRCODE = 'P0002'; END IF;
  IF v_sub.user_id IS DISTINCT FROM v_attempt.user_id THEN
    RAISE EXCEPTION 'Subscription belongs to a different learner' USING ERRCODE = '23514';
  END IF;
  IF v_sub.status NOT IN ('active', 'expired') THEN
    RAISE EXCEPTION 'Subscription status % cannot be extended', v_sub.status USING ERRCODE = '55000';
  END IF;
  v_used := coalesce(v_sub.puyp_extensions_used, 0);
  IF v_used >= p_max_extensions THEN
    RAISE EXCEPTION 'Extension cap reached' USING ERRCODE = '55000';
  END IF;

  -- Never shorten the subscription.
  v_sub_expiry := greatest(p_new_expires_at, coalesce(v_sub.expires_at, p_new_expires_at));
  UPDATE public.subscriptions
  SET expires_at = v_sub_expiry,
      puyp_extensions_used = v_used + 1,
      status = 'active',
      updated_at = now()
  WHERE id = v_sub.id;

  SELECT id, role, tier, tier_expires_at INTO v_user
  FROM public.users WHERE id = v_attempt.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learner not found' USING ERRCODE = 'P0002'; END IF;
  IF v_user.role = 'admin' OR v_user.tier = 'admin' THEN
    v_user_action := 'kept_admin';
    v_user_expiry := v_user.tier_expires_at;
  ELSIF v_user.tier = 'pro' AND v_user.tier_expires_at IS NULL THEN
    v_user_action := 'kept_permanent';
    v_user_expiry := NULL;
  ELSE
    v_user_expiry := greatest(v_sub_expiry, coalesce(v_user.tier_expires_at, v_sub_expiry));
    v_user_action := CASE WHEN v_user_expiry > v_sub_expiry THEN 'kept_later' ELSE 'extended' END;
    UPDATE public.users
    SET tier = 'pro', tier_expires_at = v_user_expiry, updated_at = now()
    WHERE id = v_user.id;
  END IF;

  INSERT INTO public.subscription_extensions
    (subscription_id, user_id, source, attempt_id, previous_expires_at, new_expires_at, granted_by)
  VALUES (v_sub.id, v_attempt.user_id, 'puyp', v_attempt.id, v_sub.expires_at, v_sub_expiry, p_actor_id);

  UPDATE public.exam_attempts
  SET verified_at = now(), verified_by = p_actor_id
  WHERE id = v_attempt.id;

  SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor_id;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'approve_puyp', 'exam_attempt', v_attempt.id,
    jsonb_build_object(
      'via', p_via,
      'subscription_id', v_sub.id,
      'target_user_id', v_attempt.user_id,
      'exam_type', v_attempt.exam_type,
      'requested_expires_at', p_new_expires_at,
      'previous_expires_at', v_sub.expires_at,
      'new_expires_at', v_sub_expiry,
      'previous_user_expiry', v_user.tier_expires_at,
      'previous_user_tier', v_user.tier,
      'user_access', v_user_action,
      'extensions_used', v_used + 1
    ) || coalesce(p_audit_context, '{}'::jsonb));

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'user_id', v_attempt.user_id,
    'subscription_id', v_sub.id,
    'previous_expires_at', v_sub.expires_at,
    'new_expires_at', v_sub_expiry,
    'user_access', v_user_action,
    'user_expires_at', v_user_expiry,
    'extensions_used', v_used + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_puyp_approve(uuid, uuid, timestamptz, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_puyp_approve(uuid, uuid, timestamptz, text, integer, jsonb) TO service_role;

RESET lock_timeout;
