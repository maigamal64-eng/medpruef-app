-- experiments + experiment_assignments: A/B test infrastructure.
-- §2.9 of the April 23 admin revamp sprint.
CREATE TABLE IF NOT EXISTS public.experiments (
  key text PRIMARY KEY,
  description text,
  variants jsonb NOT NULL,
  traffic_split jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped')),
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiments_status ON public.experiments (status);

CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  experiment_key text NOT NULL REFERENCES public.experiments(key) ON DELETE CASCADE,
  variant text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, experiment_key)
);

CREATE INDEX IF NOT EXISTS idx_experiment_assignments_key_variant
  ON public.experiment_assignments (experiment_key, variant);

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "experiments_deny_all" ON public.experiments;
CREATE POLICY "experiments_deny_all"
  ON public.experiments
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "experiment_assignments_deny_all" ON public.experiment_assignments;
CREATE POLICY "experiment_assignments_deny_all"
  ON public.experiment_assignments
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.experiments IS
  'A/B experiments. Variants + traffic split as JSONB. status: draft | running | stopped.';
COMMENT ON TABLE public.experiment_assignments IS
  'Per-user variant assignment. Sticky: first visit assigns, subsequent visits read.';
