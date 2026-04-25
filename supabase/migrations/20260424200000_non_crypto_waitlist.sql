-- Rescue-sprint follow-up: capture users who hit the pre-checkout
-- trust dialog and tap "Ich habe keine Krypto." We email them as
-- soon as Stripe Atlas clears.
--
-- Applied via Supabase MCP on 2026-04-24.

CREATE TABLE IF NOT EXISTS public.non_crypto_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  tier_interest text,
  current_provider text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  contacted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_non_crypto_waitlist_created
  ON public.non_crypto_waitlist (created_at DESC);

ALTER TABLE public.non_crypto_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all non_crypto_waitlist" ON public.non_crypto_waitlist;
CREATE POLICY "deny all non_crypto_waitlist" ON public.non_crypto_waitlist
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
