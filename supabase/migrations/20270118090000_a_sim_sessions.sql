-- a-sim-s2-1123 (oral and case simulation, unit S2: session store). UNAPPLIED; track-A applies on a release GO.
-- Rollback: scripts/sql/track-a/a-sim-sessions/down.sql. Proof: npm run test:db:sim-sessions on a throwaway PostgreSQL 16.
-- One row per simulation run. `state` is the serialised core session (src/lib/sim/state.ts) and holds the
-- learner's own typed text, so the table is service-role only: RLS on, no policies, no grant to anon or
-- authenticated. The API reads the user id from the signed session and filters every query by it.
-- Retention and deletion of old rows belong to S11; account deletion cascades here.
-- cost_micro_usd is the per-session AI cost (S5/S10 write it, USD 150 cap); ai_marking is the access
-- decision made at creation, read back as the restore context so stored state cannot turn AI on.

CREATE TABLE IF NOT EXISTS public.sim_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  profile_key text NOT NULL,
  case_id text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  ai_marking boolean NOT NULL DEFAULT false,
  state jsonb NOT NULL,
  state_version integer NOT NULL DEFAULT 1,
  cost_micro_usd bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  abandoned_at timestamptz,
  CONSTRAINT sim_sessions_mode CHECK (mode IN ('practice_part', 'full_exam')),
  CONSTRAINT sim_sessions_status CHECK (status IN ('ready', 'running', 'review', 'finished', 'abandoned')),
  CONSTRAINT sim_sessions_state_shape CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT sim_sessions_version_positive CHECK (state_version >= 1),
  CONSTRAINT sim_sessions_cost_nonneg CHECK (cost_micro_usd >= 0),
  CONSTRAINT sim_sessions_profile_key_shape CHECK (profile_key ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT sim_sessions_closed_stamp CHECK (
    (status = 'finished') = (finished_at IS NOT NULL) AND (status = 'abandoned') = (abandoned_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS sim_sessions_user_status_idx ON public.sim_sessions (user_id, status);
CREATE INDEX IF NOT EXISTS sim_sessions_user_created_idx ON public.sim_sessions (user_id, created_at DESC);

COMMENT ON TABLE public.sim_sessions IS 'Simulation runs (S2). state holds the learner''s own typed text; service role only, every read filtered by the signed-in user.';

ALTER TABLE public.sim_sessions ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: deny-all for every client role.
REVOKE ALL ON TABLE public.sim_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.sim_sessions FROM anon;
REVOKE ALL ON TABLE public.sim_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sim_sessions TO service_role;
