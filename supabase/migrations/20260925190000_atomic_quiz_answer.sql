-- Record an answer and every derived counter as one transaction. The client
-- request key makes a retry after a lost response idempotent.
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
    INSERT INTO public.user_question_progress(user_id, question_id, times_seen, times_correct, ease_factor,
      interval_days, next_review_at, last_seen_at)
    VALUES (p_user_id, p_question_id, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      CASE WHEN p_is_correct THEN 2.6 ELSE 2.3 END,
      CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      now() + CASE WHEN p_is_correct THEN interval '1 day' ELSE interval '0 day' END, now())
    ON CONFLICT (user_id, question_id) DO UPDATE SET
      times_seen = coalesce(user_question_progress.times_seen, 0) + 1,
      times_correct = coalesce(user_question_progress.times_correct, 0) + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
      ease_factor = CASE WHEN p_is_correct THEN least(3.0, coalesce(user_question_progress.ease_factor, 2.5) + 0.1)
                         ELSE greatest(1.3, coalesce(user_question_progress.ease_factor, 2.5) - 0.2) END,
      interval_days = CASE WHEN p_is_correct
        THEN greatest(1, round(coalesce(user_question_progress.interval_days, 0) * least(3.0, coalesce(user_question_progress.ease_factor, 2.5) + 0.1))::integer)
        ELSE 0 END,
      next_review_at = now() + CASE WHEN p_is_correct
        THEN greatest(1, round(coalesce(user_question_progress.interval_days, 0) * least(3.0, coalesce(user_question_progress.ease_factor, 2.5) + 0.1))::integer) * interval '1 day'
        ELSE interval '0 day' END,
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

REVOKE EXECUTE ON FUNCTION public.record_quiz_answer(uuid, integer, boolean, text, integer, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_quiz_answer(uuid, integer, boolean, text, integer, boolean, uuid) TO service_role;
