-- webhook_attempts — log every inbound webhook POST regardless of outcome.
--
-- This table is already live in production (created by the rescue sprint
-- via the Supabase MCP). The rescue agents `apply_migration`-ed the SQL
-- but never landed the file in `supabase/migrations/`. Without the file,
-- a fresh-project bootstrap or a disaster-recovery run cannot reconstruct
-- the schema.
--
-- This migration is **idempotent** (`IF NOT EXISTS` everywhere) so re-applying
-- against the live DB is a no-op. The shape MUST exactly match what's
-- already in production — verified against the live `information_schema`
-- by the data-integrity audit agent on 2026-04-24.
--
-- Source-of-truth references:
--   - `src/lib/webhook-logger.ts`     (the only writer)
--   - `src/app/api/admin/webhooks/nowpayments/status/route.ts` (the reader)
--   - `src/app/api/webhooks/nowpayments/route.ts` (calls the logger)
--
-- Severity context: this closes **C-02** in
-- `./outputs/full-review/2026-04-24-medpruef-CONSOLIDATED-REPORT.md`.

CREATE TABLE IF NOT EXISTS public.webhook_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  path text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  signature_header text,
  signature_valid boolean,
  payload_hash text,
  body_preview text,
  result text NOT NULL,
  error text,
  subscription_id uuid,
  event_id text
);

CREATE INDEX IF NOT EXISTS webhook_attempts_provider_received_at_idx
  ON public.webhook_attempts (provider, received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_attempts_signature_header_idx
  ON public.webhook_attempts (signature_header);
CREATE INDEX IF NOT EXISTS webhook_attempts_event_id_idx
  ON public.webhook_attempts (event_id);
CREATE INDEX IF NOT EXISTS webhook_attempts_subscription_id_idx
  ON public.webhook_attempts (subscription_id);

-- Result values are validated at the application layer (logger lib) rather
-- than via a CHECK constraint so we can add new values without a migration
-- (e.g. when Stripe ships and we add 'webhook_too_old' or similar).

ALTER TABLE public.webhook_attempts ENABLE ROW LEVEL SECURITY;

-- Deny all reads/writes from anon + authenticated. Service role bypasses
-- RLS and is the only writer. Admin reads go through the
-- /api/admin/webhooks/* endpoints which use the service-role client too.
DROP POLICY IF EXISTS "webhook_attempts deny anon" ON public.webhook_attempts;
CREATE POLICY "webhook_attempts deny anon"
  ON public.webhook_attempts
  FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "webhook_attempts deny authenticated" ON public.webhook_attempts;
CREATE POLICY "webhook_attempts deny authenticated"
  ON public.webhook_attempts
  FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.webhook_attempts IS
  'Logs every inbound webhook POST (NOWPayments today, Stripe later) regardless of outcome. See src/lib/webhook-logger.ts. Migration C-02.';
