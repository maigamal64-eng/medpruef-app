-- a-pricing-v2 (track-A CEO decision 15 Oct 2026 under [name]'s delegation).
-- UNAPPLIED. Apply by hand in the SQL editor in an agreed window, BEFORE
-- PRICING_V2_ENABLED, REVERSE_TRIAL_ENABLED or TICKET_RENEWAL_ENABLED is set
-- (a v2 payment would otherwise fail the tier CHECK and land in Unresolved
-- payments). Rollback: scripts/sql/track-a/a-pricing-v2/down.sql (refuses
-- while rows of the new tiers or requests exist). Proof: npm run
-- test:db:pricing-v2 on throwaway PostgreSQL 16.
--
-- 1. subscriptions_tier_check: the nine known tiers plus flex_month,
--    sitting_pass, half_year, guarantee_ticket and reverse_trial. If
--    production held any other value the ADD fails validation and the whole
--    file rolls back (fail closed).
-- 2. grant_whop_paid_subscription_until: the atomic paid grant for an exact
--    end (the Sitting Pass). A NEW function; the applied months function
--    grant_whop_paid_subscription is not touched. Same receipts table, same
--    locks and replay rules; the window added to running access is the pass
--    length (p_expires_at minus now). The history entry records
--    added_months (rounded up, 1 to 3) so the revoke paths can recompute.
-- 3. trials: kind (legacy | reverse), email_key (sha256 of the normalised
--    address), ip_hash; one reverse trial per address key. The table stays
--    the anti-abuse wall: rows outlive accounts (user_id SET NULL).
-- 4. start_reverse_trial: one atomic start of the 3-day no-card trial
--    (trials row, a zero-amount provenance subscription with tier
--    reverse_trial, users.tier pro with an end date). Never open-ended.
-- 5. ticket_renewal_requests + admin_ticket_renewal_decide: the Guarantee
--    Ticket renewal on proof (a failed result or a booked sitting after the
--    ticket ends), at most two approvals per ticket, compare-and-set on the
--    ticket end, audit row in the same transaction.
-- 6. Private storage bucket ticket-proofs (only where the storage schema
--    exists).
--
-- Grants: every function is service_role only; PUBLIC, anon and
-- authenticated are revoked explicitly (Supabase 30 Oct explicit grant rule).

SET lock_timeout = '3s';

-- 1. Tier CHECK -------------------------------------------------------------
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier = ANY (ARRAY[
    'premium_pass_guaranteed'::text,
    'monthly'::text,
    'three_month'::text,
    'six_month'::text,
    'twelve_month'::text,
    'first_month_19'::text,
    'first_3mo_27'::text,
    'notes_free_trial'::text,
    'notes_pro_trial'::text,
    'flex_month'::text,
    'sitting_pass'::text,
    'half_year'::text,
    'guarantee_ticket'::text,
    'reverse_trial'::text
  ]));

-- 2. Exact-end paid grant ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_whop_paid_subscription_until(
  p_user_id uuid, p_tier text, p_payment_id text,
  p_amount_cents integer, p_currency text, p_expires_at timestamptz,
  p_added_months integer, p_membership_id text DEFAULT NULL
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
  current_time_utc timestamptz;
  window_length interval;
  final_expiry timestamptz;
  previous_expiry timestamptz;
  grant_mode text;
  is_replay boolean := false;
BEGIN
  PERFORM set_config('lock_timeout','200ms',true);
  IF current_setting('transaction_timeout',true) IS NOT NULL THEN
    PERFORM set_config('transaction_timeout','2s',true);
  END IF;
  current_time_utc := clock_timestamp();
  -- The pass is at least 1 day and at most 4 months long (the caller clamps
  -- to 30 days .. 3 months); anything else is a bug, never a grant.
  IF p_payment_id IS NULL OR btrim(p_payment_id) = '' OR p_expires_at IS NULL OR
     p_expires_at <= current_time_utc + interval '1 day' OR
     p_expires_at > current_time_utc + interval '4 months' OR
     p_added_months IS NULL OR p_added_months < 1 OR p_added_months > 3 THEN
    RAISE EXCEPTION 'Invalid paid grant arguments' USING ERRCODE = '22023';
  END IF;
  window_length := p_expires_at - current_time_utc;
  PERFORM pg_advisory_xact_lock(hashtextextended('whop-paid:' || p_payment_id, 0));
  SELECT * INTO STRICT u FROM public.users WHERE id = p_user_id FOR UPDATE;

  SELECT * INTO receipt FROM public.whop_paid_grant_receipts r WHERE r.payment_id = p_payment_id;
  IF FOUND THEN
    IF receipt.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Payment belongs to another user' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT receipt.grant_mode, receipt.subscription_id,
      receipt.granted_expires_at, receipt.previous_expires_at, true, true;
    RETURN;
  END IF;

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
    -- Running Whop access: the pass length is added after its end (the
    -- months function's extension rule); otherwise the pass starts now.
    final_expiry := greatest(coalesce(s.expires_at, current_time_utc), current_time_utc) + window_length;
    IF s.id IS NOT NULL THEN
      grant_mode := 'extended';
      UPDATE public.subscriptions SET expires_at = final_expiry,
        provider_payment_id = p_payment_id,
        amount_cents = coalesce(p_amount_cents, s.amount_cents),
        currency = coalesce(nullif(p_currency, ''), s.currency, 'EUR'),
        granted_payment_ids = coalesce(s.granted_payment_ids, '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object('payment_id', p_payment_id,
            'amount_cents', p_amount_cents, 'added_months', p_added_months,
            'granted_at', current_time_utc, 'ends_at', p_expires_at)),
        whop_membership_id = coalesce(nullif(p_membership_id, ''), s.whop_membership_id),
        updated_at = current_time_utc WHERE id = s.id;
    ELSE
      grant_mode := 'inserted';
      INSERT INTO public.subscriptions(user_id, tier, status, payment_provider, payment_method,
        amount_cents, currency, provider_payment_id, granted_payment_ids, whop_membership_id,
        started_at, expires_at)
      VALUES (p_user_id, p_tier, 'active', 'whop', 'card', p_amount_cents, p_currency, p_payment_id,
        jsonb_build_array(jsonb_build_object('payment_id', p_payment_id, 'amount_cents', p_amount_cents,
          'added_months', p_added_months, 'granted_at', current_time_utc, 'ends_at', p_expires_at)),
        p_membership_id, current_time_utc, final_expiry) RETURNING * INTO s;
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
REVOKE ALL ON FUNCTION public.grant_whop_paid_subscription_until(uuid,text,text,integer,text,timestamptz,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_whop_paid_subscription_until(uuid,text,text,integer,text,timestamptz,integer,text)
  TO service_role;

-- 3. trials: the reverse-trial wall ------------------------------------------
ALTER TABLE public.trials ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.trials ADD COLUMN IF NOT EXISTS email_key text;
ALTER TABLE public.trials ADD COLUMN IF NOT EXISTS ip_hash text;
DO $kind$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trials_kind_check' AND conrelid = 'public.trials'::regclass) THEN
    ALTER TABLE public.trials ADD CONSTRAINT trials_kind_check CHECK (kind IN ('legacy', 'reverse'));
  END IF;
END;
$kind$;
CREATE UNIQUE INDEX IF NOT EXISTS trials_reverse_email_key_uniq
  ON public.trials (email_key) WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS trials_reverse_ip_recent_idx
  ON public.trials (ip_hash, started_at) WHERE ip_hash IS NOT NULL;

-- 4. Reverse-trial start ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_reverse_trial(
  p_user_id uuid,
  p_email_key text,
  p_telegram_id bigint,
  p_ip_hash text,
  p_days integer,
  p_since timestamptz,
  p_max_per_ip integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  u record;
  v_now timestamptz := clock_timestamp();
  v_end timestamptz;
  v_existing record;
  v_recent integer;
BEGIN
  PERFORM set_config('lock_timeout','500ms',true);
  IF p_days IS NULL OR p_days < 1 OR p_days > 7 OR p_since IS NULL
     OR p_max_per_ip IS NULL OR p_max_per_ip < 1 OR p_max_per_ip > 20 THEN
    RAISE EXCEPTION 'Invalid reverse trial arguments' USING ERRCODE = '22023';
  END IF;
  -- A verified identity is required: a confirmed email (its key) or Telegram.
  IF nullif(btrim(coalesce(p_email_key, '')), '') IS NULL AND p_telegram_id IS NULL THEN
    RETURN jsonb_build_object('started', false, 'reason', 'unverified');
  END IF;

  SELECT id, role, tier, tier_expires_at, is_banned, created_at INTO u
  FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('started', false, 'reason', 'no_user'); END IF;
  IF coalesce(u.is_banned, false) THEN RETURN jsonb_build_object('started', false, 'reason', 'banned'); END IF;
  IF u.role = 'admin' OR u.tier = 'admin' THEN RETURN jsonb_build_object('started', false, 'reason', 'admin'); END IF;
  IF u.created_at IS NULL OR u.created_at < p_since THEN
    RETURN jsonb_build_object('started', false, 'reason', 'before_since');
  END IF;
  IF u.created_at < v_now - interval '7 days' THEN
    RETURN jsonb_build_object('started', false, 'reason', 'too_old');
  END IF;

  SELECT * INTO v_existing FROM public.trials t WHERE t.user_id = p_user_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('started', false, 'reason', 'used', 'kind', v_existing.kind,
      'expires_at', v_existing.expires_at);
  END IF;
  IF u.tier = 'pro' AND (u.tier_expires_at IS NULL OR u.tier_expires_at > v_now) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'already_pro');
  END IF;
  IF p_email_key IS NOT NULL AND EXISTS (SELECT 1 FROM public.trials t WHERE t.email_key = p_email_key) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'email_used');
  END IF;
  IF p_telegram_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.trials t WHERE t.telegram_id = p_telegram_id) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'telegram_used');
  END IF;
  IF p_ip_hash IS NOT NULL THEN
    -- Serialise starts from one network so the cap cannot be raced.
    PERFORM pg_advisory_xact_lock(hashtextextended('reverse-trial-ip:' || p_ip_hash, 0));
    SELECT count(*) INTO v_recent FROM public.trials t
      WHERE t.ip_hash = p_ip_hash AND t.started_at > v_now - interval '24 hours';
    IF v_recent >= p_max_per_ip THEN
      RETURN jsonb_build_object('started', false, 'reason', 'ip_limit');
    END IF;
  END IF;

  v_end := v_now + make_interval(days => p_days);
  BEGIN
    INSERT INTO public.trials (telegram_id, user_id, started_at, expires_at, kind, email_key, ip_hash)
    VALUES (p_telegram_id, p_user_id, v_now, v_end, 'reverse', p_email_key, p_ip_hash);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('started', false, 'reason', 'used');
  END;
  INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method,
    amount_cents, currency, started_at, expires_at)
  VALUES (p_user_id, 'reverse_trial', 'active', 'trial', 'reverse_trial', 0, 'EUR', v_now, v_end);
  UPDATE public.users
    SET tier = 'pro', tier_expires_at = greatest(coalesce(tier_expires_at, v_end), v_end), updated_at = v_now
    WHERE id = p_user_id;
  RETURN jsonb_build_object('started', true, 'reason', 'started', 'expires_at', v_end);
END;
$$;
REVOKE ALL ON FUNCTION public.start_reverse_trial(uuid, text, bigint, text, integer, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_reverse_trial(uuid, text, bigint, text, integer, timestamptz, integer)
  TO service_role;

-- 5. Guarantee Ticket renewal on proof ---------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_renewal_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('failed_result', 'booked_sitting')),
  proof_path text CHECK (proof_path IS NULL OR length(proof_path) <= 300),
  proof_link text CHECK (proof_link IS NULL OR (length(proof_link) <= 500 AND proof_link LIKE 'https://%')),
  sitting_date date,
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  previous_expires_at timestamptz,
  new_expires_at timestamptz,
  proof_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_renewal_requests_proof_check CHECK (proof_path IS NOT NULL OR proof_link IS NOT NULL),
  CONSTRAINT ticket_renewal_requests_sitting_check CHECK (kind <> 'booked_sitting' OR sitting_date IS NOT NULL),
  CONSTRAINT ticket_renewal_requests_decided_check CHECK (
    (status = 'pending' AND decided_at IS NULL) OR (status <> 'pending' AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_renewal_requests_one_pending
  ON public.ticket_renewal_requests (subscription_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ticket_renewal_requests_queue_idx
  ON public.ticket_renewal_requests (status, created_at);
CREATE INDEX IF NOT EXISTS ticket_renewal_requests_user_idx
  ON public.ticket_renewal_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_renewal_requests_cleanup_idx
  ON public.ticket_renewal_requests (decided_at) WHERE proof_path IS NOT NULL AND proof_deleted_at IS NULL;
ALTER TABLE public.ticket_renewal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all ticket_renewal_requests" ON public.ticket_renewal_requests;
CREATE POLICY "deny all ticket_renewal_requests" ON public.ticket_renewal_requests
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.ticket_renewal_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ticket_renewal_requests TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ticket_renewal_decide(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_expected_expires_at timestamptz,
  p_max_renewals integer,
  p_audit_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_req record;
  v_sub record;
  v_user record;
  v_actor_email text;
  v_used integer;
  v_new timestamptz;
  v_user_expiry timestamptz;
  v_user_action text;
BEGIN
  IF NOT public.admin_actor_has_permission(p_actor_id, 'revenue.manage') THEN
    RAISE EXCEPTION 'revenue.manage permission required' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'deny') THEN
    RAISE EXCEPTION 'decision must be approve or deny' USING ERRCODE = '22023';
  END IF;
  IF p_max_renewals IS NULL OR p_max_renewals < 1 OR p_max_renewals > 5 THEN
    RAISE EXCEPTION 'Invalid renewal cap' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'deny' AND (p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 500) THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, user_id, subscription_id, kind, status, sitting_date INTO v_req
  FROM public.ticket_renewal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002'; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided' USING ERRCODE = '55000';
  END IF;

  SELECT id, user_id, tier, status, expires_at INTO v_sub
  FROM public.subscriptions WHERE id = v_req.subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002'; END IF;
  IF v_sub.user_id IS DISTINCT FROM v_req.user_id THEN
    RAISE EXCEPTION 'Ticket belongs to a different learner' USING ERRCODE = '23514';
  END IF;
  IF v_sub.tier IS DISTINCT FROM 'guarantee_ticket' THEN
    RAISE EXCEPTION 'Only a Guarantee Ticket can be renewed this way' USING ERRCODE = '55000';
  END IF;

  SELECT email INTO v_actor_email FROM public.users WHERE id = p_actor_id;

  IF p_decision = 'deny' THEN
    UPDATE public.ticket_renewal_requests
      SET status = 'denied', decided_by = p_actor_id, decided_at = now(), decision_reason = btrim(p_reason)
      WHERE id = v_req.id;
    INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)
    VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'deny_ticket_renewal', 'ticket_renewal_request', v_req.id,
      jsonb_build_object('subscription_id', v_sub.id, 'target_user_id', v_req.user_id, 'kind', v_req.kind,
        'reason', btrim(p_reason)) || coalesce(p_audit_context, '{}'::jsonb));
    RETURN jsonb_build_object('request_id', v_req.id, 'status', 'denied');
  END IF;

  -- Approve: compare-and-set on the ticket end the admin saw.
  IF p_expected_expires_at IS NULL OR v_sub.expires_at IS DISTINCT FROM p_expected_expires_at THEN
    RAISE EXCEPTION 'The ticket end changed since you loaded it; reload and decide again' USING ERRCODE = '40001';
  END IF;
  IF v_sub.expires_at IS NULL THEN
    RAISE EXCEPTION 'A ticket without an end date cannot be renewed' USING ERRCODE = '55000';
  END IF;
  IF v_sub.status NOT IN ('active', 'expired') THEN
    RAISE EXCEPTION 'Ticket status % cannot be renewed', v_sub.status USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_used FROM public.ticket_renewal_requests r
    WHERE r.subscription_id = v_sub.id AND r.status = 'approved';
  IF v_used >= p_max_renewals THEN
    RAISE EXCEPTION 'Renewal cap reached' USING ERRCODE = '55000';
  END IF;

  -- One renewal year after the later of the ticket end and now; never shorter.
  v_new := greatest(v_sub.expires_at, now()) + interval '12 months';
  UPDATE public.subscriptions SET expires_at = v_new, status = 'active', updated_at = now()
    WHERE id = v_sub.id;

  SELECT id, role, tier, tier_expires_at INTO v_user FROM public.users WHERE id = v_req.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Learner not found' USING ERRCODE = 'P0002'; END IF;
  IF v_user.role = 'admin' OR v_user.tier = 'admin' THEN
    v_user_action := 'kept_admin';
    v_user_expiry := v_user.tier_expires_at;
  ELSIF v_user.tier = 'pro' AND v_user.tier_expires_at IS NULL THEN
    v_user_action := 'kept_permanent';
    v_user_expiry := NULL;
  ELSE
    v_user_expiry := greatest(v_new, coalesce(v_user.tier_expires_at, v_new));
    v_user_action := CASE WHEN v_user_expiry > v_new THEN 'kept_later' ELSE 'extended' END;
    UPDATE public.users SET tier = 'pro', tier_expires_at = v_user_expiry, updated_at = now()
      WHERE id = v_user.id;
  END IF;

  UPDATE public.ticket_renewal_requests
    SET status = 'approved', decided_by = p_actor_id, decided_at = now(),
        decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        previous_expires_at = v_sub.expires_at, new_expires_at = v_new
    WHERE id = v_req.id;
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)
  VALUES (p_actor_id, coalesce(v_actor_email, 'unknown@medpruf.com'), 'approve_ticket_renewal', 'ticket_renewal_request', v_req.id,
    jsonb_build_object('subscription_id', v_sub.id, 'target_user_id', v_req.user_id, 'kind', v_req.kind,
      'previous_expires_at', v_sub.expires_at, 'new_expires_at', v_new,
      'previous_user_expiry', v_user.tier_expires_at, 'user_access', v_user_action,
      'renewals_used', v_used + 1) || coalesce(p_audit_context, '{}'::jsonb));
  RETURN jsonb_build_object('request_id', v_req.id, 'status', 'approved', 'subscription_id', v_sub.id,
    'previous_expires_at', v_sub.expires_at, 'new_expires_at', v_new,
    'user_access', v_user_action, 'user_expires_at', v_user_expiry, 'renewals_used', v_used + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_ticket_renewal_decide(uuid, uuid, text, text, timestamptz, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ticket_renewal_decide(uuid, uuid, text, text, timestamptz, integer, jsonb) TO service_role;

-- 6. Private proof bucket (Supabase only) -------------------------------------
DO $bucket$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('ticket-proofs', 'ticket-proofs', false, 10485760,
      ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$bucket$;

RESET lock_timeout;
