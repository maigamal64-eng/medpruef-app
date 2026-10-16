import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

import {
  alertAmountMismatch,
  amountGuardMode,
  chargedAmountCents,
  checkProPaymentAmount,
  decideAmountGuard,
  AMOUNT_HOLD_CLAIM_PROVIDER,
  AMOUNT_MISMATCH_EVENT,
} from "@/lib/whop-amount-guard";
import { amountMismatchLines, checkoutWatchEmail } from "@/lib/checkout-failure-rate";

describe("amount guard rule (G2)", () => {
  it("reads the mode; anything unknown is the default shadow", () => {
    expect(amountGuardMode({})).toBe("shadow");
    expect(amountGuardMode({ WHOP_AMOUNT_GUARD: "enforce" })).toBe("enforce");
    expect(amountGuardMode({ WHOP_AMOUNT_GUARD: " OFF " })).toBe("off");
    expect(amountGuardMode({ WHOP_AMOUNT_GUARD: "true" })).toBe("shadow");
  });

  it("passes a full EUR charge, net after fees and an unreported currency", () => {
    expect(checkProPaymentAmount({ tier: "first_month_19", paidCents: 1900, currency: "eur" })).toEqual({ ok: true });
    expect(checkProPaymentAmount({ tier: "first_month_19", paidCents: 1772, currency: "EUR" })).toEqual({ ok: true });
    expect(checkProPaymentAmount({ tier: "first_3mo_27", paidCents: 4900, currency: null })).toEqual({ ok: true });
    // 80 percent exactly passes (floor of 1520).
    expect(checkProPaymentAmount({ tier: "first_month_19", paidCents: 1520, currency: "eur" })).toEqual({ ok: true });
  });

  it("names the cause of every refusal", () => {
    expect(checkProPaymentAmount({ tier: "first_month_19", paidCents: 1519, currency: "eur" })).toMatchObject({ ok: false, cause: "under_price", priceCents: 1900, minCents: 1520 });
    expect(checkProPaymentAmount({ tier: "premium_pass_guaranteed", paidCents: 12900, currency: "egp" })).toMatchObject({ ok: false, cause: "currency" });
    expect(checkProPaymentAmount({ tier: "premium_pass_guaranteed", paidCents: 0, currency: "eur" })).toMatchObject({ ok: false, cause: "zero_amount" });
    expect(checkProPaymentAmount({ tier: "first_month_19", paidCents: null, currency: "eur" })).toMatchObject({ ok: false, cause: "no_amount" });
    expect(checkProPaymentAmount({ tier: "not_a_tier", paidCents: 1900, currency: "eur" })).toMatchObject({ ok: false, cause: "tier_not_priced" });
  });

  it("reads the gross charge first, net after fees only as the last resort", () => {
    expect(chargedAmountCents({ final_amount: 19, amount_after_fees: 14.8 })).toBe(1900);
    expect(chargedAmountCents({ final_amount: 0, subtotal: 19 })).toBe(0); // a coupon shows in final_amount
    expect(chargedAmountCents({ total: "22.80", subtotal: 19 })).toBe(2280);
    expect(chargedAmountCents({ amount_after_fees: 17.72 })).toBe(1772);
    // A free charge that shows only in the net figure still reads as 0 (reviewer P2).
    expect(chargedAmountCents({ subtotal: 19, amount_after_fees: 0 })).toBe(0);
    expect(chargedAmountCents({ amount: 19, amount_after_fees: "0" })).toBe(0);
    expect(chargedAmountCents({ currency: "eur" })).toBeNull();
    expect(chargedAmountCents(null)).toBeNull();
  });

  it("reads Whop money objects too (release-int-8 seam with the version pin)", () => {
    const money = (amount: string) => ({ amount, currency: "eur", decimals: 2, display_decimals: 2 });
    expect(chargedAmountCents({ total: money("49.00"), subtotal: money("49.00") })).toBe(4900);
    expect(chargedAmountCents({ total: money("0.00"), subtotal: money("49.00") })).toBe(0);
    expect(chargedAmountCents({ total: { currency: "eur" } })).toBeNull();
  });

  it("never checks the EUR 0 card trial start", () => {
    expect(checkProPaymentAmount({ tier: "notes_pro_trial", paidCents: 0, currency: "eur", trialStart: true })).toEqual({ ok: true });
    // Its paid renewal is checked like any charge.
    expect(checkProPaymentAmount({ tier: "notes_pro_trial", paidCents: 500, currency: "eur" })).toMatchObject({ ok: false, cause: "under_price" });
  });

  it("off never checks, shadow grants with the mismatch, enforce holds", () => {
    const bad = { tier: "first_month_19", paidCents: 0, currency: "eur" };
    expect(decideAmountGuard(bad, "off")).toEqual({ action: "grant", mismatch: null });
    expect(decideAmountGuard(bad, "shadow")).toMatchObject({ action: "grant", mismatch: { cause: "zero_amount" } });
    expect(decideAmountGuard(bad, "enforce")).toMatchObject({ action: "hold", mismatch: { cause: "zero_amount" } });
    expect(decideAmountGuard({ ...bad, paidCents: 1900 }, "enforce")).toEqual({ action: "grant", mismatch: null });
  });
});

describe("alertAmountMismatch: one alert per payment", () => {
  const mismatch = { ok: false as const, cause: "currency" as const, priceCents: 1900, minCents: 1520 };
  function db(opts: { rowError?: boolean } = {}) {
    const claims = new Set<string>();
    const { sb, calls } = createFakeSupabase((c) => {
      if (c.table === "processed_webhook_events" && c.op === "insert") {
        const p = c.payload as { provider: string; event_id: string };
        const key = `${p.provider}:${p.event_id}`;
        if (claims.has(key)) return { error: { code: "23505", message: "duplicate" } };
        claims.add(key);
        return { data: { event_id: p.event_id } };
      }
      if (c.table === "processed_webhook_events" && c.op === "delete") { claims.clear(); return {}; }
      if (c.table === "user_events" && c.op === "insert") return opts.rowError ? { error: { message: "down" } } : {};
      return {};
    });
    return { sb, calls };
  }
  const input = { paymentId: "pay_x", userId: "u1", tier: "first_month_19", planId: "plan_x", paidCents: 1900, currency: "egp", mismatch, source: "webhook", held: true };

  it("writes one row and one Sentry message, a second sighting nothing", async () => {
    sentry.captureMessage.mockClear();
    const { sb, calls } = db();
    expect(await alertAmountMismatch(sb, input)).toEqual({ alerted: true });
    expect(await alertAmountMismatch(sb, { ...input, source: "checkout_verify" })).toEqual({ alerted: false });
    const rows = calls.filter((c) => c.table === "user_events" && c.op === "insert");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ user_id: "whop-webhook", event_type: AMOUNT_MISMATCH_EVENT, event_data: { payment_id: "pay_x", cause: "currency", currency: "EGP", held: true } });
    expect(calls.find((c) => c.table === "processed_webhook_events")!.payload).toMatchObject({ provider: AMOUNT_HOLD_CLAIM_PROVIDER, event_id: "pay_x" });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("a failed row write frees the claim so the next sighting alerts", async () => {
    const { sb, calls } = db({ rowError: true });
    expect(await alertAmountMismatch(sb, input)).toEqual({ alerted: false });
    expect(calls.some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(true);
  });
});

describe("checkout watch email lists amount rows", () => {
  it("separates held and shadow rows, ids and amounts only", () => {
    const lines = amountMismatchLines([
      { created_at: "2026-10-20T08:00:00Z", event_type: "whop_payment_amount_mismatch", event_data: { payment_id: "pay_h", tier: "sitting_pass", paid_cents: 0, currency: "EUR", price_cents: 5900, cause: "zero_amount", source: "webhook", held: true, email: "never@example.test" } },
      { created_at: "2026-10-20T08:05:00Z", event_type: "whop_payment_amount_mismatch", event_data: { payment_id: "pay_s", tier: "first_month_19", paid_cents: 1200, currency: "EUR", price_cents: 1900, cause: "under_price", source: "checkout_verify", held: false } },
    ]);
    const mail = checkoutWatchEmail(null, [], [], lines);
    expect(mail.subject).toContain("amount_held");
    expect(mail.subject).toContain("amount_shadow");
    expect(mail.htmlBody).toContain("pay_h");
    expect(mail.htmlBody).toContain("0.00 EUR");
    expect(mail.htmlBody).toContain("59.00 EUR");
    expect(mail.htmlBody).not.toContain("never@example.test");
    expect(mail.htmlBody).not.toMatch(/\u2014/);
  });
});
