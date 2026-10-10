-- UNAPPLIED (contract C3a, written in wave 0). Apply only with release train R2
-- on [name]'s migration GO, after 20261014090000_ai_call_log_cache_cols.sql.
--
-- Adds, all additive and MedPruef-only (the Supabase project is shared with
-- [name], so every object is named ai_* in public and nothing else is
-- touched):
--   table    public.ai_quota_daily            per-user, per-route, per-Vienna-day attempt counter
--   function public.ai_quota_take(uuid,text,integer) -> jsonb {ok, used[, reason]}
--   function public.ai_legacy_cost_month(uuid)       -> bigint micro-USD (current UTC month)
--   function public.ai_spend_month(text)              -> bigint micro-USD (Anthropic rows, UTC month)
--   function public.ai_spend_cap(bigint,numeric)      -> bigint micro-USD
--
-- Access: RLS on, no anon/authenticated access, EXECUTE to service_role only,
-- explicit GRANTs (Supabase default privileges would otherwise grant new
-- public functions and tables to anon and authenticated).
-- R3 (mentor ledger) replaces ai_spend_month with CREATE OR REPLACE and the
-- same signature to add ledger spend.

SET lock_timeout = '3s';

-- ─── Counter table ──────────────────────────────────────────────────────
-- No FK to public.users on purpose: a new FK would take a SHARE ROW EXCLUSIVE
-- lock on users (same reasoning as 20261007100000). Callers pass the
-- authenticated user id from requireUser(); stale rows are inert and can be
-- pruned by vienna_day (no cron is registered by this migration).
CREATE TABLE IF NOT EXISTS public.ai_quota_daily (
  user_id    uuid        NOT NULL,
  route      text        NOT NULL CHECK (route ~ '^[a-z][a-z0-9_]{0,39}$'),
  vienna_day date        NOT NULL,
  attempts   integer     NOT NULL CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, vienna_day)
);

CREATE INDEX IF NOT EXISTS idx_ai_quota_daily_day ON public.ai_quota_daily (vienna_day);

ALTER TABLE public.ai_quota_daily ENABLE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'ai_quota_daily'
                   AND policyname = 'ai_quota_daily_no_client') THEN
    CREATE POLICY ai_quota_daily_no_client ON public.ai_quota_daily
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END
$policy$;

REVOKE ALL ON public.ai_quota_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_quota_daily FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_quota_daily TO service_role;

COMMENT ON TABLE public.ai_quota_daily IS
  'Legacy AI daily attempt counter, one row per (user, route, Europe/Vienna day). Written only by ai_quota_take(). RLS deny-all; service-role only.';

-- ─── ai_quota_take ──────────────────────────────────────────────────────
-- One atomic statement takes an attempt: INSERT ... ON CONFLICT DO UPDATE
-- ... WHERE attempts < p_limit. The row lock taken by ON CONFLICT serialises
-- concurrent callers, and the WHERE is re-checked against the latest row
-- version, so N parallel calls with limit L succeed exactly min(N, L) times.
-- The Vienna day is computed here, never by the caller. A limit below 1 never
-- inserts. Any database error returns ok=false (fail closed) instead of
-- raising, and the TypeScript caller treats any RPC error as ok=false too.
CREATE OR REPLACE FUNCTION public.ai_quota_take(p_user uuid, p_route text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day  date;
  v_used integer;
BEGIN
  IF p_user IS NULL OR p_route IS NULL OR p_limit IS NULL
     OR p_route !~ '^[a-z][a-z0-9_]{0,39}$' THEN
    RETURN jsonb_build_object('ok', false, 'used', NULL, 'reason', 'invalid_args');
  END IF;

  v_day := (now() AT TIME ZONE 'Europe/Vienna')::date;

  IF p_limit < 1 THEN
    SELECT q.attempts INTO v_used FROM public.ai_quota_daily q
     WHERE q.user_id = p_user AND q.route = p_route AND q.vienna_day = v_day;
    RETURN jsonb_build_object('ok', false, 'used', COALESCE(v_used, 0), 'reason', 'limit_reached');
  END IF;

  INSERT INTO public.ai_quota_daily AS q (user_id, route, vienna_day, attempts)
  VALUES (p_user, p_route, v_day, 1)
  ON CONFLICT (user_id, route, vienna_day)
  DO UPDATE SET attempts = q.attempts + 1, updated_at = now()
     WHERE q.attempts < p_limit
  RETURNING q.attempts INTO v_used;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'used', v_used);
  END IF;

  SELECT q.attempts INTO v_used FROM public.ai_quota_daily q
   WHERE q.user_id = p_user AND q.route = p_route AND q.vienna_day = v_day;
  RETURN jsonb_build_object('ok', false, 'used', v_used, 'reason', 'limit_reached');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'used', NULL, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── ai_legacy_cost_month ───────────────────────────────────────────────
-- A user's legacy AI spend (all providers, every route except the mentor,
-- which meters in its own ledger) in the current UTC calendar month, in
-- micro-USD, each row rounded up. Rows with a NULL cost add 0, so R2 callers
-- must always write cost_usd (tokens when known, else an input estimate).
CREATE OR REPLACE FUNCTION public.ai_legacy_cost_month(p_user uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(CEIL(l.cost_usd * 1000000)), 0)::bigint
    FROM public.ai_call_log l
   WHERE l.user_id = p_user
     AND l.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
     AND l.created_at <  ((date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC')
     AND (l.route IS NULL OR l.route <> 'mentor');
$$;

-- ─── ai_spend_month ─────────────────────────────────────────────────────
-- Total Anthropic spend for the UTC calendar month p_month ('YYYY-MM'), in
-- micro-USD, each row rounded up. A malformed month raises (22023), which the
-- caller treats as a failure (fail closed).
CREATE OR REPLACE FUNCTION public.ai_spend_month(p_month text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz;
  v_total bigint;
BEGIN
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'p_month must be YYYY-MM, got %', p_month USING ERRCODE = '22023';
  END IF;
  v_start := (to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp) AT TIME ZONE 'UTC';
  SELECT COALESCE(SUM(CEIL(l.cost_usd * 1000000)), 0)::bigint INTO v_total
    FROM public.ai_call_log l
   WHERE l.provider = 'anthropic'
     AND l.created_at >= v_start
     AND l.created_at <  v_start + interval '1 month';
  RETURN v_total;
END;
$$;

-- ─── ai_spend_cap ───────────────────────────────────────────────────────
-- Global monthly AI cap in micro-USD = max(p_floor_micro, p_net_pct percent
-- of trailing-30-day Whop revenue). Revenue source, read from payment_events:
--   * Whop 'payment.succeeded' webhook rows with a valid signature, deduped
--     per payment_id (Whop retries deliver the same payment many times),
--   * minus refund.created / dispute.created rows for those payments, at
--     the full payment amount (conservative).
-- Two documented approximations, both in the safe direction or neutral:
--   * amount_cents are EUR cents taken at par as USD cents. EUR trades above
--     USD, so this UNDERSTATES revenue and therefore the cap.
--   * "net" is gross minus refunds: Whop fees are not recorded in
--     payment_events. Fees (a few percent) are smaller than the FX haircut.
-- Defaults are the contract values; mentor config (C5) passes its env values.
CREATE OR REPLACE FUNCTION public.ai_spend_cap(
  p_floor_micro bigint DEFAULT 50000000,
  p_net_pct numeric DEFAULT 6
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_paid_cents     bigint;
  v_refunded_cents bigint;
BEGIN
  IF p_floor_micro IS NULL OR p_floor_micro < 0 OR p_net_pct IS NULL OR p_net_pct < 0 OR p_net_pct > 100 THEN
    RAISE EXCEPTION 'invalid cap arguments' USING ERRCODE = '22023';
  END IF;

  WITH paid AS (
    SELECT e.payment_id, MAX(e.amount_cents)::bigint AS cents
      FROM public.payment_events e
     WHERE e.provider = 'whop'
       AND e.event = 'webhook_received'
       AND e.signature_valid IS TRUE
       AND e.metadata->>'whop_event' = 'payment.succeeded'
       AND e.payment_id IS NOT NULL
       AND e.amount_cents > 0
       AND e.created_at >= now() - interval '30 days'
     GROUP BY e.payment_id
  ), refunded AS (
    SELECT DISTINCT e.payment_id
      FROM public.payment_events e
     WHERE e.provider = 'whop'
       AND e.event = 'webhook_received'
       AND e.signature_valid IS TRUE
       AND e.metadata->>'whop_event' IN ('refund.created', 'dispute.created')
       AND e.payment_id IS NOT NULL
  )
  SELECT COALESCE(SUM(p.cents), 0),
         COALESCE(SUM(p.cents) FILTER (WHERE r.payment_id IS NOT NULL), 0)
    INTO v_paid_cents, v_refunded_cents
    FROM paid p LEFT JOIN refunded r USING (payment_id);

  -- 1 cent = 10,000 micro-USD.
  RETURN GREATEST(
    p_floor_micro,
    FLOOR(GREATEST(v_paid_cents - v_refunded_cents, 0) * 10000 * p_net_pct / 100)::bigint
  );
END;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ai_quota_take(uuid, text, integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_legacy_cost_month(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_spend_month(text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_spend_cap(bigint, numeric)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_quota_take(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_legacy_cost_month(uuid)         TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_spend_month(text)               TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_spend_cap(bigint, numeric)      TO service_role;

COMMENT ON FUNCTION public.ai_quota_take(uuid, text, integer) IS
  'Atomically takes one AI attempt for (user, route, Europe/Vienna day). Returns {ok, used[, reason]}; fails closed. service_role only.';
COMMENT ON FUNCTION public.ai_legacy_cost_month(uuid) IS
  'Legacy (non-mentor) AI spend for one user in the current UTC month, micro-USD rounded up. service_role only.';
COMMENT ON FUNCTION public.ai_spend_month(text) IS
  'Anthropic spend for a UTC month YYYY-MM, micro-USD rounded up. R3 replaces it to add the mentor ledger. service_role only.';
COMMENT ON FUNCTION public.ai_spend_cap(bigint, numeric) IS
  'Global monthly AI cap, micro-USD: max(floor, pct of trailing-30-day Whop revenue, EUR at par, refunds removed). service_role only.';

RESET lock_timeout;
