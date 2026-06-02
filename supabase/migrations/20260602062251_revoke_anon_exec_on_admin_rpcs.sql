-- D-1 (security audit 2026-06-02): four public SECURITY DEFINER functions were
-- EXECUTE-able by the anon/authenticated roles via PostgREST /rest/v1/rpc/,
-- bypassing the requireAdmin API guard entirely:
--   * get_admin_overview_counts()                  → leaked business metrics (total_users, DAU/WAU/MAU, questions/day)
--   * get_admin_daily_active_users(integer)         → leaked per-day actives
--   * increment_topic_strength(uuid,text,text,bool) → let anon forge another user's topic-strength stats
--   * increment_user_announcements_qs(uuid)         → let anon forge another user's announcement-gate counter
--
-- All four are invoked ONLY via the service-role client (getServiceClient):
--   - src/app/api/answer/route.ts      → increment_user_announcements_qs, increment_topic_strength
--   - src/app/api/stats/admin/route.ts → get_admin_overview_counts, get_admin_daily_active_users
-- service_role keeps its own explicit EXECUTE grant and bypasses these revokes,
-- so the app is unaffected. Revoking from PUBLIC + anon + authenticated closes
-- the unauthenticated path. PUBLIC is included because
-- increment_user_announcements_qs is reachable by anon via the default PUBLIC
-- grant even though its explicit ACL lists only postgres/service_role.
--
-- REVOKE is idempotent — safe to re-run / safe alongside the already-applied
-- remote migration (version 20260602062251). This file mirrors that change so a
-- `supabase db reset` / rebuild-from-files keeps the hole closed.

REVOKE EXECUTE ON FUNCTION public.get_admin_overview_counts()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_daily_active_users(integer)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_topic_strength(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_user_announcements_qs(uuid)
  FROM PUBLIC, anon, authenticated;
