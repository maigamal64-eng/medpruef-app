-- Simulation S3 (a-sim-s3-1123): case content extension. UNAPPLIED; track-A applies on a release GO.
-- Rollback: scripts/sql/track-a/a-sim-case-ext/down.sql. Proof: npm run test:db:sim-case-ext.
-- Adds the optional persona and examiner notes to de_kp_cases and lets provenance be protocol_informed
-- (16 Nov ruling: a case drafted with a found exam protocol as one source, marked to learners).
-- Existing rows are untouched (both columns NULL, provenance unchanged). Idempotent. One transaction, fails fast on a lock.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE public.de_kp_cases ADD COLUMN IF NOT EXISTS patient_persona_de text;
ALTER TABLE public.de_kp_cases ADD COLUMN IF NOT EXISTS examiner_notes jsonb;

ALTER TABLE public.de_kp_cases DROP CONSTRAINT IF EXISTS de_kp_cases_provenance;
ALTER TABLE public.de_kp_cases ADD CONSTRAINT de_kp_cases_provenance
  CHECK (provenance IN ('drafted_from_open_refs', 'protocol_informed'));

ALTER TABLE public.de_kp_cases DROP CONSTRAINT IF EXISTS de_kp_cases_persona_length;
ALTER TABLE public.de_kp_cases ADD CONSTRAINT de_kp_cases_persona_length
  CHECK (patient_persona_de IS NULL OR length(btrim(patient_persona_de)) BETWEEN 40 AND 1500);

ALTER TABLE public.de_kp_cases DROP CONSTRAINT IF EXISTS de_kp_cases_examiner_notes_shape;
ALTER TABLE public.de_kp_cases ADD CONSTRAINT de_kp_cases_examiner_notes_shape
  CHECK (examiner_notes IS NULL OR (jsonb_typeof(examiner_notes) = 'array' AND jsonb_array_length(examiner_notes) <= 8));

-- A protocol case must carry exactly one exam_protocol source with a non-empty land and exam_date and no url
-- (S3 review: the learner label names Land and month, and a message link would identify the post).
ALTER TABLE public.de_kp_cases DROP CONSTRAINT IF EXISTS de_kp_cases_protocol_source;
ALTER TABLE public.de_kp_cases ADD CONSTRAINT de_kp_cases_protocol_source
  CHECK (
    provenance <> 'protocol_informed'
    OR (
      jsonb_array_length(jsonb_path_query_array(sources, '$[*] ? (@.kind == "exam_protocol")')) = 1
      AND NOT jsonb_path_exists(sources, '$[*] ? (@.kind == "exam_protocol" && (!exists(@.land) || !exists(@.exam_date) || @.land == "" || @.exam_date == "" || exists(@.url)))')
    )
  );

COMMIT;
