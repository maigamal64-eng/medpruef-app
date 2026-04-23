-- admin_audit_log: every admin mutation leaves a trail.
-- §2.7 of the April 23 admin revamp sprint.
--
-- Applied via Supabase MCP on 2026-04-23 against project xfgllbkpgbginbjikjbb.
-- This file is the on-disk record of that migration so it's in git history.
--
-- Populated by src/lib/admin/audit.ts logAdminAction({ req, action, targetType, targetId, payload }).
-- Every /api/admin/* mutation (POST/PATCH/DELETE) must call it.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_email text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created
  ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target
  ON public.admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_created
  ON public.admin_audit_log (action, created_at DESC);

-- RLS: deny all anon/authenticated. Service role bypasses RLS.
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_log_deny_all" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_deny_all"
  ON public.admin_audit_log
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.admin_audit_log IS
  'Every admin mutation (POST/PATCH/DELETE on /api/admin/* or equivalent) inserts a row. Populated via src/lib/admin/audit.ts logAdminAction().';
