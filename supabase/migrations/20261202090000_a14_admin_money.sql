-- a14 admin money (ADM-01, ADM-02). track-A candidate, UNAPPLIED.
-- Production application needs [name]'s GO (pick-admin-schema-go A). Proven on
-- a throwaway PostgreSQL 16 cluster by `npm run test:db:a14`.
-- Rollback: scripts/sql/track-a/a14-admin-money/down.sql.
--
-- 1. payment_resolutions: one row per paid payment that never granted and
--    was resolved by an admin on /admin/payments (Unresolved payments queue):
--    'link' (granted to a learner through the shared Whop grant path),
--    'test' or 'not_ours' (dismissed; excluded from money in). The unique
--    payment id is the lock that stops a double submit from granting twice.
--    Service-role only, RLS deny-all, explicit grants (30 Oct rule).
-- 2. ops_growth_summary: the agent read uses the same paying definition as
--    every admin page (src/lib/admin/money-rules.ts): real learners (staff
--    and test accounts excluded) with an active, unexpired real-rail row AND
--    a positive payment. Trial rows without a charge are reported apart under
--    a new top-level 'trials' key. Signature, ACL, audit event and the
--    all_time keys are unchanged.

SET lock_timeout = '3s';

-- 1. payment_resolutions -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_resolutions (
  payment_id text PRIMARY KEY
    CHECK (payment_id ~ '^[A-Za-z0-9_-]{3,100}$'),
  provider text NOT NULL DEFAULT 'whop'
    CHECK (provider IN ('whop', 'stripe', 'nowpayments')),
  kind text NOT NULL CHECK (kind IN ('link', 'test', 'not_ours')),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  subscription_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Dismissals never name a learner. A link names one at write time (the
  -- route requires it); a later account deletion may null it.
  CONSTRAINT payment_resolutions_dismiss_no_user CHECK (kind = 'link' OR user_id IS NULL)
);

COMMENT ON TABLE public.payment_resolutions IS
  'a14 (ADM-02): admin resolution of a paid payment that never granted. link = granted via the shared Whop grant path; test / not_ours = dismissed and excluded from money in. Service role only.';

CREATE INDEX IF NOT EXISTS payment_resolutions_created_at_idx
  ON public.payment_resolutions (created_at DESC);
CREATE INDEX IF NOT EXISTS payment_resolutions_user_id_idx
  ON public.payment_resolutions (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.payment_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_resolutions deny anon" ON public.payment_resolutions;
CREATE POLICY "payment_resolutions deny anon" ON public.payment_resolutions
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "payment_resolutions deny authenticated" ON public.payment_resolutions;
CREATE POLICY "payment_resolutions deny authenticated" ON public.payment_resolutions
  AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.payment_resolutions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_resolutions TO service_role;

-- 2. ops_growth_summary: shared paying definition ----------------------------
CREATE OR REPLACE FUNCTION public.ops_growth_summary(
 p_token_hash text,p_environment text,p_audience text,p_days integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'overview.read');
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 WITH real_users AS (
  SELECT u.id,u.created_at FROM public.users u
  WHERE coalesce(u.role,'')<>'admin' AND coalesce(u.tier,'')<>'admin'
   AND (u.email IS NULL OR btrim(u.email)='' OR NOT (
     lower(btrim(u.email)) LIKE '%@medpruf.com' OR lower(btrim(u.email)) LIKE '%@medpruef.com'
     OR lower(btrim(u.email)) LIKE '%.invalid' OR lower(btrim(u.email)) LIKE '%.test'
     OR lower(btrim(u.email)) LIKE '%@example.%'
     OR lower(btrim(u.email)) ~ '(^|[^a-z])(test|testing|fixture|e2e|dummy|fake|qa|demo|playwright|smoke)([^a-z]|$)'
   ))
 ), answer_counts AS (
  SELECT h.user_id,count(*) AS n FROM public.answer_history h JOIN real_users ru ON ru.id=h.user_id GROUP BY h.user_id
 ), live_rows AS (
  SELECT s.user_id,
   (coalesce(s.amount_cents,0)>0 OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.granted_payment_ids)='array' THEN s.granted_payment_ids ELSE '[]'::jsonb END) e
     WHERE CASE WHEN jsonb_typeof(e->'amount_cents')='number' THEN (e->>'amount_cents')::numeric>0 ELSE false END
   )) AS paid
  FROM public.subscriptions s JOIN real_users ru ON ru.id=s.user_id
  WHERE s.status='active' AND s.payment_provider IN ('whop','stripe','nowpayments')
   AND (s.expires_at IS NULL OR s.expires_at>now())
 ), paying_users AS (
  SELECT DISTINCT user_id FROM live_rows WHERE paid
 ), trial_users AS (
  SELECT DISTINCT l.user_id FROM live_rows l WHERE NOT l.paid AND l.user_id NOT IN (SELECT user_id FROM paying_users)
 ), recent_active AS (
  SELECT DISTINCT l.user_id FROM public.user_activity_log l JOIN real_users ru ON ru.id=l.user_id
  WHERE l.created_at>=now()-make_interval(days=>p_days)
 )
 SELECT jsonb_build_object(
  'as_of',now(),
  'all_time',jsonb_build_object(
   'signups',(SELECT count(*) FROM real_users),
   'activated',(SELECT count(*) FROM answer_counts WHERE n>=1),
   'engaged',(SELECT count(*) FROM answer_counts WHERE n>=25),
   'paying',(SELECT count(*) FROM paying_users)
  ),
  'trials',jsonb_build_object('in_trial',(SELECT count(*) FROM trial_users)),
  'last_days',jsonb_build_object(
   'days',p_days,
   'signups',(SELECT count(*) FROM real_users WHERE created_at>=now()-make_interval(days=>p_days)),
   'active_users',(SELECT count(*) FROM recent_active),
   'active_users_basis','Distinct real users with at least one user_activity_log event in the window'
  ),
  'basis',jsonb_build_object(
   'real_user_filter','Excludes role=admin, tier=admin, @medpruf.com/@medpruef.com, reserved test domains (.invalid, example.*, .test) and test words in the email; null email is retained',
   'activated','Real users with at least one answer_history row',
   'engaged','Real users with at least 25 answer_history rows',
   'paying','Distinct real users with an active, unexpired subscription on whop/stripe/nowpayments and a positive payment (row amount or payment history); null expiry is treated as unexpired. Trials without a charge are counted under trials.in_trial',
   'recent_active','Distinct real users with at least one user_activity_log row in the requested window'
  )
 ) INTO r;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'growth.summary'); RETURN r;
END $$;
