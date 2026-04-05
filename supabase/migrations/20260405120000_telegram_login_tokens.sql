-- Telegram Login Tokens: one-time tokens for bot→web login deep-link flow.
-- Flow: user sends /start web_login to @MedPruefBot → webhook generates a UUID,
-- inserts a row here, replies with a button that opens medpruef.app/?tg_token=<uuid>
-- → landing page POSTs to /api/auth with { tokenExchange } → row is marked used.

create table if not exists public.telegram_login_tokens (
  token         text primary key,
  telegram_id   bigint not null,
  first_name    text,
  last_name     text,
  username      text,
  photo_url     text,
  language_code text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);

create index if not exists telegram_login_tokens_expires_at_idx
  on public.telegram_login_tokens (expires_at);

create index if not exists telegram_login_tokens_telegram_id_idx
  on public.telegram_login_tokens (telegram_id);

alter table public.telegram_login_tokens enable row level security;
-- No anon/authenticated policies: all reads/writes happen via service role
-- from the /api/auth route and the /api/telegram/webhook route.

-- Optional cleanup (run via pg_cron or manual sweep):
-- delete from public.telegram_login_tokens where expires_at < now() - interval '1 day';
