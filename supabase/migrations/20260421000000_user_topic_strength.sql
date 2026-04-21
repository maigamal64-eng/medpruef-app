-- ═══════════════════════════════════════════════════════════════════
-- user_topic_strength — server-side per-user per-topic accuracy
-- 2026-04-21 (backlog #13, cross-device weakness detection)
-- ═══════════════════════════════════════════════════════════════════
-- Context:
--   Before this migration, `src/lib/weakness.ts` stored per-topic
--   accuracy in localStorage. Users on multiple devices (web + mobile
--   PWA) saw different "weak topic" recommendations and different
--   Study Plans because the weakness signal never crossed devices.
--
--   This table is the new source of truth. It's populated by
--   `/api/answer` via the `increment_topic_strength` RPC on every
--   submitted answer, and read by `/api/user/topic-strength` (GET).
--   `/api/user/study-plan` falls back to this table when the user's
--   `answer_history` hasn't yet been aggregated for the plan window.
--
-- Shape:
--   One row per (user, exam_type, topic). Counters accumulate monotonically.
--   A user can have rows across every exam they've touched — the
--   client filters by `exam_type` when reading.
--
-- Consistency:
--   `increment_topic_strength` is a SECURITY DEFINER plpgsql function
--   with an UPSERT (INSERT ... ON CONFLICT DO UPDATE), so concurrent
--   answer submissions from two devices can't produce a race. Without
--   the RPC the js-side upsert-then-select pattern would corrupt
--   counts when two answers land in the same millisecond.
--
-- Backfill:
--   `scripts/backfill_topic_strength.py` seeds the table from the
--   existing `answer_history` joined against `questions`. After the
--   one-time backfill the RPC keeps the table current.
--
-- RLS:
--   Deny-all for anon/authenticated. Service-role bypasses RLS, so
--   `/api/answer` + `/api/user/topic-strength` (both server-side via
--   getServiceClient()) read/write normally. No client-side Supabase
--   queries hit this table.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.user_topic_strength (
  user_id uuid not null references public.users(id) on delete cascade,
  exam_type text not null,
  topic text not null,
  answered int not null default 0,
  correct int not null default 0,
  last_answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, exam_type, topic)
);

create index if not exists idx_user_topic_strength_updated
  on public.user_topic_strength (user_id, updated_at desc);

alter table public.user_topic_strength enable row level security;

-- Deny-all for anon/authenticated; service-role bypasses RLS as always.
drop policy if exists "deny_all_anon" on public.user_topic_strength;
create policy "deny_all_anon" on public.user_topic_strength
  as restrictive for all to anon, authenticated
  using (false) with check (false);

comment on table public.user_topic_strength is
  'Server-side source of truth for per-user per-topic accuracy. Populated by /api/answer on every submission via increment_topic_strength RPC. Client reads via /api/user/topic-strength (GET). Cross-device sync for weakness detection + Study Plan.';

-- ───────────────────────────────────────────────────────────────────
-- increment_topic_strength RPC — atomic upsert-and-increment
-- ───────────────────────────────────────────────────────────────────
-- Called from /api/answer after a successful answer_history insert.
-- Using a plpgsql function with SECURITY DEFINER so the single UPSERT
-- is race-safe even under concurrent inserts from multiple devices.
-- Service-role bypasses RLS; we grant authenticated/service_role for
-- completeness.

create or replace function public.increment_topic_strength(
  p_user_id uuid,
  p_exam_type text,
  p_topic text,
  p_is_correct boolean
) returns void as $$
begin
  insert into public.user_topic_strength (
    user_id, exam_type, topic, answered, correct, last_answered_at, updated_at
  )
  values (
    p_user_id,
    p_exam_type,
    p_topic,
    1,
    case when p_is_correct then 1 else 0 end,
    now(),
    now()
  )
  on conflict (user_id, exam_type, topic) do update set
    answered = public.user_topic_strength.answered + 1,
    correct = public.user_topic_strength.correct
      + case when p_is_correct then 1 else 0 end,
    last_answered_at = now(),
    updated_at = now();
end;
$$ language plpgsql security definer;

grant execute on function public.increment_topic_strength(uuid, text, text, boolean)
  to authenticated, service_role;

comment on function public.increment_topic_strength(uuid, text, text, boolean) is
  'Atomically upserts a user_topic_strength row and increments answered/correct counters. Called by /api/answer. Race-safe under concurrent multi-device writes.';
