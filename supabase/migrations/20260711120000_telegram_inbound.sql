-- telegram_inbound — visibility log for inbound TEXT messages to @MedPruefBot
-- (2026-07-11, ops blind-spot fix).
--
-- WHY: the webhook (src/app/api/telegram/webhook/route.ts) only ever handles
-- "/start" and "/start <payload>" commands (bot activation + web-login deep
-- link). Any free-text reply a user sends the bot fails the startMatch regex
-- and the handler returns 200 immediately WITHOUT recording or forwarding
-- anything (see the route's own comment: "free-text replies sent back here
-- are NOT processed/forwarded"). That made a real inbound reply (e.g. a user
-- replying to an outreach nudge) completely invisible — not in the DB, not in
-- Vercel runtime logs beyond a bare request line, nowhere. This table is the
-- fix: EVERY inbound text message from a real user gets a row here before the
-- existing /start-only logic runs, so "did they reply, and what did they
-- say" is always answerable.
--
-- Scope: TEXT messages from real users that are NOT a "/start" command (so
-- neither bot-activation traffic nor a login-token exchange is logged here
-- — only genuine free-text replies). Never logs our own bot's outbound
-- sendMessage calls (this table has no concept of outbound). The insert is
-- additive and best-effort (see logTelegramInbound in the route) — it must
-- never throw or block the existing /start / login-token flow.
--
-- PII: telegram_id / chat_id / username / first_name / message_text are
-- Telegram-provided identifiers a user handed us by messaging the bot, same
-- sensitivity class as users.telegram_id (already stored raw). raw stores
-- the full inbound Telegram `message` object for forensics/future fields;
-- message_text is never null for a row in this table (the route only logs
-- when msg.text is present).
--
-- Service-role only — RLS deny-all for anon + authenticated, same posture as
-- every other operational/log table in this project (payment_events,
-- csp_violations, landing_hits).

CREATE TABLE IF NOT EXISTS public.telegram_inbound (
  id              BIGSERIAL PRIMARY KEY,
  telegram_id     BIGINT NOT NULL,       -- Telegram from.id of the sender
  chat_id         BIGINT NOT NULL,       -- Telegram message.chat.id (reply target)
  username        TEXT,                  -- Telegram from.username, if set
  first_name      TEXT,                  -- Telegram from.first_name, if set
  message_text    TEXT NOT NULL,          -- message.text (the route only logs when text is present)
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full inbound Telegram `message` object
  -- Best-effort link to our own user, resolved via users.telegram_id at
  -- insert time. NULLABLE: most inbound senders won't have linked their
  -- Telegram account yet, and that absence is itself useful signal, not an
  -- error — same NULLABLE-on-purpose posture as payment_events.user_id.
  matched_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_inbound_created_idx
  ON public.telegram_inbound (created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_inbound_telegram_id_idx
  ON public.telegram_inbound (telegram_id);
CREATE INDEX IF NOT EXISTS telegram_inbound_matched_user_id_idx
  ON public.telegram_inbound (matched_user_id) WHERE matched_user_id IS NOT NULL;

ALTER TABLE public.telegram_inbound ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram_inbound deny anon" ON public.telegram_inbound;
CREATE POLICY "telegram_inbound deny anon"
  ON public.telegram_inbound FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "telegram_inbound deny authenticated" ON public.telegram_inbound;
CREATE POLICY "telegram_inbound deny authenticated"
  ON public.telegram_inbound FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.telegram_inbound IS
  'Append-only visibility log for inbound TEXT messages to @MedPruefBot (2026-07-11 ops blind-spot fix). The webhook only ever ACTS on /start* commands; every other inbound message was previously invisible (not logged, not forwarded). This table records it regardless. matched_user_id resolved via users.telegram_id when possible, NULLABLE on purpose. Writer: src/app/api/telegram/webhook/route.ts (logTelegramInbound, best-effort, never throws). Reader: none yet (query directly via Supabase MCP / admin ad hoc; no dedicated UI). RLS: deny-all anon/authenticated, service-role only.';
