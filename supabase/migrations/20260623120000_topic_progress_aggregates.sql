-- ═══════════════════════════════════════════════════════════════════
-- get_user_topic_progress(p_user_id uuid, p_exam_type text) — 2026-06-23 (bug B-21)
-- ═══════════════════════════════════════════════════════════════════
-- Context: /api/user/topic-progress computed per-topic progress by
-- SELECTing every answer_history row for the user (joined to questions
-- for the topic + exam_type filter) into JS and deduping question_ids
-- with per-topic Sets. Supabase's PostgREST client silently caps a
-- SELECT at 1000 rows, so any user with >1000 answer_history rows got
-- WRONG per-topic answered/correct/wrong/accuracy — only their first
-- ~1000 answers (by insertion order) reached JS, and which topics got
-- truncated was arbitrary. The route's `.limit(50000)` does NOT help:
-- the server-side max-rows ceiling overrides a higher client limit.
-- This is the SAME class as B-07 (fixed for /api/stats via
-- get_user_topic_stats); the existence of get_topic_counts "to bypass
-- the 1000-row REST limit" is the standing tell.
--
-- Confirmed on prod (2026-06-23): 4 of 75 users with answers exceed
-- 1000 answer_history rows (1557 / 1508 / 1407 / 1203). Those four read
-- truncated per-topic progress here too.
--
-- Fix: move the GROUP BY + DISTINCT-question dedup server-side, exactly
-- as get_topic_counts and get_user_topic_stats already do, so the
-- aggregate is correct with no row cap.
--
-- This RPC mirrors the *live* get_topic_counts / get_user_topic_stats
-- convention (verified against prod pg_proc 2026-06-23):
--   • SECURITY INVOKER (the default) — the route calls this via the
--     service-role client which bypasses RLS, so reads work; keeping
--     INVOKER means RLS stays the backstop and this never becomes a
--     parameterized "any user's progress" reader gated only by EXECUTE.
--   • LANGUAGE sql, STABLE
--   • SET search_path = public, pg_temp
--   • p_-prefixed parameters
--   • counts cast ::int so PostgREST returns numbers, not bigint strings
--
-- ── SEMANTIC FIDELITY (this is the part that differs from B-07) ──────
-- topic-progress DEDUPES by question_id (distinct *questions* answered
-- per topic), whereas /api/stats counts every attempt. The prior JS
-- kept THREE separate per-topic Sets, all keyed by question_id:
--     answered.add(qid)                       -- every row
--     if (is_correct) correct.add(qid)        -- ever-correct qids
--     else            wrong.add(qid)          -- ever-wrong qids
-- then emitted { answered: answered.size, correct: correct.size,
--                wrong: wrong.size }.
-- CRITICAL: a question answered correctly once AND incorrectly another
-- time lands in BOTH the correct and the wrong Set, so in general
--     answered  !=  correct + wrong          (they overlap)
-- and `wrong` MUST be counted independently — it CANNOT be derived as
-- (answered - correct). Verified on prod: for the worst user
-- (c24ab4d1…, kenntnispruefung) 55 question_ids are both-correct-and-
-- wrong; e.g. Psychiatrie answered=296 but correct+wrong=321. The
-- count(DISTINCT …) FILTER form below reproduces each Set exactly:
--     answered := count(DISTINCT question_id)
--     correct  := count(DISTINCT question_id) FILTER (WHERE is_correct)
--     wrong    := count(DISTINCT question_id) FILTER (WHERE NOT is_correct)
--
-- Other fidelity points, each matched to the JS it replaces (all
-- verified against prod so the sub-1000 path stays byte-identical):
--   • INNER JOIN questions (matches `questions!inner`). 0 orphan
--     answer_history rows on prod, so inner vs left is a no-op today;
--     inner is the faithful reproduction of `row.questions?.topic`
--     being undefined → `continue` when a row has no matching question.
--   • exam_type scoped in the JOIN/WHERE (matches
--     `.eq('questions.exam_type', examType)`).
--   • NO is_active filter. The JS join does NOT filter is_active, and
--     the worst user has exactly 1 answered row on an INACTIVE question
--     (6 such rows exist globally). Adding `q.is_active` here would drop
--     that distinct question and diverge from the live path. Deliberate.
--   • topic := coalesce(nullif(topic,''),'Unknown'). The JS skipped
--     rows whose topic was falsy (`if (!topic) continue`), so '' / null
--     never produced a bucket. With an INNER JOIN a NULL topic still
--     yields a row, so we fold null/'' into 'Unknown' rather than skip;
--     prod currently has 0 null/empty topics on answered questions, so
--     this is defensive only and moves no existing number. (Route then
--     only emits topics present in get_topic_counts, so an 'Unknown'
--     bucket that has no counts-row is dropped downstream anyway.)
--   • is_correct is NOT NULL on prod (0 nulls), so FILTER (WHERE
--     is_correct) / FILTER (WHERE NOT is_correct) partition cleanly.
--
-- `total` and `accuracy` are NOT computed here: `total` stays sourced
-- from get_topic_counts and `accuracy` stays computed in the route
-- (round(correct/answered*100)), exactly as before — this RPC only
-- replaces the truncation-prone raw-row fetch + JS dedup.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_topic_progress(
  p_user_id   uuid,
  p_exam_type text
)
RETURNS TABLE (topic text, answered int, correct int, wrong int)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    coalesce(nullif(q.topic, ''), 'Unknown')                          AS topic,
    count(DISTINCT ah.question_id)::int                                AS answered,
    count(DISTINCT ah.question_id) FILTER (WHERE ah.is_correct)::int   AS correct,
    count(DISTINCT ah.question_id) FILTER (WHERE NOT ah.is_correct)::int AS wrong
  FROM answer_history ah
  JOIN questions q ON q.id = ah.question_id
  WHERE ah.user_id = p_user_id
    AND q.exam_type = p_exam_type
  GROUP BY coalesce(nullif(q.topic, ''), 'Unknown');
$$;

-- Defence-in-depth: this RPC takes a user_id argument, so it must never
-- be reachable unauthenticated via PostgREST /rest/v1/rpc/. It is called
-- ONLY from /api/user/topic-progress via the service-role client
-- (getServiceClient), which keeps its own EXECUTE grant and bypasses
-- these REVOKEs. Mirrors get_user_topic_stats +
-- 20260602062251_revoke_anon_exec_on_admin_rpcs.sql. REVOKE is
-- idempotent — safe to re-run.
REVOKE EXECUTE ON FUNCTION public.get_user_topic_progress(uuid, text)
  FROM PUBLIC, anon, authenticated;
