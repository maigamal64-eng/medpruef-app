-- ═══════════════════════════════════════════════════════════════════
-- RLS Lockdown — 2026-04-15
-- ═══════════════════════════════════════════════════════════════════
-- Context: audit revealed 11 tables exposed via PostgREST without RLS,
-- plus 6 existing always-true policies (USING true / WITH CHECK true)
-- on users/user_gamification/user_question_progress/answer_history that
-- allowed direct PostgREST writes via the public anon key to promote
-- any user to admin, edit any row, etc.
--
-- This migration closes that entire attack surface. Every API path in
-- the app goes through `getServiceClient()` (service-role key) which
-- bypasses RLS by design, so denying everything at the row level
-- breaks no legitimate traffic and eliminates the direct-PostgREST
-- privilege escalation vector.
--
-- Strategy: deny-by-default via `USING (false)` / `WITH CHECK (false)`.
-- The service-role key bypasses RLS entirely. If client-side direct
-- queries are added later, they can gain access by adding specific
-- tenancy policies (`auth.uid() = user_id`) on top.
--
-- The only legitimate public surface is `questions` — the exam content
-- is readable by design — so we preserve a SELECT policy there.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- Part 1: replace always-true policies with deny-all on tenant tables.
-- ───────────────────────────────────────────────────────────────────

-- users
DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_select ON public.users;
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_deny_all_anon ON public.users
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- user_gamification
DROP POLICY IF EXISTS ug_insert ON public.user_gamification;
DROP POLICY IF EXISTS ug_select ON public.user_gamification;
DROP POLICY IF EXISTS ug_update ON public.user_gamification;
CREATE POLICY ug_deny_all_anon ON public.user_gamification
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- user_question_progress
DROP POLICY IF EXISTS uqp_insert ON public.user_question_progress;
DROP POLICY IF EXISTS uqp_select ON public.user_question_progress;
DROP POLICY IF EXISTS uqp_update ON public.user_question_progress;
CREATE POLICY uqp_deny_all_anon ON public.user_question_progress
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- answer_history
DROP POLICY IF EXISTS ah_insert ON public.answer_history;
DROP POLICY IF EXISTS ah_select ON public.answer_history;
CREATE POLICY ah_deny_all_anon ON public.answer_history
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- questions: keep public-read policy (intended public content)
-- but ensure no INSERT/UPDATE/DELETE paths are open.
DROP POLICY IF EXISTS questions_readable ON public.questions;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY questions_public_read ON public.questions
  FOR SELECT TO anon, authenticated USING (is_active = true);

-- ───────────────────────────────────────────────────────────────────
-- Part 2: enable RLS on tables that have it disabled entirely.
-- Since nothing uses the anon key to touch these, deny-all is safe.
-- ───────────────────────────────────────────────────────────────────

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_deny_all_anon ON public.user_activity_log
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.question_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY suggestions_deny_all_anon ON public.question_suggestions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.questions_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY archive_deny_all_anon ON public.questions_archive
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.topic_reclassifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY reclass_deny_all_anon ON public.topic_reclassifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY feedback_deny_all_anon ON public.user_feedback
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_stats_deny_all_anon ON public.daily_stats
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.pdf_question_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdf_idx_deny_all_anon ON public.pdf_question_index
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_deny_all_anon ON public.user_sessions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_deny_all_anon ON public.user_events
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- telegram_login_tokens already has RLS enabled but no policies.
-- Deny-all is the correct state (only service role should read/write).
-- Add an explicit deny policy so the Supabase advisor stops complaining.
CREATE POLICY tokens_deny_all_anon ON public.telegram_login_tokens
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ───────────────────────────────────────────────────────────────────
-- Part 3: pin search_path on public functions so they can't be
-- redirected by a search_path hijack. Fixes the two Supabase WARN
-- advisors for `normalize_question_text` and `get_topic_counts`.
-- ───────────────────────────────────────────────────────────────────

ALTER FUNCTION public.normalize_question_text(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_topic_counts(text) SET search_path = public, pg_temp;
