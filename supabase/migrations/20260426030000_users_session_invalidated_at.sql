-- review-2026-04-26-B1 · session-invalidation column for force-refresh.
--
-- Obai's case proved that when an admin grants Pro to a user with a
-- stale browser session, there's no way to invalidate the cached
-- client state from the server. Users had to manually clear site data,
-- which 80% of doctors won't figure out.
--
-- This column lets the new POST /api/admin/users/<id>/force-refresh-session
-- stamp now() so requireUser() in src/lib/auth-guard.ts can compare
-- the request's session-issued-at against this stamp and short-circuit
-- with code:'REFRESH_REQUIRED'. The client interceptor (authFetch.ts)
-- catches that, clears caches + localStorage, and triggers a fresh
-- /api/auth.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_invalidated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_session_invalidated_at
  ON public.users (session_invalidated_at)
  WHERE session_invalidated_at IS NOT NULL;

COMMENT ON COLUMN public.users.session_invalidated_at IS
  'When set to a timestamp, the auth guard rejects any session whose '
  '`issued_at` (or, in absence of that, the user''s last login) is older '
  'than this value with code:''REFRESH_REQUIRED''. Used by the admin '
  'force-refresh endpoint after granting Pro / changing tier so the '
  'user picks up the new state without manually clearing site data. '
  'See review-2026-04-26-B1.';
