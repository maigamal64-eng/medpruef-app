-- MUX-86, unapplied. Snapshot confirmed Whop renewal dates on each payment lot.
ALTER TABLE public.ai_credit_lot ADD COLUMN IF NOT EXISTS renews_at timestamptz;
COMMENT ON COLUMN public.ai_credit_lot.renews_at IS 'Provider-confirmed renewal date for this grant, never computed from package interval. NULL when unconfirmed or one-time.';

CREATE TABLE IF NOT EXISTS public.ai_mentor_purchase_completion (
  payment_id text PRIMARY KEY CHECK (length(payment_id) BETWEEN 1 AND 200),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_mentor_purchase_completion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_mentor_purchase_completion FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.ai_mentor_purchase_completion TO service_role;

CREATE OR REPLACE FUNCTION public.mentor_record_purchase_completed(p_user uuid, p_checkout_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_payment text; v_package text; v_count integer;
BEGIN
  -- A checkout query string is no receipt. Require the signed buyer's persisted
  -- granted purchase AND that exact live payment lot before recording anything.
  SELECT p.payment_id, l.package_id INTO v_payment, v_package
  FROM public.ai_mentor_purchase p JOIN public.ai_credit_lot l
    ON l.user_id=p.user_id AND l.package_id=p.package_id AND l.source='whop_payment'
    AND l.source_id=p.payment_id AND l.status='live'
  WHERE p.user_id=p_user AND p.checkout_session_id=p_checkout_session_id AND p.status='granted';
  IF v_payment IS NULL THEN RETURN false; END IF;
  INSERT INTO public.ai_mentor_purchase_completion(payment_id,user_id) VALUES(v_payment,p_user)
    ON CONFLICT(payment_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count=0 THEN RETURN false; END IF;
  INSERT INTO public.user_events(user_id,event_type,event_data)
    VALUES(p_user,'purchase_completed',jsonb_build_object('entry','checkout','package_id',v_package));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mentor_record_purchase_completed(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_record_purchase_completed(uuid,uuid) TO service_role;
