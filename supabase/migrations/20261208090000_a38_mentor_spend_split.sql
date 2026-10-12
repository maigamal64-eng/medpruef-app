-- a38 (MUX-106 option A, [name] 2026-10-12): separate mentor and legacy caps.
--
-- Adds ai_spend_month_split(p_month): the same UTC-month Anthropic spend that
-- ai_spend_month(p_month) returns, split into its two lanes, so the mentor and
-- legacy AI (ai-chat, translate, notes transform, notes safety) can each be
-- checked against their own share of ai_spend_cap(). The shares are computed
-- in the app (src/lib/ai/limits.ts laneCapMicro) and always add up to the old
-- total cap. ai_spend_month and ai_spend_cap are unchanged.
--
-- Requires 20261014095000_ai_quota_rpc.sql (ai_call_log). Reads
-- ai_usage_ledger from 20261022100000_mentor_ledger.sql when it exists and
-- counts the mentor lane as 0 before that. Unapplied; the app falls back to the shared total while
-- this function is missing. Rollback: scripts/sql/track-a/a38-mentor-ledger/down.sql.

CREATE OR REPLACE FUNCTION public.ai_spend_month_split(p_month text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start  timestamptz;
  v_legacy bigint;
  v_mentor bigint;
BEGIN
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'p_month must be YYYY-MM, got %', p_month USING ERRCODE = '22023';
  END IF;
  v_start := (to_date(p_month || '-01', 'YYYY-MM-DD')::timestamp) AT TIME ZONE 'UTC';
  -- Same rows as ai_spend_month: legacy = Anthropic ai_call_log rows not
  -- logged by the mentor route; mentor = ledger consumption (settle and
  -- house_cost cost). Grants, purchases, reserves and clawbacks never count.
  SELECT COALESCE(SUM(CEIL(l.cost_usd * 1000000)), 0)::bigint INTO v_legacy
    FROM public.ai_call_log l
   WHERE l.provider = 'anthropic'
     AND (l.route IS NULL OR l.route <> 'mentor')
     AND l.created_at >= v_start
     AND l.created_at <  v_start + interval '1 month';
  -- Applied before the mentor ledger, the mentor lane is simply 0, so this
  -- read can never take legacy AI down by itself.
  IF to_regclass('public.ai_usage_ledger') IS NULL THEN
    v_mentor := 0;
  ELSE
    EXECUTE $q$SELECT COALESCE(SUM(g.cost_micro), 0)::bigint
      FROM public.ai_usage_ledger g
     WHERE g.kind IN ('settle', 'house_cost')
       AND g.cost_micro IS NOT NULL
       AND g.created_at >= $1
       AND g.created_at <  $1 + interval '1 month'$q$
      INTO v_mentor USING v_start;
  END IF;
  RETURN jsonb_build_object('legacy_micro', v_legacy, 'mentor_micro', v_mentor);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_spend_month_split(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_spend_month_split(text) TO service_role;

COMMENT ON FUNCTION public.ai_spend_month_split(text) IS
  'a38 MUX-106 A: UTC-month Anthropic spend split into legacy_micro and mentor_micro (sum = ai_spend_month). service_role only; each lane is checked against its own share of ai_spend_cap in the app.';
