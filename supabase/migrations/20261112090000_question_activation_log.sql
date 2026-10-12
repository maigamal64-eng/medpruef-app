-- track-B b20. track-A applies this migration after its independent review.
BEGIN;
CREATE TABLE public.question_activation_log (
  batch_id text NOT NULL CHECK (batch_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  question_id integer NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,
  gate_result jsonb NOT NULL CHECK (jsonb_typeof(gate_result) = 'object' AND gate_result @> '{"pass":true}'::jsonb),
  reviewer text NOT NULL CHECK (length(btrim(reviewer)) > 0),
  rights_basis text NOT NULL CHECK (length(btrim(rights_basis)) > 0),
  activated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (batch_id, question_id)
);
CREATE INDEX question_activation_log_question_idx ON public.question_activation_log (question_id, activated_at DESC);
ALTER TABLE public.question_activation_log ENABLE ROW LEVEL SECURITY;
-- No anon or authenticated policy. Audit rows are private and append-only.
-- Supabase may grant service_role ALL through default privileges. Clear those
-- inherited table grants before installing the narrow append-only grant.
REVOKE ALL ON TABLE public.question_activation_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.question_activation_log TO service_role;
COMMIT;
