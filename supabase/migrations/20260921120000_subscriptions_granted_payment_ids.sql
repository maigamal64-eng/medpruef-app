-- 2026-09-21 — Fix 6: subscriptions.granted_payment_ids
--
-- Adds a jsonb history of EVERY payment that contributed time to a whop
-- subscription row (extend semantics keep only the LATEST payment id in
-- provider_payment_id; the history preserves the full ledger so a later
-- refund/dispute can match any contributing payment and recompute the
-- surviving window). Default '[]'; the whop grant helper appends one entry
-- {payment_id, amount_cents, added_months, granted_at} per payment.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + the backfill only touches rows
-- still at '[]'. Scope of the backfill is deliberately limited to the two
-- known multi-payment users (Munir 805082ec…, 4eeac38d…). Metadata only:
-- no expiry, status, or tier value is modified by this migration.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS granted_payment_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- One-off, idempotent backfill: seed granted_payment_ids for the known
-- multi-payment users from payment_events grant_succeeded rows (tier
-- determines added_months; €0 notes_pro_trial rows are excluded because
-- the trial window is not a paid contribution).
WITH seeded AS (
  SELECT
    s.id AS sub_id,
    jsonb_agg(
      jsonb_build_object(
        'payment_id', pe.payment_id,
        'amount_cents', pe.amount_cents,
        'added_months', CASE pe.tier
          WHEN 'premium_pass_guaranteed' THEN 6
          WHEN 'first_3mo_27' THEN 3
          WHEN 'first_month_19' THEN 1
          ELSE 1
        END,
        'granted_at', pe.created_at
      ) ORDER BY pe.created_at
    ) AS entries
  FROM public.payment_events pe
  JOIN public.users u ON u.id = pe.user_id
  JOIN public.subscriptions s
    ON s.user_id = u.id
   AND s.payment_provider = 'whop'
   AND s.status = 'active'
  WHERE pe.event = 'grant_succeeded'
    AND pe.payment_id IS NOT NULL
    AND pe.user_id IS NOT NULL
    AND pe.tier IS DISTINCT FROM 'notes_pro_trial'
    AND (u.id::text LIKE '805082ec%' OR u.id::text LIKE '4eeac38d%')
  GROUP BY s.id
)
UPDATE public.subscriptions s
SET granted_payment_ids = seeded.entries
FROM seeded
WHERE s.id = seeded.sub_id
  AND s.granted_payment_ids = '[]'::jsonb;
