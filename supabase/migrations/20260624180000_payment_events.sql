-- payment_events — structured, append-only instrumentation of the PAYMENT
-- FUNNEL (Gate 1, 2026-06-24). One row per funnel step so we can PROVE
-- whether a user factually tried to pay and exactly where it dropped:
--
--   checkout_session_created  → a plan was clicked AND a Whop checkout
--                               session (ch_…) was created (user_id, tier,
--                               session id, plan id)
--   checkout_redirected       → the checkout route is about to hand the
--                               hosted purchase_url back to the client
--                               (server-visible proxy for "redirected to pay")
--   checkout_failed           → the checkout route could not create a session
--                               (provider error / unconfigured plan / unknown
--                               tier) — the buyer never reached Whop
--   webhook_received          → mirror row for EVERY inbound Whop webhook
--                               (the authoritative delivery truth lives in
--                               webhook_attempts; this row keeps the funnel
--                               feed in one stream, incl. unmatched events)
--   grant_succeeded           → Pro was granted on payment.succeeded
--   grant_failed              → a money signal arrived but the grant did NOT
--                               happen — `reason` says WHY (unmapped /
--                               no_payment_id / db_error / unrecognized_event)
--
-- WHY a dedicated table (not user_events / user_activity_log):
--   user_events.user_id is uuid NOT NULL — it CANNOT store an unmatched
--   webhook (the exact silent-failure case we must surface), and today such
--   inserts fail (their {error} return is never read) and are dropped. This
--   table makes user_id NULLABLE precisely so an unmatched / failed grant is
--   RECORDED, loud, and visible in /admin/payments — never swallowed.
--
-- PII: never store a raw email. user_id (when known) is the join key; a
--   one-way email_hash (sha256(email + PAYMENT_EVENTS_SALT)) lets the admin
--   correlate an unmatched webhook to a signup without persisting PII, mirror
--   of csp_violations.ip_hash. payment_id / session_id / plan_id / tier are
--   operational identifiers, not PII.
--
-- Server-side operational logging is consent-independent (this is not user
-- analytics; it is payment observability), so no consent gate applies.
--
-- Service-role only — RLS deny-all for anon + authenticated (every sensitive
-- table in this project follows this; the admin read goes through the
-- service-role client in /api/stats/admin/payments).

CREATE TABLE IF NOT EXISTS public.payment_events (
  id              BIGSERIAL PRIMARY KEY,
  -- Funnel step. Validated at the app layer (paymentEvents.ts) rather than a
  -- CHECK constraint so a new step can be added without a migration — same
  -- governance choice as webhook_attempts.result.
  event           TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'whop',
  -- Buyer, when known. NULLABLE on purpose: an unmatched webhook (no metadata,
  -- email mismatch, unknown plan) has no user_id yet still MUST be recorded.
  user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  email_hash      TEXT,                 -- sha256(email + salt); NO raw email
  tier            TEXT,                 -- internal tier id (first_month_19 …)
  -- Operational identifiers for joining a drop to a manual grant.
  checkout_session_id TEXT,             -- Whop ch_… (checkout-configuration)
  plan_id         TEXT,                 -- Whop plan_… id
  payment_id      TEXT,                 -- Whop pay_… id (the manual-grant key)
  amount_cents    INTEGER,
  currency        TEXT,
  -- For grant_failed / checkout_failed: WHY it dropped (machine-readable).
  reason          TEXT,
  -- Did the webhook signature verify? NULL for non-webhook funnel steps.
  signature_valid BOOLEAN,
  -- For webhook_received: did we map it to a user / known sub? Lets the feed
  -- flag an unmatched delivery without re-deriving it.
  matched         BOOLEAN,
  -- Free-form structured context (NEVER secrets/PII): event name, ok flag,
  -- had_secret_header bool, status code, etc.
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feed is ordered newest-first; the funnel counts filter by event + time.
CREATE INDEX IF NOT EXISTS payment_events_created_idx
  ON public.payment_events (created_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_event_created_idx
  ON public.payment_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_payment_id_idx
  ON public.payment_events (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_events_user_id_idx
  ON public.payment_events (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Deny-all for anon + authenticated. The service-role client bypasses RLS and
-- is the ONLY writer (the funnel logger) + reader (the admin API route).
DROP POLICY IF EXISTS "payment_events deny anon" ON public.payment_events;
CREATE POLICY "payment_events deny anon"
  ON public.payment_events FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "payment_events deny authenticated" ON public.payment_events;
CREATE POLICY "payment_events deny authenticated"
  ON public.payment_events FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.payment_events IS
  'Append-only payment-funnel instrumentation (Gate 1, 2026-06-24). One row per funnel step (checkout_session_created → checkout_redirected → webhook_received → grant_succeeded / grant_failed). user_id NULLABLE so unmatched/failed grants are recorded, not swallowed. No raw PII (email_hash only). Writer/reader: src/lib/paymentEvents.ts + /api/stats/admin/payments. Service-role only.';
