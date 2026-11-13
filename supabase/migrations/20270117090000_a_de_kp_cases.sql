-- KP-DE case practice (a-de-kp-engine-1112, build step 3a). UNAPPLIED; track-A applies on a release GO.
-- Spec: docs/specs/de-kenntnispruefung/FEATURE-SPEC.md section 3.1. Rollback: scripts/sql/track-a/de-kp/down.sql.
-- Own tables, never public.questions: no Austrian count, quota or RPC sees them. DE_KP_ENABLED stays off.

CREATE TABLE IF NOT EXISTS public.de_kp_cases (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  exam_key text NOT NULL DEFAULT 'de_kenntnispruefung',
  subject text NOT NULL,
  taxonomy_code text NOT NULL,
  title_de text NOT NULL,
  title_en text NOT NULL,
  vignette_de text NOT NULL,
  history_checklist jsonb NOT NULL,
  patient_answers_de jsonb NOT NULL,
  findings jsonb NOT NULL,
  differentials jsonb NOT NULL,
  bericht_rubric jsonb NOT NULL,
  model_bericht_de text NOT NULL,
  sources jsonb NOT NULL,
  provenance text NOT NULL,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  is_free boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT de_kp_cases_exam_key CHECK (exam_key = 'de_kenntnispruefung'),
  CONSTRAINT de_kp_cases_subject CHECK (subject IN ('innere', 'chirurgie', 'notfall')),
  CONSTRAINT de_kp_cases_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT de_kp_cases_provenance CHECK (provenance = 'drafted_from_open_refs'),
  CONSTRAINT de_kp_cases_checklist_shape CHECK (jsonb_typeof(history_checklist) = 'array'),
  CONSTRAINT de_kp_cases_patient_answers_shape CHECK (jsonb_typeof(patient_answers_de) = 'object'),
  CONSTRAINT de_kp_cases_findings_shape CHECK (jsonb_typeof(findings) = 'array'),
  CONSTRAINT de_kp_cases_differentials_shape CHECK (jsonb_typeof(differentials) = 'object'),
  CONSTRAINT de_kp_cases_rubric_shape CHECK (jsonb_typeof(bericht_rubric) = 'array'),
  CONSTRAINT de_kp_cases_sources_shape CHECK (jsonb_typeof(sources) = 'array')
);

-- Exactly one active case may be free.
CREATE UNIQUE INDEX IF NOT EXISTS de_kp_cases_one_free_active
  ON public.de_kp_cases (is_free) WHERE is_free AND is_active;

CREATE TABLE IF NOT EXISTS public.de_kp_followups (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES public.de_kp_cases(id) ON DELETE CASCADE,
  position integer NOT NULL,
  scope text NOT NULL,
  stem_de text NOT NULL,
  required integer NOT NULL,
  accepted jsonb NOT NULL,
  model_answer_de text NOT NULL,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT de_kp_followups_position_range CHECK (position BETWEEN 1 AND 8),
  CONSTRAINT de_kp_followups_scope CHECK (scope IN ('case', 'cross')),
  CONSTRAINT de_kp_followups_unique_position UNIQUE (case_id, position),
  -- Same shape rules as kaf_items. CASE guards jsonb_array_length, which raises on a non-array.
  CONSTRAINT de_kp_followups_accepted_shape CHECK (
    CASE WHEN jsonb_typeof(accepted) = 'array' THEN jsonb_array_length(accepted) BETWEEN 1 AND 3 ELSE false END
  ),
  CONSTRAINT de_kp_followups_required_range CHECK (required BETWEEN 1 AND 3),
  CONSTRAINT de_kp_followups_required_matches CHECK (
    CASE WHEN jsonb_typeof(accepted) = 'array' THEN required = jsonb_array_length(accepted) ELSE false END
  ),
  CONSTRAINT de_kp_followups_key_points_shape CHECK (jsonb_typeof(key_points) = 'array'),
  CONSTRAINT de_kp_followups_model_answer_present CHECK (length(btrim(model_answer_de)) > 0)
);

CREATE TABLE IF NOT EXISTS public.de_kp_case_attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  case_id integer NOT NULL REFERENCES public.de_kp_cases(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  history_score numeric,
  differential_score numeric,
  bericht_score numeric,
  followup_score numeric,
  critical_missed integer,
  source text,
  step text NOT NULL DEFAULT 'anamnese',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  marks jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT de_kp_attempts_step CHECK (step IN ('anamnese', 'differentials', 'bericht', 'oral', 'done')),
  CONSTRAINT de_kp_attempts_source CHECK (source IS NULL OR source IN ('de_kp_landing', 'de_kp_hub')),
  CONSTRAINT de_kp_attempts_scores CHECK (
    (history_score IS NULL OR history_score BETWEEN 0 AND 1)
    AND (differential_score IS NULL OR differential_score BETWEEN 0 AND 1)
    AND (bericht_score IS NULL OR bericht_score BETWEEN 0 AND 1)
    AND (followup_score IS NULL OR followup_score BETWEEN 0 AND 1)
  ),
  CONSTRAINT de_kp_attempts_critical CHECK (critical_missed IS NULL OR critical_missed >= 0),
  CONSTRAINT de_kp_attempts_answers_shape CHECK (jsonb_typeof(answers) = 'object' AND jsonb_typeof(marks) = 'object')
);

CREATE INDEX IF NOT EXISTS de_kp_case_attempts_user_idx ON public.de_kp_case_attempts (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS de_kp_case_attempts_case_idx ON public.de_kp_case_attempts (case_id);

COMMENT ON TABLE public.de_kp_cases IS 'KP-DE: reviewed case bank (two Medic reads). Service role only. Never mixed with public.questions.';
COMMENT ON TABLE public.de_kp_case_attempts IS 'KP-DE: learner runs. answers hold the learner''s own typed text; only that learner reads it.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['de_kp_cases', 'de_kp_followups', 'de_kp_case_attempts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- No policies on purpose: deny-all for every client role.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.de_kp_cases_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.de_kp_followups_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.de_kp_cases_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.de_kp_followups_id_seq TO service_role;
