-- a-topic-reset-selfserve-1019 ([name] 19 Oct, decision topic-reset-selfserve-1019).
-- A signed-in learner resets the progress of one subject (exam type + topic);
-- every reset is backed up in public.progress_resets and an admin can restore it.
--
-- Scope of a reset, for the caller's rows of the questions with that
-- exam_type and topic (topic as stored on questions, active or not, the same
-- join get_user_topic_progress uses):
--   answer_history          deleted (the per-topic answers, mistakes, coverage)
--   user_question_progress  deleted; a bookmarked row is kept and its review
--                           schedule cleared (the bookmark survives the reset)
--   user_topic_strength     the (user, exam_type, topic) counter row deleted
--   flashcard_reviews       deleted when the table exists (a23 changeset)
-- Never touched: user_gamification (XP, streak, totals), subscriptions,
-- exam_simulations, notes, other topics or exams.
--
-- Every deleted or changed row is stored as full row JSON in
-- progress_resets.archived before the write; counts are checked against the
-- archive inside the same transaction. question_ids keeps the distinct
-- questions of the archived answers so the free sample still counts them
-- (src/lib/free-tier.ts) until a restore puts them back.
-- Service role only; RLS on, no policies (deny-all for anon/authenticated).
-- Rollback (proof only, refuses while resets exist): scripts/sql/track-a/a-topic-reset/down.sql

CREATE TABLE IF NOT EXISTS public.progress_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exam_type text NOT NULL,
  topic text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by uuid,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  restore_counts jsonb
);

CREATE INDEX IF NOT EXISTS progress_resets_user_created_idx
  ON public.progress_resets (user_id, created_at DESC);

ALTER TABLE public.progress_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.progress_resets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.progress_resets TO service_role;
-- The archive is never deleted by the app (account deletion still cascades).
REVOKE DELETE, TRUNCATE ON public.progress_resets FROM service_role;

COMMENT ON TABLE public.progress_resets IS
  'a-topic-reset: one row per learner subject reset with the full archived rows; restore via topic_progress_restore. Service role only.';

-- ---------------------------------------------------------------------------
-- Reset
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.topic_progress_reset(
  p_user uuid,
  p_exam_type text,
  p_topic text,
  p_daily_limit integer DEFAULT 10,
  p_max_rows integer DEFAULT 20000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent integer;
  v_ah jsonb;
  v_ah_n integer;
  v_ah_ids uuid[];
  v_qids integer[];
  v_uqp jsonb;
  v_uqp_n integer;
  v_uqp_del integer;
  v_uqp_kept integer;
  v_uts jsonb;
  v_uts_n integer;
  v_fr jsonb := '[]'::jsonb;
  v_fr_n integer := 0;
  v_fr_ids bigint[];
  v_n integer;
  v_has_fr boolean := to_regclass('public.flashcard_reviews') IS NOT NULL;
  v_id uuid;
  v_counts jsonb;
BEGIN
  IF p_user IS NULL OR coalesce(btrim(p_exam_type), '') = '' OR coalesce(btrim(p_topic), '') = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- One reset at a time per learner (double taps, two tabs) and an honest
  -- daily count under that lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('progress_reset:' || p_user::text, 0));

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.questions q WHERE q.exam_type = p_exam_type AND q.topic = p_topic) THEN
    RETURN jsonb_build_object('status', 'unknown_topic');
  END IF;

  SELECT count(*) INTO v_recent FROM public.progress_resets r
   WHERE r.user_id = p_user AND r.created_at > now() - interval '24 hours';
  IF v_recent >= p_daily_limit THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'limit', p_daily_limit);
  END IF;

  -- Lock and snapshot every row the reset will change. Deletes below go by
  -- the ids taken here, so a concurrent answer is never deleted unarchived.
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at, a.id), '[]'::jsonb), count(*),
         coalesce(array_agg(a.id), '{}'::uuid[]),
         coalesce(array_agg(DISTINCT a.question_id) FILTER (WHERE a.question_id IS NOT NULL), '{}'::integer[])
    INTO v_ah, v_ah_n, v_ah_ids, v_qids
    FROM (SELECT h.* FROM public.answer_history h
            JOIN public.questions q ON q.id = h.question_id
           WHERE h.user_id = p_user AND q.exam_type = p_exam_type AND q.topic = p_topic
           FOR UPDATE OF h) a;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.question_id), '[]'::jsonb), count(*)
    INTO v_uqp, v_uqp_n
    FROM (SELECT g.* FROM public.user_question_progress g
            JOIN public.questions q ON q.id = g.question_id
           WHERE g.user_id = p_user AND q.exam_type = p_exam_type AND q.topic = p_topic
             -- A bookmark that was never practised holds no progress.
             AND (NOT coalesce(g.is_bookmarked, false) OR coalesce(g.times_seen, 0) > 0 OR g.last_seen_at IS NOT NULL)
           FOR UPDATE OF g) p;

  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb), count(*)
    INTO v_uts, v_uts_n
    FROM (SELECT t.* FROM public.user_topic_strength t
           WHERE t.user_id = p_user AND t.exam_type = p_exam_type AND t.topic = p_topic
           FOR UPDATE) s;

  IF v_has_fr THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id), '[]'::jsonb), count(*)::int, coalesce(array_agg(f.id), '{}'::bigint[])
        FROM (SELECT r.* FROM public.flashcard_reviews r
                JOIN public.questions q ON q.id = r.question_id
               WHERE r.user_id = $1 AND q.exam_type = $2 AND q.topic = $3
               FOR UPDATE OF r) f
    $q$ INTO v_fr, v_fr_n, v_fr_ids USING p_user, p_exam_type, p_topic;
  END IF;

  IF v_ah_n + v_uqp_n + v_uts_n + v_fr_n = 0 THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;
  IF v_ah_n + v_uqp_n + v_uts_n + v_fr_n > p_max_rows THEN
    RETURN jsonb_build_object('status', 'too_large');
  END IF;

  DELETE FROM public.answer_history h WHERE h.id = ANY (v_ah_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_ah_n THEN RAISE EXCEPTION 'topic_progress_reset: answer_history count mismatch (% vs %)', v_n, v_ah_n; END IF;

  DELETE FROM public.user_question_progress g
   WHERE g.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_uqp) e)
     AND NOT coalesce(g.is_bookmarked, false);
  GET DIAGNOSTICS v_uqp_del = ROW_COUNT;
  UPDATE public.user_question_progress g
     SET times_seen = 0, times_correct = 0, ease_factor = 2.5, interval_days = 0,
         next_review_at = NULL, last_seen_at = NULL
   WHERE g.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_uqp) e)
     AND coalesce(g.is_bookmarked, false);
  GET DIAGNOSTICS v_uqp_kept = ROW_COUNT;
  IF v_uqp_del + v_uqp_kept <> v_uqp_n THEN
    RAISE EXCEPTION 'topic_progress_reset: user_question_progress count mismatch (% vs %)', v_uqp_del + v_uqp_kept, v_uqp_n;
  END IF;

  DELETE FROM public.user_topic_strength t
   WHERE t.user_id = p_user AND t.exam_type = p_exam_type AND t.topic = p_topic;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_uts_n THEN RAISE EXCEPTION 'topic_progress_reset: user_topic_strength count mismatch (% vs %)', v_n, v_uts_n; END IF;

  IF v_has_fr AND v_fr_n > 0 THEN
    EXECUTE 'DELETE FROM public.flashcard_reviews r WHERE r.id = ANY ($1)' USING v_fr_ids;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_fr_n THEN RAISE EXCEPTION 'topic_progress_reset: flashcard_reviews count mismatch (% vs %)', v_n, v_fr_n; END IF;
  END IF;

  v_counts := jsonb_build_object(
    'answer_history', v_ah_n,
    'user_question_progress', v_uqp_del,
    'user_question_progress_bookmark_kept', v_uqp_kept,
    'user_topic_strength', v_uts_n,
    'flashcard_reviews', v_fr_n,
    'questions', coalesce(array_length(v_qids, 1), 0)
  );

  INSERT INTO public.progress_resets (user_id, exam_type, topic, counts, archived, question_ids)
  VALUES (p_user, p_exam_type, p_topic, v_counts,
          jsonb_build_object('answer_history', v_ah, 'user_question_progress', v_uqp,
                             'user_topic_strength', v_uts, 'flashcard_reviews', v_fr),
          v_qids)
  RETURNING id INTO v_id;

  INSERT INTO public.user_events (user_id, event_type, event_data)
  VALUES (p_user::text, 'topic_progress_reset',
          jsonb_build_object('reset_id', v_id, 'exam', p_exam_type, 'topic', p_topic, 'counts', v_counts));

  RETURN jsonb_build_object('status', 'reset', 'reset_id', v_id, 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.topic_progress_reset(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.topic_progress_reset(uuid, text, text, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Restore (admin). Merges the archive back; newer practice wins:
--   answer_history      archived rows re-inserted (same ids), existing ids or
--                       request ids skipped, rows of deleted questions skipped
--   user_question_progress  a row with any schedule built since the reset is
--                       kept; a bare bookmark row gets the archived schedule
--                       back with the current bookmark flag
--   user_topic_strength archived counters added to the current row
--   flashcard_reviews   re-inserted when the table exists, conflicts skipped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.topic_progress_restore(
  p_reset uuid,
  p_user uuid,
  p_actor uuid,
  p_actor_email text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.progress_resets%ROWTYPE;
  v_ah_in integer := 0;
  v_ah_total integer := 0;
  v_uqp_in integer := 0;
  v_uqp_upd integer := 0;
  v_uqp_kept integer := 0;
  v_uqp_total integer := 0;
  v_uts integer := 0;
  v_fr_in integer := 0;
  v_counts jsonb;
BEGIN
  IF p_reset IS NULL OR p_user IS NULL OR p_actor IS NULL OR coalesce(btrim(p_actor_email), '') = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('progress_reset:' || p_user::text, 0));

  SELECT * INTO r FROM public.progress_resets WHERE id = p_reset AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF r.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_restored', 'restored_at', r.restored_at);
  END IF;

  -- answer_history
  SELECT count(*) INTO v_ah_total FROM jsonb_array_elements(coalesce(r.archived->'answer_history', '[]'::jsonb));
  INSERT INTO public.answer_history
  SELECT a.* FROM jsonb_populate_recordset(NULL::public.answer_history, coalesce(r.archived->'answer_history', '[]'::jsonb)) a
   WHERE a.user_id = p_user AND EXISTS (SELECT 1 FROM public.questions q WHERE q.id = a.question_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_ah_in = ROW_COUNT;

  -- user_question_progress
  SELECT count(*) INTO v_uqp_total FROM jsonb_array_elements(coalesce(r.archived->'user_question_progress', '[]'::jsonb));
  -- No temp table: the archived rows are read twice from the same JSON.
  UPDATE public.user_question_progress g
     SET times_seen = a.times_seen, times_correct = a.times_correct, ease_factor = a.ease_factor,
         interval_days = a.interval_days, next_review_at = a.next_review_at, last_seen_at = a.last_seen_at
    FROM jsonb_populate_recordset(NULL::public.user_question_progress, coalesce(r.archived->'user_question_progress', '[]'::jsonb)) a
   WHERE a.user_id = p_user AND g.user_id = p_user AND g.question_id = a.question_id
     -- Only a row the reset left as a bare bookmark; any schedule built since
     -- (answers or flashcard ratings) is newer and stays.
     AND coalesce(g.times_seen, 0) = 0 AND g.next_review_at IS NULL AND g.last_seen_at IS NULL;
  GET DIAGNOSTICS v_uqp_upd = ROW_COUNT;

  INSERT INTO public.user_question_progress
  SELECT a.* FROM jsonb_populate_recordset(NULL::public.user_question_progress, coalesce(r.archived->'user_question_progress', '[]'::jsonb)) a
   WHERE a.user_id = p_user
     AND EXISTS (SELECT 1 FROM public.questions q WHERE q.id = a.question_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_question_progress g WHERE g.user_id = p_user AND g.question_id = a.question_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_uqp_in = ROW_COUNT;
  v_uqp_kept := v_uqp_total - v_uqp_upd - v_uqp_in;

  -- user_topic_strength: counters add up (the merged history holds both).
  INSERT INTO public.user_topic_strength AS t (user_id, exam_type, topic, answered, correct, last_answered_at, updated_at)
  SELECT s.user_id, s.exam_type, s.topic, s.answered, s.correct, s.last_answered_at, now()
    FROM jsonb_populate_recordset(NULL::public.user_topic_strength, coalesce(r.archived->'user_topic_strength', '[]'::jsonb)) s
   WHERE s.user_id = p_user
  ON CONFLICT (user_id, exam_type, topic) DO UPDATE
     SET answered = t.answered + excluded.answered,
         correct = t.correct + excluded.correct,
         last_answered_at = greatest(t.last_answered_at, excluded.last_answered_at),
         updated_at = now();
  GET DIAGNOSTICS v_uts = ROW_COUNT;

  IF to_regclass('public.flashcard_reviews') IS NOT NULL
     AND jsonb_array_length(coalesce(r.archived->'flashcard_reviews', '[]'::jsonb)) > 0 THEN
    EXECUTE $q$
      INSERT INTO public.flashcard_reviews
      SELECT f.* FROM jsonb_populate_recordset(NULL::public.flashcard_reviews, $1) f
       WHERE f.user_id = $2 AND EXISTS (SELECT 1 FROM public.questions q WHERE q.id = f.question_id)
      ON CONFLICT DO NOTHING
    $q$ USING r.archived->'flashcard_reviews', p_user;
    GET DIAGNOSTICS v_fr_in = ROW_COUNT;
  END IF;

  v_counts := jsonb_build_object(
    'answer_history', v_ah_in, 'answer_history_skipped', v_ah_total - v_ah_in,
    'user_question_progress', v_uqp_in + v_uqp_upd, 'user_question_progress_kept_newer', v_uqp_kept,
    'user_topic_strength', v_uts, 'flashcard_reviews', v_fr_in
  );

  UPDATE public.progress_resets SET restored_at = now(), restored_by = p_actor, restore_counts = v_counts WHERE id = r.id;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (p_actor, p_actor_email, 'progress_reset_restore', 'user', p_user,
          jsonb_build_object('reset_id', r.id, 'exam', r.exam_type, 'topic', r.topic,
                             'reset_at', r.created_at, 'reset_counts', r.counts,
                             'restore_counts', v_counts, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  INSERT INTO public.user_events (user_id, event_type, event_data)
  VALUES (p_user::text, 'topic_progress_restored',
          jsonb_build_object('reset_id', r.id, 'exam', r.exam_type, 'topic', r.topic, 'counts', v_counts));

  RETURN jsonb_build_object('status', 'restored', 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.topic_progress_restore(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.topic_progress_restore(uuid, uuid, uuid, text, text) TO service_role;
