BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Additive only: the existing confirmed default and every existing row stay as
-- they are ([name] pick decision:pick-predeadline-send: deadline mail goes to the
-- current confirmed opt-in audience). Double opt-in for NEW signups arrives with
-- the track-A route patch, which inserts confirmed=false explicitly.
ALTER TABLE public.exam_reminders ADD COLUMN IF NOT EXISTS confirmation_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.exam_reminders ADD COLUMN IF NOT EXISTS consent_email text;
ALTER TABLE public.exam_reminders ADD COLUMN IF NOT EXISTS consent_confirmed_at timestamptz;
ALTER TABLE public.exam_reminders ADD COLUMN IF NOT EXISTS consent_version integer;
-- Per-address confirmation-mail cooldown (claimed before the provider call).
ALTER TABLE public.exam_reminders ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS exam_reminders_confirmation_token_idx ON public.exam_reminders(confirmation_token);

-- No subscription FK: deleting/recreating a row must never erase a send fence.
CREATE TABLE IF NOT EXISTS public.exam_reminder_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_key text NOT NULL CHECK (recipient_key ~ '^[0-9a-f]{64}$'),
  sitting_key text NOT NULL,
  offset_days integer NOT NULL CHECK (offset_days IN (14, 7, 3, 1)),
  channel text NOT NULL CHECK (channel IN ('email', 'telegram')),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (recipient_key, sitting_key, offset_days, channel),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
ALTER TABLE public.exam_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exam_reminder_sends TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_exam_reminder(p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE changed bigint;
BEGIN
  UPDATE public.exam_reminders SET confirmed = true, consent_email = lower(btrim(email)), consent_confirmed_at = now(), consent_version = 1, unsubscribed_at = NULL, confirmation_token = gen_random_uuid()
    WHERE confirmation_token = p_token;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END $$;
CREATE OR REPLACE FUNCTION public.unsubscribe_exam_reminders(p_token uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.exam_reminders SET unsubscribed_at = now(), confirmed = false, consent_email = NULL, consent_confirmed_at = NULL, consent_version = NULL, confirmation_token = gen_random_uuid()
  WHERE lower(btrim(email)) IN (SELECT lower(btrim(email)) FROM public.exam_reminders WHERE unsub_token = p_token);
$$;
REVOKE ALL ON FUNCTION public.confirm_exam_reminder(uuid), public.unsubscribe_exam_reminders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_exam_reminder(uuid), public.unsubscribe_exam_reminders(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.invalidate_exam_consent_on_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Address changes only. Opt-out is handled by unsubscribe_exam_reminders; the
  -- live route's unsubscribe and re-signup semantics are left unchanged.
  IF lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    NEW.confirmed := false;
    NEW.consent_email := NULL;
    NEW.consent_confirmed_at := NULL;
    NEW.consent_version := NULL;
    NEW.confirmation_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.invalidate_exam_consent_on_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_exam_consent_on_change() TO service_role;
DROP TRIGGER IF EXISTS invalidate_exam_consent_on_change ON public.exam_reminders;
CREATE TRIGGER invalidate_exam_consent_on_change BEFORE UPDATE OF email ON public.exam_reminders
FOR EACH ROW EXECUTE FUNCTION public.invalidate_exam_consent_on_change();
COMMIT;
