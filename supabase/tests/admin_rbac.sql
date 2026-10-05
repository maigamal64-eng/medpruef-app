-- Run with `supabase test db` against a disposable local database.
-- Fixtures are rolled back. This never targets production data.
BEGIN;

DO $$
DECLARE
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_manager uuid := '22222222-2222-4222-8222-222222222222';
  v_target uuid := '33333333-3333-4333-8333-333333333333';
  v_support_role uuid;
  v_manager_role uuid;
  v_revenue_role uuid;
  v_created_role uuid;
  v_manager_created_role uuid;
  v_owner_access_role uuid;
  v_denied boolean;
BEGIN
  IF has_function_privilege('service_role', 'public.admin_exec_select(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'legacy arbitrary SQL RPC is still executable by service_role';
  END IF;
  IF has_function_privilege('authenticated', 'public.admin_exec_select(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'legacy arbitrary SQL RPC is still executable by authenticated users';
  END IF;

  INSERT INTO public.users (id, email, role) VALUES
    (v_owner, 'rbac-owner-test@invalid.local', 'admin'),
    (v_manager, 'rbac-manager-test@invalid.local', 'admin'),
    (v_target, 'rbac-target-test@invalid.local', 'user')
  ON CONFLICT (id) DO NOTHING;
  IF public.admin_actor_has_permission(v_target, 'users.read') THEN
    RAISE EXCEPTION 'new user unexpectedly has admin permissions before membership assignment';
  END IF;
  UPDATE public.users SET role = 'admin' WHERE id = v_target;
  IF public.admin_actor_has_permission(v_target, 'users.read') THEN
    RAISE EXCEPTION 'changing the legacy users.role bit must not grant admin permissions';
  END IF;
  UPDATE public.users SET role = 'user' WHERE id = v_target;

  -- Owner membership represents the migration's explicit legacy-admin grant.
  INSERT INTO public.admin_user_roles (user_id, role_id)
    SELECT v_owner, id FROM public.admin_roles WHERE role_key = 'owner'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.admin_roles (role_key, name, is_system)
    VALUES ('rbac-support-test', 'RBAC support fixture', false)
    ON CONFLICT (role_key) DO UPDATE SET is_active = true
    RETURNING id INTO v_support_role;
  INSERT INTO public.admin_role_permissions (role_id, permission_key)
    VALUES (v_support_role, 'users.read') ON CONFLICT DO NOTHING;

  INSERT INTO public.admin_roles (role_key, name, is_system)
    VALUES ('rbac-manager-test', 'RBAC access manager fixture', false)
    ON CONFLICT (role_key) DO UPDATE SET is_active = true
    RETURNING id INTO v_manager_role;
  INSERT INTO public.admin_role_permissions (role_id, permission_key)
    VALUES (v_manager_role, 'access.manage'), (v_manager_role, 'users.read')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.admin_user_roles (user_id, role_id) VALUES (v_manager, v_manager_role)
    ON CONFLICT DO NOTHING;

  INSERT INTO public.admin_roles (role_key, name, is_system)
    VALUES ('rbac-revenue-test', 'RBAC revenue fixture', false)
    ON CONFLICT (role_key) DO UPDATE SET is_active = true
    RETURNING id INTO v_revenue_role;
  INSERT INTO public.admin_role_permissions (role_id, permission_key)
    VALUES (v_revenue_role, 'users.read'), (v_revenue_role, 'revenue.manage')
    ON CONFLICT DO NOTHING;

  IF NOT public.admin_actor_has_permission(v_owner, 'access.manage') THEN
    RAISE EXCEPTION 'owner must retain access.manage';
  END IF;
  IF public.admin_actor_has_permission(v_manager, 'revenue.manage') THEN
    RAISE EXCEPTION 'custom access manager must not inherit ungranted permissions';
  END IF;

  -- A manager may grant a permission they hold, but not escalate beyond it.
  v_created_role := public.admin_create_role(v_manager, 'rbac-limited-test', 'Limited fixture', '', ARRAY['users.read']::text[]);
  v_denied := false;
  BEGIN
    PERFORM public.admin_create_role(v_manager, 'rbac-escalate-test', 'Escalation fixture', '', ARRAY['access.manage']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly granted access.manage'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_create_role(v_manager, 'rbac-revenue-escalate-test', 'Revenue escalation fixture', '', ARRAY['revenue.manage']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly granted a permission they do not hold'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_create_role(v_manager, 'rbac-access-escalate-test', 'Access escalation fixture', '', ARRAY['access.manage', 'users.read']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly combined access.manage with another permission'; END IF;
  v_manager_created_role := public.admin_create_role(v_manager, 'rbac-manager-created-test', 'Manager created fixture', '', ARRAY['users.read']::text[]);
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_role(v_manager, 'rbac-manager-created-test', 'Escalated fixture', '', ARRAY['revenue.manage']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly edited a role beyond their held permission subset'; END IF;
  v_owner_access_role := public.admin_create_role(v_owner, 'rbac-owner-managed-test', 'Owner managed fixture', '', ARRAY['access.manage', 'revenue.manage']::text[]);
  IF v_owner_access_role IS NULL THEN RAISE EXCEPTION 'owner could not explicitly grant access.manage'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_role(v_manager, 'owner', 'Replaced owner', '', ARRAY['users.read']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly edited the owner system role'; END IF;

  -- Membership assignment is constrained by the actor's held permission set.
  PERFORM public.admin_update_membership(v_manager, v_target, ARRAY['rbac-support-test']::text[]);
  IF NOT public.admin_actor_has_permission(v_target, 'users.read') THEN
    RAISE EXCEPTION 'explicit custom role assignment did not enable its grant';
  END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_membership(v_manager, v_target, ARRAY['rbac-revenue-test']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly assigned a role with unheld permissions'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_membership(v_manager, v_owner, ARRAY[]::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly removed owner access'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_membership(v_manager, v_manager, ARRAY[]::text[]);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'actor unexpectedly edited their own membership'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_update_membership(v_manager, v_target, ARRAY['owner']::text[]);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'manager unexpectedly promoted another account to owner'; END IF;
  PERFORM public.admin_update_membership(v_owner, v_target, ARRAY['owner']::text[]);
  IF NOT public.admin_actor_has_permission(v_target, 'access.manage') THEN
    RAISE EXCEPTION 'owner could not explicitly promote another owner';
  END IF;

  -- Legacy admins already present after the migration must have an explicit owner membership.
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_user_roles ur
        JOIN public.admin_roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.role_key = 'owner'
      )
      AND u.id = v_owner
  ) THEN
    RAISE EXCEPTION 'legacy admin preservation backfill is missing owner membership';
  END IF;
END;
$$;

ROLLBACK;
