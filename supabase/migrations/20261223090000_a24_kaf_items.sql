-- a24 exam (chain L): the reviewed KAF (Kurzantwortfragen) pool for the timed
-- KAF practice mode (readiness SIM-04 / CNT-14, pick-kaf-pool = build, [name]
-- 2026-10-12). UNAPPLIED changeset; track-A applies it on a release GO.
-- Rollback: scripts/sql/track-a/a24-exam/down.sql.
-- Proof:    npm run test:db:a24 (throwaway PostgreSQL 16).
-- Data:     scripts/sql/track-a/a24-exam/kaf-seed.sql (a separate data artifact,
--           never part of this migration; built by scripts/content/kaf/build-seed.mjs).
--
-- One row per question that passed two Medic reads. `accepted` holds one list of
-- accepted wordings per required answer (sip.kaf: up to three answers can be
-- required, one point only for a fully right answer). The learner marks their
-- own answer; the accepted wording is shown after submit and snapshotted by
-- POST /api/history/exams. Learner routes read it only through the service
-- role (/api/exam/kaf-pool, /api/exam/kaf-pool/answers), dark behind
-- KAF_TIMED_ENABLED.

CREATE TABLE IF NOT EXISTS public.kaf_items (
  question_id integer PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
  accepted jsonb NOT NULL,
  required integer NOT NULL,
  model_answer text NOT NULL,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- CASE guards jsonb_array_length, which raises on a non-array.
  CONSTRAINT kaf_items_accepted_shape CHECK (
    CASE WHEN jsonb_typeof(accepted) = 'array' THEN jsonb_array_length(accepted) BETWEEN 1 AND 3 ELSE false END
  ),
  CONSTRAINT kaf_items_required_range CHECK (required BETWEEN 1 AND 3),
  CONSTRAINT kaf_items_required_matches CHECK (
    CASE WHEN jsonb_typeof(accepted) = 'array' THEN required = jsonb_array_length(accepted) ELSE false END
  ),
  CONSTRAINT kaf_items_key_points_shape CHECK (jsonb_typeof(key_points) = 'array'),
  CONSTRAINT kaf_items_model_answer_present CHECK (length(btrim(model_answer)) > 0)
);

COMMENT ON TABLE public.kaf_items IS
  'a24: reviewed KAF pool (two Medic reads). accepted = one array of accepted wordings per required answer. Service role only.';

ALTER TABLE public.kaf_items ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: deny-all for every client role.
REVOKE ALL ON TABLE public.kaf_items FROM PUBLIC;
REVOKE ALL ON TABLE public.kaf_items FROM anon;
REVOKE ALL ON TABLE public.kaf_items FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kaf_items TO service_role;
