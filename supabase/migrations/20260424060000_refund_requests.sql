-- refund_requests — log of user-requested refunds.
--
-- Already live in production via the rescue sprint; never landed as a file.
-- See C-02 in `./outputs/full-review/2026-04-24-medpruef-CONSOLIDATED-REPORT.md`.
--
-- Refunds are NOT executed automatically — crypto reversals are manual.
-- [name] processes via `/admin/refund-requests` (UI deferred to follow-up).
-- The 7-day no-questions-asked refund guarantee on /pricing depends on
-- this table existing + being readable from the admin panel.

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS refund_requests_user_id_idx
  ON public.refund_requests (user_id);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx
  ON public.refund_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS refund_requests_subscription_id_idx
  ON public.refund_requests (subscription_id);

-- Idempotency: a user with one open `pending` refund request for a given
-- subscription should not be able to fire another. The /api/subscriptions/
-- refund-request endpoint already enforces this with a SELECT, but we
-- also add a partial unique index so the DB enforces it under racy parallel
-- requests.
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_pending_per_sub_idx
  ON public.refund_requests (user_id, subscription_id)
  WHERE status = 'pending';

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

-- Service-role only — no public read or write. Users can request refunds
-- via /api/subscriptions/refund-request which uses the service-role client
-- after `requireUser()` validates ownership.
DROP POLICY IF EXISTS "refund_requests deny anon" ON public.refund_requests;
CREATE POLICY "refund_requests deny anon"
  ON public.refund_requests
  FOR ALL
  TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "refund_requests deny authenticated" ON public.refund_requests;
CREATE POLICY "refund_requests deny authenticated"
  ON public.refund_requests
  FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.refund_requests IS
  'User-requested refunds. Manual processing by admin (crypto reversals are not auto). Migration C-02.';
