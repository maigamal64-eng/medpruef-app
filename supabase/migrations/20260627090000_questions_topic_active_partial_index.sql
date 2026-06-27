-- 2026-06-27 — Perf fix for the /api/questions get_topic_counts statement-timeout
-- (Sentry issue: "canceling statement due to statement timeout", POST /api/questions).
--
-- The unfiltered GROUP BY topic over ~10,700 active rows did ~6,340 heap touches
-- and, under concurrency with 2-months-stale planner stats, tipped past
-- statement_timeout. A partial index on (topic) WHERE is_active enables an
-- index-only scan for the "all exams" topic-count path. Additive + safe.
--
-- Paired in the same maintenance pass with `ANALYZE questions` (stats had been
-- stale since 2026-04-21). Applied to production via the Supabase MCP on 2026-06-27.

CREATE INDEX IF NOT EXISTS idx_questions_topic_active
  ON public.questions (topic)
  WHERE is_active;
