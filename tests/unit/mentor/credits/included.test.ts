import { describe, expect, it } from "vitest";
import {
  planIncludedGrants,
  isTrialSub,
  type EntitlementSnapshot,
  type EntitlementSub,
  type IncludedPackageRow,
} from "@/lib/mentor/credits/included";
import type { MentorPackageId } from "@/lib/mentor/contract";

const U = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;

// The seeded catalogue (20261022100000_mentor_ledger.sql), included rows only.
function catalogue(over: Partial<Record<MentorPackageId, Partial<IncludedPackageRow>>> = {}) {
  const base: Array<[MentorPackageId, number, number]> = [
    ["included_pro_monthly", 250_000, 30],
    ["included_pro_quarterly", 250_000, 30],
    ["included_cohort", 750_000, 30],
    ["trial_taste", 100_000, 7],
    ["gift_admin", 300_000, 30],
    ["referral_reward", 300_000, 30],
    ["included_admin", 5_000_000, 30],
    ["included_unknown", 100_000, 30],
    ["free", 0, 1],
  ];
  const m = new Map<MentorPackageId, IncludedPackageRow>();
  for (const [id, g, e] of base) {
    m.set(id, { package_id: id, grant_micro: g, expiry_days: e, active: id !== "free", ...over[id] });
  }
  return m;
}

function sub(over: Partial<EntitlementSub> = {}): EntitlementSub {
  return {
    id: "sub-1",
    tier: "first_month_19",
    status: "active",
    payment_provider: "whop",
    amount_cents: 1900,
    started_at: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    expires_at: new Date(NOW.getTime() + 25 * DAY).toISOString(),
    ...over,
  };
}

function snap(over: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return {
    user: { id: U, role: "user", tier: "pro", tier_expires_at: new Date(NOW.getTime() + 25 * DAY).toISOString() },
    subs: [],
    referrals: [],
    packages: catalogue(),
    freeEnabled: false,
    ...over,
  };
}

describe("planIncludedGrants", () => {
  it("Pro monthly: one pro_included lot keyed <sub>:<slice>, expiring at min(slice end, entitlement end)", () => {
    const g = planIncludedGrants(snap({ subs: [sub()] }), NOW);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ userId: U, packageId: "included_pro_monthly", source: "pro_included", sourceId: "sub-1:0", micro: null });
    // slice 0 ends at start + 30 days = NOW + 25 days, equal to the entitlement end
    expect(g[0].expiresAt!.getTime()).toBe(NOW.getTime() + 25 * DAY);
    expect(g[0].startsAt!.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it("slices are anchored to the entitlement start, not the calendar month", () => {
    const s = sub({ tier: "first_3mo_27", started_at: new Date(NOW.getTime() - 45 * DAY).toISOString(), expires_at: new Date(NOW.getTime() + 47 * DAY).toISOString() });
    const g = planIncludedGrants(snap({ subs: [s] }), NOW);
    expect(g[0]).toMatchObject({ packageId: "included_pro_quarterly", sourceId: "sub-1:1" });
    expect(g[0].startsAt!.getTime()).toBe(NOW.getTime() - 15 * DAY);
    expect(g[0].expiresAt!.getTime()).toBe(NOW.getTime() + 15 * DAY);
  });

  it("clamps the lot to the entitlement end when Pro lapses inside the slice", () => {
    const g = planIncludedGrants(snap({ subs: [sub({ expires_at: new Date(NOW.getTime() + 2 * DAY).toISOString() })] }), NOW);
    expect(g[0].expiresAt!.getTime()).toBe(NOW.getTime() + 2 * DAY);
  });

  it("cohort maps to included_cohort; a paid notes_pro_trial maps to Pro monthly", () => {
    expect(planIncludedGrants(snap({ subs: [sub({ tier: "premium_pass_guaranteed" })] }), NOW)[0].packageId).toBe("included_cohort");
    expect(planIncludedGrants(snap({ subs: [sub({ tier: "notes_pro_trial", amount_cents: 1900 })] }), NOW)[0].packageId).toBe("included_pro_monthly");
  });

  it("EUR 0 card trial gets the trial taste once per user (key = user id), clamped to the trial end", () => {
    const trial = sub({ tier: "notes_pro_trial", amount_cents: 0, expires_at: new Date(NOW.getTime() + 1 * DAY).toISOString() });
    expect(isTrialSub(trial)).toBe(true);
    const g = planIncludedGrants(snap({ subs: [trial] }), NOW);
    expect(g[0]).toMatchObject({ packageId: "trial_taste", source: "trial_taste", sourceId: U });
    expect(g[0].expiresAt!.getTime()).toBe(NOW.getTime() + 1 * DAY);
  });

  it("the legacy no-card trial row (provider 'trial') also counts as a trial", () => {
    expect(isTrialSub(sub({ tier: "notes_free_trial", payment_provider: "trial", amount_cents: null }))).toBe(true);
  });

  it("a paid subscription beats a parallel trial; the larger grant wins between two paid subs", () => {
    const trial = sub({ id: "t", tier: "notes_pro_trial", amount_cents: 0 });
    const cohort = sub({ id: "c", tier: "premium_pass_guaranteed" });
    const monthly = sub({ id: "m" });
    const g = planIncludedGrants(snap({ subs: [trial, cohort, monthly] }), NOW);
    expect(g).toHaveLength(1);
    // Pricing A: Pro 250,000 per slice, cohort 750,000 (pick B), so the cohort is the larger grant.
    expect(g[0].sourceId).toBe("c:0");
    const g2 = planIncludedGrants(snap({ subs: [trial, monthly] }), NOW);
    expect(g2.map((x) => x.sourceId)).toEqual(["m:0"]);
  });

  it("two overlapping rows of one entitlement: the longer-running row anchors the slice (no second grant days later)", () => {
    const a = sub({ id: "a", tier: "notes_pro_trial", started_at: new Date(NOW.getTime() - 26 * DAY).toISOString(), expires_at: new Date(NOW.getTime() + 4 * DAY).toISOString() });
    const b = sub({ id: "b", tier: "notes_pro_trial", started_at: new Date(NOW.getTime() - 22 * DAY).toISOString(), expires_at: new Date(NOW.getTime() + 35 * DAY).toISOString() });
    expect(planIncludedGrants(snap({ subs: [a, b] }), NOW)[0].sourceId).toBe("b:0");
  });

  it("stacked renewal: a future-started row does not count as live and does not fall into the gift bucket", () => {
    const ended = sub({ id: "old", started_at: new Date(NOW.getTime() - 31 * DAY).toISOString(), expires_at: new Date(NOW.getTime() - 1 * DAY).toISOString() });
    const next = sub({ id: "next", started_at: new Date(NOW.getTime() + 1 * DAY).toISOString(), expires_at: new Date(NOW.getTime() + 31 * DAY).toISOString() });
    expect(planIncludedGrants(snap({ subs: [ended, next] }), NOW)).toEqual([]);
    // the live one of the real prod pair (09-17..10-17 then 10-17..11-17) is used
    const live = sub({ id: "live", started_at: new Date(NOW.getTime() - 23 * DAY).toISOString(), expires_at: new Date(NOW.getTime() + 7 * DAY).toISOString() });
    expect(planIncludedGrants(snap({ subs: [live, next] }), NOW)[0].sourceId).toBe("live:0");
  });

  it("skips rows with null dates, non-active status or expired windows", () => {
    expect(planIncludedGrants(snap({ subs: [sub({ started_at: null })], user: { id: U, role: "user", tier: "free", tier_expires_at: null } }), NOW)).toEqual([]);
    expect(planIncludedGrants(snap({ subs: [sub({ status: "refunded" })], user: { id: U, role: "user", tier: "free", tier_expires_at: null } }), NOW)).toEqual([]);
  });

  it("manual (comped) subscription -> gift_admin / admin_gift; unknown paid tier -> included_unknown keyed by user", () => {
    expect(planIncludedGrants(snap({ subs: [sub({ payment_provider: "manual" })] }), NOW)[0]).toMatchObject({ packageId: "gift_admin", source: "admin_gift", sourceId: "sub-1:0" });
    expect(planIncludedGrants(snap({ subs: [sub({ tier: "twelve_month" })] }), NOW)[0]).toMatchObject({ packageId: "included_unknown", source: "unknown_included", sourceId: `${U}:0` });
  });

  it("Pro via users.tier only: a rewarded referral -> referral_reward keyed by referral id", () => {
    const g = planIncludedGrants(snap({ referrals: [{ id: "ref-1", rewarded_at: NOW.toISOString() }] }), NOW);
    expect(g[0]).toMatchObject({ packageId: "referral_reward", source: "referral_reward", sourceId: "ref-1" });
    expect(g[0].expiresAt!.getTime()).toBe(NOW.getTime() + 25 * DAY);
  });

  it("Pro via users.tier only, no referral -> admin gift on an epoch-anchored slice", () => {
    const g = planIncludedGrants(snap(), NOW);
    expect(g[0].packageId).toBe("gift_admin");
    expect(g[0].sourceId).toMatch(new RegExp(`^${U}:\\d+$`));
  });

  it("admin role gets the explicit monthly admin cap only, keyed by UTC month", () => {
    const g = planIncludedGrants(snap({ user: { id: U, role: "admin", tier: "pro", tier_expires_at: null }, subs: [sub()] }), NOW);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ packageId: "included_admin", source: "admin_included", sourceId: `${U}:2026-10` });
    expect(g[0].expiresAt!.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("free users get nothing unless MENTOR_FREE_ENABLED, then the one-time taste", () => {
    const free = { id: U, role: "user", tier: "free", tier_expires_at: null };
    expect(planIncludedGrants(snap({ user: free }), NOW)).toEqual([]);
    expect(planIncludedGrants(snap({ user: free, freeEnabled: true }), NOW)[0]).toMatchObject({ packageId: "trial_taste", sourceId: U });
  });

  it("an inactive or zero package row grants nothing ([name] can switch a grant off by data)", () => {
    expect(planIncludedGrants(snap({ subs: [sub()], packages: catalogue({ included_pro_monthly: { active: false } }) }), NOW)).toEqual([]);
    expect(planIncludedGrants(snap({ subs: [sub()], packages: catalogue({ included_pro_monthly: { grant_micro: 0 } }) }), NOW)).toEqual([]);
  });

  it("no user -> no grant", () => {
    expect(planIncludedGrants(snap({ user: null }), NOW)).toEqual([]);
  });
});
