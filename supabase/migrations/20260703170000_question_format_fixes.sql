-- Audit trail for the 2026-07-03 AI formatting + explanation pipeline.
-- Every touched question gets one row with full before/after, so any change
-- is reviewable and reversible. RLS deny-all (service-role only).
create table if not exists public.question_format_fixes (
  id bigint generated always as identity primary key,
  question_id integer not null,
  run_tag text not null default 'fmt-2026-07-03',
  before jsonb not null,
  after jsonb not null,
  applied_fields text[] not null default '{}',
  needs_medical_review boolean not null default false,
  review_reason text,
  model text,
  confidence numeric,
  created_at timestamptz not null default now()
);
create index if not exists qff_qid_idx on public.question_format_fixes (question_id);
create index if not exists qff_review_idx on public.question_format_fixes (needs_medical_review) where needs_medical_review;
alter table public.question_format_fixes enable row level security;
