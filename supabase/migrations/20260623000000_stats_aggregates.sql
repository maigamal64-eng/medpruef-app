-- ═══════════════════════════════════════════════════════════════════
-- get_user_topic_stats(p_user_id uuid) — 2026-06-23 (bug B-07)
-- ═══════════════════════════════════════════════════════════════════
-- Context: /api/stats computed per-topic accuracy by SELECTing every
-- answer_history row for the user into JS and counting in a loop.
-- Supabase's PostgREST client silently caps a SELECT at 1000 rows, so
-- any user with >1000 answered questions got WRONG per-topic stats —
-- only their first ~1000 answers (by insertion order) were counted,
-- and which topics got truncated was arbitrary.
--
-- Confirmed on prod (2026-06-23): 4 of 75 users with answers exceed
-- 1000 rows (max 1557). For the worst case the per-topic "total" was
-- off by up to 5x (e.g. HNO: 31 counted vs 188 real) and accuracy
-- percentages drifted a few points per topic.
--
-- Fix: move the GROUP BY server-side, exactly as get_topic_counts and
-- the get_admin_* RPCs already do, so count(*) is cheap and correct
-- with no row cap.
--
-- This RPC mirrors the *live* get_topic_counts convention (verified
-- against prod pg_proc, NOT the stale baseline migration which still
-- shows the old `exam_source` signature + SECURITY DEFINER):
--   • SECURITY INVOKER (the default) — the route calls this via the
--     service-role client which bypasses RLS, so reads work; keeping
--     INVOKER means RLS stays as the backstop and this never becomes a
--     parameterized "any user's stats" reader gated only by EXECUTE.
--   • LANGUAGE sql, STABLE
--   • SET search_path = public, pg_temp
--   • p_-prefixed parameter
--
-- Semantics reproduce the prior JS path EXACTLY (byte-identical for the
-- 71 sub-1000 users, verified on prod):
--   • count EVERY answer row (NOT deduped by question — that is
--     /api/user/topic-progress's behavior, deliberately different here)
--   • topic := coalesce(nullif(topic,''),'Unknown')  (the JS was
--     `questions?.topic || 'Unknown'`, which also buckets '' and null
--     under 'Unknown'; prod currently has 0 null/empty topics so this
--     is defensive only and moves no existing number)
--   • is_correct truthy ⇒ correct++
--   • counts cast ::int so PostgREST returns numbers, not bigint strings
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_topic_stats(p_user_id uuid)
RETURNS TABLE (topic text, total int, correct int)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(nullif(q.topic, ''), 'Unknown') AS topic,
    count(*)::int                            AS total,
    count(*) FILTER (WHERE ah.is_correct)::int AS correct
  FROM answer_history ah
  LEFT JOIN questions q ON q.id = ah.question_id
  WHERE ah.user_id = p_user_id
  GROUP BY coalesce(nullif(q.topic, ''), 'Unknown');
$$;

-- Defence-in-depth: this RPC takes a user_id argument, so it must never
-- be reachable unauthenticated via PostgREST /rest/v1/rpc/. It is called
-- ONLY from /api/stats via the service-role client (getServiceClient),
-- which keeps its own EXECUTE grant and bypasses these REVOKEs. Mirrors
-- the idiom in 20260602062251_revoke_anon_exec_on_admin_rpcs.sql.
-- REVOKE is idempotent — safe to re-run.
REVOKE EXECUTE ON FUNCTION public.get_user_topic_stats(uuid)
  FROM PUBLIC, anon, authenticated;
