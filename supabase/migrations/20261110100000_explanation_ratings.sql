-- b18: no backfill. Existing aggregate votes remain as a historical baseline.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE public.explanation_ratings (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT explanation_ratings_user_question_key UNIQUE (user_id, question_id)
);
CREATE INDEX explanation_ratings_question_idx ON public.explanation_ratings(question_id);
ALTER TABLE public.explanation_ratings ENABLE ROW LEVEL SECURITY;
-- Custom app sessions are checked in requireUser; no browser DB privileges.
REVOKE ALL ON public.explanation_ratings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.explanation_ratings TO service_role;

-- Atomic deltas preserve legacy totals and work for insert, update and delete.
CREATE FUNCTION public.sync_explanation_rating_totals() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.questions SET
      explanation_rating_sum = coalesce(explanation_rating_sum, 0) + NEW.rating,
      explanation_rating_count = coalesce(explanation_rating_count, 0) + 1
    WHERE id = NEW.question_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.question_id IS DISTINCT FROM OLD.question_id THEN
      RAISE EXCEPTION 'Rating identity cannot change' USING ERRCODE = '22023';
    END IF;
    UPDATE public.questions SET
      explanation_rating_sum = coalesce(explanation_rating_sum, 0) + NEW.rating - OLD.rating
    WHERE id = NEW.question_id AND NEW.rating IS DISTINCT FROM OLD.rating;
    RETURN NEW;
  ELSE
    UPDATE public.questions SET
      explanation_rating_sum = coalesce(explanation_rating_sum, 0) - OLD.rating,
      explanation_rating_count = coalesce(explanation_rating_count, 0) - 1
    WHERE id = OLD.question_id;
    RETURN OLD;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_explanation_rating_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_explanation_rating_totals() TO service_role;
CREATE TRIGGER explanation_ratings_totals AFTER INSERT OR UPDATE OR DELETE ON public.explanation_ratings
FOR EACH ROW EXECUTE FUNCTION public.sync_explanation_rating_totals();

-- A vote belongs to the explanation that was shown. Existing regeneration
-- writers reset aggregates; clear the durable ledger in the same transaction.
-- Counter-only updates from the ledger trigger do not invoke this trigger.
CREATE FUNCTION public.clear_replaced_explanation_ratings() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.explanation_ratings WHERE question_id = NEW.id;
  UPDATE public.questions SET explanation_rating_sum = 0, explanation_rating_count = 0
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_replaced_explanation_ratings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_replaced_explanation_ratings() TO service_role;
CREATE TRIGGER questions_clear_replaced_explanation_ratings
AFTER UPDATE OF explanation, ai_explanation, ai_explanation_generated_at ON public.questions
FOR EACH ROW WHEN (OLD.explanation IS DISTINCT FROM NEW.explanation
  OR OLD.ai_explanation IS DISTINCT FROM NEW.ai_explanation
  OR OLD.ai_explanation_generated_at IS DISTINCT FROM NEW.ai_explanation_generated_at)
EXECUTE FUNCTION public.clear_replaced_explanation_ratings();

-- The upsert and aggregate trigger run in the same transaction, no split writes.
CREATE FUNCTION public.rate_explanation_once(p_user_id uuid, p_question_id integer, p_rating smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
  IF p_rating IS NULL OR p_rating NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'Invalid rating' USING ERRCODE = '22023';
  END IF;
  -- Serialize with explanation replacement before taking the vote-row lock.
  PERFORM 1 FROM public.questions WHERE id = p_question_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.explanation_ratings(user_id, question_id, rating)
  VALUES (p_user_id, p_question_id, p_rating)
  ON CONFLICT (user_id, question_id) DO UPDATE SET rating = EXCLUDED.rating;
  SELECT jsonb_build_object('sum', explanation_rating_sum, 'count', explanation_rating_count)
    INTO result FROM public.questions WHERE id = p_question_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.rate_explanation_once(uuid, integer, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_explanation_once(uuid, integer, smallint) TO service_role;
CREATE VIEW public.explanation_downvoted_questions WITH (security_invoker = true) AS
SELECT question_id, count(*) FILTER (WHERE rating = -1) AS down_votes,
  count(*) AS votes, sum(rating) AS rating_sum
FROM public.explanation_ratings GROUP BY question_id HAVING count(*) FILTER (WHERE rating = -1) >= 2;
REVOKE ALL ON public.explanation_downvoted_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.explanation_downvoted_questions TO service_role;
COMMIT;
