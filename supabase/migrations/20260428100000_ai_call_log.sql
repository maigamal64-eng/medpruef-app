-- ai_call_log: per-call audit table for /api/ai-chat
-- Replaces the user_events count-based quota check with a dedicated table
-- so we can also track tokens, costs, and provider per call.
-- Quota window: midnight Europe/Vienna (matches the user-facing reset copy).

CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,                    -- 'anthropic' | 'openai' | 'none'
  model text NOT NULL,                       -- e.g. 'gpt-4o-mini' | 'claude-haiku-4-5'
  in_tokens int,
  out_tokens int,
  cost_usd numeric(10,6),
  duration_ms int,
  question_id int,
  success boolean NOT NULL DEFAULT true,
  error_code text                            -- short tag when success=false
);

-- Vienna-day index for the daily-quota count query.
CREATE INDEX IF NOT EXISTS idx_ai_call_log_user_vienna_day
  ON public.ai_call_log (
    user_id,
    ((created_at AT TIME ZONE 'Europe/Vienna')::date)
  );

-- Per-user recent-history index for admin debug queries.
CREATE INDEX IF NOT EXISTS idx_ai_call_log_user_created
  ON public.ai_call_log (user_id, created_at DESC);

-- Lock RLS down — service-role only (mirrors subscriptions, csp_violations).
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_call_log' AND policyname = 'ai_call_log_no_anon'
  ) THEN
    CREATE POLICY ai_call_log_no_anon ON public.ai_call_log
      FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE public.ai_call_log IS
  'Per-call audit table for /api/ai-chat. Replaces user_events-based quota counting; resets at midnight Europe/Vienna. RLS deny-all; service-role only.';
