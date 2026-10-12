-- a25 study library (chain L): lifetime note-creation counter for the free
-- note allowance (UX-STU-51, pick-ux-stu-51 B, [name] 2026-10-12: "Free notes
-- cap stays 10 ever (non-renewable); server must count lifetime creations
-- before delete button ships"). UNAPPLIED changeset; track-A applies it on a
-- release GO.
-- Rollback: scripts/sql/track-a/a25-study-library/down.sql.
-- Proof:    npm run test:db:a25 (throwaway PostgreSQL 16).
--
-- One row per learner: how many notes were ever created for the account.
-- An AFTER INSERT trigger on public.notes feeds it, so every path counts
-- (create, AI transform, import, clone). Deleting a note never lowers it:
-- service_role may only SELECT here, the trigger function (owner) is the only
-- writer. The app reads it through src/lib/notes-cap.ts; until this changeset
-- is applied the app falls back to the live row count and refuses free-account
-- deletes (DELETE /api/notes/[id] answers 503 NOTE_DELETE_UNAVAILABLE).
--
-- Idempotent: re-running keeps the counted totals (the backfill only raises a
-- total to the live row count, never lowers it).

CREATE TABLE IF NOT EXISTS public.note_creation_counts (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  created_total integer NOT NULL DEFAULT 0 CHECK (created_total >= 0),
  first_created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.note_creation_counts IS
  'a25: lifetime count of notes created per account (free allowance is lifetime, pick-ux-stu-51 B). Written only by notes_count_creation(); deletes never lower it.';

ALTER TABLE public.note_creation_counts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'note_creation_counts' AND policyname = 'deny all'
  ) THEN
    CREATE POLICY "deny all" ON public.note_creation_counts AS RESTRICTIVE FOR ALL USING (false);
  END IF;
END $$;

REVOKE ALL ON TABLE public.note_creation_counts FROM PUBLIC;
REVOKE ALL ON TABLE public.note_creation_counts FROM anon;
REVOKE ALL ON TABLE public.note_creation_counts FROM authenticated;
REVOKE ALL ON TABLE public.note_creation_counts FROM service_role;
GRANT SELECT ON TABLE public.note_creation_counts TO service_role;

CREATE OR REPLACE FUNCTION public.notes_count_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.note_creation_counts AS c (user_id, created_total, first_created_at, updated_at)
  VALUES (NEW.user_id, 1, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET created_total = c.created_total + 1,
        updated_at = now();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notes_count_creation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes_count_creation() FROM anon;
REVOKE ALL ON FUNCTION public.notes_count_creation() FROM authenticated;
REVOKE ALL ON FUNCTION public.notes_count_creation() FROM service_role;

-- Trigger and backfill run in one statement under a lock that blocks note
-- inserts, so no note is counted twice or missed while the changeset applies
-- (a DO block is one transaction even when the runner autocommits).
DO $$
BEGIN
  LOCK TABLE public.notes IN SHARE ROW EXCLUSIVE MODE;
  DROP TRIGGER IF EXISTS notes_count_creation ON public.notes;
  CREATE TRIGGER notes_count_creation
    AFTER INSERT ON public.notes
    FOR EACH ROW EXECUTE FUNCTION public.notes_count_creation();
  INSERT INTO public.note_creation_counts AS c (user_id, created_total, first_created_at, updated_at)
  SELECT n.user_id, count(*)::integer, min(n.created_at), now()
  FROM public.notes n
  GROUP BY n.user_id
  ON CONFLICT (user_id) DO UPDATE
    SET created_total = GREATEST(c.created_total, EXCLUDED.created_total),
        first_created_at = LEAST(c.first_created_at, EXCLUDED.first_created_at);
END $$;
