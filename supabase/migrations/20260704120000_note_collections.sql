-- Migration: note collections (user "lists") for organizing saved / owned notes.
-- Part of the Explore/Library reimplementation (2026-07-04, EXP-1).
--
-- Two additive tables (no ALTER on a live table):
--   note_collections       — a user-created list ("Kardiologie", "Vor der Prüfung", …)
--   note_collection_items  — membership edge (collection ↔ note)
--
-- WHY collections and not "tags on foreign notes": a user cannot own tags on a
-- public curated note they did not author (PATCH tags is owner-only). Collections
-- are the ONE organization mechanism that works for BOTH a user's own notes AND
-- a saved public (curated/community) note. A reference-save = insert a
-- collection_item pointing at the public note id; no clone, no create-cap hit.
--
-- Security: RLS deny-all (RESTRICTIVE, USING(false)) like every other notes table;
-- reached only via getServiceClient() (service-role). anon/authenticated never touch these.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. note_collections
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.note_collections (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text         NOT NULL,
  -- is_default marks the auto-created "Saved" list (one per user); a partial
  -- unique index enforces the singleton without blocking multiple named lists.
  is_default  boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- List a user's collections, newest first.
CREATE INDEX IF NOT EXISTS note_collections_user_idx
  ON public.note_collections (user_id, created_at DESC);

-- Exactly one default ("Saved") collection per user.
CREATE UNIQUE INDEX IF NOT EXISTS note_collections_user_default_idx
  ON public.note_collections (user_id)
  WHERE is_default;

ALTER TABLE public.note_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all" ON public.note_collections
  AS RESTRICTIVE FOR ALL USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. note_collection_items
-- ════════════════════════════════════════════════════════════════════════════
-- Membership edge. note_id CASCADEs so a deleted/taken-down note (e.g. a
-- moderated public note) also vanishes from every collection. A row can point
-- at a note the user does NOT own (a saved public curated/community note) — the
-- reference-save. PK (collection_id, note_id) makes a save idempotent.
CREATE TABLE IF NOT EXISTS public.note_collection_items (
  collection_id  uuid         NOT NULL REFERENCES public.note_collections(id) ON DELETE CASCADE,
  note_id        uuid         NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  -- True when this item references a note the collection owner does not author
  -- (a saved public note) — lets the Library render "saved from Explore" cheaply
  -- without a cross-join to notes.user_id on every list read.
  is_reference   boolean      NOT NULL DEFAULT false,
  added_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, note_id)
);

-- Reverse lookup: "which collections is this note in" (for the note reader's
-- save-state + to unsave).
CREATE INDEX IF NOT EXISTS note_collection_items_note_idx
  ON public.note_collection_items (note_id);

ALTER TABLE public.note_collection_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all" ON public.note_collection_items
  AS RESTRICTIVE FOR ALL USING (false);
