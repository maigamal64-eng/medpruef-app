BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS public.study_nudge_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  opt_in boolean NOT NULL DEFAULT false,
  channel text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  unsub_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  last_sent timestamptz,
  pending_email text,
  confirmation_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  consent_email text,
  consent_confirmed_at timestamptz,
  consent_version integer,
  confirmation_sent_at timestamptz,
  CHECK (NOT opt_in OR (consent_email IS NOT NULL AND consent_email = lower(btrim(consent_email)) AND consent_confirmed_at IS NOT NULL AND consent_version IS NOT NULL AND consent_version = 1)),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.study_nudge_prefs ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
ALTER TABLE public.study_nudge_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_nudge_prefs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.study_nudge_prefs TO service_role;

CREATE TABLE IF NOT EXISTS public.study_nudge_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pref_id uuid NOT NULL REFERENCES public.study_nudge_prefs(id) ON DELETE CASCADE,
  nudge_day date NOT NULL,
  channel text NOT NULL CHECK (channel = 'email'),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (pref_id, nudge_day, channel),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
ALTER TABLE public.study_nudge_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_nudge_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.study_nudge_sends TO service_role;
-- Atomically suspend consent on every destination change, even if changed back.
-- This changes reminder preferences only; legacy login behaviour is unchanged.
CREATE OR REPLACE FUNCTION public.suspend_study_consent_on_email_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    UPDATE public.study_nudge_prefs SET opt_in = false, consent_email = NULL, consent_confirmed_at = NULL, consent_version = NULL, pending_email = NULL, confirmation_token = gen_random_uuid() WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.suspend_study_consent_on_email_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_study_consent_on_email_change() TO service_role;
DROP TRIGGER IF EXISTS suspend_study_consent_on_email_change ON public.users;
CREATE TRIGGER suspend_study_consent_on_email_change BEFORE UPDATE OF email ON public.users
FOR EACH ROW EXECUTE FUNCTION public.suspend_study_consent_on_email_change();
COMMIT;
