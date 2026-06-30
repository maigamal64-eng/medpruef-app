-- note_reports — moderation queue for public flash-notes (Notes feature P6).
--
-- Public notes (Explore) are a PII / wrong-medicine / copyright surface, so every
-- public note carries a `report` action → a row here → an admin takedown queue.
-- Paired with the pre-publish Haiku PII/quality scan + the 24h author grace, this
-- is the safety stack that the signed design (§9 #5) requires to be LIVE before
-- ANY note can go public. The whole Explore surface stays behind the
-- NOTES_EXPLORE_ENABLED flag until that stack is reviewed.
--
-- RLS deny-all / service-role only, like every table.
CREATE TABLE IF NOT EXISTS public.note_reports (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id           uuid         NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  -- Keep the report even if the reporter deletes their account (moderation history).
  reporter_user_id  uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  reason            text         NOT NULL
                      CHECK (reason IN ('pii', 'wrong', 'spam', 'copyright', 'other')),
  detail            text,
  status            text         NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- The admin queue reads open reports newest-first.
CREATE INDEX IF NOT EXISTS note_reports_status_idx
  ON public.note_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS note_reports_note_idx
  ON public.note_reports (note_id);

-- One open report per (note, reporter) — a user can't spam-report the same note.
CREATE UNIQUE INDEX IF NOT EXISTS note_reports_note_reporter_open_idx
  ON public.note_reports (note_id, reporter_user_id)
  WHERE status = 'open';

ALTER TABLE public.note_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all" ON public.note_reports;
CREATE POLICY "deny all" ON public.note_reports AS RESTRICTIVE FOR ALL USING (false);
