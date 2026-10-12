-- a30-senders (track-A chain R, 2026-10-12). UNAPPLIED changeset; production is
-- migrated by hand only, never with supabase db push. Apply after
-- 20261111100000_study_nudge.sql. Rollback: scripts/sql/track-a/a30-senders/down.sql.
--
-- Study nudges (LX-11, pick-nudge-channels A):
--   * hour: the learner's chosen Vienna hour (06..22), default 09 as in b19.
--   * channel 'telegram': the customer bot writes to the chat linked to the
--     account (users.telegram_id with users.telegram_chat_id_confirmed, i.e. that
--     chat started the bot); consent is the signed-session opt-in from Settings,
--     bound to consent_telegram_id.
--   * study_nudge_sends.kind: which lines the message carried (log only).
--   * The destination-change trigger now suspends only the consent of the
--     changed destination: an email change keeps a Telegram consent and a
--     Telegram id change keeps an email consent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.study_nudge_prefs ADD COLUMN IF NOT EXISTS hour smallint NOT NULL DEFAULT 9;
ALTER TABLE public.study_nudge_prefs ADD COLUMN IF NOT EXISTS consent_telegram_id bigint;
ALTER TABLE public.study_nudge_sends ADD COLUMN IF NOT EXISTS kind text;

-- Replace the b19 check constraints (generated names) with named ones. Only
-- CHECKs that mention channel or consent are dropped; status and sent_at
-- checks stay.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS rel, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('public.study_nudge_prefs'::regclass, 'public.study_nudge_sends'::regclass)
      AND conname NOT LIKE 'a30_%'
      AND (pg_get_constraintdef(oid) LIKE '%channel%' OR pg_get_constraintdef(oid) LIKE '%consent_email%')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.rel, c.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a30_study_nudge_prefs_channel' AND conrelid = 'public.study_nudge_prefs'::regclass) THEN
    ALTER TABLE public.study_nudge_prefs ADD CONSTRAINT a30_study_nudge_prefs_channel CHECK (channel IN ('email', 'telegram'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a30_study_nudge_prefs_hour' AND conrelid = 'public.study_nudge_prefs'::regclass) THEN
    ALTER TABLE public.study_nudge_prefs ADD CONSTRAINT a30_study_nudge_prefs_hour CHECK (hour BETWEEN 6 AND 22);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a30_study_nudge_prefs_consent' AND conrelid = 'public.study_nudge_prefs'::regclass) THEN
    ALTER TABLE public.study_nudge_prefs ADD CONSTRAINT a30_study_nudge_prefs_consent CHECK (
      NOT opt_in OR (
        consent_confirmed_at IS NOT NULL AND consent_version IS NOT NULL AND consent_version = 1 AND (
          (channel = 'email' AND consent_email IS NOT NULL AND consent_email = lower(btrim(consent_email)))
          OR (channel = 'telegram' AND consent_telegram_id IS NOT NULL)
        )
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a30_study_nudge_sends_channel' AND conrelid = 'public.study_nudge_sends'::regclass) THEN
    ALTER TABLE public.study_nudge_sends ADD CONSTRAINT a30_study_nudge_sends_channel CHECK (channel IN ('email', 'telegram'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'a30_study_nudge_sends_kind' AND conrelid = 'public.study_nudge_sends'::regclass) THEN
    ALTER TABLE public.study_nudge_sends ADD CONSTRAINT a30_study_nudge_sends_kind CHECK (kind IS NULL OR kind IN ('due', 'streak', 'due_streak'));
  END IF;
END $$;

-- The hourly sweep reads opted-in prefs for one hour at a time.
CREATE INDEX IF NOT EXISTS study_nudge_prefs_opt_in_hour_idx ON public.study_nudge_prefs (hour) WHERE opt_in;

CREATE OR REPLACE FUNCTION public.suspend_study_consent_on_email_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    -- An outstanding email confirmation is void for any channel.
    UPDATE public.study_nudge_prefs SET pending_email = NULL, confirmation_token = gen_random_uuid() WHERE user_id = NEW.id;
    UPDATE public.study_nudge_prefs SET opt_in = false, consent_email = NULL, consent_confirmed_at = NULL, consent_version = NULL
      WHERE user_id = NEW.id AND channel = 'email';
  END IF;
  IF NEW.telegram_id IS DISTINCT FROM OLD.telegram_id THEN
    UPDATE public.study_nudge_prefs SET opt_in = false, consent_telegram_id = NULL, consent_confirmed_at = NULL, consent_version = NULL
      WHERE user_id = NEW.id AND channel = 'telegram';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.suspend_study_consent_on_email_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_study_consent_on_email_change() TO service_role;
DROP TRIGGER IF EXISTS suspend_study_consent_on_email_change ON public.users;
CREATE TRIGGER suspend_study_consent_on_email_change BEFORE UPDATE OF email, telegram_id ON public.users
FOR EACH ROW EXECUTE FUNCTION public.suspend_study_consent_on_email_change();

-- Privileges are unchanged: RLS on, service_role only (re-stated for a fresh apply).
ALTER TABLE public.study_nudge_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_nudge_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_nudge_prefs, public.study_nudge_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.study_nudge_prefs, public.study_nudge_sends TO service_role;
COMMIT;
