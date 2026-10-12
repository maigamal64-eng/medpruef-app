-- a-stability (2026-10-12): keep the per-learner topic aggregates off the
-- questions heap.
--
-- Outage 12 Oct 14:04-14:28 UTC: get_topic_counts, get_user_topic_progress
-- and get_user_topic_attempt_stats hit statement timeouts on the free-plan
-- instance, piled up, and the instance stopped answering until a restart.
--
-- get_user_topic_progress, get_user_topic_attempt_stats and
-- get_user_topic_last_correct (one Home load runs all three) join a learner's
-- answer_history to questions for exam_type and topic. On a realistic local
-- copy (PostgreSQL 16, 11k questions, 26k answer rows) each call builds its
-- hash from an Index Scan on questions_exam_type_idx that reads every heap
-- page of the exam's questions: about 1,500 buffers of wide rows (stem,
-- choices, explanations) per call. This narrow covering index lets the same
-- plans run as Index Only Scans: about 95 buffers per call, about 630 kB of
-- index against a 17 MB heap. The free-tier answered-ids keyset read drops
-- from about 1,500 to about 50 buffers.
-- Before/after plans: track-b handover a-stability/release.md.
--
-- Additive; no function, grant or row changes. 11k rows build in well under
-- a second (SHARE lock on questions for that time; give up after 5 s rather
-- than queue behind a long writer). Index-only scans need the visibility map:
-- run VACUUM (ANALYZE) public.questions right after applying (VACUUM cannot
-- run inside this transaction). Rollback:
-- scripts/sql/track-a/a-stability/down.sql. Proof: npm run test:db:a-stability.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS questions_exam_type_id_cover_idx
  ON public.questions (exam_type, id) INCLUDE (topic, is_active);

ANALYZE public.questions;
