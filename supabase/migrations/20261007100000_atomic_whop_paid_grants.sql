-- UNAPPLIED: enable WHOP_ATOMIC_GRANTS_ENABLED only after this migration and
-- an approved deployment/readback. The application never falls back on RPC errors.
-- This ledger is an idempotency receipt, not a revenue/accounting replacement.
CREATE TABLE public.whop_paid_grant_receipts (
  payment_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  grant_mode text NOT NULL CHECK (grant_mode IN ('extended', 'inserted')),
  granted_expires_at timestamptz NOT NULL,
  previous_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whop_paid_grant_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whop_paid_grant_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.whop_paid_grant_receipts TO service_role;

CREATE FUNCTION public.grant_whop_paid_subscription(
  p_user_id uuid, p_tier text, p_payment_id text,
  p_amount_cents integer, p_currency text, p_duration_months integer,
  p_membership_id text DEFAULT NULL
)
RETURNS TABLE (
  mode text, subscription_id uuid, expires_at timestamptz,
  previous_expires_at timestamptz, replayed boolean, entitlement_reconciled boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  u public.users%ROWTYPE;
  s public.subscriptions%ROWTYPE;
  receipt public.whop_paid_grant_receipts%ROWTYPE;
  current_time_utc timestamptz := now();
  base_utc timestamp;
  final_expiry timestamptz;
  previous_expiry timestamptz;
  grant_mode text;
  is_replay boolean := false;
BEGIN
  IF p_payment_id IS NULL OR btrim(p_payment_id) = '' OR
     p_duration_months IS NULL OR p_duration_months < 1 OR p_duration_months > 120 THEN
    RAISE EXCEPTION 'Invalid paid grant arguments' USING ERRCODE = '22023';
  END IF;
  -- Same payment across users and different payments for one user serialize.
  PERFORM pg_advisory_xact_lock(hashtextextended('whop-paid:' || p_payment_id, 0));
  SELECT * INTO STRICT u FROM public.users WHERE id = p_user_id FOR UPDATE;

  SELECT * INTO receipt FROM public.whop_paid_grant_receipts r WHERE r.payment_id = p_payment_id;
  IF FOUND THEN
    IF receipt.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Payment belongs to another user' USING ERRCODE = '22023';
    END IF;
    -- A receipt never resurrects cancelled/refunded/expired access, even if a
    -- caller released an outer webhook claim and retries the payment later.
    RETURN QUERY SELECT receipt.grant_mode, receipt.subscription_id,
      receipt.granted_expires_at, receipt.previous_expires_at, true, true;
    RETURN;
  END IF;

  -- Adopt historical successful grants without extending again. Search the
  -- complete JSON history because provider_payment_id stores only the latest.
  SELECT * INTO s FROM public.subscriptions sub
    WHERE sub.payment_provider = 'whop' AND
      (sub.provider_payment_id = p_payment_id OR
       sub.granted_payment_ids @> jsonb_build_array(jsonb_build_object('payment_id', p_payment_id)))
    ORDER BY sub.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF s.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Payment belongs to another user' USING ERRCODE = '22023';
    END IF;
    IF s.status <> 'active' OR (s.expires_at IS NOT NULL AND s.expires_at <= current_time_utc) THEN
      RAISE EXCEPTION 'Previously granted payment is no longer active' USING ERRCODE = '22023';
    END IF;
    -- Preserve historical non-expiring subscriptions; do not manufacture a
    -- finite receipt or mutate them merely to repair the denormalized user.
    IF s.expires_at IS NULL THEN
      IF u.role IS DISTINCT FROM 'admin' AND u.tier IS DISTINCT FROM 'admin' THEN
        UPDATE public.users SET tier = 'pro', tier_expires_at = NULL, updated_at = current_time_utc
          WHERE id = p_user_id;
      END IF;
      RETURN QUERY SELECT 'extended'::text, s.id, s.expires_at, s.expires_at, true, true;
      RETURN;
    END IF;
    final_expiry := s.expires_at;
    previous_expiry := s.expires_at;
    grant_mode := 'extended';
    is_replay := true;
  ELSE
    SELECT * INTO s FROM public.subscriptions sub
      WHERE sub.user_id = p_user_id AND sub.payment_provider = 'whop' AND sub.status = 'active'
        AND (sub.expires_at IS NULL OR sub.expires_at > current_time_utc)
      ORDER BY sub.expires_at DESC NULLS FIRST LIMIT 1 FOR UPDATE;
    previous_expiry := s.expires_at;
    base_utc := greatest(coalesce(s.expires_at, current_time_utc), current_time_utc) AT TIME ZONE 'UTC';
    -- JS Date.setUTCMonth rolls overflow days forward. Postgres '+ 1 month'
    -- clamps month end instead, so compute from month start plus day offset.
    final_expiry := (date_trunc('month', base_utc) + make_interval(months => p_duration_months)
      + (base_utc - date_trunc('month', base_utc))) AT TIME ZONE 'UTC';
    IF s.id IS NOT NULL THEN
      grant_mode := 'extended';
      UPDATE public.subscriptions SET expires_at = final_expiry,
        provider_payment_id = p_payment_id,
        amount_cents = coalesce(p_amount_cents, s.amount_cents),
        currency = coalesce(nullif(p_currency, ''), s.currency, 'EUR'),
        granted_payment_ids = coalesce(s.granted_payment_ids, '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object('payment_id', p_payment_id,
            'amount_cents', p_amount_cents, 'added_months', p_duration_months,
            'granted_at', current_time_utc)),
        whop_membership_id = coalesce(nullif(p_membership_id, ''), s.whop_membership_id),
        updated_at = current_time_utc WHERE id = s.id;
    ELSE
      grant_mode := 'inserted';
      INSERT INTO public.subscriptions(user_id, tier, status, payment_provider, payment_method,
        amount_cents, currency, provider_payment_id, granted_payment_ids, whop_membership_id,
        started_at, expires_at)
      VALUES (p_user_id, p_tier, 'active', 'whop', 'card', p_amount_cents, p_currency, p_payment_id,
        jsonb_build_array(jsonb_build_object('payment_id', p_payment_id, 'amount_cents', p_amount_cents,
          'added_months', p_duration_months, 'granted_at', current_time_utc)), p_membership_id,
        current_time_utc, final_expiry) RETURNING * INTO s;
    END IF;
  END IF;

  IF u.role IS DISTINCT FROM 'admin' AND u.tier IS DISTINCT FROM 'admin'
      AND NOT (u.tier = 'pro' AND u.tier_expires_at IS NULL) THEN
    UPDATE public.users SET tier = 'pro',
      tier_expires_at = greatest(u.tier_expires_at, final_expiry), updated_at = current_time_utc
      WHERE id = p_user_id;
  END IF;
  INSERT INTO public.whop_paid_grant_receipts(payment_id, user_id, subscription_id,
    grant_mode, granted_expires_at, previous_expires_at)
    VALUES(p_payment_id, p_user_id, s.id, grant_mode, final_expiry, previous_expiry);
  RETURN QUERY SELECT grant_mode, s.id, final_expiry, previous_expiry, is_replay, true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_whop_paid_subscription(uuid,text,text,integer,text,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_whop_paid_subscription(uuid,text,text,integer,text,integer,text)
  TO service_role;
