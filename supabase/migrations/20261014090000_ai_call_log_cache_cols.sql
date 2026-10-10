-- UNAPPLIED (contract C3a, written in wave 0). Apply only with release train R2
-- on [name]'s migration GO. Additive only: four nullable columns, three CHECK
-- constraints and one index on public.ai_call_log. No data is rewritten, no
-- grant is changed, nothing outside this MedPruef table is touched (the
-- Supabase project is shared with [name]).
--
-- Contract C3a lists "provider" among the columns to add. It already exists on
-- public.ai_call_log as text NOT NULL ('anthropic' | 'openai' | 'none'), so it
-- is asserted below rather than re-added.
--
-- Lock profile: ALTER TABLE ... ADD COLUMN (nullable, no default) is a catalog
-- change; ADD CONSTRAINT ... NOT VALID skips the scan; VALIDATE takes only a
-- SHARE UPDATE EXCLUSIVE lock (the table holds about 100 rows today). The
-- brief lock_timeout makes the migration fail fast instead of queueing behind
-- live traffic.

SET lock_timeout = '3s';

DO $preflight$
BEGIN
  IF to_regclass('public.ai_call_log') IS NULL THEN
    RAISE EXCEPTION 'public.ai_call_log is missing; apply 20260428100000_ai_call_log.sql first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_call_log'
      AND column_name = 'provider' AND data_type = 'text' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'public.ai_call_log.provider (text NOT NULL) expected';
  END IF;
END
$preflight$;

ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS status text;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_call_log'::regclass AND conname = 'ai_call_log_cache_tokens_nonneg') THEN
    ALTER TABLE public.ai_call_log
      ADD CONSTRAINT ai_call_log_cache_tokens_nonneg
      CHECK ((cache_read_tokens IS NULL OR cache_read_tokens >= 0)
         AND (cache_write_tokens IS NULL OR cache_write_tokens >= 0)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_call_log'::regclass AND conname = 'ai_call_log_route_format') THEN
    ALTER TABLE public.ai_call_log
      ADD CONSTRAINT ai_call_log_route_format
      CHECK (route IS NULL OR route ~ '^[a-z][a-z0-9_]{0,39}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_call_log'::regclass AND conname = 'ai_call_log_status_values') THEN
    -- Mirrors the wrapper's outcomes (src/lib/ai/anthropic.ts):
    --   ok, timeout (AiTimeout), empty_text (AiEmptyText),
    --   upstream_error (AiUpstream), rejected_input (AiInputRejected, never billed),
    --   refusal (AiRefusal, stop_reason refusal, billed),
    --   cache_ttl_violation (AiCacheTtlViolation), quota_denied, cap_denied.
    -- NULL = rows written before R2.
    ALTER TABLE public.ai_call_log
      ADD CONSTRAINT ai_call_log_status_values
      CHECK (status IS NULL OR status IN (
        'ok', 'timeout', 'empty_text', 'upstream_error', 'rejected_input',
        'refusal', 'cache_ttl_violation', 'quota_denied', 'cap_denied')) NOT VALID;
  END IF;
END
$constraints$;

ALTER TABLE public.ai_call_log VALIDATE CONSTRAINT ai_call_log_cache_tokens_nonneg;
ALTER TABLE public.ai_call_log VALIDATE CONSTRAINT ai_call_log_route_format;
ALTER TABLE public.ai_call_log VALIDATE CONSTRAINT ai_call_log_status_values;

-- Global monthly spend (ai_spend_month) scans by created_at across all users.
CREATE INDEX IF NOT EXISTS idx_ai_call_log_created_at
  ON public.ai_call_log (created_at);

COMMENT ON COLUMN public.ai_call_log.cache_read_tokens IS
  'usage.cache_read_input_tokens from the Anthropic response (null before R2 or when unknown).';
COMMENT ON COLUMN public.ai_call_log.cache_write_tokens IS
  'usage.cache_creation_input_tokens (5-minute writes only; the wrapper refuses 1-hour TTL).';
COMMENT ON COLUMN public.ai_call_log.route IS
  'Calling route key: ai_chat | translate | notes_transform | notes_safety (legacy). Null before R2.';
COMMENT ON COLUMN public.ai_call_log.status IS
  'Call outcome from the shared wrapper. Null before R2. cost_usd must be set on failures too (tokens when known, else an input-cost estimate).';

RESET lock_timeout;
