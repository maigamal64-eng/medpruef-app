-- ═══════════════════════════════════════════════════════════════════
-- Question translations cache — 2026-04-18
-- ═══════════════════════════════════════════════════════════════════
-- Context: Backlog item #9. Target audience (~64k foreign doctors)
-- speaks Arabic/Russian/Ukrainian/Serbian as native tongue. Medical
-- German is hard even for fluent B2/C1 speakers. Vladimir Abaev
-- (user-78dc38b9@example.com) has 182 Qs at 32% accuracy — strong language-
-- barrier signal. We promised Russian support in his Apr 17 response
-- email. This delivers.
--
-- Design:
-- - Per-question, per-language, per-field (explanation | ai_explanation
--   | question). We translate ai_explanation first because it's already
--   the richest text we surface. Keeping `field` flexible so we can
--   expand to `question` and `explanation` later without migration.
-- - Unique (question_id, lang, field) so a user who asks for a
--   translation again just hits the cache — zero API cost.
-- - `source_model` records which model produced the text (e.g.
--   'gpt-4o-mini', 'claude-haiku-4-5') so we can audit quality later
--   and selectively re-run a model upgrade without touching others.
-- - ON DELETE CASCADE so if a question is deleted, its translations go
--   with it (no orphaned rows).
--
-- RLS: deny-all for anon + authenticated (matches the RLS lockdown
-- from 2026-04-15). All reads/writes go through /api/translate using
-- the service-role client.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.question_translations (
  id bigserial PRIMARY KEY,
  question_id integer NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  lang text NOT NULL, -- 'ru' | 'ar' | 'en' | 'fr' | 'tr' | 'uk' | 'sr'
  field text NOT NULL, -- 'explanation' | 'question' | 'ai_explanation'
  translated_text text NOT NULL,
  source_model text, -- e.g. 'gpt-4o-mini', 'claude-haiku-4-5'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, lang, field)
);

CREATE INDEX IF NOT EXISTS idx_qtr_qid_lang
  ON public.question_translations (question_id, lang);

ALTER TABLE public.question_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY qtr_deny_all_anon ON public.question_translations
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
