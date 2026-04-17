-- ═══════════════════════════════════════════════════════════════════
-- Pricing waitlist — 2026-04-17
-- ═══════════════════════════════════════════════════════════════════
-- Context: Abobaker (and others in the feedback queue) asked what Pro
-- costs and how to get it. We have a /pricing page showing Free (live),
-- Pro (coming soon, price TBC), and Group (coming soon). The Coming-
-- Soon tiers collect email signups into this table so [name] can notify
-- users when pricing is finalized and when Pro goes live.
--
-- Schema notes:
-- - user_id is nullable because pricing is publicly accessible (logged-
--   out visitors can sign up). On delete of the linked user we SET NULL
--   rather than CASCADE so we keep the signup in case the user returns
--   with a different account.
-- - tier_interest is a text column (not a CHECK-constrained enum) for
--   forward compatibility — we expect to add more tiers (e.g. 'team',
--   'lifetime') without a schema migration.
-- - The POST /api/waitlist route deduplicates by email within a 24h
--   window so a user spamming the button doesn't create noise.
--
-- RLS: deny-all for anon + authenticated (matches the RLS lockdown
-- from 2026-04-15). All access goes through the /api/waitlist route
-- which uses the service-role key and bypasses RLS.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pricing_waitlist (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  tier_interest text NOT NULL, -- 'pro' | 'group' | 'unknown'
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pricing_waitlist_email ON public.pricing_waitlist (email);
CREATE INDEX idx_pricing_waitlist_created ON public.pricing_waitlist (created_at DESC);

ALTER TABLE public.pricing_waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_waitlist_deny_all_anon ON public.pricing_waitlist
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
