-- ═══════════════════════════════════════════════════════════════════
-- Missing FK indexes — 2026-04-15
-- ═══════════════════════════════════════════════════════════════════
-- Supabase performance advisor flagged 5 foreign-key columns without
-- covering indexes. These are cheap to add and the queries they
-- support are hot paths in the admin dashboard and the quiz engine.
-- See reports/review-2026-04-15/02-database.md.
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS answer_history_question_id_idx
  ON public.answer_history (question_id);

CREATE INDEX IF NOT EXISTS question_suggestions_resolved_by_idx
  ON public.question_suggestions (resolved_by);

CREATE INDEX IF NOT EXISTS user_events_session_id_idx
  ON public.user_events (session_id);

CREATE INDEX IF NOT EXISTS user_question_progress_question_id_idx
  ON public.user_question_progress (question_id);

CREATE INDEX IF NOT EXISTS users_referred_by_idx
  ON public.users (referred_by);
