import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, eqVal } from "../helpers/fake-supabase";
import {
  classifySubscriptionCadence,
  loadRenewalOfferSuppression,
  shouldSuppressRenewalOffer,
} from "@/lib/billing-cadence";
import { AUTO_RENEWING_WHOP_PLAN_IDS } from "@/lib/billing-copy";

// Plan ids as they appear in payment_events (read-only, 2026-10-10).
const MONTHLY = "plan_redacted8f2b848b";
const QUARTERLY = "plan_redacted145e2752";
const TRIAL = "plan_redactedec56d4df";
const LEGACY_ONE_TIME_19 = "plan_redacted07253e20";
const LEGACY_ONE_TIME_49 = "plan_redacted8dbd8718";

describe("classifySubscriptionCadence", () => {
  it("treats the Pro trial tier as auto-renewing without a plan lookup", () => {
    expect(classifySubscriptionCadence({ tier: "notes_pro_trial", payment_provider: "whop", plan_id: null })).toBe("auto_renews");
  });
  it.each([MONTHLY, QUARTERLY, TRIAL])("treats Whop plan %s as auto-renewing", (plan) => {
    expect(classifySubscriptionCadence({ tier: "first_3mo_27", payment_provider: "whop", plan_id: plan })).toBe("auto_renews");
  });
  it.each([LEGACY_ONE_TIME_19, LEGACY_ONE_TIME_49])("treats legacy one-time plan %s as one-time", (plan) => {
    expect(classifySubscriptionCadence({ tier: "first_month_19", payment_provider: "whop", plan_id: plan })).toBe("one_time");
  });
  it("treats a new/unrecognized Whop plan as unknown, never assumes one-time", () => {
    expect(classifySubscriptionCadence({ tier: "first_month_19", payment_provider: "whop", plan_id: "plan_new" })).toBe("unknown");
  });
  it("marks a Whop row with no logged plan as unknown", () => {
    expect(classifySubscriptionCadence({ tier: "first_month_19", payment_provider: "whop", plan_id: null })).toBe("unknown");
  });
  it("treats crypto and manual grants as one-time", () => {
    expect(classifySubscriptionCadence({ tier: "premium_pass_guaranteed", payment_provider: "nowpayments", plan_id: null })).toBe("one_time");
    expect(classifySubscriptionCadence({ tier: "first_month_19", payment_provider: "manual", plan_id: null })).toBe("one_time");
  });
  it("lists exactly the three recurring plans from billing-copy", () => {
    expect([...AUTO_RENEWING_WHOP_PLAN_IDS].sort()).toEqual([MONTHLY, QUARTERLY, TRIAL].sort());
  });
});

describe("shouldSuppressRenewalOffer", () => {
  it("allows the offer with no active rows (lapsed one-time buyer)", () => {
    expect(shouldSuppressRenewalOffer([])).toBe(false);
  });
  it("allows the offer for a one-time buyer", () => {
    expect(shouldSuppressRenewalOffer([{ tier: "first_month_19", payment_provider: "whop", plan_id: LEGACY_ONE_TIME_19 }])).toBe(false);
  });
  it("suppresses when any active row auto-renews (trial user about to convert)", () => {
    expect(shouldSuppressRenewalOffer([
      { tier: "first_month_19", payment_provider: "whop", plan_id: LEGACY_ONE_TIME_19 },
      { tier: "notes_pro_trial", payment_provider: "whop", plan_id: null },
    ])).toBe(true);
  });
  it("suppresses when a Whop row's cadence is unknown (fail closed)", () => {
    expect(shouldSuppressRenewalOffer([{ tier: "first_3mo_27", payment_provider: "whop", plan_id: null }])).toBe(true);
  });
});

describe("loadRenewalOfferSuppression", () => {
  it("joins the latest payment's logged plan id and suppresses a recurring quarterly buyer", async () => {
    const { sb, calls } = createFakeSupabase((c) => {
      if (c.table === "subscriptions") return { data: [{ tier: "first_3mo_27", payment_provider: "whop", provider_payment_id: "pay_Q" }] };
      if (c.table === "payment_events") return { data: [{ payment_id: "pay_Q", plan_id: QUARTERLY }] };
      return {};
    });
    const r = await loadRenewalOfferSuppression(sb as unknown as SupabaseClient, "u1");
    expect(r.suppressed).toBe(true);
    const subQuery = calls.find((c) => c.table === "subscriptions")!;
    expect(eqVal(subQuery, "user_id")).toBe("u1");
    expect(eqVal(subQuery, "status")).toBe("active");
    const ev = calls.find((c) => c.table === "payment_events")!;
    expect(ev.filters).toContainEqual({ kind: "in", column: "payment_id", value: ["pay_Q"] });
  });
  it("allows the offer for a legacy one-time buyer", async () => {
    const { sb } = createFakeSupabase((c) => {
      if (c.table === "subscriptions") return { data: [{ tier: "first_month_19", payment_provider: "whop", provider_payment_id: "pay_O" }] };
      if (c.table === "payment_events") return { data: [{ payment_id: "pay_O", plan_id: LEGACY_ONE_TIME_19 }] };
      return {};
    });
    expect((await loadRenewalOfferSuppression(sb as unknown as SupabaseClient, "u1")).suppressed).toBe(false);
  });
  it("skips the plan lookup for a trial-only user", async () => {
    const { sb, calls } = createFakeSupabase((c) => (c.table === "subscriptions" ? { data: [{ tier: "notes_pro_trial", payment_provider: "whop", provider_payment_id: "pay_T" }] } : {}));
    expect((await loadRenewalOfferSuppression(sb as unknown as SupabaseClient, "u1")).suppressed).toBe(true);
    expect(calls.some((c) => c.table === "payment_events")).toBe(false);
  });
  it("throws on a read error so callers fail closed", async () => {
    const { sb } = createFakeSupabase(() => ({ error: { message: "db down" } }));
    await expect(loadRenewalOfferSuppression(sb as unknown as SupabaseClient, "u1")).rejects.toMatchObject({ message: "db down" });
  });
});
