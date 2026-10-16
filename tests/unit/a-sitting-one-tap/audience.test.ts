import { describe, expect, it } from "vitest";
import { offerAudience, type AudienceUser } from "@/lib/sitting-link/audience";
import type { LearnerSubscriptionRow } from "@/lib/admin/learner-access";

const now = new Date("2026-11-01T10:00:00Z");
const free: AudienceUser = { email: "user-610e28c1@example.com", role: "user", tier: "free", tierExpiresAt: null, isBanned: false };
const row = (over: Partial<LearnerSubscriptionRow>): LearnerSubscriptionRow => ({ tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: "2026-11-20T00:00:00Z", ...over });

describe("offer audience", () => {
  it("never-paid free account: plan fit and trial", () => {
    expect(offerAudience({ user: free, subs: [], suppressed: false, now })).toEqual({ planFit: true, trialOffer: true, reason: "ok" });
  });

  it("current payer: nothing", () => {
    const user = { ...free, tier: "pro", tierExpiresAt: "2026-11-20T00:00:00Z" };
    expect(offerAudience({ user, subs: [row({})], suppressed: false, now }).reason).toBe("current_access");
  });

  it("comp (admin grant, no row): nothing", () => {
    const user = { ...free, tier: "pro", tierExpiresAt: "2026-12-20T00:00:00Z" };
    expect(offerAudience({ user, subs: [], suppressed: false, now })).toMatchObject({ planFit: false, trialOffer: false });
    expect(offerAudience({ user: { ...free, tier: "pro", tierExpiresAt: null }, subs: [], suppressed: false, now }).reason).toBe("current_access");
  });

  it("running trial: plan fit only", () => {
    const user = { ...free, tier: "pro", tierExpiresAt: "2026-11-03T00:00:00Z" };
    const trial = row({ tier: "reverse_trial", payment_provider: "trial", amount_cents: 0, provider_payment_id: null, expires_at: "2026-11-03T00:00:00Z" });
    expect(offerAudience({ user, subs: [trial], suppressed: false, now })).toEqual({ planFit: true, trialOffer: false, reason: "ok" });
  });

  it("converted card trial (tier kept, renewals paid): current payer, nothing (reviewer P1)", () => {
    const user = { ...free, tier: "pro", tierExpiresAt: "2026-11-20T00:00:00Z" };
    const converted = row({ tier: "notes_pro_trial", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_2", granted_payment_ids: [{ payment_id: "pay_2", amount_cents: 1900 }] });
    expect(offerAudience({ user, subs: [converted], suppressed: false, now })).toEqual({ planFit: false, trialOffer: false, reason: "current_access" });
    const noRef = row({ tier: "notes_pro_trial", amount_cents: 1900, provider_payment_id: null });
    expect(offerAudience({ user, subs: [noRef], suppressed: false, now }).reason).toBe("current_access");
  });

  it("comp beside a running trial row: nothing (access outlives the trial)", () => {
    const trial = row({ tier: "reverse_trial", payment_provider: "trial", amount_cents: 0, provider_payment_id: null, expires_at: "2026-11-03T00:00:00Z" });
    expect(offerAudience({ user: { ...free, tier: "pro", tierExpiresAt: null }, subs: [trial], suppressed: false, now }).reason).toBe("current_access");
    expect(offerAudience({ user: { ...free, tier: "pro", tierExpiresAt: "2027-01-01T00:00:00Z" }, subs: [trial], suppressed: false, now }).reason).toBe("current_access");
  });

  it("former payer and former comp: plan fit, never the trial", () => {
    const lapsed = row({ status: "expired", expires_at: "2026-09-01T00:00:00Z" });
    expect(offerAudience({ user: { ...free, tierExpiresAt: "2026-09-01T00:00:00Z" }, subs: [lapsed], suppressed: false, now })).toEqual({ planFit: true, trialOffer: false, reason: "ok" });
    expect(offerAudience({ user: { ...free, tierExpiresAt: "2026-09-01T00:00:00Z" }, subs: [], suppressed: false, now }).trialOffer).toBe(false);
    const manual = row({ payment_provider: "manual", status: "expired", amount_cents: 0, provider_payment_id: null, expires_at: "2026-09-01T00:00:00Z" });
    expect(offerAudience({ user: free, subs: [manual], suppressed: false, now }).trialOffer).toBe(false);
  });

  it("admin, staff, test, banned and do-not-contact: nothing", () => {
    expect(offerAudience({ user: { ...free, role: "admin" }, subs: [], suppressed: false, now }).reason).toBe("admin_staff");
    expect(offerAudience({ user: { ...free, email: "user-b7e46e80@example.com" }, subs: [], suppressed: false, now }).reason).toBe("admin_staff");
    expect(offerAudience({ user: { ...free, email: "user-be904983@example.com" }, subs: [], suppressed: false, now }).reason).toBe("admin_staff");
    expect(offerAudience({ user: { ...free, isBanned: true }, subs: [], suppressed: false, now }).reason).toBe("banned");
    expect(offerAudience({ user: free, subs: [], suppressed: true, now }).reason).toBe("do_not_contact");
    expect(offerAudience({ user: free, subs: [], suppressed: null, now }).reason).toBe("do_not_contact");
  });
});
