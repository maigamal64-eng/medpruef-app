-- flags: feature flags per environment, gradual rollout.
-- §2.9 of the April 23 admin revamp sprint.
--
-- /admin/flags UI + flag() helper in src/lib/admin/flags.ts.
CREATE TABLE IF NOT EXISTS public.flags (
  key text PRIMARY KEY,
  description text,
  env text NOT NULL DEFAULT 'all' CHECK (env IN ('production','preview','development','all')),
  enabled boolean NOT NULL DEFAULT false,
  rollout_pct integer NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flags_updated_at ON public.flags (updated_at DESC);

ALTER TABLE public.flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flags_deny_all" ON public.flags;
CREATE POLICY "flags_deny_all"
  ON public.flags
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.flags IS
  'Feature flags with per-env scope + percent rollout. Read via src/lib/admin/flags.ts flag(key, userId).';
