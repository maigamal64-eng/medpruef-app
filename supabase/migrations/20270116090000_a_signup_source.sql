-- a-signup-source-1029 (2026-10-29). UNAPPLIED: track-A applies by hand.
-- Every new account records the lever that brought it, so the tagged share
-- of signups can be read from users alone (79 percent carried no source).
--   signup_source        one key, src/lib/signup-source SIGNUP_SOURCE_RE
--                        (utm:<s>, code:<c>, referral, tg:<method>,
--                        ref:<channel>, app_shell, direct, ...); never a URL,
--                        raw host, address, name, referral code or id
--   signup_source_basis  the precedence rung that chose it
-- Written once by /api/auth for an account it has just created, only while
-- SIGNUP_SOURCE_ENABLED is the literal "true" (default OFF). Existing
-- accounts stay NULL (no backfill). Nullable columns without a default are
-- a catalog-only change, so no table rewrite. Rollback:
-- scripts/sql/track-a/a-signup-source/down.sql.
SET lock_timeout = '3s';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signup_source text,
  ADD COLUMN IF NOT EXISTS signup_source_basis text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_signup_source_shape'
                 AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_signup_source_shape CHECK (
      signup_source IS NULL OR (
        length(signup_source) <= 120
        AND signup_source ~ '^(direct|app_shell|referral|lernplan|selbsttest|tg_welcome|tg_ref|fb_ref|tg:(bot_deeplink|miniapp|widget)|ref:[a-z0-9]{1,24}|(utm|code|gratis|blog|sitting|tg_post|tg_start):[a-z0-9][a-z0-9_-]{0,79})$'
      )
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_signup_source_basis_shape'
                 AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_signup_source_basis_shape CHECK (
      signup_source_basis IS NULL
      OR signup_source_basis IN ('utm', 'code', 'telegram', 'referrer', 'app_shell', 'direct')
    ) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.users VALIDATE CONSTRAINT users_signup_source_shape;
ALTER TABLE public.users VALIDATE CONSTRAINT users_signup_source_basis_shape;

COMMENT ON COLUMN public.users.signup_source IS 'Lever that brought the account (a-signup-source-1029): one SIGNUP_SOURCE_RE key, written once at signup while SIGNUP_SOURCE_ENABLED is on.';
COMMENT ON COLUMN public.users.signup_source_basis IS 'Precedence rung that chose signup_source: utm, code, telegram, referrer, app_shell, direct.';
