-- Admin RBAC foundation. Existing administrators are explicitly migrated
-- to the owner role; future admins get no membership or permissions by default.
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  permission_key text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE CHECK (role_key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_role_permissions (
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.admin_permissions(permission_key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS public.admin_user_roles (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS admin_user_roles_role_idx ON public.admin_user_roles(role_id);

INSERT INTO public.admin_permissions (permission_key, description) VALUES
  ('overview.read', 'View admin overview and work queue'),
  ('users.read', 'View learner accounts and activity'),
  ('users.write', 'Edit non-entitlement learner profile fields'),
  ('users.entitlements.write', 'Grant and reconcile learner entitlements'),
  ('users.sessions.write', 'Lock accounts and invalidate sessions'),
  ('users.sessions.read', 'View learner session and device details'),
  ('users.notes.read', 'View learner notes and note activity'),
  ('content.read', 'View question bank and learner reports'),
  ('content.moderate', 'Review and change reported learning content'),
  ('feedback.read', 'View learner feedback'),
  ('feedback.manage', 'Update feedback triage state'),
  ('revenue.read', 'View subscriptions, payments and referrals'),
  ('revenue.reconcile', 'Reconcile pending entitlements'),
  ('revenue.manage', 'Manage referrals and purchase-your-pass cases'),
  ('system.read', 'View operational health and audit records'),
  ('system.manage', 'Manage operational controls and integrations'),
  ('access.manage', 'Create roles and assign admin access')
ON CONFLICT (permission_key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO public.admin_roles (role_key, name, description, is_system)
VALUES ('owner', 'Owner', 'Full administrative access, including access management.', true)
ON CONFLICT (role_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = true,
  is_active = true;

INSERT INTO public.admin_role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM public.admin_roles r CROSS JOIN public.admin_permissions p
WHERE r.role_key = 'owner'
ON CONFLICT DO NOTHING;

-- Preserve access for every administrator that exists at migration time.
-- This does not grant access to admins added later by changing users.role.
INSERT INTO public.admin_user_roles (user_id, role_id)
SELECT u.id, r.id
FROM public.users u
CROSS JOIN public.admin_roles r
WHERE u.role = 'admin' AND r.role_key = 'owner'
ON CONFLICT DO NOTHING;

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_permissions_deny_client ON public.admin_permissions;
CREATE POLICY admin_permissions_deny_client ON public.admin_permissions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS admin_roles_deny_client ON public.admin_roles;
CREATE POLICY admin_roles_deny_client ON public.admin_roles FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS admin_role_permissions_deny_client ON public.admin_role_permissions;
CREATE POLICY admin_role_permissions_deny_client ON public.admin_role_permissions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS admin_user_roles_deny_client ON public.admin_user_roles;
CREATE POLICY admin_user_roles_deny_client ON public.admin_user_roles FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.admin_actor_has_permission(p_actor_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.admin_user_roles ur ON ur.user_id = u.id
    JOIN public.admin_roles r ON r.id = ur.role_id AND r.is_active
    JOIN public.admin_role_permissions rp ON rp.role_id = r.id
    WHERE u.id = p_actor_id AND u.role = 'admin'
      AND rp.permission_key = p_permission_key
  );
$$;

REVOKE ALL ON FUNCTION public.admin_actor_has_permission(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_actor_has_permission(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_user_directory(
  p_q text DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_auth text DEFAULT NULL,
  p_sort text DEFAULT 'last_active',
  p_order text DEFAULT 'desc',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb;
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

  WITH directory AS (
    SELECT
      u.id,
      u.telegram_id,
      u.email,
      u.first_name,
      u.last_name,
      u.telegram_username,
      u.photo_url,
      u.role,
      u.tier,
      u.created_at,
      u.updated_at,
      g.total_xp,
      g.current_streak,
      g.total_questions_answered,
      g.total_correct,
      g.daily_questions_today,
      g.last_study_date,
      ev.last_event_at,
      ah.answer_count,
      ah.correct_count
    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT ug.total_xp, ug.current_streak, ug.total_questions_answered,
        ug.total_correct, ug.daily_questions_today, ug.last_study_date
      FROM public.user_gamification ug
      WHERE ug.user_id = u.id
      LIMIT 1
    ) g ON true
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS last_event_at
      FROM public.user_events e
      WHERE e.user_id = u.id::text
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS answer_count, count(*) FILTER (WHERE a.is_correct) AS correct_count
      FROM public.answer_history a
      WHERE a.user_id = u.id
    ) ah ON true
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
      coalesce(d.last_event_at, d.updated_at, d.created_at) AS last_active,
      CASE WHEN coalesce(d.last_event_at, d.updated_at, d.created_at) >= now() - interval '1 day' THEN 'active'
        WHEN coalesce(d.last_event_at, d.updated_at, d.created_at) >= now() - interval '7 days' THEN 'recent'
        ELSE 'inactive' END AS status
    FROM directory d
  ), ordered AS (
    SELECT e.*, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'name' AND p_order = 'asc' THEN lower(coalesce(concat_ws(' ', e.first_name, e.last_name), e.email, e.telegram_username, '')) END ASC NULLS LAST,
      CASE WHEN p_sort = 'name' AND p_order = 'desc' THEN lower(coalesce(concat_ws(' ', e.first_name, e.last_name), e.email, e.telegram_username, '')) END DESC NULLS LAST,
      CASE WHEN p_sort = 'role' AND p_order = 'asc' THEN e.role END ASC NULLS LAST,
      CASE WHEN p_sort = 'role' AND p_order = 'desc' THEN e.role END DESC NULLS LAST,
      CASE WHEN p_sort = 'tier' AND p_order = 'asc' THEN e.tier END ASC NULLS LAST,
      CASE WHEN p_sort = 'tier' AND p_order = 'desc' THEN e.tier END DESC NULLS LAST,
      CASE WHEN p_sort = 'status' AND p_order = 'asc' THEN CASE e.status WHEN 'active' THEN 1 WHEN 'recent' THEN 2 ELSE 3 END END ASC,
      CASE WHEN p_sort = 'status' AND p_order = 'desc' THEN CASE e.status WHEN 'active' THEN 1 WHEN 'recent' THEN 2 ELSE 3 END END DESC,
      CASE WHEN p_sort = 'xp' AND p_order = 'asc' THEN coalesce(e.total_xp, 0) END ASC NULLS LAST,
      CASE WHEN p_sort = 'xp' AND p_order = 'desc' THEN coalesce(e.total_xp, 0) END DESC NULLS LAST,
      CASE WHEN p_sort = 'streak' AND p_order = 'asc' THEN coalesce(e.current_streak, 0) END ASC NULLS LAST,
      CASE WHEN p_sort = 'streak' AND p_order = 'desc' THEN coalesce(e.current_streak, 0) END DESC NULLS LAST,
      CASE WHEN p_sort = 'questions_answered' AND p_order = 'asc' THEN e.questions_answered END ASC NULLS LAST,
      CASE WHEN p_sort = 'questions_answered' AND p_order = 'desc' THEN e.questions_answered END DESC NULLS LAST,
      CASE WHEN p_sort = 'accuracy' AND p_order = 'asc' THEN e.accuracy END ASC NULLS LAST,
      CASE WHEN p_sort = 'accuracy' AND p_order = 'desc' THEN e.accuracy END DESC NULLS LAST,
      CASE WHEN p_sort = 'last_active' AND p_order = 'asc' THEN e.last_active END ASC NULLS LAST,
      CASE WHEN p_sort = 'last_active' AND p_order = 'desc' THEN e.last_active END DESC NULLS LAST,
      CASE WHEN p_sort = 'created_at' AND p_order = 'asc' THEN e.created_at END ASC NULLS LAST,
      CASE WHEN p_sort = 'created_at' AND p_order = 'desc' THEN e.created_at END DESC NULLS LAST,
      e.id
    ) AS sort_position
    FROM enriched e
  ), page AS (
    SELECT * FROM ordered
    WHERE sort_position > p_offset AND sort_position <= p_offset + p_limit
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM enriched),
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
      'last_active', p.last_active
    ) ORDER BY p.sort_position) FROM page p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_directory(text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_directory(text, text, text, text, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_role(
  p_actor_id uuid,
  p_role_key text,
  p_name text,
  p_description text,
  p_permissions text[],
  p_audit_context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role_id uuid;
  v_actor_email text;
  v_permission_count integer;
  v_actor_is_owner boolean;
  v_actor_permissions text[];
BEGIN
  IF NOT public.admin_actor_has_permission(p_actor_id, 'access.manage') THEN
    RAISE EXCEPTION 'access.manage permission required' USING ERRCODE = '42501';
  END IF;
  IF p_role_key = 'owner' OR p_role_key !~ '^[a-z][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'Invalid or reserved role key' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 2 OR length(p_name) > 80 THEN
    RAISE EXCEPTION 'Role name must be between 2 and 80 characters' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_permissions), 0) = 0 THEN
    RAISE EXCEPTION 'At least one permission must be explicitly granted' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT permission_key) INTO v_permission_count
  FROM public.admin_permissions
  WHERE permission_key = ANY(p_permissions);
  IF v_permission_count <> cardinality(p_permissions) THEN
    RAISE EXCEPTION 'Unknown or duplicate permission key' USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_actor_id AND r.role_key = 'owner'
  ) INTO v_actor_is_owner;
  SELECT coalesce(array_agg(DISTINCT rp.permission_key), ARRAY[]::text[]) INTO v_actor_permissions
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id AND r.is_active
  JOIN public.admin_role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = p_actor_id;
  IF NOT v_actor_is_owner AND (
    'access.manage' = ANY(p_permissions) OR NOT p_permissions <@ v_actor_permissions
  ) THEN
    RAISE EXCEPTION 'Role grants exceed the actor permission subset' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.admin_roles (role_key, name, description, is_system)
  VALUES (p_role_key, trim(p_name), coalesce(p_description, ''), false)
  RETURNING id INTO v_role_id;
  INSERT INTO public.admin_role_permissions (role_id, permission_key)
  SELECT v_role_id, unnest(p_permissions);

  SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor_id;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, payload)
  VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'create_admin_role', 'admin_role',
    jsonb_build_object('role_key', p_role_key, 'permissions', to_jsonb(p_permissions)) || coalesce(p_audit_context, '{}'::jsonb));
  RETURN v_role_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_role(
  p_actor_id uuid,
  p_role_key text,
  p_name text,
  p_description text,
  p_permissions text[],
  p_audit_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role_id uuid;
  v_is_system boolean;
  v_actor_is_owner boolean;
  v_actor_email text;
  v_actor_permissions text[];
  v_permission_count integer;
BEGIN
  IF NOT public.admin_actor_has_permission(p_actor_id, 'access.manage') THEN
    RAISE EXCEPTION 'access.manage permission required' USING ERRCODE = '42501';
  END IF;
  IF p_role_key = 'owner' THEN
    RAISE EXCEPTION 'The owner system role is reserved and cannot be edited' USING ERRCODE = '42501';
  END IF;
  SELECT id, is_system INTO v_role_id, v_is_system
  FROM public.admin_roles WHERE role_key = p_role_key AND is_active;
  IF v_role_id IS NULL THEN RAISE EXCEPTION 'Role not found' USING ERRCODE = 'P0002'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_actor_id AND r.role_key = 'owner'
  ) INTO v_actor_is_owner;
  IF v_is_system AND NOT v_actor_is_owner THEN
    RAISE EXCEPTION 'Only an owner may change a system role' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 2 OR length(p_name) > 80 OR coalesce(cardinality(p_permissions), 0) = 0 THEN
    RAISE EXCEPTION 'Invalid role name or empty permission set' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT permission_key) INTO v_permission_count
  FROM public.admin_permissions WHERE permission_key = ANY(p_permissions);
  IF v_permission_count <> cardinality(p_permissions) THEN
    RAISE EXCEPTION 'Unknown or duplicate permission key' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT rp.permission_key), ARRAY[]::text[]) INTO v_actor_permissions
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id AND r.is_active
  JOIN public.admin_role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = p_actor_id;
  IF NOT v_actor_is_owner AND (
    'access.manage' = ANY(p_permissions) OR NOT p_permissions <@ v_actor_permissions
  ) THEN
    RAISE EXCEPTION 'Role grants exceed the actor permission subset' USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_roles SET name = trim(p_name), description = coalesce(p_description, ''), updated_at = now()
  WHERE id = v_role_id;
  DELETE FROM public.admin_role_permissions WHERE role_id = v_role_id;
  INSERT INTO public.admin_role_permissions (role_id, permission_key)
  SELECT v_role_id, unnest(p_permissions);
  SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor_id;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, payload)
  VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'update_admin_role', 'admin_role',
    jsonb_build_object('role_key', p_role_key, 'permissions', to_jsonb(p_permissions)) || coalesce(p_audit_context, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_membership(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_role_keys text[],
  p_audit_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_email text;
  v_actor_is_owner boolean;
  v_target_has_owner boolean;
  v_wants_owner boolean;
  v_old_roles text[];
  v_new_roles text[];
  v_unknown_count integer;
  v_actor_permissions text[];
  v_assignment_permissions text[];
BEGIN
  IF NOT public.admin_actor_has_permission(p_actor_id, 'access.manage') THEN
    RAISE EXCEPTION 'access.manage permission required' USING ERRCODE = '42501';
  END IF;
  -- Serialize membership mutations so two concurrent owner removals cannot
  -- both observe the other owner and leave the system without an owner.
  PERFORM pg_advisory_xact_lock(90572614, 1);
  IF p_target_user_id IS NULL OR p_actor_id = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot edit the acting account through membership management' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_actor_id AND r.role_key = 'owner'
  ) INTO v_actor_is_owner;
  SELECT EXISTS (
    SELECT 1 FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_target_user_id AND r.role_key = 'owner'
  ) INTO v_target_has_owner;
  v_wants_owner := 'owner' = ANY(coalesce(p_role_keys, ARRAY[]::text[]));
  IF (v_target_has_owner OR v_wants_owner) AND NOT v_actor_is_owner THEN
    RAISE EXCEPTION 'Only an owner may assign or remove owner access' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id = p_target_user_id AND v_actor_is_owner AND NOT v_wants_owner THEN
    RAISE EXCEPTION 'An owner cannot remove their own owner access' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(r.role_key ORDER BY r.role_key), ARRAY[]::text[]) INTO v_old_roles
  FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_target_user_id;
  SELECT count(DISTINCT role_key) INTO v_unknown_count
  FROM public.admin_roles
  WHERE role_key = ANY(coalesce(p_role_keys, ARRAY[]::text[])) AND is_active;
  IF v_unknown_count <> cardinality(coalesce(p_role_keys, ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'Unknown, inactive, or duplicate role key' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT rp.permission_key), ARRAY[]::text[]) INTO v_actor_permissions
  FROM public.admin_user_roles ur
  JOIN public.admin_roles r ON r.id = ur.role_id AND r.is_active
  JOIN public.admin_role_permissions rp ON rp.role_id = r.id
  WHERE ur.user_id = p_actor_id;
  SELECT coalesce(array_agg(DISTINCT rp.permission_key), ARRAY[]::text[]) INTO v_assignment_permissions
  FROM public.admin_roles r
  JOIN public.admin_role_permissions rp ON rp.role_id = r.id
  WHERE r.role_key = ANY(coalesce(p_role_keys, ARRAY[]::text[])) AND r.is_active;
  IF NOT v_actor_is_owner AND (
    'access.manage' = ANY(v_assignment_permissions) OR NOT v_assignment_permissions <@ v_actor_permissions
  ) THEN
    RAISE EXCEPTION 'Assigned roles exceed the actor permission subset' USING ERRCODE = '42501';
  END IF;

  IF v_target_has_owner AND NOT v_wants_owner AND NOT EXISTS (
    SELECT 1
    FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id = ur.role_id
    WHERE r.role_key = 'owner' AND ur.user_id <> p_target_user_id
  ) THEN
    RAISE EXCEPTION 'At least one owner must remain assigned' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.admin_user_roles WHERE user_id = p_target_user_id;
  INSERT INTO public.admin_user_roles (user_id, role_id, assigned_by)
  SELECT p_target_user_id, r.id, p_actor_id
  FROM public.admin_roles r
  WHERE r.role_key = ANY(coalesce(p_role_keys, ARRAY[]::text[])) AND r.is_active;
  UPDATE public.users SET role = CASE WHEN cardinality(coalesce(p_role_keys, ARRAY[]::text[])) > 0 THEN 'admin' ELSE 'user' END,
    updated_at = now()
  WHERE id = p_target_user_id;

  SELECT coalesce(array_agg(role_key ORDER BY role_key), ARRAY[]::text[]) INTO v_new_roles
  FROM unnest(coalesce(p_role_keys, ARRAY[]::text[])) AS role_key;
  SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor_id;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'update_admin_membership', 'user', p_target_user_id,
    jsonb_build_object('previous_roles', to_jsonb(v_old_roles), 'new_roles', to_jsonb(v_new_roles)) || coalesce(p_audit_context, '{}'::jsonb));
END;
$$;

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

REVOKE ALL ON FUNCTION public.admin_create_role(uuid, text, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_role(uuid, text, text, text, text[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_membership(uuid, uuid, text[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_entitlement(uuid, uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_role(uuid, text, text, text, text[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_role(uuid, text, text, text, text[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_membership(uuid, uuid, text[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_entitlement(uuid, uuid, integer, text, jsonb) TO service_role;

-- The application no longer exposes the arbitrary SQL runner. Removing the
-- service_role EXECUTE grant closes direct invocation of the old RPC too.
REVOKE ALL ON FUNCTION public.admin_exec_select(text) FROM PUBLIC, anon, authenticated, service_role;
