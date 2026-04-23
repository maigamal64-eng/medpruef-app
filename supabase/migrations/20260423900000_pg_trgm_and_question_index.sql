-- pg_trgm + trigram index on questions.question for duplicate detection.
-- §2.5 of the April 23 admin revamp sprint.
--
-- Powers /api/admin/questions/duplicates via `similarity(question, ?) > 0.7`.
-- Column is `question` on this schema (not `question_stem` as the sprint
-- prompt said — corrected at apply time).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_questions_stem_trgm
  ON public.questions USING gin (question gin_trgm_ops);

COMMENT ON INDEX public.idx_questions_stem_trgm IS
  'Trigram index for similarity() search. Powers the duplicate detector in /admin/questions.';
