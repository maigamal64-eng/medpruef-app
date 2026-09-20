-- Exam simulation persistence (exam_simulations) (2026-09-20, History feature v1)
--
-- WHY: the exam simulation (/exam) grades entirely client-side and wrote
-- NOTHING server-side — a completed mock exam vanished the moment its result
-- screen closed (customer feedback id=49, Ahmet, 2026-09-16: "I could not
-- see my previous exam … It has already gone").
--
-- This table is the durable record of every submitted exam attempt:
-- config (what was asked for), the ordered question ids, the buyer's raw
-- selected indices, and the SERVER-side grading snapshot (correct flags as
-- they were at submission time — a later content edit never rewrites history).
--
-- Access model: recording is open to any signed-in user (so a free user's
-- attempts exist and the Pro upsell can show real saved data); READING is
-- Pro-only, enforced in the API routes (requireUser + isPaidAccess), and RLS
-- deny-all matches the rest of the platform (service-role only via /api/*).
--
-- Boundary note: exam answers deliberately do NOT write into answer_history
-- (that would change free-tier counting + spaced-rep semantics); this table
-- is the exam-simulation ledger only.

create table if not exists public.exam_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  exam_type text not null,
  title text,
  config jsonb,
  question_ids bigint[] not null,
  -- per-question buyer input, keyed by question id: {"70669": [0,2]}
  answers jsonb not null default '{}'::jsonb,
  -- server-side grading snapshot: {"70669": {"selected":[0,2],"correct_indices":[0,2],"is_correct":true}}
  grading jsonb not null default '{}'::jsonb,
  correct_count int not null default 0,
  total_count int not null default 0,
  score_pct numeric(5,2) not null default 0,
  duration_ms integer,
  status text not null default 'completed',
  started_at timestamptz,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists exam_simulations_user_recent_idx
  on public.exam_simulations (user_id, completed_at desc);

-- RLS: deny-all anon/authenticated; API routes use the service role.
alter table public.exam_simulations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'exam_simulations'
  ) then
    create policy exam_simulations_deny_all on public.exam_simulations
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;