import { describe, expect, it } from "vitest";
import { checkWhopPaymentForGrant, judgePaymentForGrant } from "@/lib/whop-payment-read";

const expectArgs = { paymentId: "pay_synth1", planId: "plan_synth", userId: "22222222-2222-4222-8222-222222222222" };
const payment = (extra: Record<string, unknown> = {}) => ({ id: "pay_synth1", status: "paid", plan: { id: "plan_synth" }, membership: { id: "mem_synth1" }, final_amount: 19, ...extra });

describe("judgePaymentForGrant (Whop review G1)", () => {
  it("accepts a paid, unrefunded payment on the plan and returns the mem_ membership and paid amount", () => {
    expect(judgePaymentForGrant(payment(), expectArgs)).toEqual({ ok: true, membershipId: "mem_synth1", amountCents: 1900 });
  });
  it("unwraps a data envelope", () => {
    expect(judgePaymentForGrant({ data: payment() }, expectArgs)).toMatchObject({ ok: true });
  });
  it("never pins a mber_ member id", () => {
    expect(judgePaymentForGrant(payment({ membership: undefined, member: { id: "mber_x1" } }), expectArgs)).toMatchObject({ ok: true, membershipId: null });
  });
  it("refuses unreadable bodies and another payment id", () => {
    expect(judgePaymentForGrant(null, expectArgs)).toEqual({ ok: false, reason: "reread_failed" });
    expect(judgePaymentForGrant("x", expectArgs)).toEqual({ ok: false, reason: "reread_failed" });
    expect(judgePaymentForGrant(payment({ id: "pay_other" }), expectArgs)).toEqual({ ok: false, reason: "reread_failed" });
  });
  it("refuses anything but status paid", () => {
    for (const status of ["failed", "pending", "open", "draft", "Paid", undefined]) {
      expect(judgePaymentForGrant(payment({ status }), expectArgs)).toEqual({ ok: false, reason: "not_paid" });
    }
  });
  it("refuses refunds and disputes", () => {
    expect(judgePaymentForGrant(payment({ refunded_amount: 1 }), expectArgs)).toEqual({ ok: false, reason: "refunded" });
    expect(judgePaymentForGrant(payment({ substatus: "dispute_open" }), expectArgs)).toEqual({ ok: false, reason: "refunded" });
    expect(judgePaymentForGrant(payment({ refunded_at: "2026-10-16T00:00:00Z" }), expectArgs)).toEqual({ ok: false, reason: "refunded" });
  });
  it("refuses another plan or none", () => {
    expect(judgePaymentForGrant(payment({ plan: { id: "plan_other" } }), expectArgs)).toEqual({ ok: false, reason: "plan_mismatch" });
    expect(judgePaymentForGrant(payment({ plan: undefined }), expectArgs)).toEqual({ ok: false, reason: "plan_mismatch" });
  });
  it("refuses a payment whose metadata names another MedPrüf account", () => {
    expect(judgePaymentForGrant(payment({ metadata: { medpruef_user_id: "33333333-3333-4333-8333-333333333333" } }), expectArgs)).toEqual({ ok: false, reason: "other_account" });
    expect(judgePaymentForGrant(payment({ metadata: { medpruef_user_id: expectArgs.userId } }), expectArgs)).toMatchObject({ ok: true });
  });
});

describe("judgePaymentForGrant amount (reviewer P3)", () => {
  it("refuses a EUR 0 or amountless paid payment", () => {
    expect(judgePaymentForGrant(payment({ final_amount: 0 }), expectArgs)).toEqual({ ok: false, reason: "zero_amount" });
    expect(judgePaymentForGrant(payment({ final_amount: undefined }), expectArgs)).toEqual({ ok: false, reason: "zero_amount" });
  });
});

describe("checkWhopPaymentForGrant", () => {
  it("fails closed when the read throws", async () => {
    const r = await checkWhopPaymentForGrant({ ...expectArgs, apiKey: "k", fetchPayment: async () => { throw new Error("HTTP 500"); } });
    expect(r).toEqual({ ok: false, reason: "reread_failed" });
  });
  it("reads the payment by id with the key and judges it", async () => {
    const seen: string[] = [];
    const r = await checkWhopPaymentForGrant({ ...expectArgs, apiKey: "k", fetchPayment: async (id, key) => { seen.push(`${id}:${key}`); return payment(); } });
    expect(seen).toEqual(["pay_synth1:k"]);
    expect(r).toMatchObject({ ok: true });
  });
});
