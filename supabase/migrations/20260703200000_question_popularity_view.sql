-- Popularity view for content pipelines (2026-07-03): which questions are
-- actually answered. Used by scripts/generate-notes.mjs to pick the top-N
-- questions for curated per-question notes. Service-role read.
create or replace view question_popularity as
select question_id, count(*)::int as n from answer_history group by question_id;
