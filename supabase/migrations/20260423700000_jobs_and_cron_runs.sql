-- jobs + cron_runs: admin live-status infrastructure.
-- §2.6 of the April 23 admin revamp sprint.
--
-- jobs: long-running admin actions (CSV export, bulk PUYP approve, refund)
--       with progress_pct streamed via Supabase Realtime to the UI.
--       cancel_requested_at: admin-triggered cancel; handlers check the
--       flag and abort cleanly.
--
-- cron_runs: execution history for scheduled tasks. One row per fire;
--            started_at on insert, finished_at + status on completion.
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  progress_pct integer NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  progress_label text,
  started_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error text,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON public.jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_started_by ON public.jobs (started_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  rows_affected integer,
  error text,
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_started
  ON public.cron_runs (cron_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status_started
  ON public.cron_runs (status, started_at DESC);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_deny_all" ON public.jobs;
CREATE POLICY "jobs_deny_all"
  ON public.jobs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "cron_runs_deny_all" ON public.cron_runs;
CREATE POLICY "cron_runs_deny_all"
  ON public.cron_runs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.jobs IS
  'Long-running admin jobs with progress streaming. cancel_requested_at: admin-triggered cancel; handlers check the flag and abort cleanly.';
COMMENT ON TABLE public.cron_runs IS
  'Scheduled task execution history. One row per cron fire; updated with finished_at + status on completion.';
