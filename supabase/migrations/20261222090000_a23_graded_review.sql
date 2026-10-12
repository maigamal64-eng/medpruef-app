-- a23 practice (chain L): honest spaced repetition and a separate flashcard
-- review kind. UNAPPLIED changeset; track-A applies it on a release GO.
-- Rollback: scripts/sql/track-a/a23-practice/down.sql.
-- Proof: npm run test:db:a23 (throwaway PostgreSQL 16).
--
-- Decisions (reports/decision-triage-2026-10-11):
--   pick-scheduler A        graded scheduling exists only behind SRS_GRADE_ENABLED
--                           (default OFF); questions keep the binary scheduler.
--   pick-interval-limits A  new intervals at most 180 days and never later than
--                           the exam date minus 2 days. Old rows above the cap are
--                           not rewritten; they are capped on their next answer.
--   pick-ux-pra-59 A        a flashcard rating is its own kind: schedule plus a
--                           review log, no answer_history row, no XP, no accuracy,
--                           no free-cap count, no mistake-list entry. The streak
--                           still advances. Behind FLASHCARD_REVIEW_KIND_ENABLED.
--   pick-ux-pra-85 A        handled in /api/answer (FREE_SCHEDULE_ENABLED decides
--                           p_is_free / p_schedule); no SQL difference.
--   UX-PRA-55               get_mistake_rows: one server rule for open and
--                           corrected mistakes (read-only, service_role only).
--
-- An exam date in the past never caps anything (a stale users.exam_date would
-- otherwise make every card due immediately). src/lib/master-learning/srs.ts
-- mirrors these functions; tests/unit/master-plan/learning/srs-golden.json was
-- produced by srs_graded_next and pins the arithmetic.

-- 1. The two caps, shared by every scheduler below.
CREATE OR REPLACE FUNCTION public.srs_cap_interval(
  p_days integer,
  p_today date,
  p_exam_date date
) RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_exam_date IS NOT NULL AND p_today IS NOT NULL AND p_exam_date >= p_today
      THEN least(least(p_days, 180), greatest(0, (p_exam_date - p_today) - 2))
    ELSE least(p_days, 180)
  END;
$$;

-- 2. Graded arithmetic (b35 track-B draft, past-exam fix added).
CREATE OR REPLACE FUNCTION public.srs_graded_next(
  p_ease double precision,
  p_interval integer,
  p_grade smallint,
  p_today date,
  p_exam_date date
) RETURNS TABLE(ease_factor double precision, interval_days integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ease0 double precision := coalesce(p_ease, 2.5);
  v_prev integer := greatest(coalesce(p_interval, 0), 0);
  v_ease double precision := coalesce(p_ease, 2.5);
  v_raw integer;
  v_base integer;
BEGIN
  IF p_grade IS NULL OR p_grade < 0 OR p_grade > 3 THEN
    RAISE EXCEPTION 'INVALID_GRADE' USING ERRCODE = 'P0001';
  END IF;

  IF p_grade = 0 THEN
    v_ease := greatest(1.3, v_ease0 - 0.2);
    v_raw := 0;
  ELSIF p_grade = 1 THEN
    v_ease := greatest(1.3, v_ease0 - 0.15);
    v_raw := CASE WHEN v_prev <= 0 THEN 1 ELSE greatest(1, round(v_prev * 1.2::double precision)::integer) END;
  ELSIF p_grade = 2 THEN
    v_raw := CASE
      WHEN v_prev <= 0 THEN 1
      WHEN v_prev < 6 THEN 6
      ELSE greatest(1, round(v_prev * v_ease0)::integer)
    END;
  ELSE
    v_ease := least(3.0, v_ease0 + 0.15);
    v_base := CASE
      WHEN v_prev <= 0 THEN 1
      WHEN v_prev < 6 THEN 6
      ELSE greatest(1, round(v_prev * v_ease)::integer)
    END;
    v_raw := greatest(v_base + 1, round(v_base * 1.3::double precision)::integer);
  END IF;

  ease_factor := v_ease;
  interval_days := public.srs_cap_interval(v_raw, p_today, p_exam_date);
  RETURN NEXT;
END;
$$;

-- 3. record_quiz_answer: identical to 20260925190000 except that the stored
--    interval is capped (180 days, exam date minus 2). Same signature, so
--    CREATE OR REPLACE keeps the grants.
CREATE OR REPLACE FUNCTION public.record_quiz_answer(
  p_user_id uuid,
  p_question_id integer,
  p_is_correct boolean,
  p_user_answer text,
  p_time_spent_ms integer,
  p_is_free boolean,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_question public.questions%ROWTYPE;
  v_answer_id uuid;
  v_existing public.answer_history%ROWTYPE;
  v_gam public.user_gamification%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_yesterday date := ((now() AT TIME ZONE 'Europe/Vienna')::date - 1);
  v_xp integer;
  v_new_streak integer;
  v_new_day boolean;
  v_exam date;
BEGIN
  SELECT * INTO v_question
  FROM public.questions
  WHERE id = p_question_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  v_xp := CASE WHEN p_is_correct THEN 10 + (coalesce(v_question.difficulty, 2) - 1) * 5 ELSE 2 END;

  IF p_request_id IS NULL THEN
    INSERT INTO public.answer_history(user_id, question_id, user_answer, is_correct, time_spent_ms, xp_earned)
    VALUES (p_user_id, p_question_id, nullif(p_user_answer, ''), p_is_correct, nullif(p_time_spent_ms, 0), v_xp)
    RETURNING id INTO v_answer_id;
  ELSE
    INSERT INTO public.answer_history(user_id, question_id, user_answer, is_correct, time_spent_ms, xp_earned, client_request_id)
    VALUES (p_user_id, p_question_id, nullif(p_user_answer, ''), p_is_correct, nullif(p_time_spent_ms, 0), v_xp, p_request_id)
    ON CONFLICT (user_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_answer_id;

    IF v_answer_id IS NULL THEN
      SELECT * INTO v_existing FROM public.answer_history
      WHERE user_id = p_user_id AND client_request_id = p_request_id;
      IF v_existing.question_id IS DISTINCT FROM p_question_id OR v_existing.is_correct IS DISTINCT FROM p_is_correct THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;
      SELECT * INTO v_gam FROM public.user_gamification WHERE user_id = p_user_id;
      RETURN jsonb_build_object('saved', true, 'duplicate', true, 'xp', 0,
                                'totalXp', coalesce(v_gam.total_xp, 0),
                                'gamification', CASE WHEN v_gam.user_id IS NULL THEN NULL ELSE to_jsonb(v_gam) END);
    END IF;
  END IF;

  IF NOT p_is_free THEN
    SELECT exam_date INTO v_exam FROM public.users WHERE id = p_user_id;
    INSERT INTO public.user_question_progress(user_id, question_id, times_seen, times_correct, ease_factor,
      interval_days, next_review_at, last_seen_at)
    VALUES (p_user_id, p_question_id, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      CASE WHEN p_is_correct THEN 2.6 ELSE 2.3 END,
      public.srs_cap_interval(CASE WHEN p_is_correct THEN 1 ELSE 0 END, v_today, v_exam),
      now() + public.srs_cap_interval(CASE WHEN p_is_correct THEN 1 ELSE 0 END, v_today, v_exam) * interval '1 day',
      now())
    ON CONFLICT (user_id, question_id) DO UPDATE SET
      times_seen = coalesce(user_question_progress.times_seen, 0) + 1,
      times_correct = coalesce(user_question_progress.times_correct, 0) + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      ease_factor = CASE WHEN p_is_correct THEN least(3.0, coalesce(user_question_progress.ease_factor, 2.5) + 0.1)
                         ELSE greatest(1.3, coalesce(user_question_progress.ease_factor, 2.5) - 0.2) END,
      interval_days = public.srs_cap_interval(CASE WHEN p_is_correct
        THEN greatest(1, round(coalesce(user_question_progress.interval_days, 0) * least(3.0, coalesce(user_question_progress.ease_factor, 2.5) + 0.1))::integer)
        ELSE 0 END, v_today, v_exam),
      next_review_at = now() + public.srs_cap_interval(CASE WHEN p_is_correct
        THEN greatest(1, round(coalesce(user_question_progress.interval_days, 0) * least(3.0, coalesce(user_question_progress.ease_factor, 2.5) + 0.1))::integer)
        ELSE 0 END, v_today, v_exam) * interval '1 day',
      last_seen_at = now();
  END IF;

  INSERT INTO public.user_gamification(user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO STRICT v_gam FROM public.user_gamification WHERE user_id = p_user_id FOR UPDATE;

  v_new_day := v_gam.daily_reset_date IS DISTINCT FROM v_today;
  IF NOT v_new_day THEN
    v_new_streak := greatest(coalesce(v_gam.current_streak, 0), 1);
  ELSIF v_gam.last_study_date = v_yesterday THEN
    v_new_streak := coalesce(v_gam.current_streak, 0) + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  UPDATE public.user_gamification SET
    total_questions_answered = coalesce(total_questions_answered, 0) + 1,
    total_correct = coalesce(total_correct, 0) + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    total_xp = coalesce(total_xp, 0) + v_xp,
    current_streak = v_new_streak,
    longest_streak = greatest(coalesce(longest_streak, 0), v_new_streak),
    last_study_date = v_today,
    daily_questions_today = CASE WHEN v_new_day THEN 1 ELSE coalesce(daily_questions_today, 0) + 1 END,
    daily_reset_date = v_today
  WHERE user_id = p_user_id RETURNING * INTO v_gam;

  UPDATE public.users SET xp_total = v_gam.total_xp, last_active_date = v_today WHERE id = p_user_id;

  INSERT INTO public.user_topic_strength(user_id, exam_type, topic, answered, correct, last_answered_at, updated_at)
  VALUES (p_user_id, v_question.exam_type, v_question.topic, 1,
          CASE WHEN p_is_correct THEN 1 ELSE 0 END, now(), now())
  ON CONFLICT (user_id, exam_type, topic) DO UPDATE SET
    answered = public.user_topic_strength.answered + 1,
    correct = public.user_topic_strength.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    last_answered_at = now(), updated_at = now();

  RETURN jsonb_build_object('saved', true, 'duplicate', false, 'xp', v_xp,
                            'totalXp', v_gam.total_xp, 'gamification', to_jsonb(v_gam));
END;
$$;

-- 4. Graded quiz answer (b35 draft): history, XP, streak and topic strength
--    stay in record_quiz_answer (binary: good and easy count as right); the
--    progress row is then overwritten with the graded result in the same
--    transaction. A duplicate retry changes nothing.
CREATE OR REPLACE FUNCTION public.record_graded_answer(
  p_user_id uuid,
  p_question_id integer,
  p_grade smallint,
  p_request_id uuid DEFAULT NULL,
  p_is_free boolean DEFAULT false,
  p_user_answer text DEFAULT NULL,
  p_time_spent_ms integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prior public.user_question_progress%ROWTYPE;
  v_exam date;
  v_today date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_next record;
  v_result jsonb;
BEGIN
  IF p_grade IS NULL OR p_grade < 0 OR p_grade > 3 THEN
    RAISE EXCEPTION 'INVALID_GRADE' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_is_free THEN
    SELECT * INTO v_prior FROM public.user_question_progress
    WHERE user_id = p_user_id AND question_id = p_question_id FOR UPDATE;
    SELECT exam_date INTO v_exam FROM public.users WHERE id = p_user_id;
  END IF;

  v_result := public.record_quiz_answer(
    p_user_id, p_question_id, p_grade >= 2, p_user_answer, p_time_spent_ms, p_is_free, p_request_id
  );

  IF p_is_free OR coalesce((v_result ->> 'duplicate')::boolean, false) THEN
    RETURN v_result;
  END IF;

  SELECT * INTO v_next FROM public.srs_graded_next(v_prior.ease_factor, v_prior.interval_days, p_grade, v_today, v_exam);

  UPDATE public.user_question_progress SET
    ease_factor = v_next.ease_factor,
    interval_days = v_next.interval_days,
    next_review_at = now() + v_next.interval_days * interval '1 day'
  WHERE user_id = p_user_id AND question_id = p_question_id;

  RETURN v_result || jsonb_build_object(
    'graded', true,
    'grade', p_grade,
    'intervalDays', v_next.interval_days,
    'nextReviewAt', now() + v_next.interval_days * interval '1 day'
  );
END;
$$;

-- 5. Flashcard review log (pick-ux-pra-59 A). Service role only.
CREATE TABLE IF NOT EXISTS public.flashcard_reviews (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  grade smallint NOT NULL CHECK (grade BETWEEN 0 AND 3),
  client_request_id uuid NOT NULL,
  scheduled boolean NOT NULL DEFAULT false,
  graded boolean NOT NULL DEFAULT false,
  ease_factor double precision,
  interval_days integer,
  next_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flashcard_reviews_request_key UNIQUE (user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS flashcard_reviews_user_created_idx
  ON public.flashcard_reviews (user_id, created_at DESC);
ALTER TABLE public.flashcard_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flashcard_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_reviews TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.flashcard_reviews_id_seq TO service_role;

-- 6. One flashcard rating. p_schedule: write user_question_progress (Pro, or
--    every account when FREE_SCHEDULE_ENABLED). p_graded: four-grade arithmetic
--    (SRS_GRADE_ENABLED); otherwise the binary scheduler with good and easy as
--    right. times_seen and times_correct are never touched, so accuracy and the
--    unseen pool (answer_history) stay quiz-only.
CREATE OR REPLACE FUNCTION public.record_flashcard_review(
  p_user_id uuid,
  p_question_id integer,
  p_grade smallint,
  p_request_id uuid,
  p_schedule boolean,
  p_graded boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review_id bigint;
  v_existing public.flashcard_reviews%ROWTYPE;
  v_prior public.user_question_progress%ROWTYPE;
  v_gam public.user_gamification%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_yesterday date := ((now() AT TIME ZONE 'Europe/Vienna')::date - 1);
  v_exam date;
  v_ease double precision;
  v_days integer;
  v_next_at timestamptz;
  v_new_day boolean;
  v_new_streak integer;
  v_cards_today integer;
BEGIN
  IF p_grade IS NULL OR p_grade < 0 OR p_grade > 3 THEN
    RAISE EXCEPTION 'INVALID_GRADE' USING ERRCODE = 'P0001';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.questions WHERE id = p_question_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.flashcard_reviews(user_id, question_id, grade, client_request_id, scheduled, graded)
  VALUES (p_user_id, p_question_id, p_grade, p_request_id, coalesce(p_schedule, false), coalesce(p_graded, false))
  ON CONFLICT (user_id, client_request_id) DO NOTHING
  RETURNING id INTO v_review_id;

  IF v_review_id IS NULL THEN
    SELECT * INTO v_existing FROM public.flashcard_reviews
    WHERE user_id = p_user_id AND client_request_id = p_request_id;
    IF v_existing.question_id IS DISTINCT FROM p_question_id OR v_existing.grade IS DISTINCT FROM p_grade THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO v_cards_today FROM public.flashcard_reviews
    WHERE user_id = p_user_id AND created_at >= (v_today::timestamp AT TIME ZONE 'Europe/Vienna');
    SELECT * INTO v_gam FROM public.user_gamification WHERE user_id = p_user_id;
    RETURN jsonb_build_object('saved', true, 'duplicate', true, 'kind', 'flashcard', 'xp', 0,
      'scheduled', v_existing.scheduled, 'intervalDays', v_existing.interval_days,
      'nextReviewAt', v_existing.next_review_at, 'cardsToday', v_cards_today,
      'gamification', CASE WHEN v_gam.user_id IS NULL THEN NULL ELSE to_jsonb(v_gam) END);
  END IF;

  IF coalesce(p_schedule, false) THEN
    SELECT * INTO v_prior FROM public.user_question_progress
    WHERE user_id = p_user_id AND question_id = p_question_id FOR UPDATE;
    SELECT exam_date INTO v_exam FROM public.users WHERE id = p_user_id;

    IF coalesce(p_graded, false) THEN
      SELECT n.ease_factor, n.interval_days INTO v_ease, v_days
      FROM public.srs_graded_next(v_prior.ease_factor, v_prior.interval_days, p_grade, v_today, v_exam) n;
    ELSIF v_prior.user_id IS NULL THEN
      v_ease := CASE WHEN p_grade >= 2 THEN 2.6 ELSE 2.3 END;
      v_days := public.srs_cap_interval(CASE WHEN p_grade >= 2 THEN 1 ELSE 0 END, v_today, v_exam);
    ELSIF p_grade >= 2 THEN
      v_ease := least(3.0, coalesce(v_prior.ease_factor, 2.5) + 0.1);
      v_days := public.srs_cap_interval(greatest(1, round(coalesce(v_prior.interval_days, 0) * v_ease)::integer), v_today, v_exam);
    ELSE
      v_ease := greatest(1.3, coalesce(v_prior.ease_factor, 2.5) - 0.2);
      v_days := 0;
    END IF;
    v_next_at := now() + v_days * interval '1 day';

    INSERT INTO public.user_question_progress(user_id, question_id, times_seen, times_correct, ease_factor,
      interval_days, next_review_at, last_seen_at)
    VALUES (p_user_id, p_question_id, 0, 0, v_ease, v_days, v_next_at, now())
    ON CONFLICT (user_id, question_id) DO UPDATE SET
      ease_factor = EXCLUDED.ease_factor,
      interval_days = EXCLUDED.interval_days,
      next_review_at = EXCLUDED.next_review_at,
      last_seen_at = now();

    UPDATE public.flashcard_reviews
    SET ease_factor = v_ease, interval_days = v_days, next_review_at = v_next_at
    WHERE id = v_review_id;
  END IF;

  -- Streak only: totals, XP and the daily question count stay quiz-owned. A
  -- new day still resets daily_questions_today so the quiz streak rule
  -- (daily_reset_date) keeps working.
  INSERT INTO public.user_gamification(user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO STRICT v_gam FROM public.user_gamification WHERE user_id = p_user_id FOR UPDATE;
  v_new_day := v_gam.daily_reset_date IS DISTINCT FROM v_today;
  IF NOT v_new_day THEN
    v_new_streak := greatest(coalesce(v_gam.current_streak, 0), 1);
  ELSIF v_gam.last_study_date = v_yesterday THEN
    v_new_streak := coalesce(v_gam.current_streak, 0) + 1;
  ELSE
    v_new_streak := 1;
  END IF;
  UPDATE public.user_gamification SET
    current_streak = v_new_streak,
    longest_streak = greatest(coalesce(longest_streak, 0), v_new_streak),
    last_study_date = v_today,
    daily_questions_today = CASE WHEN v_new_day THEN 0 ELSE coalesce(daily_questions_today, 0) END,
    daily_reset_date = v_today
  WHERE user_id = p_user_id RETURNING * INTO v_gam;
  UPDATE public.users SET last_active_date = v_today WHERE id = p_user_id;

  SELECT count(*) INTO v_cards_today FROM public.flashcard_reviews
  WHERE user_id = p_user_id AND created_at >= (v_today::timestamp AT TIME ZONE 'Europe/Vienna');

  RETURN jsonb_build_object('saved', true, 'duplicate', false, 'kind', 'flashcard', 'xp', 0,
    'scheduled', coalesce(p_schedule, false), 'intervalDays', v_days,
    'nextReviewAt', v_next_at, 'cardsToday', v_cards_today,
    'gamification', to_jsonb(v_gam));
END;
$$;

-- 7. Open mistakes (UX-PRA-55), one server definition for /mistakes and the
--    "Meine Fehler" pool. A question is open while it has a miss and, since
--    the last miss, fewer than two correct answers with the second at least
--    one day (24 h) after the first; src/lib/learning-metrics.ts isOpenMistake
--    is the same rule. Corrected rows stay listed under "Korrigiert". Totals
--    are counted before the state filter. Stable order: last miss, then id.
CREATE OR REPLACE FUNCTION public.get_mistake_rows(
  p_user_id uuid,
  p_exam_types text[],
  p_topics text[],
  p_state text,
  p_offset integer,
  p_limit integer
) RETURNS TABLE(
  question_id integer,
  topic text,
  is_active boolean,
  wrong_count integer,
  last_wrong_at timestamptz,
  corrected_at timestamptz,
  is_open boolean,
  open_total bigint,
  corrected_total bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH attempts AS (
    SELECT ah.question_id, ah.is_correct, ah.created_at
    FROM public.answer_history ah
    JOIN public.questions q ON q.id = ah.question_id
    WHERE ah.user_id = p_user_id
      AND (p_exam_types IS NULL OR q.exam_type = ANY(p_exam_types))
      AND (p_topics IS NULL OR q.topic = ANY(p_topics))
  ),
  misses AS (
    SELECT a.question_id,
           (count(*) FILTER (WHERE NOT a.is_correct))::integer AS wrong_count,
           max(a.created_at) FILTER (WHERE NOT a.is_correct) AS last_wrong_at
    FROM attempts a
    GROUP BY a.question_id
    HAVING count(*) FILTER (WHERE NOT a.is_correct) > 0
  ),
  since AS (
    SELECT m.question_id, a.created_at,
           min(a.created_at) OVER (PARTITION BY m.question_id) AS first_ok
    FROM misses m
    JOIN attempts a ON a.question_id = m.question_id AND a.is_correct AND a.created_at > m.last_wrong_at
  ),
  graduated AS (
    SELECT s.question_id, min(s.created_at) AS corrected_at
    FROM since s
    WHERE s.created_at >= s.first_ok + interval '1 day'
    GROUP BY s.question_id
  ),
  rows_all AS (
    SELECT m.question_id, q.topic, q.is_active, m.wrong_count, m.last_wrong_at, g.corrected_at,
           (g.corrected_at IS NULL) AS is_open
    FROM misses m
    JOIN public.questions q ON q.id = m.question_id
    LEFT JOIN graduated g ON g.question_id = m.question_id
  ),
  counted AS (
    SELECT r.*,
           count(*) FILTER (WHERE r.is_open) OVER () AS open_total,
           count(*) FILTER (WHERE NOT r.is_open) OVER () AS corrected_total
    FROM rows_all r
  )
  SELECT c.question_id, c.topic, c.is_active, c.wrong_count, c.last_wrong_at, c.corrected_at, c.is_open,
         c.open_total, c.corrected_total
  FROM counted c
  WHERE coalesce(p_state, 'open') = 'all'
     OR (coalesce(p_state, 'open') = 'open' AND c.is_open)
     OR (p_state = 'corrected' AND NOT c.is_open)
  ORDER BY c.last_wrong_at DESC, c.question_id DESC
  OFFSET greatest(coalesce(p_offset, 0), 0)
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION public.srs_cap_interval(integer, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srs_cap_interval(integer, date, date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.srs_graded_next(double precision, integer, smallint, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srs_graded_next(double precision, integer, smallint, date, date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.record_quiz_answer(uuid, integer, boolean, text, integer, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_quiz_answer(uuid, integer, boolean, text, integer, boolean, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.record_graded_answer(uuid, integer, smallint, uuid, boolean, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_graded_answer(uuid, integer, smallint, uuid, boolean, text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.record_flashcard_review(uuid, integer, smallint, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_flashcard_review(uuid, integer, smallint, uuid, boolean, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_mistake_rows(uuid, text[], text[], text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mistake_rows(uuid, text[], text[], text, integer, integer) TO service_role;
