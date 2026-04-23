-- ═══════════════════════════════════════════════════════════════════
-- Crypto payments + referrals — 2026-04-23 (crypto-founders-launch)
-- ═══════════════════════════════════════════════════════════════════
-- Context: Stripe / Paddle / Whop all blocked on KYC (Egyptian passport
-- expired). Decision (2026-04-22): ship crypto-only launch via
-- NOWPayments for the Founders' tier (€114, 6 months) on the June 26
-- Pharmakologie cycle. Stripe Atlas runs in parallel and will cut
-- over later.
--
-- This migration adds:
--   1. public.subscriptions — audit table + source-of-truth for paid
--      tiers. users.tier + users.tier_expires_at stay denormalized
--      for fast reads (no join on hot paths).
--   2. public.processed_webhook_events — idempotency guard for
--      NOWPayments IPN retries. Primary key (provider, event_id).
--   3. public.referrals — earn side: one row per (referrer, referee)
--      pair, €40 default credit, qualifies on referee's first paid
--      subscription.
--   4. public.users — adds payout_* columns (method, wallet address,
--      wallet chain, Wise email) and referred_by_code (text — the
--      code they signed up with). NOTE: users.referral_code (text,
--      UNIQUE) and users.referred_by (uuid, FK → users.id) already
--      exist from earlier schema; both are preserved. referral_code
--      is the user's own invite code; referred_by_code is the code
--      they typed in during signup (resolved to referred_by uuid
--      later if still wanted, but the text form is what the checkout
--      API sees first).
--   5. public.waitlist — non-crypto tier signups (Stripe-pending
--      email capture). SEPARATE from public.pricing_waitlist, which
--      predates this migration and is kept for backward compatibility
--      with the existing /api/waitlist endpoint. New pricing-page
--      captures of exam_type + exam_date will target this table.
--
-- RLS: deny-all anon/authenticated on every new table — all access
-- goes through /api/* routes using the service-role key. Matches the
-- 2026-04-15 RLS lockdown.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. subscriptions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  tier text NOT NULL,                   -- 'founders' | 'pro' | 'pro_3mo' | 'pro_6mo' | 'pro_12mo'
  status text NOT NULL,                 -- 'pending' | 'active' | 'expired' | 'cancelled' | 'refunded' | 'partially_paid' | 'failed'
  payment_provider text,                -- 'nowpayments' | 'stripe' | 'manual'
  payment_method text,                  -- 'crypto' | 'card' | 'bank_transfer'
  amount_cents int,                     -- e.g. 11400 for €114
  currency text DEFAULT 'EUR',
  crypto_tx_hash text,
  crypto_currency text,                 -- 'USDT_TRC20' | 'USDC_ERC20' | 'BTC' etc
  provider_invoice_id text,             -- NOWPayments invoice_id
  provider_payment_id text,             -- NOWPayments payment_id
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active
  ON public.subscriptions(user_id, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_invoice
  ON public.subscriptions(provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all subscriptions" ON public.subscriptions;
CREATE POLICY "deny all subscriptions" ON public.subscriptions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 2. processed_webhook_events ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  processed_at timestamptz DEFAULT now(),
  payload jsonb,                        -- keep for audit/debug
  PRIMARY KEY (provider, event_id)
);

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all webhook events" ON public.processed_webhook_events;
CREATE POLICY "deny all webhook events" ON public.processed_webhook_events
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 3. referrals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  referee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'qualified' | 'rewarded'
  reward_credit_cents int DEFAULT 4000,    -- €40 per referral
  qualified_at timestamptz,                -- referee's first paid subscription
  rewarded_at timestamptz,                 -- payout executed
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON public.referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee
  ON public.referrals(referee_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code
  ON public.referrals(referral_code);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all referrals" ON public.referrals;
CREATE POLICY "deny all referrals" ON public.referrals
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 4. users — payout + text-form referred_by ─────────────────────
-- NOTE: users.referral_code (text, UNIQUE) already exists and is
-- populated for all 90 rows. users.referred_by (uuid, FK → users.id)
-- also exists but is currently unused (0 rows populated). The spec
-- calls for referred_by text (the code they signed up with). To avoid
-- dropping the existing FK column, we ADD a new text column named
-- referred_by_code that stores the invite code string. The existing
-- uuid column is preserved for any future "resolved-to-user" usage.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referred_by_code text,
  ADD COLUMN IF NOT EXISTS payout_method text,              -- 'crypto_wallet' | 'wise_account' | null
  ADD COLUMN IF NOT EXISTS payout_wallet_address text,      -- USDT / USDC wallet address
  ADD COLUMN IF NOT EXISTS payout_wallet_chain text,        -- 'TRC20' | 'ERC20' | 'POLYGON'
  ADD COLUMN IF NOT EXISTS payout_wise_email text;

CREATE INDEX IF NOT EXISTS idx_users_referred_by_code
  ON public.users(referred_by_code)
  WHERE referred_by_code IS NOT NULL;

-- ── 5. waitlist (non-crypto, Stripe-pending) ─────────────────────
-- Separate from the existing public.pricing_waitlist table (which is
-- kept for backward compatibility with the existing /api/waitlist
-- endpoint). This new table is what the rebuilt pricing page will
-- POST to for the non-Founders' tier cards — it captures exam_type +
-- exam_date + tier_interest so [name] can blast them when Stripe Atlas
-- clears.
CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  exam_type text,                       -- 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma'
  exam_date date,
  tier_interest text,                   -- '3mo' | '6mo' | '12mo' | 'monthly'
  source text DEFAULT 'stripe_pending',
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_email
  ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_source
  ON public.waitlist(source);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all waitlist" ON public.waitlist;
CREATE POLICY "deny all waitlist" ON public.waitlist
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
