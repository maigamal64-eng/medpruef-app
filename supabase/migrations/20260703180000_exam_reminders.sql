-- Exam deadline reminder list (2026-07-03). The purest lead magnet in this
-- market: a scared candidate always wants "tell me before registration
-- closes". Captures an email + which exam; RLS deny-all, public API writes
-- via service role. Sending nudges is a later scheduled task.
create table if not exists public.exam_reminders (
  id bigint generated always as identity primary key,
  email text not null,
  exam_type text not null check (exam_type in ('kenntnispruefung','kmp_innsbruck','pharma','all')),
  locale text not null default 'de',
  user_id uuid references public.users(id) on delete set null,
  source text default 'landing',
  utm jsonb,
  confirmed boolean not null default true,
  unsub_token uuid not null default gen_random_uuid(),
  unsubscribed_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (email, exam_type)
);
create index if not exists exam_reminders_exam_idx on public.exam_reminders (exam_type) where unsubscribed_at is null;
create index if not exists exam_reminders_unsub_idx on public.exam_reminders (unsub_token);
alter table public.exam_reminders enable row level security;
