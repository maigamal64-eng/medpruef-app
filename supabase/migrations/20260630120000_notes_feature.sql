-- Migration: notes feature (flash-notes + personal Library) — server infrastructure
-- Phase 1 of the signed-off Notes build (reviews/notes-feature-2026-06-30/).
--
-- Goal: stand up net-new server-side notes infrastructure. Today per-question
-- notes live ONLY in localStorage (src/lib/notes-store.ts) — this also unblocks
-- the deferred cross-device sync weakness. No UI change in this phase; the rail
-- only. The 4 tables below are all ADDITIVE (no ALTER on a live table), so live
-- behaviour is untouched.
--
-- Tables:
--   notes                — the flash-note (structured content jsonb, see §2 of SPEC)
--   note_links           — edges between notes (large content split into linked cards)
--   note_review_progress — SM-2 for note-cards, SEPARATE from user_question_progress
--   trials               — the Telegram-gated 1-week Pro trial anti-abuse wall
--
-- Security: every table is RLS deny-all (RESTRICTIVE, USING(false)); the API
-- routes reach them through getServiceClient() (service-role key, bypasses RLS).
-- anon + authenticated roles must never touch these directly.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. notes
-- ════════════════════════════════════════════════════════════════════════════
-- One row per flash-note. `content` holds the structured shape the card renders
-- ({title, blocks:[{type,front,back,text}], tags, refs}); `title` and `tags` are
-- denormalized to the top level for cheap filtering/indexing and are kept in
-- sync with content.title / content.tags by the API on every write.
--
-- `search_text` is a denormalized flat string (title + block texts + tags) the
-- API fills on write; `search_tsv` is generated from it. Config is 'simple'
-- (NOT german/english) on purpose: note content is mixed DE/EN/AR, so a language
-- stemmer would mangle two of the three. 'simple' = exact-token matching, the
-- safe default for multilingual content.
CREATE TABLE IF NOT EXISTS public.notes (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_type   text         NOT NULL
                  CHECK (source_type IN ('bookmark', 'user_note', 'ai_explanation', 'manual')),
  source_ref    jsonb,                                   -- {question_id, message_id?} — provenance
  title         text         NOT NULL DEFAULT '',
  content       jsonb        NOT NULL DEFAULT '{}'::jsonb, -- the structured flash-note
  tags          text[]       NOT NULL DEFAULT '{}',
  exam_type     text,
  topic         text,
  metadata      jsonb        NOT NULL DEFAULT '{}'::jsonb, -- import_key, source_model, created_from, …
  visibility    text         NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'public')),
  published_at  timestamptz,                             -- set when first made public (Phase 6)
  is_active     boolean      NOT NULL DEFAULT true,
  search_text   text         NOT NULL DEFAULT '',
  search_tsv    tsvector     GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- Library list is always scoped to (user_id) + filtered by active/visibility/source.
CREATE INDEX IF NOT EXISTS notes_user_id_idx
  ON public.notes (user_id);

CREATE INDEX IF NOT EXISTS notes_user_active_idx
  ON public.notes (user_id, is_active);

CREATE INDEX IF NOT EXISTS notes_user_visibility_idx
  ON public.notes (user_id, visibility);

-- Explore (Phase 6) browses active public notes; partial index keeps it tight.
CREATE INDEX IF NOT EXISTS notes_public_active_idx
  ON public.notes (published_at DESC)
  WHERE visibility = 'public' AND is_active = true;

-- Full-text search over the denormalized search_text (title + blocks + tags).
CREATE INDEX IF NOT EXISTS notes_search_tsv_idx
  ON public.notes USING gin (search_tsv);

-- Tag filtering.
CREATE INDEX IF NOT EXISTS notes_tags_idx
  ON public.notes USING gin (tags);

-- Idempotent localStorage→server import: the API writes
-- metadata.import_key = 'localStorage:<questionId>:<entryId>' so a retried or
-- double-fired import never creates duplicate rows. UNIQUE per (user, key),
-- but only for rows that actually carry an import_key.
CREATE UNIQUE INDEX IF NOT EXISTS notes_user_import_key_idx
  ON public.notes (user_id, (metadata->>'import_key'))
  WHERE metadata ? 'import_key';

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all" ON public.notes
  AS RESTRICTIVE FOR ALL USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. note_links
-- ════════════════════════════════════════════════════════════════════════════
-- A simple edge table (graph, not a tree): large content the Haiku transform
-- splits into multiple cards is wired parent→child; users can also cross-link.
-- `kind` distinguishes 'sequence' (1-of-K reading order) from user cross-links.
CREATE TABLE IF NOT EXISTS public.note_links (
  parent_note_id  uuid         NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  child_note_id   uuid         NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  kind            text         NOT NULL DEFAULT 'sequence',
  created_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_note_id, child_note_id, kind),
  CONSTRAINT note_links_no_self_loop CHECK (parent_note_id <> child_note_id)
);

-- Reverse lookup ("what links TO this note").
CREATE INDEX IF NOT EXISTS note_links_child_idx
  ON public.note_links (child_note_id);

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all" ON public.note_links
  AS RESTRICTIVE FOR ALL USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. note_review_progress
-- ════════════════════════════════════════════════════════════════════════════
-- SM-2 spaced-repetition state for note-cards. Deliberately SEPARATE from
-- user_question_progress (which is question-keyed) — this is what lets a note be
-- *revised* like a flashcard. One row per (user, note).
CREATE TABLE IF NOT EXISTS public.note_review_progress (
  user_id        uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note_id        uuid         NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  ease_factor    real         NOT NULL DEFAULT 2.5,   -- SM-2 EF, floor 1.3
  interval_days  integer      NOT NULL DEFAULT 0,
  repetitions    integer      NOT NULL DEFAULT 0,     -- consecutive correct recalls
  next_review_at timestamptz,
  last_seen_at   timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, note_id)
);

-- "What's due for review" for a user, soonest first.
CREATE INDEX IF NOT EXISTS note_review_due_idx
  ON public.note_review_progress (user_id, next_review_at);

ALTER TABLE public.note_review_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all" ON public.note_review_progress
  AS RESTRICTIVE FOR ALL USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. trials
-- ════════════════════════════════════════════════════════════════════════════
-- The Telegram-gated 1-week full-Pro trial (signed decision §6). The wall is
-- one telegram_id = one trial EVER. telegram_id is the PRIMARY KEY, so the
-- UNIQUE constraint is intrinsic.
--
-- CRITICAL anti-abuse property (advisor catch): the row must OUTLIVE the user
-- account. If user_id cascaded on account deletion, deleting + re-creating an
-- account would free the telegram_id to trial again — the exact bypass §6
-- forbids. So user_id is NULLABLE with ON DELETE SET NULL: after an account is
-- deleted the row persists as a tombstone keyed on telegram_id, and that
-- telegram can never trial again. UNIQUE(user_id) still holds (Postgres treats
-- NULLs as distinct, so multiple tombstones coexist) and stops one live account
-- from stacking trials via different telegrams.
--
-- Privacy note: telegram_id is already stored raw on public.users for linked
-- users, so this is not a new class of stored data; the tombstone simply
-- outlives the users row. If a forever-retained raw id is later judged too
-- sensitive, switch to a hashed telegram_id here (the lookup at activation
-- hashes the incoming id the same way) — the wall semantics are unchanged.
CREATE TABLE IF NOT EXISTS public.trials (
  telegram_id  bigint       PRIMARY KEY,                              -- the anti-abuse wall
  user_id      uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  started_at   timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT trials_user_id_unique UNIQUE (user_id)
);

-- Find a user's trial row by account (e.g. "is this user's trial still active").
CREATE INDEX IF NOT EXISTS trials_user_id_idx
  ON public.trials (user_id);

ALTER TABLE public.trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all" ON public.trials
  AS RESTRICTIVE FOR ALL USING (false);
