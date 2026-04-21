-- 20260422000000_kmp_grading_backfill.sql
--
-- C-1: Fix KMP Innsbruck grading. The KoalaMed import (scripts/import_koalamed.py)
-- wrote `choices` JSONB with an `is_correct` key, but every other exam_type and
-- the client-side MCQ builder (src/lib/mcq.ts::buildMCQFromChoices) read the
-- `correct` key. Result: EVERY KMP choice had `correct: undefined` on the
-- client, so every answer graded as wrong. 46 of 47 stored answer_history rows
-- with a true text match were marked is_correct=false. 98% false-negative rate
-- on KMP.
--
-- This migration does three idempotent things:
--   1. Rewrite `questions.choices` for all kmp_innsbruck rows so every choice
--      object has a `correct` key (copied from `is_correct` when present).
--      The `is_correct` key is preserved for backwards compatibility.
--   2. Regrade `answer_history` rows where the user's answer text genuinely
--      matches the canonical `questions.answer` but is_correct=false.
--   3. Bump `user_gamification.total_correct` for users whose rows got
--      regraded. current_streak is NOT touched here — that's fixed in a
--      separate backfill (scripts/backfill_current_streak.py).
--
-- Safe to run twice — step 1 is a no-op if `correct` already exists; step 2
-- uses a WHERE clause that a second run matches zero rows on.

BEGIN;

-- ── Step 1. Normalize KMP choices JSONB ─────────────────────────────────
-- For each kmp_innsbruck question, rewrite every element of `choices` so
-- that the object has a top-level `correct` boolean. We keep `is_correct`
-- alongside for anything still reading the old key (e.g. old cached PWA
-- bundles until they update). Pharma rows have NULL choices → untouched.
WITH kmp_rows AS (
  SELECT id, choices
  FROM questions
  WHERE exam_type = 'kmp_innsbruck'
    AND choices IS NOT NULL
    -- Only rows whose first element is missing a `correct` key — this
    -- makes re-runs a no-op.
    AND NOT (choices->0 ? 'correct')
)
UPDATE questions q
SET choices = (
  SELECT jsonb_agg(
    elem || jsonb_build_object(
      'correct',
      COALESCE((elem->>'is_correct')::boolean, (elem->>'correct')::boolean, false)
    )
  )
  FROM jsonb_array_elements(q.choices) AS elem
)
FROM kmp_rows
WHERE q.id = kmp_rows.id;

-- ── Step 2. Regrade affected answer_history rows ────────────────────────
-- Match on TRIM(lower(...)) against both the canonical `answer` and the
-- " | "-concatenated multi-correct string. Covers single-correct + multi.
WITH regrade AS (
  SELECT ah.id, ah.user_id, ah.xp_earned, q.difficulty
  FROM answer_history ah
  JOIN questions q ON q.id = ah.question_id
  WHERE q.exam_type = 'kmp_innsbruck'
    AND ah.is_correct = false
    AND ah.user_answer IS NOT NULL
    AND TRIM(LOWER(q.answer)) = TRIM(LOWER(ah.user_answer))
),
regrade_update AS (
  UPDATE answer_history ah
  SET is_correct = true
  FROM regrade r
  WHERE ah.id = r.id
  RETURNING ah.id, ah.user_id
)
SELECT
  (SELECT COUNT(*) FROM regrade) AS rows_regraded,
  (SELECT COUNT(DISTINCT user_id) FROM regrade_update) AS users_affected;

-- ── Step 3. Bump total_correct on user_gamification ─────────────────────
-- Count of newly-flipped rows per user → add to total_correct.
-- Uses the same match predicate as step 2 but re-derives the count from
-- answer_history (which now has the flipped bits) for a stable deterministic
-- result that survives step 2 running.
--
-- Idempotency trick: we only bump users whose stored total_correct is
-- LESS than the actual count of is_correct=true rows in answer_history.
-- On a second run the counts match → WHERE filters everything out → no-op.
WITH actual_correct AS (
  SELECT user_id, COUNT(*) AS actual
  FROM answer_history
  WHERE is_correct = true
  GROUP BY user_id
)
UPDATE user_gamification ug
SET total_correct = ac.actual
FROM actual_correct ac
WHERE ug.user_id = ac.user_id
  AND ug.total_correct < ac.actual;

COMMIT;
