-- Seed seats (track-A job a-seed-seats, 2026-10-15; CEO decision seed-seats,
-- growth plan section 10 and X9). UNAPPLIED changeset for the post-6 Nov
-- migration window; apply after 20270102090000 (campaign codes) and
-- 20270103090000 (the reverse_trial tier). Nothing here grants anything on
-- its own: seat codes are only redeemed through the app while
-- SEED_SEATS_ENABLED is on (src/lib/seed-seats/).
--
--  1. ai_credit_campaign.kind ('credits' | 'seat') and pro_days. A seat code
--     gives pro_days (1..30, the app always writes 30) of Pro plus its credits;
--     its total cap is at most 20 redemptions (the venue cap) and its lot
--     expires with the seat (expiry_days = pro_days). Not updatable by
--     service_role: a code's kind and length are fixed at creation.
--  2. subscriptions_tier_check: the fourteen tiers of 20270103090000 plus
--     seed_seat. A seat row is provenance only: payment_provider 'seat',
--     payment_method 'seed_seat', amount 0, dated. It is never a payment, so
--     every paying count (amount > 0) leaves it out.
--  3. ai_credit_campaign_redemption: seat_subscription_id, seat_ends_at,
--     identity_key (seed_seat_identity_key: sha256 of the normalised
--     confirmed address, computed in the function under the row lock) and
--     telegram_id, with partial unique indexes: one seat per address and per
--     Telegram account, not only per account. The row has no user FK, so the
--     wall outlives a deleted account. (One person with an address on one
--     account and Telegram on another passes, as with the reverse trial.)
--  4. mentor_redeem_campaign_code is replaced with one added line: a code
--     whose kind is not 'credits' answers unknown_code, so a seat code can
--     never be spent as a credits-only code (it would burn the person's one
--     redemption without the seat).
--  5. mentor_redeem_seat_code(): the whole seat in one transaction. Account
--     first (same per-account advisory lock as the credit codes, users row
--     lock, not banned, not admin, created within 14 days, a confirmed email
--     (its key computed here) or Telegram, never paid, no running paid or comped access), then the
--     identity wall, then the code (kind seat, live, total and Vienna-day caps
--     under the code row lock), then the credits lot (source campaign_code,
--     key campaign:<user>, expiring with the seat), the dated seed_seat
--     subscriptions row, users.tier 'pro' with the seat end, and the
--     redemption row. A repeat of the same code is an idempotent duplicate.
--
-- Grants: service_role only; PUBLIC, anon and authenticated revoked
-- explicitly (Supabase 30 Oct explicit grant rule).

SET lock_timeout = '5s';

-- ─── 1. Code kind ───────────────────────────────────────────────────────
ALTER TABLE public.ai_credit_campaign ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'credits';
ALTER TABLE public.ai_credit_campaign ADD COLUMN IF NOT EXISTS pro_days integer;
DO $kind$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_campaign_kind_check' AND conrelid = 'public.ai_credit_campaign'::regclass) THEN
    ALTER TABLE public.ai_credit_campaign ADD CONSTRAINT ai_credit_campaign_kind_check CHECK (
      (kind = 'credits' AND pro_days IS NULL) OR
      (kind = 'seat' AND pro_days IS NOT NULL AND pro_days BETWEEN 1 AND 30 AND total_cap <= 20 AND expiry_days = pro_days));
  END IF;
END;
$kind$;

-- ─── 2. Tier CHECK ──────────────────────────────────────────────────────
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
    'reverse_trial'::text,
    'seed_seat'::text,
    -- a-card-trial-build-1024: 20270115090000 (applied first) added it.
    'flex_month_trial'::text
  ]));
CREATE INDEX IF NOT EXISTS subscriptions_seed_seat_live_idx
  ON public.subscriptions (expires_at) WHERE tier = 'seed_seat';

-- ─── 3. Redemption: the seat and the person ─────────────────────────────
ALTER TABLE public.ai_credit_campaign_redemption ADD COLUMN IF NOT EXISTS seat_subscription_id uuid;
ALTER TABLE public.ai_credit_campaign_redemption ADD COLUMN IF NOT EXISTS seat_ends_at timestamptz;
ALTER TABLE public.ai_credit_campaign_redemption ADD COLUMN IF NOT EXISTS identity_key text;
ALTER TABLE public.ai_credit_campaign_redemption ADD COLUMN IF NOT EXISTS telegram_id bigint;
DO $seat$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_campaign_redemption_identity_check' AND conrelid = 'public.ai_credit_campaign_redemption'::regclass) THEN
    ALTER TABLE public.ai_credit_campaign_redemption ADD CONSTRAINT ai_credit_campaign_redemption_identity_check
      CHECK (identity_key IS NULL OR identity_key ~ '^[0-9a-f]{64}$');
  END IF;
END;
$seat$;
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_campaign_redemption_identity_uniq
  ON public.ai_credit_campaign_redemption (identity_key) WHERE identity_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_campaign_redemption_telegram_uniq
  ON public.ai_credit_campaign_redemption (telegram_id) WHERE telegram_id IS NOT NULL;

-- The one-seat-per-person key of a confirmed address: the reverse trial's
-- normalisation (trimmed, lower-cased, +tag dropped, Gmail dots dropped,
-- googlemail = gmail), sha256 with the prefix "seed-seat:" so it never equals
-- a reverse-trial key. src/lib/seed-seats/server.ts seatIdentityKey mirrors it
-- (the PG16 proof compares both). NULL when there is no usable address.
CREATE OR REPLACE FUNCTION public.seed_seat_identity_key(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_at     integer;
  v_local  text;
  v_domain text;
  v_plus   integer;
BEGIN
  v_at := length(v_email) - strpos(reverse(v_email), '@') + 1;
  IF strpos(v_email, '@') = 0 OR v_at < 2 OR v_at = length(v_email) THEN
    RETURN NULL;
  END IF;
  v_local := substr(v_email, 1, v_at - 1);
  v_domain := substr(v_email, v_at + 1);
  IF v_domain = 'googlemail.com' THEN v_domain := 'gmail.com'; END IF;
  v_plus := strpos(v_local, '+');
  IF v_plus > 0 THEN v_local := substr(v_local, 1, v_plus - 1); END IF;
  IF v_domain = 'gmail.com' THEN v_local := replace(v_local, '.', ''); END IF;
  IF v_local = '' THEN RETURN NULL; END IF;
  RETURN encode(sha256(convert_to('seed-seat:' || v_local || '@' || v_domain, 'UTF8')), 'hex');
END;
$$;
REVOKE ALL ON FUNCTION public.seed_seat_identity_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_seat_identity_key(text) TO service_role;

-- ─── 4. Credit codes refuse seat codes ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mentor_redeem_campaign_code(
  p_user uuid,
  p_code text,
  p_via text,
  p_max_account_age_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code     public.ai_credit_campaign%ROWTYPE;
  v_banned   boolean;
  v_created  timestamptz;
  v_verified boolean;
  v_answered integer;
  v_prior    public.ai_credit_campaign_redemption%ROWTYPE;
  v_total    integer;
  v_day      integer;
  v_day_start timestamptz := (date_trunc('day', now() AT TIME ZONE 'Europe/Vienna')) AT TIME ZONE 'Europe/Vienna';
  v_grant    jsonb;
  v_expires  timestamptz;
BEGIN
  IF p_user IS NULL OR p_code IS NULL OR p_via NOT IN ('landing', 'settings')
     OR p_max_account_age_days IS NULL OR p_max_account_age_days < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  -- One redemption per account, whatever the code; serialise per account.
  PERFORM pg_advisory_xact_lock(hashtextextended('mentor_campaign_user:' || p_user::text, 0));
  SELECT * INTO v_prior FROM public.ai_credit_campaign_redemption WHERE user_id = p_user;
  IF FOUND THEN
    IF v_prior.code = p_code AND v_prior.seat_subscription_id IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'lot_id', v_prior.lot_id, 'credits', v_prior.credits, 'code', v_prior.code);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END IF;

  -- The account first: an ineligible account gets the same answer for any code.
  SELECT coalesce(is_banned, false), created_at,
         (email_verified_at IS NOT NULL OR (telegram_id IS NOT NULL AND telegram_id::text <> ''))
    INTO v_banned, v_created, v_verified
    FROM public.users WHERE id = p_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  IF v_banned THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'banned');
  END IF;
  IF v_created IS NULL OR v_created < now() - make_interval(days => p_max_account_age_days) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_too_old');
  END IF;
  IF NOT v_verified THEN
    -- Throwaway accounts: an unverified account needs 10 distinct answered questions (as the welcome lot).
    SELECT count(DISTINCT question_id) INTO v_answered
      FROM (SELECT question_id FROM public.answer_history WHERE user_id = p_user LIMIT 500) a;
    IF coalesce(v_answered, 0) < 10 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unverified');
    END IF;
  END IF;

  -- The code row lock serialises the caps.
  SELECT * INTO v_code FROM public.ai_credit_campaign WHERE code = p_code FOR UPDATE;
  -- a-seed-seats: a seat code is never spent as a credits-only code.
  IF NOT FOUND OR v_code.kind IS DISTINCT FROM 'credits' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;
  IF NOT v_code.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  IF now() < v_code.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started');
  END IF;
  IF now() >= v_code.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT count(*) INTO v_total FROM public.ai_credit_campaign_redemption WHERE code = p_code;
  IF v_total >= v_code.total_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached');
  END IF;
  SELECT count(*) INTO v_day FROM public.ai_credit_campaign_redemption WHERE code = p_code AND redeemed_at >= v_day_start;
  IF v_day >= v_code.daily_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap');
  END IF;

  v_expires := now() + make_interval(hours => v_code.expiry_days * 24);  -- absolute hours, independent of the session time zone
  v_grant := public.mentor_grant_credits(p_user, 'campaign_code', 'campaign_code', 'campaign:' || p_user::text,
                                         (v_code.credits::bigint * 5000), now(), v_expires, NULL, NULL);
  IF coalesce((v_grant->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      CASE WHEN v_grant->>'reason' = 'source_conflict' THEN 'already_redeemed' ELSE 'grant_failed' END);
  END IF;
  IF coalesce((v_grant->>'duplicate')::boolean, false) THEN
    -- A lot under this account's key without a redemption row (hand repair): never fund twice.
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END IF;

  INSERT INTO public.ai_credit_campaign_redemption (code, user_id, lot_id, credits, via, account_created_at)
  VALUES (p_code, p_user, (v_grant->>'lot_id')::uuid, v_code.credits, p_via, v_created);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'lot_id', v_grant->>'lot_id',
                            'credits', v_code.credits, 'expires_at', v_expires, 'code', p_code);
END;
$$;

REVOKE ALL ON FUNCTION public.mentor_redeem_campaign_code(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_redeem_campaign_code(uuid, text, text, integer) TO service_role;

-- ─── 5. Seat redemption ─────────────────────────────────────────────────
-- An early draft took the identity key as a fifth argument; never in production.
DROP FUNCTION IF EXISTS public.mentor_redeem_seat_code(uuid, text, text, text, integer);
CREATE OR REPLACE FUNCTION public.mentor_redeem_seat_code(
  p_user uuid,
  p_code text,
  p_via text,
  p_max_account_age_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  u           record;
  v_code      public.ai_credit_campaign%ROWTYPE;
  v_prior     public.ai_credit_campaign_redemption%ROWTYPE;
  v_now       timestamptz := now();
  v_max_age   integer;
  v_identity  text;
  v_telegram  bigint;
  v_trial_end timestamptz;
  v_total     integer;
  v_day       integer;
  v_day_start timestamptz := (date_trunc('day', now() AT TIME ZONE 'Europe/Vienna')) AT TIME ZONE 'Europe/Vienna';
  v_end       timestamptz;
  v_grant     jsonb;
  v_sub       uuid;
  v_live      record;
  v_conname   text;
BEGIN
  IF p_user IS NULL OR p_code IS NULL OR p_via NOT IN ('landing', 'settings')
     OR p_max_account_age_days IS NULL OR p_max_account_age_days < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  -- The venue rule is "account under 14 days old"; a caller can only narrow it.
  v_max_age := least(p_max_account_age_days, 14);

  -- The code first, without a lock: an unknown, paused, ended or not-started
  -- seat code answers the same as any unknown code, before any account
  -- reason could tell them apart. Re-checked under the row lock below.
  SELECT kind, active, starts_at, ends_at INTO v_live FROM public.ai_credit_campaign WHERE code = p_code;
  IF NOT FOUND OR v_live.kind IS DISTINCT FROM 'seat' OR NOT v_live.active
     OR v_now < v_live.starts_at OR v_now >= v_live.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;

  -- Same lock as the credit codes: one redemption per account, whatever the code.
  PERFORM pg_advisory_xact_lock(hashtextextended('mentor_campaign_user:' || p_user::text, 0));
  SELECT * INTO v_prior FROM public.ai_credit_campaign_redemption WHERE user_id = p_user;
  IF FOUND THEN
    IF v_prior.code = p_code AND v_prior.seat_subscription_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'kind', 'seat', 'credits', v_prior.credits,
                                'seat_ends_at', v_prior.seat_ends_at, 'code', v_prior.code);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END IF;

  -- The account first (row lock: a payment grant or another grant waits).
  SELECT id, role, tier, tier_expires_at, coalesce(is_banned, false) AS banned, created_at,
         email, email_verified_at, telegram_id
    INTO u FROM public.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;
  IF u.banned THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'banned');
  END IF;
  IF u.role = 'admin' OR u.tier = 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_pro');
  END IF;
  IF u.created_at IS NULL OR u.created_at < v_now - make_interval(days => v_max_age) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_too_old');
  END IF;
  -- A seat needs a verified identity: a confirmed address (its key computed
  -- here, under the row lock, from the address the row holds now) or
  -- Telegram. No answered-questions fallback for a seat.
  v_telegram := u.telegram_id;
  IF u.email_verified_at IS NOT NULL THEN
    v_identity := public.seed_seat_identity_key(u.email);
  END IF;
  IF v_identity IS NULL AND v_telegram IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unverified');
  END IF;

  -- Never paid: no paid subscriptions row in any settled state, no granted
  -- payment, no paid grant receipt.
  IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p_user AND coalesce(s.amount_cents, 0) > 0
               AND s.status IN ('active', 'expired', 'cancelled', 'refunded', 'partially_paid'))
     OR EXISTS (SELECT 1 FROM public.payment_events e WHERE e.user_id = p_user AND e.event = 'grant_succeeded')
     OR EXISTS (SELECT 1 FROM public.whop_paid_grant_receipts r WHERE r.user_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_before');
  END IF;

  -- No running access other than the 3-day reverse trial: a seat never
  -- replaces or stacks on a paid, comped, card-trial or open-ended period.
  IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p_user AND s.status = 'active'
               AND (s.expires_at IS NULL OR s.expires_at > v_now) AND s.tier IS DISTINCT FROM 'reverse_trial') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_pro');
  END IF;
  IF u.tier = 'pro' THEN
    IF u.tier_expires_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_pro');
    END IF;
    IF u.tier_expires_at > v_now THEN
      SELECT max(s.expires_at) INTO v_trial_end FROM public.subscriptions s
        WHERE s.user_id = p_user AND s.status = 'active' AND s.tier = 'reverse_trial' AND s.expires_at > v_now;
      IF v_trial_end IS NULL OR u.tier_expires_at > v_trial_end + interval '1 minute' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_pro');
      END IF;
    END IF;
  END IF;

  -- One seat per person (the rows outlive a deleted account).
  IF (v_identity IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_credit_campaign_redemption r WHERE r.identity_key = v_identity))
     OR (v_telegram IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_credit_campaign_redemption r WHERE r.telegram_id = v_telegram)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'identity_used');
  END IF;

  -- The code row lock serialises the venue caps.
  SELECT * INTO v_code FROM public.ai_credit_campaign WHERE code = p_code FOR UPDATE;
  IF NOT FOUND OR v_code.kind IS DISTINCT FROM 'seat' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_code');
  END IF;
  IF NOT v_code.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  IF v_now < v_code.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started');
  END IF;
  IF v_now >= v_code.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  SELECT count(*) INTO v_total FROM public.ai_credit_campaign_redemption WHERE code = p_code;
  IF v_total >= least(v_code.total_cap, 20) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached');
  END IF;
  SELECT count(*) INTO v_day FROM public.ai_credit_campaign_redemption WHERE code = p_code AND redeemed_at >= v_day_start;
  IF v_day >= v_code.daily_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap');
  END IF;

  -- The seat: absolute hours, independent of the session time zone.
  v_end := v_now + make_interval(hours => least(v_code.pro_days, 30) * 24);
  BEGIN
  v_grant := public.mentor_grant_credits(p_user, 'campaign_code', 'campaign_code', 'campaign:' || p_user::text,
                                         (v_code.credits::bigint * 5000), v_now, v_end, NULL, NULL);
  IF coalesce((v_grant->>'ok')::boolean, false) IS NOT TRUE THEN
    IF v_grant->>'reason' = 'source_conflict' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
    END IF;
    -- Abort the whole transaction: nothing of the seat stays half written.
    RAISE EXCEPTION 'seed seat credit grant failed: %', coalesce(v_grant->>'reason', 'unknown') USING ERRCODE = 'P0001';
  END IF;
  IF coalesce((v_grant->>'duplicate')::boolean, false) THEN
    -- A lot under this account's key without a redemption row (hand repair): never fund twice.
    RETURN jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  END IF;

  INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method,
    amount_cents, currency, started_at, expires_at)
  VALUES (p_user, 'seed_seat', 'active', 'seat', 'seed_seat', 0, 'EUR', v_now, v_end)
  RETURNING id INTO v_sub;
  -- A stale end on a non-Pro row never stretches the seat; a running reverse
  -- trial (the only Pro allowed here) is extended, never shortened.
  UPDATE public.users
     SET tier = 'pro',
         tier_expires_at = CASE WHEN u.tier = 'pro' THEN greatest(coalesce(u.tier_expires_at, v_end), v_end) ELSE v_end END,
         updated_at = v_now
   WHERE id = p_user;
  INSERT INTO public.ai_credit_campaign_redemption (code, user_id, lot_id, credits, via, account_created_at,
    seat_subscription_id, seat_ends_at, identity_key, telegram_id)
  VALUES (p_code, p_user, (v_grant->>'lot_id')::uuid, v_code.credits, p_via, u.created_at,
    v_sub, v_end, v_identity, v_telegram);
  EXCEPTION WHEN unique_violation THEN
    -- Two accounts of one person racing past the identity check: the unique
    -- index decides, and everything in this block is rolled back. Any other
    -- unique index is a real error, never "your other account has a seat".
    GET STACKED DIAGNOSTICS v_conname = CONSTRAINT_NAME;
    IF v_conname IN ('ai_credit_campaign_redemption_identity_uniq', 'ai_credit_campaign_redemption_telegram_uniq') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'identity_used');
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'kind', 'seat', 'credits', v_code.credits,
                            'seat_ends_at', v_end, 'code', p_code);
END;
$$;

REVOKE ALL ON FUNCTION public.mentor_redeem_seat_code(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_redeem_seat_code(uuid, text, text, integer) TO service_role;
COMMENT ON FUNCTION public.mentor_redeem_seat_code(uuid, text, text, integer) IS
  'a-seed-seats: redeem one seat code (new, never-paid, verified accounts under 14 days old; one seat per person; venue total cap at most 20 and Vienna-day cap) and grant the dated seed_seat row, dated Pro and the credits lot in one transaction. service_role only.';

RESET lock_timeout;
