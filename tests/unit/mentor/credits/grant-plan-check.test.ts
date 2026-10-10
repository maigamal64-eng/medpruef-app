import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { MIN_PAID_RATIO, amountProblem, paidAmountCents } from "@/lib/mentor/credits/grant-payment";
import { PLAN_CACHE_MS, checkMentorPlan, comparePlan, resetPlanCheckCache } from "@/lib/mentor/credits/plan-check";

describe("paidAmountCents (H3)", () => {
  it("takes the LOWEST amount any field reports, so a coupon that only shows in final_amount counts", () => {
    expect(paidAmountCents({ final_amount: 0, amount: 4.9, subtotal: 4.9 })).toBe(0);
    expect(paidAmountCents({ amount: 4.9, amount_after_fees: 4.13 })).toBe(413);
    expect(paidAmountCents({ final_amount: "4.90" })).toBe(490);
  });
  it("returns null when no amount field exists (fail closed)", () => {
    expect(paidAmountCents({ id: "pay_1" })).toBeNull();
    expect(paidAmountCents(null)).toBeNull();
  });
});

describe("amountProblem (H3)", () => {
  it("passes the full price and the net-of-fees amount, refuses zero, unknown, other currencies and deep discounts", () => {
    expect(amountProblem(490, "eur", 490)).toBeNull();
    expect(amountProblem(413, "EUR", 490)).toBeNull();
    expect(amountProblem(Math.floor(490 * MIN_PAID_RATIO), "eur", 490)).toBeNull();
    expect(amountProblem(0, "eur", 490)).toBe("amount_mismatch");
    expect(amountProblem(null, "eur", 490)).toBe("amount_mismatch");
    expect(amountProblem(490, "usd", 490)).toBe("amount_mismatch");
    expect(amountProblem(245, "eur", 490)).toBe("amount_mismatch");
    expect(amountProblem(490, null, 490)).toBeNull();
    expect(amountProblem(490, "eur", null)).toBe("package_not_priced");
    expect(amountProblem(490, "eur", 0)).toBe("package_not_priced");
  });
});

const GOOD = { currency: "eur", initial_price: 4.9, renewal_price: 4.9, trial_period_days: 0 };

describe("comparePlan (M3)", () => {
  it("accepts a matching subscription plan, also inside a data envelope", () => {
    expect(comparePlan(GOOD, 490, "subscription")).toEqual({ ok: true });
    expect(comparePlan({ data: GOOD }, 490, "subscription")).toEqual({ ok: true });
  });
  it("accepts a one-time top-up that does not renew", () => {
    expect(comparePlan({ currency: "eur", initial_price: 10, renewal_price: 0 }, 1000, "topup")).toEqual({ ok: true });
    expect(comparePlan({ currency: "eur", initial_price: 10 }, 1000, "topup")).toEqual({ ok: true });
  });
  it("refuses a wrong currency, initial price, renewal price, a trial, or an unreadable plan", () => {
    expect(comparePlan({ ...GOOD, currency: "usd" }, 490, "subscription")).toEqual({ ok: false, reason: "currency" });
    expect(comparePlan({ ...GOOD, initial_price: 5.9 }, 490, "subscription")).toEqual({ ok: false, reason: "initial_price" });
    expect(comparePlan({ currency: "eur" }, 490, "subscription")).toEqual({ ok: false, reason: "initial_price" });
    expect(comparePlan({ ...GOOD, renewal_price: 9.9 }, 490, "subscription")).toEqual({ ok: false, reason: "renewal_price" });
    expect(comparePlan({ currency: "eur", initial_price: 10, renewal_price: 10 }, 1000, "topup")).toEqual({ ok: false, reason: "renewal_price" });
    expect(comparePlan({ ...GOOD, trial_period_days: 7 }, 490, "subscription")).toEqual({ ok: false, reason: "trial" });
    expect(comparePlan(null, 490, "subscription")).toEqual({ ok: false, reason: "plan_unreadable" });
    expect(comparePlan("x", 490, "subscription")).toEqual({ ok: false, reason: "plan_unreadable" });
  });
});

describe("checkMentorPlan cache (M3)", () => {
  beforeEach(() => resetPlanCheckCache());
  const base = { planId: "plan_b", priceCents: 490, kind: "subscription" as const, apiKey: "k" };

  it("reads Whop once per 10 minutes, then again", async () => {
    const fetchPlan = vi.fn(async () => GOOD);
    let t = 1_000;
    const a = { ...base, fetchPlan, now: () => t };
    expect(await checkMentorPlan(a)).toEqual({ ok: true });
    t += PLAN_CACHE_MS - 1;
    expect(await checkMentorPlan(a)).toEqual({ ok: true });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    t += 2;
    await checkMentorPlan(a);
    expect(fetchPlan).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure, and an unreadable plan or a missing key refuses", async () => {
    const bad = vi.fn(async () => ({ ...GOOD, initial_price: 5.9 }));
    expect(await checkMentorPlan({ ...base, fetchPlan: bad })).toEqual({ ok: false, reason: "initial_price" });
    expect(await checkMentorPlan({ ...base, fetchPlan: bad })).toEqual({ ok: false, reason: "initial_price" });
    expect(bad).toHaveBeenCalledTimes(2);
    expect(await checkMentorPlan({ ...base, fetchPlan: async () => { throw new Error("HTTP 500"); } })).toEqual({ ok: false, reason: "plan_unreadable" });
    expect(await checkMentorPlan({ ...base, apiKey: null, fetchPlan: bad })).toEqual({ ok: false, reason: "plan_unreadable" });
  });
});
