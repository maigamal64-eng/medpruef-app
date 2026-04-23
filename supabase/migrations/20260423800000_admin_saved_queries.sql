-- admin_saved_queries: per-admin named SELECT-only queries.
-- §2.8 of the April 23 admin revamp sprint.
--
-- Used by /admin/sql. SQL is validated server-side in the runner route
-- (SELECT-only regex + keyword blocklist) before execution.
CREATE TABLE IF NOT EXISTS public.admin_saved_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sql text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_saved_queries_owner
  ON public.admin_saved_queries (owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_saved_queries_owner_name
  ON public.admin_saved_queries (owner_id, name);

ALTER TABLE public.admin_saved_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_saved_queries_deny_all" ON public.admin_saved_queries;
CREATE POLICY "admin_saved_queries_deny_all"
  ON public.admin_saved_queries
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.admin_saved_queries IS
  'Per-admin saved SELECT queries. Used by /admin/sql. SQL is validated server-side before execution.';
