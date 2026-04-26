-- review-2026-04-26-C2 · auto-bump users.updated_at on every UPDATE.
--
-- Direct DB updates to `users.tier` (e.g. via Supabase MCP for the
-- 3 Tier-1 yes-reply grants on 2026-04-26) didn't bump `updated_at`.
-- Audit trail is broken.
--
-- This trigger sets `updated_at = now()` on every actual change.
-- The `WHEN (OLD.* IS DISTINCT FROM NEW.*)` guard prevents a no-op
-- UPDATE from bumping the timestamp.

CREATE OR REPLACE FUNCTION public.bump_users_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_updated_at_bump ON public.users;
CREATE TRIGGER users_updated_at_bump
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.bump_users_updated_at();

COMMENT ON FUNCTION public.bump_users_updated_at IS
  'Sets users.updated_at = now() on every UPDATE that actually changes '
  'a value. Wired via the users_updated_at_bump trigger. Closes the '
  'audit gap where direct DB updates (Supabase Studio, MCP scripts) '
  'left updated_at stale. See review-2026-04-26-C2.';
