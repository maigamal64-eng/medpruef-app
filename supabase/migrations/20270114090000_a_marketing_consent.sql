-- a-intercom-marketing-consent (2026-10-17). UNAPPLIED: track-A applies by hand.
-- Records the learner's own opt-in to marketing and news emails (Intercom
-- review G3: the privacy page promised opt-in, nothing recorded it).
--   marketing_opt_in           false until the learner ticks the box at
--                              register or switches it on in Settings
--   marketing_consent_at       time of the learner's latest decision (grant
--                              or withdrawal), set by the app only
--   marketing_consent_version  version of the consent text shown at that
--                              decision (src/lib/marketing-consent/copy.ts)
-- Adding a NOT NULL column with a constant default is a catalog-only change
-- on PostgreSQL 11+, so no table rewrite. Rollback:
-- scripts/sql/track-a/a-marketing-consent/down.sql.
SET lock_timeout = '3s';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_version text;

-- An opt-in always carries its time and text version.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_marketing_consent_recorded'
                 AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_marketing_consent_recorded
      CHECK (NOT marketing_opt_in OR (marketing_consent_at IS NOT NULL AND marketing_consent_version IS NOT NULL)) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.users VALIDATE CONSTRAINT users_marketing_consent_recorded;

COMMENT ON COLUMN public.users.marketing_opt_in IS 'Learner opted in to marketing and news emails (a-intercom-marketing-consent). Default false; only the learner changes it.';
COMMENT ON COLUMN public.users.marketing_consent_at IS 'Time of the latest marketing consent decision (grant or withdrawal).';
COMMENT ON COLUMN public.users.marketing_consent_version IS 'Consent text version shown at that decision (MARKETING_CONSENT_VERSION).';
