-- UNAPPLIED (contract C3, revised for the CREDITS model, written in wave 0 by
-- W0-C0B-MENTOR on 2026-10-10). Apply only with release train R3 on [name]'s
-- separate migration GO, AFTER 20261014090000_ai_call_log_cache_cols.sql and
-- 20261014095000_ai_quota_rpc.sql (this file replaces ai_spend_month and reads
-- ai_call_log.route and .provider, both added by the R2 files).
--
-- Model ([name], 10 Oct 2026: "the AI mentor feature should have a separate
-- subscription of packages that give users credits"):
--   * Every balance is integer micro-USD of TRUE API cost (1 USD = 1,000,000).
--     The user-facing "credit" is a display unit only: 1 credit = 5,000
--     micro-USD (CREDIT_MICRO_USD in src/lib/mentor/config.ts). No balance is
--     ever stored in credits, so changing the display ratio never moves money.
--   * Credits arrive as LOTS (ai_credit_lot). A lot comes from a Whop mentor
--     package payment (one lot per Whop payment id), a lazy included grant for
--     Pro, cohort, trial, admin, gift or referral users, or an admin adjustment.
--     Each lot has its own expiry. Spending takes from the lot that expires
--     first.
--   * Package amounts, prices and expiry rules are DATA rows in
--     ai_credit_package, seeded PROVISIONAL here. [name]'s price answer is a row
--     update, never a code change.
--   * Every API call reserves its maximum cost first (mentor_reserve), then
--     settles the actual cost (mentor_settle). Stale reservations settle at the
--     ceiling, billed to the user, never released.
--
-- Objects (all MedPruef-only, prefixed ai_ or mentor_; the Supabase project is
-- shared with [name], nothing else is touched):
--   tables    ai_credit_package, ai_credit_wallet, ai_credit_lot,
--             ai_mentor_reservation, ai_mentor_whop_membership, ai_mentor_rate,
--             ai_usage_ledger (append-only)
--   public    mentor_reserve, mentor_settle_input, mentor_settle, mentor_release,
--   RPCs      mentor_sweep_stale, mentor_grant_credits, mentor_clawback,
--             mentor_membership_status, mentor_whop_lookup, mentor_balance,
--             mentor_attempt_take, mentor_house_fail_take,
--             ai_spend_month (replaced: legacy rows plus mentor ledger spend)
--   helpers   _mentor_available, _mentor_consume, _mentor_settle_core,
--             _mentor_sweep_user (service_role only, like the RPCs)
--
-- Access: RLS on with deny-all client policies, no anon/authenticated access,
-- EXECUTE to service_role only, explicit GRANTs (Supabase default privileges
-- would otherwise grant new public objects to anon and authenticated). The
-- ledger is append-only: service_role gets SELECT and INSERT only.
-- No FK to public.users on purpose (a new FK takes a SHARE ROW EXCLUSIVE lock
-- on users, same reasoning as 20261007100000 and 20261014095000).
--
-- Lock order everywhere: ai_credit_wallet row, then ai_credit_lot rows, then
-- ai_mentor_reservation rows. One wallet row per user is the serialisation
-- point, so two parallel reserves can never both pass when only one fits.

SET lock_timeout = '3s';

-- ─── Package catalogue (data, provisional) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_credit_package (
  package_id      text        PRIMARY KEY CHECK (package_id ~ '^[a-z][a-z0-9_]{1,47}$'),
  kind            text        NOT NULL CHECK (kind IN
                    ('subscription', 'topup', 'included', 'trial', 'gift', 'referral', 'admin', 'free', 'unknown')),
  grant_micro     bigint      NOT NULL CHECK (grant_micro >= 0),
  -- subscription: renewal period; included: the 30-day slice one grant covers.
  period_days     integer     CHECK (period_days IS NULL OR period_days BETWEEN 1 AND 366),
  -- lot lifetime from its start (subscription = period plus grace).
  expiry_days     integer     NOT NULL CHECK (expiry_days BETWEEN 1 AND 730),
  -- display price, must equal the Whop plan price (sold packages only).
  price_eur_cents integer     CHECK (price_eur_cents IS NULL OR price_eur_cents >= 0),
  -- sellable / grantable. Grants for a payment that already happened ignore it.
  active          boolean     NOT NULL DEFAULT false,
  -- true until [name] confirms the numbers.
  provisional     boolean     NOT NULL DEFAULT true,
  sort            smallint    NOT NULL DEFAULT 100,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'subscription' OR period_days IS NOT NULL)
);

-- Seed. ON CONFLICT DO NOTHING so a re-run never overwrites [name]'s edits.
-- Sold packages are inactive until the Whop plans exist and [name] picks prices
-- (proposal: reports/plan-2026-10-10/act/mentor-pricing.json). Included rows
-- carry [name]'s 10 Oct pick (plan-allowance B): Pro USD 1.00, cohort 0.75,
-- trial 0.10, gifts and referrals 0.30, free 0; unknown gets the smallest
-- positive value; admin an explicit USD 5.00 cap.
INSERT INTO public.ai_credit_package
  (package_id, kind, grant_micro, period_days, expiry_days, price_eur_cents, active, provisional, sort, note)
VALUES
  ('mentor_basis',           'subscription',  750000,   30,  33,  490, false, true, 10, 'PROPOSED: 150 credits every 30 days. Lot lives 30 days plus 3 days grace.'),
  ('mentor_plus',            'subscription', 2000000,   30,  33,  990, false, true, 20, 'PROPOSED: 400 credits every 30 days.'),
  ('mentor_topup',           'topup',        2000000, NULL, 180, 1000, false, true, 30, 'PROPOSED: one-time 400 credits, valid 180 days. Sold only when MENTOR_TOPUPS_ENABLED.'),
  ('included_pro_monthly',   'included',     1000000,   30,  30, NULL, true,  true, 40, '[name] pick B: USD 1.00 per 30-day slice of Pro monthly.'),
  ('included_pro_quarterly', 'included',     1000000,   30,  30, NULL, true,  true, 41, '[name] pick B: USD 1.00 per 30-day slice of Pro quarterly.'),
  ('included_cohort',        'included',      750000,   30,  30, NULL, true,  true, 42, '[name] pick B: USD 0.75 per 30-day slice of the 6-month cohort.'),
  ('trial_taste',            'trial',         100000, NULL,   7, NULL, true,  true, 50, '[name] pick B: USD 0.10 once per user, ever.'),
  ('gift_admin',             'gift',          300000, NULL,  30, NULL, true,  true, 60, '[name] pick B: admin-gifted Pro, USD 0.30.'),
  ('referral_reward',        'referral',      300000, NULL,  30, NULL, true,  true, 61, '[name] pick B: referral-reward Pro, USD 0.30.'),
  ('included_admin',         'admin',        5000000,   30,  30, NULL, true,  true, 70, 'Explicit admin cap USD 5.00 per 30 days.'),
  ('included_unknown',       'unknown',       100000,   30,  30, NULL, true,  true, 80, 'Any paid tier this table does not know: smallest positive value.'),
  ('free',                   'free',               0, NULL,   1, NULL, false, true, 90, 'Free users: 0. Packages are how a free user gets the mentor.')
ON CONFLICT (package_id) DO NOTHING;

-- ─── Wallet (one lock row per user) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_credit_wallet (
  user_id         uuid        PRIMARY KEY,
  reserved_micro  bigint      NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  -- actual cost that no live lot could cover (overrun or late settle); paid
  -- down by the next grant, and it blocks spending until then.
  debt_micro      bigint      NOT NULL DEFAULT 0 CHECK (debt_micro >= 0),
  house_fail_day  date,
  house_fails     integer     NOT NULL DEFAULT 0 CHECK (house_fails >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Lots ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_credit_lot (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL,
  package_id          text        NOT NULL REFERENCES public.ai_credit_package (package_id),
  source              text        NOT NULL CHECK (source IN
                        ('whop_payment', 'pro_included', 'trial_taste', 'admin_gift', 'referral_reward',
                         'admin_included', 'unknown_included', 'admin_adjust')),
  source_id           text        NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  granted_micro       bigint      NOT NULL CHECK (granted_micro > 0),
  spent_micro         bigint      NOT NULL DEFAULT 0 CHECK (spent_micro >= 0),
  clawed_back_micro   bigint      NOT NULL DEFAULT 0 CHECK (clawed_back_micro >= 0),
  starts_at           timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  status              text        NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'clawed_back')),
  whop_payment_id     text,
  whop_membership_id  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id),
  CHECK (expires_at > starts_at),
  CHECK (spent_micro + clawed_back_micro <= granted_micro)
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_lot_user_live ON public.ai_credit_lot (user_id, expires_at) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_ai_credit_lot_whop_payment ON public.ai_credit_lot (whop_payment_id) WHERE whop_payment_id IS NOT NULL;

-- ─── Reservations (one per API call) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_mentor_reservation (
  request_id           uuid        NOT NULL,
  call_index           smallint    NOT NULL CHECK (call_index BETWEEN 0 AND 15),
  user_id              uuid        NOT NULL,
  ceiling_micro        bigint      NOT NULL CHECK (ceiling_micro > 0),
  input_settled_micro  bigint      CHECK (input_settled_micro IS NULL OR input_settled_micro >= 0),
  actual_micro         bigint      CHECK (actual_micro IS NULL OR actual_micro >= 0),
  status               text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'released', 'swept')),
  billed_to            text        CHECK (billed_to IS NULL OR billed_to IN ('user', 'house')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  settled_at           timestamptz,
  PRIMARY KEY (request_id, call_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_mentor_reservation_open ON public.ai_mentor_reservation (user_id, created_at) WHERE status = 'open';

-- ─── Whop membership pin (renewals arrive with metadata = null) ─────────
CREATE TABLE IF NOT EXISTS public.ai_mentor_whop_membership (
  membership_id     text        PRIMARY KEY CHECK (length(membership_id) BETWEEN 1 AND 120),
  user_id           uuid        NOT NULL,
  package_id        text        NOT NULL REFERENCES public.ai_credit_package (package_id),
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  first_payment_id  text,
  last_payment_id   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_mentor_whop_membership_user ON public.ai_mentor_whop_membership (user_id);

-- ─── Attempt rate limits (counted at request time) ──────────────────────
CREATE TABLE IF NOT EXISTS public.ai_mentor_rate (
  user_id       uuid        PRIMARY KEY,
  minute_start  timestamptz NOT NULL,
  minute_count  integer     NOT NULL DEFAULT 0 CHECK (minute_count >= 0),
  vienna_day    date        NOT NULL,
  day_count     integer     NOT NULL DEFAULT 0 CHECK (day_count >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Append-only ledger ─────────────────────────────────────────────────
-- delta_micro_usd: signed change of the user's spendable credit
--   (grant +, settle -, clawback -, admin_adjust +/-; debt_paydown 0).
--   Invariant: SUM(delta) per user = live-lot remaining + expired-unspent
--   - debt, i.e. the ledger reconciles to the lots to the micro-USD.
-- hold_micro: signed change of the user's reserved hold
--   (reserve +ceiling, settle/release -ceiling).
-- cost_micro: TRUE API cost of one call (settle and house_cost rows only).
--   ai_spend_month sums this column, never grants or purchases.
CREATE TABLE IF NOT EXISTS public.ai_usage_ledger (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             uuid,
  kind                text        NOT NULL CHECK (kind IN
                        ('grant', 'reserve', 'settle_input', 'settle', 'release', 'house_cost',
                         'clawback', 'admin_adjust', 'debt_paydown')),
  delta_micro_usd     bigint      NOT NULL DEFAULT 0,
  hold_micro          bigint      NOT NULL DEFAULT 0,
  cost_micro          bigint      CHECK (cost_micro IS NULL OR cost_micro >= 0),
  source              text        NOT NULL CHECK (length(source) BETWEEN 1 AND 60),
  source_id           text        NOT NULL CHECK (length(source_id) BETWEEN 1 AND 240),
  request_id          uuid,
  call_index          smallint,
  lot_id              uuid,
  package_id          text,
  model               text,
  input_tokens        integer,
  output_tokens       integer,
  cache_read_tokens   integer,
  cache_write_tokens  integer,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_user_time ON public.ai_usage_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_spend ON public.ai_usage_ledger (created_at) WHERE cost_micro IS NOT NULL;

-- ─── RLS (deny all clients) ─────────────────────────────────────────────
DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_credit_package', 'ai_credit_wallet', 'ai_credit_lot', 'ai_mentor_reservation',
                           'ai_mentor_whop_membership', 'ai_mentor_rate', 'ai_usage_ledger'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_no_client') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
                     t || '_no_client', t);
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM service_role', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON public.ai_credit_package          TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_credit_wallet           TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_credit_lot              TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_mentor_reservation      TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_mentor_whop_membership  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ai_mentor_rate             TO service_role;
GRANT SELECT, INSERT         ON public.ai_usage_ledger            TO service_role;

-- ─── Helpers ────────────────────────────────────────────────────────────

-- Spendable micro-USD in live lots at instant p_at (before holds and debt).
CREATE OR REPLACE FUNCTION public._mentor_available(p_user uuid, p_at timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(l.granted_micro - l.spent_micro - l.clawed_back_micro), 0)::bigint
    FROM public.ai_credit_lot l
   WHERE l.user_id = p_user
     AND l.status = 'live'
     AND l.starts_at <= p_at
     AND l.expires_at > p_at;
$$;

-- Consume p_amount from the user's lots that were live at p_at, earliest
-- expiry first. Returns the part no lot could cover (the caller books it as
-- debt). Caller must hold the wallet lock.
CREATE OR REPLACE FUNCTION public._mentor_consume(p_user uuid, p_amount bigint, p_at timestamptz)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_left bigint := GREATEST(COALESCE(p_amount, 0), 0);
  v_lot  record;
  v_take bigint;
BEGIN
  IF v_left = 0 THEN
    RETURN 0;
  END IF;
  FOR v_lot IN
    SELECT l.id, (l.granted_micro - l.spent_micro - l.clawed_back_micro) AS remaining
      FROM public.ai_credit_lot l
     WHERE l.user_id = p_user
       AND l.status = 'live'
       AND l.starts_at <= p_at
       AND l.expires_at > p_at
       AND l.granted_micro - l.spent_micro - l.clawed_back_micro > 0
     ORDER BY l.expires_at, l.created_at, l.id
     FOR UPDATE
  LOOP
    v_take := LEAST(v_left, v_lot.remaining);
    UPDATE public.ai_credit_lot
       SET spent_micro = spent_micro + v_take, updated_at = now()
     WHERE id = v_lot.id;
    v_left := v_left - v_take;
    EXIT WHEN v_left = 0;
  END LOOP;
  RETURN v_left;
END;
$$;

-- Settle one open reservation. Caller holds the wallet lock and has locked
-- the reservation row. p_status is 'settled' (real settle) or 'swept'.
CREATE OR REPLACE FUNCTION public._mentor_settle_core(
  p_request uuid,
  p_call_index smallint,
  p_actual_micro bigint,
  p_usage jsonb,
  p_bill_user boolean,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res     public.ai_mentor_reservation%ROWTYPE;
  v_left    bigint := 0;
  v_charged bigint;
  v_usage   jsonb := COALESCE(p_usage, '{}'::jsonb);
BEGIN
  SELECT * INTO v_res FROM public.ai_mentor_reservation
   WHERE request_id = p_request AND call_index = p_call_index;
  v_charged := GREATEST(COALESCE(p_actual_micro, 0), 0);

  IF p_bill_user THEN
    v_left := public._mentor_consume(v_res.user_id, v_charged, v_res.created_at);
  END IF;

  UPDATE public.ai_credit_wallet
     SET reserved_micro = GREATEST(reserved_micro - v_res.ceiling_micro, 0),
         debt_micro = debt_micro + v_left,
         updated_at = now()
   WHERE user_id = v_res.user_id;

  UPDATE public.ai_mentor_reservation
     SET status = p_status,
         actual_micro = v_charged,
         billed_to = CASE WHEN p_bill_user THEN 'user' ELSE 'house' END,
         settled_at = now()
   WHERE request_id = p_request AND call_index = p_call_index;

  INSERT INTO public.ai_usage_ledger
    (user_id, kind, delta_micro_usd, hold_micro, cost_micro, source, source_id, request_id, call_index,
     model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, note)
  VALUES
    (v_res.user_id,
     CASE WHEN p_bill_user THEN 'settle' ELSE 'house_cost' END,
     CASE WHEN p_bill_user THEN -v_charged ELSE 0 END,
     -v_res.ceiling_micro,
     v_charged,
     'mentor_call', p_request::text || ':' || p_call_index::text || ':settle',
     p_request, p_call_index,
     NULLIF(v_usage->>'model', ''),
     NULLIF(v_usage->>'input_tokens', '')::integer,
     NULLIF(v_usage->>'output_tokens', '')::integer,
     NULLIF(v_usage->>'cache_read_input_tokens', '')::integer,
     NULLIF(v_usage->>'cache_creation_input_tokens', '')::integer,
     CASE WHEN p_status = 'swept' THEN 'stale reservation settled at the ceiling' END);

  RETURN jsonb_build_object(
    'ok', true,
    'charged_micro', v_charged,
    'billed_to', CASE WHEN p_bill_user THEN 'user' ELSE 'house' END,
    'debt_added_micro', v_left,
    'overrun', v_charged > v_res.ceiling_micro);
END;
$$;

-- Settle this user's open reservations older than p_older_than at their
-- ceiling, billed to the user. Caller holds the wallet lock.
CREATE OR REPLACE FUNCTION public._mentor_sweep_user(p_user uuid, p_older_than interval)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res record;
  v_n   integer := 0;
BEGIN
  FOR v_res IN
    SELECT r.request_id, r.call_index, r.ceiling_micro
      FROM public.ai_mentor_reservation r
     WHERE r.user_id = p_user
       AND r.status = 'open'
       AND r.created_at < now() - p_older_than
     ORDER BY r.created_at
     FOR UPDATE
  LOOP
    PERFORM public._mentor_settle_core(v_res.request_id, v_res.call_index, v_res.ceiling_micro,
                                       '{}'::jsonb, true, 'swept');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ─── mentor_reserve ─────────────────────────────────────────────────────
-- Books the MAXIMUM cost of one API call before it runs. Lazy grants are not
-- made here: the credits module calls mentor_grant_credits for any included
-- grant first. Order: lock wallet, idempotent replay check, settle this
-- user's stale reservations (older than 15 minutes) at the ceiling, then one
-- check of (live lots - holds - debt) >= ceiling. Any error: ok=false
-- (fail closed, no call).
CREATE OR REPLACE FUNCTION public.mentor_reserve(
  p_user uuid,
  p_request uuid,
  p_call_index smallint,
  p_ceiling_micro bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet   public.ai_credit_wallet%ROWTYPE;
  v_existing public.ai_mentor_reservation%ROWTYPE;
  v_avail    bigint;
BEGIN
  IF p_user IS NULL OR p_request IS NULL OR p_call_index IS NULL OR p_ceiling_micro IS NULL
     OR p_ceiling_micro <= 0 OR p_call_index < 0 OR p_call_index > 15 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args', 'remaining_micro', NULL);
  END IF;

  INSERT INTO public.ai_credit_wallet (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.ai_credit_wallet WHERE user_id = p_user FOR UPDATE;

  SELECT * INTO v_existing FROM public.ai_mentor_reservation
   WHERE request_id = p_request AND call_index = p_call_index;
  IF FOUND THEN
    IF v_existing.user_id <> p_user THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args', 'remaining_micro', NULL);
    END IF;
    v_avail := public._mentor_available(p_user, now()) - v_wallet.reserved_micro - v_wallet.debt_micro;
    RETURN jsonb_build_object('ok', v_existing.status = 'open', 'duplicate', true,
                              'reason', CASE WHEN v_existing.status = 'open' THEN NULL ELSE 'already_closed' END,
                              'remaining_micro', v_avail);
  END IF;

  PERFORM public._mentor_sweep_user(p_user, interval '15 minutes');
  SELECT * INTO v_wallet FROM public.ai_credit_wallet WHERE user_id = p_user;

  v_avail := public._mentor_available(p_user, now()) - v_wallet.reserved_micro - v_wallet.debt_micro;
  IF v_avail < p_ceiling_micro THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'remaining_micro', v_avail);
  END IF;

  INSERT INTO public.ai_mentor_reservation (request_id, call_index, user_id, ceiling_micro)
  VALUES (p_request, p_call_index, p_user, p_ceiling_micro);

  UPDATE public.ai_credit_wallet
     SET reserved_micro = reserved_micro + p_ceiling_micro, updated_at = now()
   WHERE user_id = p_user;

  INSERT INTO public.ai_usage_ledger (user_id, kind, hold_micro, source, source_id, request_id, call_index)
  VALUES (p_user, 'reserve', p_ceiling_micro, 'mentor_call',
          p_request::text || ':' || p_call_index::text || ':reserve', p_request, p_call_index);

  RETURN jsonb_build_object('ok', true, 'remaining_micro', v_avail - p_ceiling_micro);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE, 'remaining_micro', NULL);
END;
$$;

-- ─── mentor_settle_input ────────────────────────────────────────────────
-- Records the input cost reported at message_start (crash evidence). No
-- balance moves here: the final settle (or the sweep) charges the full call.
CREATE OR REPLACE FUNCTION public.mentor_settle_input(p_request uuid, p_call_index smallint, p_input_micro bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.ai_mentor_reservation%ROWTYPE;
BEGIN
  IF p_request IS NULL OR p_call_index IS NULL OR p_input_micro IS NULL OR p_input_micro < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  UPDATE public.ai_mentor_reservation
     SET input_settled_micro = p_input_micro
   WHERE request_id = p_request AND call_index = p_call_index AND status = 'open'
  RETURNING * INTO v_res;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_open');
  END IF;
  INSERT INTO public.ai_usage_ledger (user_id, kind, source, source_id, request_id, call_index, note)
  VALUES (v_res.user_id, 'settle_input', 'mentor_call',
          p_request::text || ':' || p_call_index::text || ':input', p_request, p_call_index,
          'input_micro=' || p_input_micro::text)
  ON CONFLICT (source, source_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_settle ──────────────────────────────────────────────────────
-- Charges the actual cost. p_bill_user=false books it to the house (first 3
-- of our-side failures a day, decided by mentor_house_fail_take). An actual
-- above the ceiling is still charged (overrun=true; the caller alerts).
-- Idempotent: a closed reservation returns ok with duplicate=true.
CREATE OR REPLACE FUNCTION public.mentor_settle(
  p_request uuid,
  p_call_index smallint,
  p_actual_micro bigint,
  p_usage jsonb,
  p_bill_user boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_res  public.ai_mentor_reservation%ROWTYPE;
BEGIN
  IF p_request IS NULL OR p_call_index IS NULL OR p_actual_micro IS NULL OR p_actual_micro < 0
     OR p_bill_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  SELECT r.user_id INTO v_user FROM public.ai_mentor_reservation r
   WHERE r.request_id = p_request AND r.call_index = p_call_index;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  PERFORM 1 FROM public.ai_credit_wallet WHERE user_id = v_user FOR UPDATE;
  SELECT * INTO v_res FROM public.ai_mentor_reservation
   WHERE request_id = p_request AND call_index = p_call_index FOR UPDATE;
  IF v_res.status <> 'open' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', v_res.status,
                              'charged_micro', v_res.actual_micro);
  END IF;
  RETURN public._mentor_settle_core(p_request, p_call_index, p_actual_micro, p_usage, p_bill_user, 'settled');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_release ─────────────────────────────────────────────────────
-- Only for an upstream 5xx/429 that never reached the model. Frees the hold.
CREATE OR REPLACE FUNCTION public.mentor_release(p_request uuid, p_call_index smallint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_res  public.ai_mentor_reservation%ROWTYPE;
BEGIN
  IF p_request IS NULL OR p_call_index IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  SELECT r.user_id INTO v_user FROM public.ai_mentor_reservation r
   WHERE r.request_id = p_request AND r.call_index = p_call_index;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  PERFORM 1 FROM public.ai_credit_wallet WHERE user_id = v_user FOR UPDATE;
  SELECT * INTO v_res FROM public.ai_mentor_reservation
   WHERE request_id = p_request AND call_index = p_call_index FOR UPDATE;
  IF v_res.status <> 'open' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', v_res.status);
  END IF;
  UPDATE public.ai_credit_wallet
     SET reserved_micro = GREATEST(reserved_micro - v_res.ceiling_micro, 0), updated_at = now()
   WHERE user_id = v_user;
  UPDATE public.ai_mentor_reservation
     SET status = 'released', actual_micro = 0, settled_at = now()
   WHERE request_id = p_request AND call_index = p_call_index;
  INSERT INTO public.ai_usage_ledger (user_id, kind, hold_micro, source, source_id, request_id, call_index)
  VALUES (v_user, 'release', -v_res.ceiling_micro, 'mentor_call',
          p_request::text || ':' || p_call_index::text || ':release', p_request, p_call_index);
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_sweep_stale ─────────────────────────────────────────────────
-- Global sweep (cron or admin): settles every open reservation older than
-- p_older_than at its ceiling, billed to the user. Never releases.
CREATE OR REPLACE FUNCTION public.mentor_sweep_stale(p_older_than interval)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_n    integer := 0;
BEGIN
  IF p_older_than IS NULL OR p_older_than < interval '1 minute' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  FOR v_user IN
    SELECT DISTINCT r.user_id FROM public.ai_mentor_reservation r
     WHERE r.status = 'open' AND r.created_at < now() - p_older_than
  LOOP
    PERFORM 1 FROM public.ai_credit_wallet WHERE user_id = v_user FOR UPDATE;
    v_n := v_n + public._mentor_sweep_user(v_user, p_older_than);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'settled', v_n);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_grant_credits ───────────────────────────────────────────────
-- Creates one lot, idempotent on (p_source, p_source_id): a Whop payment id,
-- or an included-grant period key built by the credits module. Pays down any
-- debt from the new lot. Pins the Whop membership so metadata-less renewals
-- map back to the user and package. One transaction.
CREATE OR REPLACE FUNCTION public.mentor_grant_credits(
  p_user uuid,
  p_package text,
  p_source text,
  p_source_id text,
  p_micro bigint DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_whop_payment_id text DEFAULT NULL,
  p_whop_membership_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pkg     public.ai_credit_package%ROWTYPE;
  v_wallet  public.ai_credit_wallet%ROWTYPE;
  v_lot     public.ai_credit_lot%ROWTYPE;
  v_micro   bigint;
  v_start   timestamptz := COALESCE(p_starts_at, now());
  v_expires timestamptz;
  v_pay     bigint := 0;
BEGIN
  IF p_user IS NULL OR p_package IS NULL OR p_source IS NULL OR p_source_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  SELECT * INTO v_pkg FROM public.ai_credit_package WHERE package_id = p_package;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_package');
  END IF;
  v_micro := COALESCE(p_micro, v_pkg.grant_micro);
  IF v_micro <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'zero_grant');
  END IF;
  v_expires := COALESCE(p_expires_at, v_start + make_interval(days => v_pkg.expiry_days));

  INSERT INTO public.ai_credit_wallet (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_wallet FROM public.ai_credit_wallet WHERE user_id = p_user FOR UPDATE;

  INSERT INTO public.ai_credit_lot
    (user_id, package_id, source, source_id, granted_micro, starts_at, expires_at, whop_payment_id, whop_membership_id)
  VALUES
    (p_user, p_package, p_source, p_source_id, v_micro, v_start, v_expires, p_whop_payment_id, p_whop_membership_id)
  ON CONFLICT (source, source_id) DO NOTHING
  RETURNING * INTO v_lot;

  IF NOT FOUND THEN
    SELECT * INTO v_lot FROM public.ai_credit_lot WHERE source = p_source AND source_id = p_source_id;
    IF v_lot.user_id <> p_user THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'source_conflict', 'lot_id', v_lot.id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'lot_id', v_lot.id,
                              'granted_micro', v_lot.granted_micro, 'expires_at', v_lot.expires_at);
  END IF;

  INSERT INTO public.ai_usage_ledger (user_id, kind, delta_micro_usd, source, source_id, lot_id, package_id)
  VALUES (p_user, 'grant', v_micro, p_source, p_source_id, v_lot.id, p_package);

  IF v_wallet.debt_micro > 0 THEN
    v_pay := LEAST(v_wallet.debt_micro, v_micro);
    UPDATE public.ai_credit_lot SET spent_micro = spent_micro + v_pay, updated_at = now() WHERE id = v_lot.id;
    UPDATE public.ai_credit_wallet SET debt_micro = debt_micro - v_pay, updated_at = now() WHERE user_id = p_user;
    -- delta 0: the settle row that created the debt already carried the full
    -- charge; paydown only moves it from debt into this lot's spent column.
    INSERT INTO public.ai_usage_ledger (user_id, kind, delta_micro_usd, source, source_id, lot_id, package_id, note)
    VALUES (p_user, 'debt_paydown', 0, 'debt_paydown', v_lot.id::text, v_lot.id, p_package,
            'paid_micro=' || v_pay::text);
  END IF;

  IF p_whop_membership_id IS NOT NULL THEN
    INSERT INTO public.ai_mentor_whop_membership AS m
      (membership_id, user_id, package_id, status, first_payment_id, last_payment_id)
    VALUES (p_whop_membership_id, p_user, p_package, 'active', p_whop_payment_id, p_whop_payment_id)
    ON CONFLICT (membership_id) DO UPDATE
      SET last_payment_id = EXCLUDED.last_payment_id, status = 'active', updated_at = now()
      WHERE m.user_id = EXCLUDED.user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'lot_id', v_lot.id,
                            'granted_micro', v_micro, 'expires_at', v_expires, 'debt_paid_micro', v_pay);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_clawback ────────────────────────────────────────────────────
-- Refund or dispute of a lot's source (e.g. 'whop_payment', '<pay_id>'):
-- removes the UNSPENT part only. Spent credit is not reversed. Idempotent.
CREATE OR REPLACE FUNCTION public.mentor_clawback(p_source text, p_source_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   uuid;
  v_lot    public.ai_credit_lot%ROWTYPE;
  v_clawed bigint;
BEGIN
  IF p_source IS NULL OR p_source_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  SELECT l.user_id INTO v_user FROM public.ai_credit_lot l WHERE l.source = p_source AND l.source_id = p_source_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  PERFORM 1 FROM public.ai_credit_wallet WHERE user_id = v_user FOR UPDATE;
  SELECT * INTO v_lot FROM public.ai_credit_lot WHERE source = p_source AND source_id = p_source_id FOR UPDATE;
  IF v_lot.status = 'clawed_back' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'lot_id', v_lot.id, 'user_id', v_user,
                              'clawed_micro', v_lot.clawed_back_micro);
  END IF;
  v_clawed := v_lot.granted_micro - v_lot.spent_micro - v_lot.clawed_back_micro;
  UPDATE public.ai_credit_lot
     SET clawed_back_micro = clawed_back_micro + v_clawed, status = 'clawed_back', updated_at = now()
   WHERE id = v_lot.id;
  INSERT INTO public.ai_usage_ledger (user_id, kind, delta_micro_usd, source, source_id, lot_id, package_id, note)
  VALUES (v_user, 'clawback', -v_clawed, 'clawback', p_source || ':' || p_source_id, v_lot.id, v_lot.package_id,
          left(COALESCE(p_reason, ''), 200));
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'lot_id', v_lot.id, 'user_id', v_user,
                            'clawed_micro', v_clawed);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_membership_status ───────────────────────────────────────────
-- membership.deactivated / went_invalid on a MENTOR membership: stop treating
-- it as active. Lots already granted run to their expiry (no clawback).
CREATE OR REPLACE FUNCTION public.mentor_membership_status(p_membership_id text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_membership_id IS NULL OR p_status IS NULL OR p_status NOT IN ('active', 'inactive') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  UPDATE public.ai_mentor_whop_membership
     SET status = p_status, updated_at = now()
   WHERE membership_id = p_membership_id
  RETURNING user_id INTO v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', v_user);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_whop_lookup ─────────────────────────────────────────────────
-- Is this Whop payment or membership a MENTOR one? Used by the webhook branch
-- for metadata-less renewals and for revoke events. Errors raise (the caller
-- must fail closed with a 503 so Whop redelivers).
CREATE OR REPLACE FUNCTION public.mentor_whop_lookup(p_payment_id text, p_membership_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_pkg  text;
BEGIN
  IF p_payment_id IS NOT NULL THEN
    SELECT l.user_id, l.package_id INTO v_user, v_pkg FROM public.ai_credit_lot l
     WHERE (l.source = 'whop_payment' AND l.source_id = p_payment_id) OR l.whop_payment_id = p_payment_id
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('mentor', true, 'via', 'payment', 'user_id', v_user, 'package_id', v_pkg);
    END IF;
  END IF;
  IF p_membership_id IS NOT NULL THEN
    SELECT m.user_id, m.package_id INTO v_user, v_pkg FROM public.ai_mentor_whop_membership m
     WHERE m.membership_id = p_membership_id;
    IF FOUND THEN
      RETURN jsonb_build_object('mentor', true, 'via', 'membership', 'user_id', v_user, 'package_id', v_pkg);
    END IF;
  END IF;
  RETURN jsonb_build_object('mentor', false);
END;
$$;

-- ─── mentor_balance ─────────────────────────────────────────────────────
-- Read model for /api/mentor/usage and the admin view. Micro-USD only; the
-- server converts to credits and never sends dollars to a learner.
CREATE OR REPLACE FUNCTION public.mentor_balance(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet public.ai_credit_wallet%ROWTYPE;
  v_lots   bigint;
  v_next   timestamptz;
  v_list   jsonb;
  v_ever   boolean;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_wallet FROM public.ai_credit_wallet WHERE user_id = p_user;
  v_lots := public._mentor_available(p_user, now());
  SELECT min(l.expires_at) INTO v_next FROM public.ai_credit_lot l
   WHERE l.user_id = p_user AND l.status = 'live' AND l.starts_at <= now() AND l.expires_at > now()
     AND l.granted_micro - l.spent_micro - l.clawed_back_micro > 0;
  SELECT EXISTS (SELECT 1 FROM public.ai_credit_lot l WHERE l.user_id = p_user) INTO v_ever;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'expires_at'), '[]'::jsonb) INTO v_list FROM (
    SELECT jsonb_build_object(
             'lot_id', l.id, 'package_id', l.package_id, 'kind', p.kind, 'source', l.source,
             'remaining_micro', l.granted_micro - l.spent_micro - l.clawed_back_micro,
             'granted_micro', l.granted_micro, 'starts_at', l.starts_at, 'expires_at', l.expires_at) AS x
      FROM public.ai_credit_lot l JOIN public.ai_credit_package p USING (package_id)
     WHERE l.user_id = p_user AND l.status = 'live' AND l.expires_at > now()
     ORDER BY l.expires_at
     LIMIT 20
  ) s;
  RETURN jsonb_build_object(
    'lots_micro', v_lots,
    'reserved_micro', COALESCE(v_wallet.reserved_micro, 0),
    'debt_micro', COALESCE(v_wallet.debt_micro, 0),
    'available_micro', v_lots - COALESCE(v_wallet.reserved_micro, 0) - COALESCE(v_wallet.debt_micro, 0),
    'next_expiry', v_next,
    'ever_granted', v_ever,
    'lots', v_list);
END;
$$;

-- ─── mentor_attempt_take ────────────────────────────────────────────────
-- Counts ATTEMPTS (not successes) at request time: one per user message.
-- Minute window is a fixed UTC minute; the day is the Europe/Vienna day,
-- computed here. Fails closed.
CREATE OR REPLACE FUNCTION public.mentor_attempt_take(p_user uuid, p_per_min integer, p_per_day integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    public.ai_mentor_rate%ROWTYPE;
  v_minute timestamptz := date_trunc('minute', now());
  v_day    date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_min_n  integer;
  v_day_n  integer;
BEGIN
  IF p_user IS NULL OR p_per_min IS NULL OR p_per_day IS NULL OR p_per_min < 0 OR p_per_day < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  INSERT INTO public.ai_mentor_rate (user_id, minute_start, vienna_day)
  VALUES (p_user, v_minute, v_day) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.ai_mentor_rate WHERE user_id = p_user FOR UPDATE;
  v_min_n := CASE WHEN v_row.minute_start = v_minute THEN v_row.minute_count ELSE 0 END;
  v_day_n := CASE WHEN v_row.vienna_day = v_day THEN v_row.day_count ELSE 0 END;
  IF v_day_n >= p_per_day THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited_day', 'minute_used', v_min_n, 'day_used', v_day_n);
  END IF;
  IF v_min_n >= p_per_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited_minute', 'minute_used', v_min_n, 'day_used', v_day_n);
  END IF;
  UPDATE public.ai_mentor_rate
     SET minute_start = v_minute, minute_count = v_min_n + 1,
         vienna_day = v_day, day_count = v_day_n + 1, updated_at = now()
   WHERE user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'minute_used', v_min_n + 1, 'day_used', v_day_n + 1);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── mentor_house_fail_take ─────────────────────────────────────────────
-- Our-side failures (empty text, timeout): the first p_limit a Vienna day are
-- on the house (ok=true, settle with p_bill_user=false); after that ok=false
-- and the caller bills the user or locks the mentor for the day. Fails closed
-- (ok=false means "do not give it away").
CREATE OR REPLACE FUNCTION public.mentor_house_fail_take(p_user uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_used integer;
BEGIN
  IF p_user IS NULL OR p_limit IS NULL OR p_limit < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  INSERT INTO public.ai_credit_wallet (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT CASE WHEN house_fail_day = v_day THEN house_fails ELSE 0 END INTO v_used
    FROM public.ai_credit_wallet WHERE user_id = p_user FOR UPDATE;
  IF v_used >= p_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'limit_reached', 'used', v_used);
  END IF;
  UPDATE public.ai_credit_wallet
     SET house_fail_day = v_day, house_fails = v_used + 1, updated_at = now()
   WHERE user_id = p_user;
  RETURN jsonb_build_object('ok', true, 'used', v_used + 1);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'db_error', 'sqlstate', SQLSTATE);
END;
$$;

-- ─── ai_spend_month (replaces the R2 version, same signature) ───────────
-- Anthropic spend for the UTC month = legacy ai_call_log rows (provider
-- anthropic, route not 'mentor', so a stray mentor log row is never counted
-- twice) + mentor ledger CONSUMPTION (cost_micro of settle and house_cost
-- rows). Grants, purchases, reserves and clawbacks never count.
CREATE OR REPLACE FUNCTION public.ai_spend_month(p_month text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start  timestamptz;
  v_legacy bigint;
  v_mentor bigint;
BEGIN
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'p_month must be YYYY-MM, got %', p_month USING ERRCODE = '22023';
  END IF;
  v_start := (to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp) AT TIME ZONE 'UTC';
  SELECT COALESCE(SUM(CEIL(l.cost_usd * 1000000)), 0)::bigint INTO v_legacy
    FROM public.ai_call_log l
   WHERE l.provider = 'anthropic'
     AND (l.route IS NULL OR l.route <> 'mentor')
     AND l.created_at >= v_start
     AND l.created_at <  v_start + interval '1 month';
  SELECT COALESCE(SUM(g.cost_micro), 0)::bigint INTO v_mentor
    FROM public.ai_usage_ledger g
   WHERE g.kind IN ('settle', 'house_cost')
     AND g.cost_micro IS NOT NULL
     AND g.created_at >= v_start
     AND g.created_at <  v_start + interval '1 month';
  RETURN v_legacy + v_mentor;
END;
$$;

-- ─── Function grants ────────────────────────────────────────────────────
DO $grants$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._mentor_available(uuid, timestamptz)',
    'public._mentor_consume(uuid, bigint, timestamptz)',
    'public._mentor_settle_core(uuid, smallint, bigint, jsonb, boolean, text)',
    'public._mentor_sweep_user(uuid, interval)',
    'public.mentor_reserve(uuid, uuid, smallint, bigint)',
    'public.mentor_settle_input(uuid, smallint, bigint)',
    'public.mentor_settle(uuid, smallint, bigint, jsonb, boolean)',
    'public.mentor_release(uuid, smallint)',
    'public.mentor_sweep_stale(interval)',
    'public.mentor_grant_credits(uuid, text, text, text, bigint, timestamptz, timestamptz, text, text)',
    'public.mentor_clawback(text, text, text)',
    'public.mentor_membership_status(text, text)',
    'public.mentor_whop_lookup(text, text)',
    'public.mentor_balance(uuid)',
    'public.mentor_attempt_take(uuid, integer, integer)',
    'public.mentor_house_fail_take(uuid, integer)',
    'public.ai_spend_month(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$grants$;

COMMENT ON TABLE public.ai_credit_package IS
  'Mentor credit packages and included grants (data, provisional until [name] confirms). Single owner of amounts, prices and expiry. service_role only.';
COMMENT ON TABLE public.ai_credit_lot IS
  'Mentor credit lots in micro-USD of true API cost, one per (source, source_id). Spent earliest expiry first. service_role only.';
COMMENT ON TABLE public.ai_usage_ledger IS
  'Append-only mentor ledger, UNIQUE(source, source_id). cost_micro is true API spend (ai_spend_month); delta is spendable credit; hold is reservation. service_role SELECT/INSERT only.';
COMMENT ON FUNCTION public.mentor_reserve(uuid, uuid, smallint, bigint) IS
  'C3: book the maximum cost of one API call. {ok, remaining_micro[, reason, duplicate]}. Fails closed. service_role only.';
COMMENT ON FUNCTION public.mentor_grant_credits(uuid, text, text, text, bigint, timestamptz, timestamptz, text, text) IS
  'Credits: create one lot, idempotent on (source, source_id); pays down debt; pins the Whop membership. service_role only.';
COMMENT ON FUNCTION public.ai_spend_month(text) IS
  'Anthropic spend for a UTC month YYYY-MM, micro-USD: legacy ai_call_log rows plus mentor ledger consumption. service_role only.';

RESET lock_timeout;
