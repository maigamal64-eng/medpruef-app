/**
 * Mentor credits: which INCLUDED grant a user is entitled to right now.
 * Pure (no I/O) so the rules are unit-testable; wallet.ts loads the rows
 * and calls mentor_grant_credits for each planned grant.
 *
 * Rules (contract.ts lot keys; [name] pick plan-allowance B, 10 Oct 2026;
 * amounts live in public.ai_credit_package rows, never here):
 *   admin role                 included_admin   admin_included   <user>:<YYYY-MM>   UTC month
 *   live Pro subscription      included_pro_*   pro_included     <sub>:<slice>      30-day slice
 *   live 6-month cohort        included_cohort  pro_included     <sub>:<slice>
 *   live manual (comped) sub   gift_admin       admin_gift       <sub>:<slice>
 *   live paid tier not mapped  included_unknown unknown_included <user>:<slice>
 *   EUR 0 card trial           trial_taste      trial_taste      <user>             once ever
 *   Pro via users.tier only:
 *     rewarded referral        referral_reward  referral_reward  <referral id>
 *     otherwise (admin grant)  gift_admin       admin_gift       <user>:<slice>     epoch-anchored slice
 *   free                       nothing, unless MENTOR_WELCOME_ENABLED and the
 *                              wallet found the account eligible: then
 *                              welcome_taste (25 credits, once ever, every
 *                              mode; a-free-credit-hooks L3). Else, while
 *                              MENTOR_FREE_ENABLED is on and the account is
 *                              verified: free_taste (5 credits, once ever,
 *                              facts mode only; [name] pick MUX-20 A).
 *                              The card trial keeps trial_taste.
 *   banned account             nothing at all.
 *
 * Amounts: the package row, unless snap.amounts names the package (only
 * while MENTOR_INCLUDED_RAISE_ENABLED is on; free-credits.ts owns them).
 *
 * One grant per call at most (the best entitlement: largest grant, then the
 * row that runs longest), so a user with two overlapping subscriptions is
 * not funded twice for the same days.
 * Included lots expire at min(slice end, entitlement end) so a lapsed Pro user
 * does not keep the rest of the slice. A REFUNDED Pro user does keep the
 * current slice until it ends (at most 30 days and the slice value, USD 1.00):
 * the Pro revoke path does not claw it back (review L1, accepted).
 */

import { entitlementSlice, includedGrantKey, type CreditLotSource, type MentorPackageId } from "../contract";
import type { GrantArgs } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;
const SLICE_MS = 30 * DAY_MS;

export interface EntitlementUser {
  id: string;
  role: string | null;
  tier: string | null;
  tier_expires_at: string | null;
  /** Set when the learner confirmed an email address (link-email flow). */
  email_verified_at?: string | null;
  /** Telegram login proves a real Telegram account. */
  telegram_id?: number | string | null;
  /** A banned account never receives a house-funded grant. */
  is_banned?: boolean | null;
}

/**
 * "Verified" for the free taste: a confirmed email or a Telegram-linked
 * account. A bare email/password registration is not verified.
 */
export function isVerifiedAccount(u: EntitlementUser): boolean {
  const email = typeof u.email_verified_at === "string" && Number.isFinite(Date.parse(u.email_verified_at));
  const telegram = u.telegram_id !== null && u.telegram_id !== undefined && String(u.telegram_id).trim() !== "";
  return email || telegram;
}

export interface EntitlementSub {
  id: string;
  tier: string | null;
  status: string | null;
  payment_provider: string | null;
  amount_cents: number | null;
  started_at: string | null;
  expires_at: string | null;
}

export interface EntitlementReferral {
  id: string;
  rewarded_at: string | null;
}

/** The ai_credit_package columns the planner needs. */
export interface IncludedPackageRow {
  package_id: MentorPackageId;
  grant_micro: number;
  expiry_days: number;
  active: boolean;
}

export interface EntitlementSnapshot {
  user: EntitlementUser | null;
  /** The user's subscriptions rows (any status; the planner filters). */
  subs: EntitlementSub[];
  /** Rewarded pro_until_exam referrals where the user is the referrer, newest first. */
  referrals: EntitlementReferral[];
  packages: Map<MentorPackageId, IncludedPackageRow>;
  freeEnabled: boolean;
  /** Per-package micro-USD overrides (free-credits.ts includedAmountOverrides); absent = the rows. */
  amounts?: Partial<Record<string, number>>;
  /**
   * The welcome lot, decided by the wallet (it needs reads): present only when
   * MENTOR_WELCOME_ENABLED is on, the account is eligible, holds no welcome
   * lot yet and the monthly breaker has room.
   */
  welcome?: { micro: number; expiryDays: number } | null;
}

/** Which rule decided (the wallet only runs the welcome reads on "free"). */
export type IncludedBranch = "none" | "banned" | "admin" | "paid" | "paid_off" | "trial" | "future" | "pro_user" | "free";

/** Subscription tier -> included package. Anything else paid is "unknown". */
export const TIER_TO_INCLUDED: Readonly<Record<string, MentorPackageId>> = Object.freeze({
  first_month_19: "included_pro_monthly",
  notes_pro_trial: "included_pro_monthly",
  first_3mo_27: "included_pro_quarterly",
  premium_pass_guaranteed: "included_cohort",
});

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function minDate(a: number, b: number | null): number {
  return b === null ? a : Math.min(a, b);
}

/** A subscriptions row that funds access right now (started, not expired, active). */
export function isLiveSub(s: EntitlementSub, nowMs: number): boolean {
  const start = ms(s.started_at);
  const end = ms(s.expires_at);
  return s.status === "active" && start !== null && end !== null && start <= nowMs && end > nowMs;
}

/** The EUR 0 phase of the card-on-file trial (or the legacy no-card trial row). */
export function isTrialSub(s: EntitlementSub): boolean {
  if (s.payment_provider === "trial" || s.tier === "notes_free_trial") return true;
  return s.tier === "notes_pro_trial" && (s.amount_cents == null || s.amount_cents <= 0);
}

function isAdmin(u: EntitlementUser): boolean {
  return u.role === "admin" || u.tier === "admin";
}

function proLiveByUserRow(u: EntitlementUser, nowMs: number): boolean {
  if (u.tier !== "pro") return false;
  if (!u.tier_expires_at) return true;
  const end = ms(u.tier_expires_at);
  return end !== null && end > nowMs;
}

interface Candidate {
  packageId: MentorPackageId;
  source: CreditLotSource;
  sourceId: string;
  startsAt: number;
  expiresAt: number;
  rank: number;
  tiebreak: number;
  /** Explicit amount (the welcome lot); otherwise the override or the row. */
  micro?: number | null;
}

function usable(pkg: IncludedPackageRow | undefined): pkg is IncludedPackageRow {
  return Boolean(pkg && pkg.active && pkg.grant_micro > 0 && pkg.expiry_days > 0);
}

function overrideMicro(snap: EntitlementSnapshot, id: MentorPackageId): number | null {
  const v = snap.amounts?.[id];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Plan the included grant(s) for `snap.user` at `now`. Returns [] or one
 * GrantArgs with explicit startsAt/expiresAt (startsAt <= now < expiresAt).
 */
export function planIncludedGrants(snap: EntitlementSnapshot, now: Date): GrantArgs[] {
  return planIncludedGrantsDetailed(snap, now).grants;
}

export function planIncludedGrantsDetailed(snap: EntitlementSnapshot, now: Date): { grants: GrantArgs[]; branch: IncludedBranch } {
  let branch: IncludedBranch = "none";
  const grants = planInner(snap, now, (b) => { branch = b; });
  return { grants, branch };
}

function planInner(snap: EntitlementSnapshot, now: Date, mark: (b: IncludedBranch) => void): GrantArgs[] {
  const u = snap.user;
  if (!u) return [];
  if (u.is_banned === true) { mark("banned"); return []; }
  const nowMs = now.getTime();
  const pkg = (id: MentorPackageId) => snap.packages.get(id);
  const out = (c: Candidate | null): GrantArgs[] => {
    if (!c || !(c.expiresAt > nowMs) || !(c.startsAt <= nowMs) || !(c.expiresAt > c.startsAt)) return [];
    return [
      {
        userId: u.id,
        packageId: c.packageId,
        source: c.source,
        sourceId: c.sourceId,
        micro: c.micro ?? overrideMicro(snap, c.packageId),
        startsAt: new Date(c.startsAt),
        expiresAt: new Date(c.expiresAt),
      },
    ];
  };

  // 1. Admin role: an explicit monthly cap, nothing else.
  if (isAdmin(u)) {
    mark("admin");
    const p = pkg("included_admin");
    if (!usable(p)) return [];
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return out({
      packageId: "included_admin",
      source: "admin_included",
      sourceId: `${u.id}:${ym}`,
      startsAt: monthStart,
      expiresAt: nextMonth,
      rank: 0,
      tiebreak: 0,
    });
  }

  // 2. Live subscriptions: the paid one with the largest grant wins; the
  //    trial taste only when no paid subscription is live.
  const live = snap.subs.filter((s) => isLiveSub(s, nowMs));
  const paid: Candidate[] = [];
  let paidLive = false;
  let trialSub: EntitlementSub | null = null;
  for (const s of live) {
    if (isTrialSub(s)) {
      const end = ms(s.expires_at) as number;
      if (!trialSub || end > (ms(trialSub.expires_at) as number)) trialSub = s;
      continue;
    }
    paidLive = true;
    const start = ms(s.started_at) as number;
    const end = ms(s.expires_at) as number;
    const slice = entitlementSlice(new Date(start), now);
    const sliceStart = start + slice * SLICE_MS;
    const sliceEnd = sliceStart + SLICE_MS;
    let packageId: MentorPackageId;
    let source: CreditLotSource;
    let sourceId: string;
    if (s.payment_provider === "manual") {
      packageId = "gift_admin";
      source = "admin_gift";
      sourceId = includedGrantKey(s.id, slice);
    } else if (s.tier && TIER_TO_INCLUDED[s.tier]) {
      packageId = TIER_TO_INCLUDED[s.tier];
      source = "pro_included";
      sourceId = includedGrantKey(s.id, slice);
    } else {
      packageId = "included_unknown";
      source = "unknown_included";
      sourceId = includedGrantKey(u.id, slice);
    }
    const p = pkg(packageId);
    if (!usable(p)) continue;
    paid.push({
      packageId,
      source,
      sourceId,
      startsAt: sliceStart,
      expiresAt: Math.min(sliceEnd, end),
      rank: overrideMicro(snap, packageId) ?? p.grant_micro,
      // Equal grants: the row that covers the longest wins, so two
      // overlapping rows of one entitlement do not each fund a slice.
      tiebreak: end,
    });
  }
  if (paid.length > 0) {
    mark("paid");
    paid.sort((a, b) => b.rank - a.rank || b.tiebreak - a.tiebreak);
    return out(paid[0]);
  }
  // A live paid subscription whose package row is switched off: no grant,
  // and no fallback to the trial taste or the gift bucket.
  if (paidLive) { mark("paid_off"); return []; }
  if (trialSub) {
    mark("trial");
    const p = pkg("trial_taste");
    if (!usable(p)) return [];
    return out({
      packageId: "trial_taste",
      source: "trial_taste",
      sourceId: u.id,
      startsAt: nowMs,
      expiresAt: minDate(nowMs + p.expiry_days * DAY_MS, ms(trialSub.expires_at)),
      rank: 0,
      tiebreak: 0,
    });
  }

  // 3. A paid subscription that has not started yet (stacked renewal): the
  //    current one just ended; wait for it instead of granting a gift.
  const future = snap.subs.some((s) => s.status === "active" && (ms(s.started_at) ?? 0) > nowMs);

  // 4. Pro from users.tier only (admin grant or referral exam reward).
  if (!future && proLiveByUserRow(u, nowMs)) {
    mark("pro_user");
    const tierEnd = ms(u.tier_expires_at);
    const ref = snap.referrals.find((r) => r.id && r.rewarded_at);
    if (ref) {
      const p = pkg("referral_reward");
      if (!usable(p)) return [];
      return out({
        packageId: "referral_reward",
        source: "referral_reward",
        sourceId: ref.id,
        startsAt: nowMs,
        expiresAt: minDate(nowMs + p.expiry_days * DAY_MS, tierEnd),
        rank: 0,
        tiebreak: 0,
      });
    }
    const p = pkg("gift_admin");
    if (!usable(p)) return [];
    const slice = entitlementSlice(new Date(0), now);
    const sliceStart = slice * SLICE_MS;
    return out({
      packageId: "gift_admin",
      source: "admin_gift",
      sourceId: includedGrantKey(u.id, slice),
      startsAt: sliceStart,
      expiresAt: minDate(sliceStart + SLICE_MS, tierEnd),
      rank: 0,
      tiebreak: 0,
    });
  }
  if (future) { mark("future"); return []; }

  // 5. Free: the welcome lot when the wallet cleared it (every mode, its own
  //    key); else, while MENTOR_FREE_ENABLED is on and the account is
  //    verified, the one-time free taste (facts only, never the card-trial key).
  mark("free");
  if (snap.welcome) {
    const p = pkg("welcome_taste");
    if (!p || !p.active || !(snap.welcome.micro > 0) || !(snap.welcome.expiryDays > 0)) return [];
    return out({
      packageId: "welcome_taste",
      source: "welcome_taste",
      sourceId: u.id,
      startsAt: nowMs,
      expiresAt: nowMs + snap.welcome.expiryDays * DAY_MS,
      rank: 0,
      tiebreak: 0,
      micro: snap.welcome.micro,
    });
  }
  if (snap.freeEnabled && isVerifiedAccount(u)) {
    const p = pkg("free_taste");
    if (!usable(p)) return [];
    return out({
      packageId: "free_taste",
      source: "free_taste",
      sourceId: u.id,
      startsAt: nowMs,
      expiresAt: nowMs + p.expiry_days * DAY_MS,
      rank: 0,
      tiebreak: 0,
    });
  }
  return [];
}
