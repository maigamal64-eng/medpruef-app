-- First-party, cookieless landing-hit counter (2026-07-03).
-- GA4/pixels are consent-gated, /api/track is login-gated, so paid-probe
-- arrivals were invisible. This table stores ANONYMOUS aggregate hits only:
-- no ip, no id, no raw user-agent, no cookie. RLS deny-all (service-role writes).
create table if not exists public.landing_hits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  path text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  has_click_id boolean not null default false,
  ref_host text,
  lang text,
  device text
);
create index if not exists landing_hits_at_idx on public.landing_hits (at desc);
create index if not exists landing_hits_src_idx on public.landing_hits (utm_source, at desc);
alter table public.landing_hits enable row level security;
