-- Invite-only referral program (2026-06-25, [name] decision).
-- The OPEN referral program is loss-making: the €40 reward exceeds the ~€18 /
-- ~€25.6 net contribution on the €19 / €49 entry tiers. So the program is now
-- OFF by default and admitted per-account by an admin. Only accounts with
-- referrals_enabled = true see/use the referral UI and can earn a reward.
-- The €40 reward stays a single configurable constant (src/lib/referrals.ts,
-- env-overridable) so [name] can lower or tier-gate it without a migration.

alter table public.users
  add column if not exists referrals_enabled boolean not null default false;

comment on column public.users.referrals_enabled is
  'Invite-only referral gate (2026-06-25). Default false = no referral UI / no earning. Admin flips true to admit an account to the program. Referral qualification (whop webhook) must also check this flag on the referrer.';
