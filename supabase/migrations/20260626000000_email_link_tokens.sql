-- Migration: email_link_tokens + users.email_verified_at
-- Phase B.4 — SAFE Telegram→email linking
--
-- Goal: let a Telegram-only user add email+password to their account without
-- disrupting their live session or merging accounts.
--
-- Pattern: stage credentials in a side-table (never on users until verified);
-- commit atomically with WHERE email IS NULL so the constraint prevents any
-- hijack/overwrite race.

-- ── 1. users.email_verified_at ───────────────────────────────────────────────
-- Added here so the link-verify commit can write it in one UPDATE.
--
-- GUARDRAIL: this column is informational only. It MUST NEVER become a blanket
-- login gate. 56 legacy email users have no verified email and their accounts
-- are permanently excluded from the verification flow. Any future login-gate
-- logic MUST keep the existing email/password and Telegram paths unchanged
-- regardless of this column's value.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- ── 2. email_link_tokens ─────────────────────────────────────────────────────
-- Staging table for email-linking tokens. One row per in-flight link attempt.
-- The raw token never touches this table — only the SHA-256 hash is stored so
-- a DB read doesn't let an attacker mint a valid link.
CREATE TABLE IF NOT EXISTS public.email_link_tokens (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text             NOT NULL UNIQUE,   -- sha256 of the raw token (hex)
  user_id         uuid             NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pending_email   text             NOT NULL,           -- lowercase-trimmed email to commit
  password_hash   text             NOT NULL,           -- bcrypt hash (rounds = 10)
  expires_at      timestamptz      NOT NULL,           -- 24 h from creation
  used_at         timestamptz,                         -- NULL = unused; non-NULL = spent
  created_at      timestamptz      NOT NULL DEFAULT now()
);

-- Fast lookups by token_hash (verify path) and user_id (duplicate-start guard)
CREATE INDEX IF NOT EXISTS email_link_tokens_token_hash_idx
  ON public.email_link_tokens (token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS email_link_tokens_user_id_idx
  ON public.email_link_tokens (user_id)
  WHERE used_at IS NULL;

-- Partial index: enforce only one pending email per target address so a race
-- between two start requests for the same email doesn't create duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS email_link_tokens_pending_email_active_idx
  ON public.email_link_tokens (pending_email)
  WHERE used_at IS NULL;

-- ── 3. RLS — deny all; service-role only ─────────────────────────────────────
-- The API routes use getServiceClient() (service role key) which bypasses RLS.
-- anon and authenticated roles must never touch this table directly.
ALTER TABLE public.email_link_tokens ENABLE ROW LEVEL SECURITY;

-- Explicit deny-all policy so the intent is documented even though RLS + no
-- permissive policies already achieves denial.
CREATE POLICY "deny all" ON public.email_link_tokens
  AS RESTRICTIVE
  FOR ALL
  USING (false);
