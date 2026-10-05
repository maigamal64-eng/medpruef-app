-- Keep the per-exam topic aggregation on a compact covering index.
-- The existing exam_type-only index required heap reads for topic and
-- is_active, which made get_topic_counts vulnerable to statement timeouts.
-- This partial index is additive and includes only active questions.
CREATE INDEX IF NOT EXISTS idx_questions_exam_topic_active
  ON public.questions (exam_type, topic)
  WHERE is_active;

ANALYZE public.questions;
