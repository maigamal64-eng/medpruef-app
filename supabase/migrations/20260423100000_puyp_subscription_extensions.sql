-- ═══════════════════════════════════════════════════════════════════
-- Pass-Until-You-Pass (PUYP) — 2026-04-23 (crypto-founders-launch)
-- ═══════════════════════════════════════════════════════════════════
-- Context (April 23 2026 lock #1): subscribers on PUYP-eligible tiers
-- (June 26 Cohort = `premium_pass_guaranteed`, and the 12-month annual
-- tier = `twelve_month`) who fail their first real exam attempt get a
-- free subscription extension through the next exam cycle, up to 2
-- additional cycles per user. Replaces cash refunds — no refund-fraud
-- surface, and the conversion story for the premium tier.
--
-- Eligibility check (mirrored in src/lib/nowpayments.ts isPuypEligibleTier):
--   tier IN ('premium_pass_guaranteed', 'twelve_month')
--
-- This migration adds (additive only, no drops):
--   1. public.exam_attempts — user-uploaded proof of exam result.
--      `result IN ('pass','fail','pending')`, `verified_at IS NULL` =
--      awaiting admin review. Pass attempts don't need admin review.
--      Index on pending verifications for the admin queue.
--   2. public.subscription_extensions — audit trail, one row per
--      grant. CHECK source='puyp' locks it to this mechanic; any
--      future extension sources would add to the CHECK list.
--   3. public.subscriptions — ADD puyp_extensions_used (counter, max
--      2 enforced in API), puyp_eligible_tier (backfilled from tier
--      name for fast reads without re-checking the lib function).
--
-- RLS: deny-all anon/authenticated on every new table. All access
-- goes through /api/puyp/* and /api/stats/admin/* using the
-- service-role key. Matches the 2026-04-15 RLS lockdown.
--
-- Storage bucket `exam-proofs` (private, 10MB limit, PDF/PNG/JPEG/WEBP)
-- is created by application code alongside this migration — see
-- reports for the CREATE STORAGE BUCKET command.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. exam_attempts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  exam_type text NOT NULL,              -- 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma'
  attempt_date date NOT NULL,
  result text NOT NULL CHECK (result IN ('pass','fail','pending')),
  proof_url text,                        -- Supabase Storage path (exam-proofs/<uid>/<uuid>.<ext>)
  verified_at timestamptz,               -- NULL = awaiting admin review (fail only; pass is self-verified)
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejection_reason text,                 -- admin note if rejected
  qbank_completion_pct numeric(5,2),     -- snapshotted at submission (≥70% gate)
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON public.exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_pending
  ON public.exam_attempts(verified_at) WHERE verified_at IS NULL;

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all exam_attempts" ON public.exam_attempts;
CREATE POLICY "deny all exam_attempts" ON public.exam_attempts
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 2. subscription_extensions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL DEFAULT 'puyp' CHECK (source='puyp'),
  attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  previous_expires_at timestamptz,       -- the expires_at before this grant (audit)
  new_expires_at timestamptz NOT NULL,   -- the expires_at after this grant
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_extensions_user ON public.subscription_extensions(user_id);

ALTER TABLE public.subscription_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all sub_extensions" ON public.subscription_extensions;
CREATE POLICY "deny all sub_extensions" ON public.subscription_extensions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 3. subscriptions: PUYP counter + eligibility flag ────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS puyp_extensions_used int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS puyp_eligible_tier boolean NOT NULL DEFAULT false;

-- Backfill the eligibility flag from tier name. Idempotent.
UPDATE public.subscriptions
   SET puyp_eligible_tier = (tier IN ('premium_pass_guaranteed','twelve_month'))
 WHERE puyp_eligible_tier IS DISTINCT FROM
       (tier IN ('premium_pass_guaranteed','twelve_month'));
