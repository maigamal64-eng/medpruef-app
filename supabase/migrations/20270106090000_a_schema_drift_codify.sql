-- a-free-only-scripts (G4 a-schema-drift-codify), 2026-10-16. NOT APPLIED. Idempotent: a no-op on production.
--
-- Production (xfgllbkpgbginbjikjbb) has five objects that no migration creates; a database rebuilt from
-- supabase/migrations alone (a-fo-06 fallback, the Kassa replay harness) lacked them, so auth routes that read
-- users.email_status (api/auth, api/auth/me, api/nudge, api/user/email-update) failed there. Read from the
-- production catalog on 2026-10-16 (statement_timeout 5 s, read only); fixture:
-- scripts/sql/track-a/a-schema-drift-codify/prod-catalog-2026-10-16.json.
--   users.email_status text DEFAULT 'unverified'::text, nullable
--   users_email_status_check      CHECK (email_status IN ('valid','bounced','unverified'))
--   users_tier_check              CHECK (tier IN ('free','pro','admin'))
--   users_active_exam_check       CHECK (active_exam IN ('kenntnispruefung','kmp_innsbruck','pharma'))
--   webhook_attempts_result_check CHECK (result IN the six WebhookAttemptResult values of src/lib/webhook-logger.ts)
-- 20260424050000_webhook_attempts.sql says the result values are validated in the app "rather than via a CHECK
-- constraint"; production has the CHECK anyway, so this file records production as it is. A new result value
-- (or a new users.tier) needs a migration that replaces the matching constraint.
-- Every statement only adds what is missing: on production nothing changes (proof:
-- scripts/sql/track-a/a-schema-drift-codify/proof.sh, PG16). Rollback file (proof only, never on production):
-- scripts/sql/track-a/a-schema-drift-codify/down.sql.

-- Locks: every ALTER below runs only when its object is missing, so on production this file takes no more than the
-- ACCESS SHARE of the catalog reads (ADD COLUMN IF NOT EXISTS would take ACCESS EXCLUSIVE on users even as a no-op).
-- Where an ALTER does run, a 2 s lock timeout stops it from queueing every users read behind a long transaction.
SET lock_timeout = '2s';

DO $codify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attname = 'email_status' AND NOT attisdropped) THEN
    ALTER TABLE public.users ADD COLUMN email_status text DEFAULT 'unverified'::text;
  END IF;

  -- Only a missing default is set: a column that already has one (production) is left untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.users'::regclass AND a.attname = 'email_status'
  ) THEN
    ALTER TABLE public.users ALTER COLUMN email_status SET DEFAULT 'unverified'::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_email_status_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_email_status_check
      CHECK (email_status = ANY (ARRAY['valid'::text, 'bounced'::text, 'unverified'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_tier_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_tier_check
      CHECK (tier = ANY (ARRAY['free'::text, 'pro'::text, 'admin'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_active_exam_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_active_exam_check
      CHECK (active_exam = ANY (ARRAY['kenntnispruefung'::text, 'kmp_innsbruck'::text, 'pharma'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.webhook_attempts'::regclass AND conname = 'webhook_attempts_result_check') THEN
    ALTER TABLE public.webhook_attempts ADD CONSTRAINT webhook_attempts_result_check
      CHECK (result = ANY (ARRAY['processed'::text, 'dup'::text, 'sig_invalid'::text, 'parse_error'::text, 'user_not_found'::text, 'other_error'::text]));
  END IF;
END
$codify$;

-- Scope the 2 s lock timeout to this file, not the rest of the applying session.
RESET lock_timeout;
