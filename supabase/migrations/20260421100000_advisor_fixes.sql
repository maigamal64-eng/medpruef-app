-- Supabase advisor fixes — 2026-04-21
--
-- Closes the two new advisor lints surfaced after the 2026-04-21
-- `user_topic_strength` + `increment_topic_strength` migration.
--
-- Findings from `mcp__supabase__get_advisors`:
--
--   1. SECURITY WARN: function_search_path_mutable
--      `public.increment_topic_strength` is SECURITY DEFINER but does not
--      pin `search_path`. A role with mutable search_path on a SECURITY
--      DEFINER function is an attack vector — a malicious schema-search
--      override can shadow the `public.user_topic_strength` reference.
--      Fix: ALTER FUNCTION ... SET search_path = public, pg_temp.
--
--   2. PERFORMANCE INFO: unindexed_foreign_keys
--      `public.pricing_waitlist.user_id` has a FK to `public.users(id)`
--      but no covering index. ON DELETE SET NULL cascades trigger a
--      full-table scan. Fix: add a btree index.
--
-- Both are purely additive — no DROPs, no column changes, no data
-- movement. Safe to apply in a single transaction.

-- 1. Pin search_path for SECURITY DEFINER function
ALTER FUNCTION public.increment_topic_strength(uuid, text, text, boolean)
  SET search_path = public, pg_temp;

-- 2. Add covering index for pricing_waitlist.user_id FK
CREATE INDEX IF NOT EXISTS idx_pricing_waitlist_user_id
  ON public.pricing_waitlist (user_id)
  WHERE user_id IS NOT NULL;
