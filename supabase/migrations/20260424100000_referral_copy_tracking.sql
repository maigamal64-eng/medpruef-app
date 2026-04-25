-- ═══════════════════════════════════════════════════════════════════
-- Referral-copy tracking — drives the nudge-dot on the Empfehlungen
-- nav link + any future "has the user earned their first share yet?"
-- gating.
--
-- Context: the post-audit rescue-sprint §4 flips the referral flow from
-- "earn first, set payout method second" to "show code on day 1, ask
-- payout only after the first qualifying referral". The small amber
-- dot next to "Empfehlungen" in the sidebar is the onboarding nudge
-- that makes the new flow discoverable — it stays lit until the user
-- has actually copied their code at least once.
--
-- Why a timestamptz (nullable) instead of a boolean: we want to know
-- WHEN the user copied (analytics + future re-nudge cooldowns), not
-- just whether. NULL = "never copied" which keeps the dot lit.
--
-- Non-destructive: pre-existing user_announcements rows get NULL on
-- the new column automatically, so the dot is lit for every existing
-- user as of the next session refresh. Backfill migration not needed.
-- ═══════════════════════════════════════════════════════════════════

-- Track whether a user has copied their referral code (drives the
-- dashboard nudge-dot until they do). Non-destructive — existing
-- user_announcements rows get a NULL value.
ALTER TABLE public.user_announcements
  ADD COLUMN IF NOT EXISTS referral_code_copied_at timestamptz;
