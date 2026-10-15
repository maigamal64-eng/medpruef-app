-- Free mentor credit hooks (track-A job a-free-credit-hooks, 2026-10-14).
-- UNAPPLIED changeset. Apply after 20261022130000_mentor_beta.sql (it re-adds
-- that file's lot source CHECK with three more sources). Nothing here grants
-- a credit: every new source is behind its own default-off env flag
-- (src/lib/mentor/credits/free-credits.ts).
--
--  1. Three new lot sources:
--       welcome_taste      <user_id>             once per account (MENTOR_WELCOME_ENABLED)
--       campaign_code      campaign:<user_id>    one code redemption per account (MENTOR_CAMPAIGN_CODES_ENABLED)
--       experience_reward  testimonial:<user_id> one testimonial reward per person (MENTOR_EXPERIENCE_REWARD_ENABLED)
--     The referral trial-start reward reuses referral_reward with key
--     trial_start:<referral id>; no schema change for it.
--  2. Three catalogue rows (kind gift, never sold). Amounts come from env as
--     an explicit p_micro; the row amounts are only the documented defaults.
--  3. ai_credit_campaign (admin-made codes) and ai_credit_campaign_redemption
--     (one row per account, UNIQUE(user_id)). RLS on, no policies, service
--     role only.
--  4. mentor_redeem_campaign_code(): the whole redemption in one transaction.
--     The account is checked first (exists, not banned, at most N days old,
--     verified email or Telegram or 10+ distinct answered questions), so an
--     ineligible account learns nothing about whether a code exists; then the
--     code (live, total and Vienna-day caps under its row lock), then
--     mentor_grant_credits and the redemption row.
--  5. Index ai_credit_lot (source, created_at) for the per-month breakers.

SET lock_timeout = '5s';

-- ─── 1. Lot sources ─────────────────────────────────────────────────────
ALTER TABLE public.ai_credit_lot DROP CONSTRAINT IF EXISTS ai_credit_lot_source_check;
ALTER TABLE public.ai_credit_lot ADD CONSTRAINT ai_credit_lot_source_check CHECK (source IN
  ('whop_payment', 'pro_included', 'trial_taste', 'admin_gift', 'referral_reward',
   'admin_included', 'unknown_included', 'admin_adjust', 'free_taste', 'beta_grant',
   'welcome_taste', 'campaign_code', 'experience_reward'));

-- ─── 2. Catalogue rows ──────────────────────────────────────────────────
INSERT INTO public.ai_credit_package
  (package_id, kind, grant_micro, period_days, expiry_days, price_eur_cents, active, provisional, sort, note)
VALUES
  ('welcome_taste', 'gift', 125000, NULL, 30, NULL, true, false, 52,
   'a-free-credit-hooks (2026-10-14): welcome credits once per account, amount from MENTOR_WELCOME_CREDITS (default 25), behind MENTOR_WELCOME_ENABLED.'),
  ('campaign_code', 'gift', 500000, NULL, 60, NULL, true, false, 63,
   'a-free-credit-hooks: campaign code credits; amount and expiry from the ai_credit_campaign row, behind MENTOR_CAMPAIGN_CODES_ENABLED.'),
  ('experience_reward', 'gift', 500000, NULL, 30, NULL, true, false, 64,
   'a-free-credit-hooks: thank-you for a first-party testimonial, admin approved, amount from MENTOR_EXPERIENCE_CREDITS (default 100).')
ON CONFLICT (package_id) DO NOTHING;

-- ─── 3. Campaign codes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_credit_campaign (
  code         text        PRIMARY KEY CHECK (code ~ '^[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9])){2,23}$'),
  label        text        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  credits      integer     NOT NULL CHECK (credits BETWEEN 1 AND 1000),
  expiry_days  integer     NOT NULL CHECK (expiry_days BETWEEN 1 AND 180),
  total_cap    integer     NOT NULL CHECK (total_cap BETWEEN 1 AND 10000),
  daily_cap    integer     NOT NULL CHECK (daily_cap BETWEEN 1 AND 10000),
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  active       boolean     NOT NULL DEFAULT true,
  note         text        CHECK (note IS NULL OR length(note) <= 500),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (daily_cap <= total_cap)
);

CREATE TABLE IF NOT EXISTS public.ai_credit_campaign_redemption (
  id                  bigserial   PRIMARY KEY,
  code                text        NOT NULL REFERENCES public.ai_credit_campaign (code),
  user_id             uuid        NOT NULL UNIQUE,
  lot_id              uuid        NOT NULL,
  credits             integer     NOT NULL CHECK (credits > 0),
  via                 text        NOT NULL CHECK (via IN ('landing', 'settings')),
  account_created_at  timestamptz,
  redeemed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_credit_campaign_redemption_code_time
  ON public.ai_credit_campaign_redemption (code, redeemed_at);

ALTER TABLE public.ai_credit_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_campaign_redemption ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_campaign FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_credit_campaign_redemption FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_credit_campaign FROM service_role;
REVOKE ALL ON public.ai_credit_campaign_redemption FROM service_role;
GRANT SELECT, INSERT ON public.ai_credit_campaign TO service_role;
GRANT UPDATE (label, total_cap, daily_cap, ends_at, active, note, updated_at) ON public.ai_credit_campaign TO service_role;
GRANT SELECT, INSERT ON public.ai_credit_campaign_redemption TO service_role;
GRANT USAGE ON SEQUENCE public.ai_credit_campaign_redemption_id_seq TO service_role;

-- ─── 4. Redemption ──────────────────────────────────────────────────────
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
    IF v_prior.code = p_code THEN
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
  IF NOT FOUND THEN
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
COMMENT ON FUNCTION public.mentor_redeem_campaign_code(uuid, text, text, integer) IS
  'a-free-credit-hooks: redeem one campaign code (once per account, total and Vienna-day caps, banned and account-age checks) and grant its campaign_code lot in one transaction. service_role only.';

-- ─── 5. Breaker index ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_credit_lot_source_created ON public.ai_credit_lot (source, created_at);

RESET lock_timeout;
