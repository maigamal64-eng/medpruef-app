import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
import { captureServerError } from "@/lib/sentry-capture";
import { loadRenewalState, snapshotRenews } from "@/lib/renewal-state";
import type { ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";

const MONTHLY = "plan_redacted8f2b848b";
const COHORT = "plan_redacted324decbc";
type Row = { tier: string; payment_provider: string | null; provider_payment_id: string | null; whop_membership_id: string | null };
const db = (rows: Row[] | null, plans: Record<string, string> = {}, fail?: "subs" | "plans") => createFakeSupabase((c) => {
  if (c.table === "subscriptions") return fail === "subs" ? { error: { message: "down" } } : { data: rows };
  if (c.table === "payment_events") return fail === "plans" ? { error: { message: "down" } } : { data: Object.entries(plans).map(([payment_id, plan_id]) => ({ payment_id, plan_id })) };
  return {};
}).sb as unknown as SupabaseClient;
const snap = (over: Partial<ProviderBillingSnapshot> = {}): ProviderBillingSnapshot => ({
  plan_id: MONTHLY, billing_cadence: "auto_renews", provider_status: "active", is_trial: false, cancel_at_period_end: false,
  next_charge_at: "2031-01-01T00:00:00.000Z", next_charge_amount_cents: 1900, billing_interval_days: 30, manage_url: null, provider_state_verified: true, ...over,
});
const monthly = (n: string): Row => ({ tier: "first_month_19", payment_provider: "whop", provider_payment_id: `pay_${n}`, whop_membership_id: `mem_${n}` });
const cohort: Row = { tier: "premium_pass_guaranteed", payment_provider: "whop", provider_payment_id: "pay_c", whop_membership_id: "mem_c" };

describe("renewal state (a21 P2): renews only when Whop confirms it", () => {
  it("snapshotRenews needs a verified, active or trialing, uncancelled membership with a next charge", () => {
    expect(snapshotRenews(snap())).toBe(true);
    expect(snapshotRenews(snap({ provider_status: "trialing" }))).toBe(true);
    expect(snapshotRenews(null)).toBe(false);
    expect(snapshotRenews(snap({ provider_state_verified: false }))).toBe(false);
    expect(snapshotRenews(snap({ cancel_at_period_end: true }))).toBe(false);
    expect(snapshotRenews(snap({ provider_status: "past_due" }))).toBe(false);
    expect(snapshotRenews(snap({ next_charge_at: null }))).toBe(false); // paused collection
    expect(snapshotRenews(snap({ billing_cadence: "unknown" }))).toBe(false);
  });
  it("one_time for no rows and for one-time or non-Whop rows, without a Whop read", async () => {
    const load = vi.fn();
    expect(await loadRenewalState(db([]), "u", load)).toBe("one_time");
    expect(await loadRenewalState(db([cohort, { tier: "pro", payment_provider: "manual", provider_payment_id: null, whop_membership_id: null }], { pay_c: COHORT }), "u", load)).toBe("one_time");
    expect(load).not.toHaveBeenCalled();
  });
  it("renews wins over an unknown row; unknown wins over cancelled", async () => {
    const load = vi.fn(async (mem: string | null) => (mem === "mem_a" ? snap() : null));
    expect(await loadRenewalState(db([{ ...monthly("x"), provider_payment_id: null }, monthly("a")], { pay_a: MONTHLY }), "u", load)).toBe("renews");
    const cancelledThenUnknown = vi.fn(async (mem: string | null) => (mem === "mem_a" ? snap({ cancel_at_period_end: true, provider_status: "canceling", next_charge_at: null }) : null));
    expect(await loadRenewalState(db([monthly("a"), monthly("b")], { pay_a: MONTHLY, pay_b: MONTHLY }), "u", cancelledThenUnknown)).toBe("unknown");
    expect(await loadRenewalState(db([monthly("a"), cohort], { pay_a: MONTHLY, pay_c: COHORT }), "u", cancelledThenUnknown)).toBe("cancelled");
  });
  it("unknown, reported, for read errors, an unread membership and an unclassified plan", async () => {
    vi.mocked(captureServerError).mockClear();
    expect(await loadRenewalState(db(null, {}, "subs"), "u", vi.fn())).toBe("unknown");
    expect(await loadRenewalState(db([monthly("a")], {}, "plans"), "u", vi.fn())).toBe("unknown");
    expect(await loadRenewalState(db([monthly("a")], { pay_a: MONTHLY }), "u", async () => null)).toBe("unknown");
    expect(await loadRenewalState(db([monthly("a")], { pay_a: MONTHLY }), "u", async () => { throw new Error("boom"); })).toBe("unknown");
    expect(captureServerError).toHaveBeenCalledTimes(4);
    expect(await loadRenewalState(db([monthly("a")], { pay_a: "plan_unlisted" }), "u", vi.fn())).toBe("unknown");
    expect(await loadRenewalState(db([{ tier: "notes_pro_trial", payment_provider: "whop", provider_payment_id: null, whop_membership_id: null }]), "u", async () => null)).toBe("unknown");
  });
});
