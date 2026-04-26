-- review-2026-04-26-B2 · users.telegram_chat_id_confirmed
--
-- 47 of 96 users registered via the Telegram Login Widget but never
-- DM'd the bot. Without an active chat session we can't push them
-- messages — re-engagement campaign is unreachable for that cohort.
--
-- This column stamps when the user activates the bot relationship
-- (clicks "Activate Telegram bot" on /dashboard, the button opens
-- t.me/MedPruefBot?start=auth_<uuid>, the bot processes /start
-- auth_<uuid> and writes here).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS telegram_chat_id_confirmed timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id_confirmed
  ON public.users (telegram_chat_id_confirmed)
  WHERE telegram_id IS NOT NULL AND telegram_chat_id_confirmed IS NULL;

COMMENT ON COLUMN public.users.telegram_chat_id_confirmed IS
  'Stamped when the user activates the MedPrueefBot via /start auth_<uuid> '
  'deep-link. NULL means we know their telegram_id (login widget) but '
  'cannot push them messages via the bot. See review-2026-04-26-B2.';
