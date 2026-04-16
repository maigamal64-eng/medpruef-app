-- =====================================================================
-- MedPruef Baseline Schema Dump
-- =====================================================================
--
-- Generated: 2026-04-16
-- Project:   xfgllbkpgbginbjikjbb (medpruf.com)
-- Purpose:   Commit the full production schema to git so the database
--            can be reconstructed from migrations alone.
--
-- This file is a READ of existing production state, not a net-new
-- migration. It captures every table, index, constraint, RLS policy,
-- and function in the public schema as of 2026-04-16.
--
-- Ordering:
--   1. Sequences (implicit via DEFAULT nextval / gen_random_uuid)
--   2. Tables (CREATE TABLE IF NOT EXISTS)
--   3. Indexes (CREATE INDEX IF NOT EXISTS)
--   4. Foreign keys (ALTER TABLE ADD CONSTRAINT ... IF NOT EXISTS pattern)
--   5. RLS enable + policies
--   6. Functions
--
-- Idempotency: IF NOT EXISTS / CREATE OR REPLACE used throughout so
-- this file can be re-applied safely against an existing database.
--
-- Relationship to other migration files in this directory:
--   - 20260405120000_telegram_login_tokens.sql   (subset — included here)
--   - 20260415020000_rls_lockdown.sql            (subset — included here)
--   - 20260415030000_admin_stats_rpc.sql         (subset — included here)
--   - 20260415040000_fk_indexes.sql              (subset — included here)
--
-- Those earlier files are kept for git history / audit trail. This
-- baseline is the canonical "rebuild from scratch" reference.
-- =====================================================================


-- ═════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═════════════════════════════════════════════════════════════════════

-- -----------------------------------------------------------------
-- users
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  telegram_id            bigint,
  telegram_username      text,
  first_name             text,
  last_name              text,
  language_code          text        DEFAULT 'de',
  photo_url              text,
  is_premium             boolean     DEFAULT false,
  premium_until          timestamptz,
  referral_code          text        DEFAULT substr(md5(random()::text), 1, 8),
  referred_by            uuid,
  exam_date              date,
  daily_goal             integer     DEFAULT 20,
  streak_count           integer     DEFAULT 0,
  longest_streak         integer     DEFAULT 0,
  last_active_date       date,
  xp_total               integer     DEFAULT 0,
  level                  integer     DEFAULT 1,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  email                  text,
  password_hash          text,
  role                   text        NOT NULL DEFAULT 'user',
  tier                   text        NOT NULL DEFAULT 'free',
  tier_expires_at        timestamptz,
  feature_overrides      jsonb       DEFAULT '{}',
  is_banned              boolean     DEFAULT false,
  streak_freezes_available integer   DEFAULT 0,
  streak_freeze_used_at  timestamptz,
  active_exam            text        DEFAULT 'kenntnispruefung',

  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_referral_code_key UNIQUE (referral_code),
  CONSTRAINT users_telegram_id_key UNIQUE (telegram_id)
);

-- -----------------------------------------------------------------
-- questions
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.questions (
  id                          integer     NOT NULL DEFAULT nextval('questions_id_seq'::regclass),
  topic                       text        NOT NULL,
  question                    text        NOT NULL,
  answer                      text        NOT NULL,
  explanation                 text,
  exam_dates                  text[],
  difficulty                  integer     DEFAULT 2,
  source_file                 text,
  is_active                   boolean     DEFAULT true,
  created_at                  timestamptz DEFAULT now(),
  tags                        text[]      DEFAULT '{}',
  image_url                   text,
  image_urls                  text[]      DEFAULT '{}',
  distractors                 text[]      DEFAULT '{}',
  anki_note_id                bigint,
  choices                     jsonb,
  ai_explanation              text,
  ai_explanation_generated_at timestamptz,
  explanation_rating_sum      integer     DEFAULT 0,
  explanation_rating_count    integer     DEFAULT 0,
  exam_type                   text        NOT NULL DEFAULT 'kenntnispruefung',
  content_hash                text,
  content_hash_short          text,

  CONSTRAINT questions_pkey PRIMARY KEY (id),
  CONSTRAINT questions_anki_note_id_key UNIQUE (anki_note_id)
);

-- -----------------------------------------------------------------
-- questions_archive
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.questions_archive (
  id                          integer     NOT NULL DEFAULT nextval('questions_archive_id_seq'::regclass),
  topic                       text        NOT NULL,
  question                    text        NOT NULL,
  answer                      text        NOT NULL,
  explanation                 text,
  exam_dates                  text[],
  difficulty                  integer     DEFAULT 2,
  source_file                 text,
  is_active                   boolean     DEFAULT true,
  created_at                  timestamptz DEFAULT now(),
  tags                        text[]      DEFAULT '{}',
  image_url                   text,
  image_urls                  text[]      DEFAULT '{}',
  distractors                 text[]      DEFAULT '{}',
  anki_note_id                bigint,
  choices                     jsonb,
  ai_explanation              text,
  ai_explanation_generated_at timestamptz,
  explanation_rating_sum      integer     DEFAULT 0,
  explanation_rating_count    integer     DEFAULT 0,
  exam_type                   text        NOT NULL DEFAULT 'kenntnispruefung',
  content_hash                text,
  content_hash_short          text,
  archived_at                 timestamptz DEFAULT now(),
  archived_reason             text,

  CONSTRAINT questions_archive_pkey PRIMARY KEY (id),
  CONSTRAINT questions_archive_anki_note_id_key UNIQUE (anki_note_id)
);

-- -----------------------------------------------------------------
-- answer_history
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.answer_history (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid,
  question_id   integer,
  user_answer   text,
  is_correct    boolean,
  time_spent_ms integer,
  xp_earned     integer     DEFAULT 0,
  created_at    timestamptz DEFAULT now(),

  CONSTRAINT answer_history_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- user_gamification
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_gamification (
  user_id                 uuid    NOT NULL,
  total_questions_answered integer DEFAULT 0,
  total_correct           integer DEFAULT 0,
  total_xp                integer DEFAULT 0,
  current_streak          integer DEFAULT 0,
  longest_streak          integer DEFAULT 0,
  level                   integer DEFAULT 1,
  rank_name               text    DEFAULT 'Praktikant',
  last_study_date         date,
  daily_questions_today   integer DEFAULT 0,
  daily_reset_date        date    DEFAULT CURRENT_DATE,

  CONSTRAINT user_gamification_pkey PRIMARY KEY (user_id)
);

-- -----------------------------------------------------------------
-- user_question_progress (SM-2 spaced repetition)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_question_progress (
  id            uuid             NOT NULL DEFAULT gen_random_uuid(),
  user_id       uuid,
  question_id   integer,
  times_seen    integer          DEFAULT 0,
  times_correct integer          DEFAULT 0,
  ease_factor   double precision DEFAULT 2.5,
  interval_days integer          DEFAULT 0,
  next_review_at timestamptz     DEFAULT now(),
  last_seen_at  timestamptz,
  is_bookmarked boolean          DEFAULT false,

  CONSTRAINT user_question_progress_pkey PRIMARY KEY (id),
  CONSTRAINT user_question_progress_user_id_question_id_key UNIQUE (user_id, question_id)
);

-- -----------------------------------------------------------------
-- daily_stats
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_stats (
  id                 bigint      NOT NULL DEFAULT nextval('daily_stats_id_seq'::regclass),
  user_id            text        NOT NULL,
  date               date        NOT NULL,
  questions_answered integer     DEFAULT 0,
  questions_correct  integer     DEFAULT 0,
  time_spent_seconds integer     DEFAULT 0,
  sessions_count     integer     DEFAULT 0,
  topics_practiced   text[]      DEFAULT '{}',
  xp_earned          integer     DEFAULT 0,
  created_at         timestamptz DEFAULT now(),

  CONSTRAINT daily_stats_pkey PRIMARY KEY (id),
  CONSTRAINT daily_stats_user_id_date_key UNIQUE (user_id, date)
);

-- -----------------------------------------------------------------
-- user_sessions
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id         text        NOT NULL,
  started_at      timestamptz DEFAULT now(),
  ended_at        timestamptz,
  duration_seconds integer,
  pages_visited   text[]      DEFAULT '{}',
  device_info     jsonb       DEFAULT '{}',
  exam_source     text,
  created_at      timestamptz DEFAULT now(),

  CONSTRAINT user_sessions_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- user_events
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_events (
  id          bigint      NOT NULL DEFAULT nextval('user_events_id_seq'::regclass),
  user_id     text        NOT NULL,
  session_id  uuid,
  event_type  text        NOT NULL,
  event_data  jsonb       DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT user_events_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- user_activity_log
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id          bigint      NOT NULL,
  user_id     uuid,
  session_id  text,
  event_type  text        NOT NULL,
  page        text,
  component   text,
  action      text,
  metadata    jsonb       DEFAULT '{}',
  question_id integer,
  topic       text,
  duration_ms integer,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT user_activity_log_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- user_feedback
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id          bigint      NOT NULL DEFAULT nextval('user_feedback_id_seq'::regclass),
  user_id     uuid,
  message     text        NOT NULL,
  context     jsonb,
  status      text        NOT NULL DEFAULT 'new',
  admin_note  text,
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT user_feedback_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- question_suggestions
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_suggestions (
  id                bigint      NOT NULL,
  question_id       integer     NOT NULL,
  user_id           uuid,
  type              text        NOT NULL,
  reason            text,
  details           text,
  suggested_changes jsonb,
  status            text        NOT NULL DEFAULT 'pending',
  admin_note        text,
  resolved_by       uuid,
  resolved_at       timestamptz,
  created_at        timestamptz DEFAULT now(),
  context           jsonb,

  CONSTRAINT question_suggestions_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- telegram_login_tokens
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_login_tokens (
  token         text        NOT NULL,
  telegram_id   bigint      NOT NULL,
  first_name    text,
  last_name     text,
  username      text,
  photo_url     text,
  language_code text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,

  CONSTRAINT telegram_login_tokens_pkey PRIMARY KEY (token)
);

-- -----------------------------------------------------------------
-- pdf_question_index
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pdf_question_index (
  id                 bigint      NOT NULL DEFAULT nextval('pdf_question_index_id_seq'::regclass),
  source_pdf         text        NOT NULL,
  topic              text        NOT NULL,
  question_number    integer,
  page_number        integer,
  stem_preview       text,
  content_hash       text        NOT NULL,
  content_hash_short text,
  extracted_at       timestamptz DEFAULT now(),

  CONSTRAINT pdf_question_index_pkey PRIMARY KEY (id)
);

-- -----------------------------------------------------------------
-- topic_reclassifications
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.topic_reclassifications (
  id          bigint      NOT NULL DEFAULT nextval('topic_reclassifications_id_seq'::regclass),
  question_id integer,
  old_topic   text        NOT NULL,
  new_topic   text        NOT NULL,
  signal      text        NOT NULL,
  confidence  numeric,
  source_ref  text,
  applied_at  timestamptz DEFAULT now(),
  applied_by  text,

  CONSTRAINT topic_reclassifications_pkey PRIMARY KEY (id)
);


-- ═════════════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═════════════════════════════════════════════════════════════════════

-- answer_history
CREATE INDEX IF NOT EXISTS idx_ah_user
  ON public.answer_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS answer_history_question_id_idx
  ON public.answer_history (question_id);

-- daily_stats
CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date
  ON public.daily_stats (user_id, date);

-- pdf_question_index
CREATE INDEX IF NOT EXISTS pdf_qi_hash_idx
  ON public.pdf_question_index (content_hash);
CREATE INDEX IF NOT EXISTS pdf_qi_topic_idx
  ON public.pdf_question_index (topic);

-- question_suggestions
CREATE INDEX IF NOT EXISTS idx_suggestions_question
  ON public.question_suggestions (question_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status
  ON public.question_suggestions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_user
  ON public.question_suggestions (user_id);
CREATE INDEX IF NOT EXISTS question_suggestions_resolved_by_idx
  ON public.question_suggestions (resolved_by);

-- questions
CREATE INDEX IF NOT EXISTS idx_questions_topic
  ON public.questions (topic);
CREATE INDEX IF NOT EXISTS questions_anki_note_id_idx
  ON public.questions (anki_note_id);
CREATE INDEX IF NOT EXISTS questions_choices_present_idx
  ON public.questions (id) WHERE choices IS NOT NULL;
CREATE INDEX IF NOT EXISTS questions_content_hash_idx
  ON public.questions (content_hash);
CREATE INDEX IF NOT EXISTS questions_content_hash_short_idx
  ON public.questions (content_hash_short);
CREATE INDEX IF NOT EXISTS questions_exam_type_idx
  ON public.questions (exam_type);
CREATE INDEX IF NOT EXISTS questions_exam_type_topic_idx
  ON public.questions (exam_type, topic);

-- questions_archive (mirrors questions indexes)
CREATE INDEX IF NOT EXISTS idx_questions_archive_topic
  ON public.questions_archive (topic);
CREATE INDEX IF NOT EXISTS questions_archive_anki_note_id_idx
  ON public.questions_archive (anki_note_id);
CREATE INDEX IF NOT EXISTS questions_archive_choices_present_idx
  ON public.questions_archive (id) WHERE choices IS NOT NULL;
CREATE INDEX IF NOT EXISTS questions_archive_content_hash_idx
  ON public.questions_archive (content_hash);
CREATE INDEX IF NOT EXISTS questions_archive_content_hash_short_idx
  ON public.questions_archive (content_hash_short);
CREATE INDEX IF NOT EXISTS questions_archive_exam_type_idx
  ON public.questions_archive (exam_type);
CREATE INDEX IF NOT EXISTS questions_archive_exam_type_topic_idx
  ON public.questions_archive (exam_type, topic);

-- telegram_login_tokens
CREATE INDEX IF NOT EXISTS telegram_login_tokens_expires_at_idx
  ON public.telegram_login_tokens (expires_at);
CREATE INDEX IF NOT EXISTS telegram_login_tokens_telegram_id_idx
  ON public.telegram_login_tokens (telegram_id);

-- topic_reclassifications
CREATE INDEX IF NOT EXISTS topic_reclass_question_idx
  ON public.topic_reclassifications (question_id);

-- user_activity_log
CREATE INDEX IF NOT EXISTS idx_activity_created
  ON public.user_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_event_type
  ON public.user_activity_log (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user_id
  ON public.user_activity_log (user_id, created_at DESC);

-- user_events
CREATE INDEX IF NOT EXISTS idx_user_events_created
  ON public.user_events (created_at);
CREATE INDEX IF NOT EXISTS idx_user_events_user_type
  ON public.user_events (user_id, event_type);
CREATE INDEX IF NOT EXISTS user_events_session_id_idx
  ON public.user_events (session_id);

-- user_feedback
CREATE INDEX IF NOT EXISTS user_feedback_created_idx
  ON public.user_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS user_feedback_status_idx
  ON public.user_feedback (status);

-- user_question_progress
CREATE INDEX IF NOT EXISTS user_question_progress_question_id_idx
  ON public.user_question_progress (question_id);

-- user_sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON public.user_sessions (user_id);

-- users
CREATE INDEX IF NOT EXISTS idx_users_banned
  ON public.users (id) WHERE is_banned = true;
CREATE INDEX IF NOT EXISTS idx_users_email
  ON public.users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role
  ON public.users (role) WHERE role <> 'user';
CREATE INDEX IF NOT EXISTS idx_users_telegram_id
  ON public.users (telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_tier
  ON public.users (tier);
CREATE INDEX IF NOT EXISTS users_referred_by_idx
  ON public.users (referred_by);


-- ═════════════════════════════════════════════════════════════════════
-- 3. FOREIGN KEY CONSTRAINTS
-- ═════════════════════════════════════════════════════════════════════
-- Note: ALTER TABLE ... ADD CONSTRAINT ... IF NOT EXISTS requires
-- PostgreSQL 17+. For Supabase (PG 15), we use DO blocks to check
-- pg_constraint before adding.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'answer_history_user_id_fkey') THEN
    ALTER TABLE public.answer_history
      ADD CONSTRAINT answer_history_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'answer_history_question_id_fkey') THEN
    ALTER TABLE public.answer_history
      ADD CONSTRAINT answer_history_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_suggestions_question_id_fkey') THEN
    ALTER TABLE public.question_suggestions
      ADD CONSTRAINT question_suggestions_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_suggestions_user_id_fkey') THEN
    ALTER TABLE public.question_suggestions
      ADD CONSTRAINT question_suggestions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_suggestions_resolved_by_fkey') THEN
    ALTER TABLE public.question_suggestions
      ADD CONSTRAINT question_suggestions_resolved_by_fkey
      FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_reclassifications_question_id_fkey') THEN
    ALTER TABLE public.topic_reclassifications
      ADD CONSTRAINT topic_reclassifications_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_activity_log_user_id_fkey') THEN
    ALTER TABLE public.user_activity_log
      ADD CONSTRAINT user_activity_log_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_events_session_id_fkey') THEN
    ALTER TABLE public.user_events
      ADD CONSTRAINT user_events_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.user_sessions(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_gamification_user_id_fkey') THEN
    ALTER TABLE public.user_gamification
      ADD CONSTRAINT user_gamification_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_question_progress_user_id_fkey') THEN
    ALTER TABLE public.user_question_progress
      ADD CONSTRAINT user_question_progress_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_question_progress_question_id_fkey') THEN
    ALTER TABLE public.user_question_progress
      ADD CONSTRAINT user_question_progress_question_id_fkey
      FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_referred_by_fkey') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_referred_by_fkey
      FOREIGN KEY (referred_by) REFERENCES public.users(id) ON DELETE NO ACTION;
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════
-- Strategy: deny-by-default for anon + authenticated roles.
-- All app traffic goes through service-role (which bypasses RLS).
-- Only `questions` has a permissive SELECT for public exam content.

-- users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'users_deny_all_anon' AND tablename = 'users') THEN
    CREATE POLICY users_deny_all_anon ON public.users
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- questions (public read for active questions)
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'questions_public_read' AND tablename = 'questions') THEN
    CREATE POLICY questions_public_read ON public.questions
      FOR SELECT TO anon, authenticated
      USING (is_active = true);
  END IF;
END $$;

-- questions_archive
ALTER TABLE public.questions_archive ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'archive_deny_all_anon' AND tablename = 'questions_archive') THEN
    CREATE POLICY archive_deny_all_anon ON public.questions_archive
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- answer_history
ALTER TABLE public.answer_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ah_deny_all_anon' AND tablename = 'answer_history') THEN
    CREATE POLICY ah_deny_all_anon ON public.answer_history
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- user_gamification
ALTER TABLE public.user_gamification ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ug_deny_all_anon' AND tablename = 'user_gamification') THEN
    CREATE POLICY ug_deny_all_anon ON public.user_gamification
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- user_question_progress
ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'uqp_deny_all_anon' AND tablename = 'user_question_progress') THEN
    CREATE POLICY uqp_deny_all_anon ON public.user_question_progress
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- daily_stats
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'daily_stats_deny_all_anon' AND tablename = 'daily_stats') THEN
    CREATE POLICY daily_stats_deny_all_anon ON public.daily_stats
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- user_sessions
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sessions_deny_all_anon' AND tablename = 'user_sessions') THEN
    CREATE POLICY sessions_deny_all_anon ON public.user_sessions
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- user_events
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'events_deny_all_anon' AND tablename = 'user_events') THEN
    CREATE POLICY events_deny_all_anon ON public.user_events
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- user_activity_log
ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'activity_deny_all_anon' AND tablename = 'user_activity_log') THEN
    CREATE POLICY activity_deny_all_anon ON public.user_activity_log
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- user_feedback
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feedback_deny_all_anon' AND tablename = 'user_feedback') THEN
    CREATE POLICY feedback_deny_all_anon ON public.user_feedback
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- question_suggestions
ALTER TABLE public.question_suggestions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'suggestions_deny_all_anon' AND tablename = 'question_suggestions') THEN
    CREATE POLICY suggestions_deny_all_anon ON public.question_suggestions
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- telegram_login_tokens
ALTER TABLE public.telegram_login_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tokens_deny_all_anon' AND tablename = 'telegram_login_tokens') THEN
    CREATE POLICY tokens_deny_all_anon ON public.telegram_login_tokens
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- pdf_question_index
ALTER TABLE public.pdf_question_index ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pdf_idx_deny_all_anon' AND tablename = 'pdf_question_index') THEN
    CREATE POLICY pdf_idx_deny_all_anon ON public.pdf_question_index
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- topic_reclassifications
ALTER TABLE public.topic_reclassifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'reclass_deny_all_anon' AND tablename = 'topic_reclassifications') THEN
    CREATE POLICY reclass_deny_all_anon ON public.topic_reclassifications
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════
-- 5. FUNCTIONS
-- ═════════════════════════════════════════════════════════════════════

-- -----------------------------------------------------------------
-- normalize_question_text(text) -> text
-- Strips whitespace, lowercases, removes punctuation for content
-- hashing and duplicate detection.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_question_text(input_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        trim(input_text),
        '\s+', ' ', 'g'
      ),
      '[^\w\s]', '', 'g'
    )
  );
$$;

-- -----------------------------------------------------------------
-- get_topic_counts(exam_source text) -> TABLE(topic, count)
-- Server-side GROUP BY to bypass Supabase 1000-row REST limit.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_topic_counts(exam_source text)
RETURNS TABLE (topic text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.topic, count(*) AS count
  FROM questions q
  WHERE q.is_active = true
    AND q.exam_type = exam_source
  GROUP BY q.topic
  ORDER BY q.topic;
$$;

-- -----------------------------------------------------------------
-- get_admin_overview_counts() -> row of aggregate KPIs
-- Used by /api/stats/admin for the dashboard tab.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_overview_counts()
RETURNS TABLE (
  total_users bigint,
  dau bigint,
  wau bigint,
  mau bigint,
  questions_today bigint,
  questions_this_week bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM users) AS total_users,
    (SELECT count(DISTINCT user_id) FROM user_events
      WHERE created_at >= date_trunc('day', now())) AS dau,
    (SELECT count(DISTINCT user_id) FROM user_events
      WHERE created_at >= now() - interval '7 days') AS wau,
    (SELECT count(DISTINCT user_id) FROM user_events
      WHERE created_at >= now() - interval '30 days') AS mau,
    (SELECT count(*) FROM user_events
      WHERE event_type = 'question_answer'
        AND created_at >= date_trunc('day', now())) AS questions_today,
    (SELECT count(*) FROM user_events
      WHERE event_type = 'question_answer'
        AND created_at >= now() - interval '7 days') AS questions_this_week;
$$;

-- -----------------------------------------------------------------
-- get_admin_daily_active_users(days_back int) -> TABLE(day, active)
-- Used by /api/stats/admin for the DAU chart.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_daily_active_users(days_back int DEFAULT 30)
RETURNS TABLE (
  day date,
  active bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    date_trunc('day', created_at)::date AS day,
    count(DISTINCT user_id) AS active
  FROM user_events
  WHERE created_at >= now() - (days_back || ' days')::interval
  GROUP BY 1
  ORDER BY 1;
$$;

-- Grant execute to service_role for the admin RPCs
GRANT EXECUTE ON FUNCTION public.get_admin_overview_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_daily_active_users(int) TO service_role;


-- ═════════════════════════════════════════════════════════════════════
-- END OF BASELINE
-- ═════════════════════════════════════════════════════════════════════
