import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutReturnReadEnabled, decideCheckoutReturn, returnBucket, type ReturnEvent } from "@/lib/checkout-return-read";
import type { ResumeAccount } from "@/lib/checkout-resume";
import { isAllowedEvent, sanitizeEventData } from "@/lib/analytics-events";
import { markCheckoutLeft, readCheckoutLeft, clearCheckoutLeft, MARKER_MAX_AGE_MS, armPricingPrompt, pricingPromptArmed } from "@/lib/checkout-return-marker";

const NOW = new Date("2026-10-15T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const acct = (o: Partial<ResumeAccount> = {}): ResumeAccount => ({ id: "u1", role: "user", tier: "free", email: "user-14be81d5@example.com", paidAccess: false, doNotContact: false, ...o });
const redirect = (min: number, tier: string | null = "first_3mo_27"): ReturnEvent => ({ event: "checkout_redirected", created_at: ago(min), tier });
const run = (o: { account?: Partial<ResumeAccount>; events?: ReturnEvent[]; enabled?: boolean; excluded?: string[] } = {}) =>
  decideCheckoutReturn({ enabled: o.enabled ?? true, excluded: new Set(o.excluded ?? []), account: acct(o.account), events: o.events ?? [redirect(3)], now: NOW });

describe("decideCheckoutReturn", () => {
  it("is off by default", () => {
    expect(checkoutReturnReadEnabled({})).toBe(false);
    expect(checkoutReturnReadEnabled({ CHECKOUT_RETURN_READ_ENABLED: "true" })).toBe(true);
    expect(run({ enabled: false })).toEqual({ show: false, reason: "flag_off" });
  });
  it("records a return inside 2 hours with the seconds bucket and the tier", () => {
    expect(run({ events: [redirect(3)] })).toMatchObject({ show: true, tier: "first_3mo_27", seconds: 180, bucket: "1_5m" });
    expect(run({ events: [redirect(0.25)] })).toMatchObject({ bucket: "lt_1m" });
    expect(run({ events: [redirect(90)] })).toMatchObject({ bucket: "30m_2h" });
  });
  it("buckets are edges-exact", () => {
    expect([59, 60, 299, 300, 1799, 1800].map(returnBucket)).toEqual(["lt_1m", "1_5m", "1_5m", "5_30m", "5_30m", "30m_2h"]);
  });
  it("nothing after 2 hours or without a redirect", () => {
    expect(run({ events: [redirect(121)] })).toEqual({ show: false, reason: "no_redirect" });
    expect(run({ events: [] })).toEqual({ show: false, reason: "no_redirect" });
  });
  it("a grant since, or a payment nobody has tied to the learner yet, hides it", () => {
    expect(run({ events: [redirect(10), { event: "grant_succeeded", created_at: ago(5) }] })).toMatchObject({ reason: "granted_since" });
    expect(run({ events: [redirect(10), { event: "webhook_received", created_at: ago(5) }] })).toMatchObject({ reason: "unresolved_payment" });
    expect(run({ events: [redirect(10), { event: "grant_failed", created_at: ago(5) }] })).toMatchObject({ reason: "unresolved_payment" });
    // an old grant before the redirect does not count
    expect(run({ events: [redirect(10), { event: "grant_succeeded", created_at: ago(60) }] })).toMatchObject({ show: true });
  });
  it("a-checkout-resume exclusions", () => {
    expect(run({ account: { paidAccess: true } })).toMatchObject({ reason: "paid" });
    expect(run({ account: { role: "admin" } })).toMatchObject({ reason: "staff" });
    expect(run({ account: { email: "user-847887c3@example.com" } })).toMatchObject({ reason: "staff" });
    expect(run({ account: { doNotContact: true } })).toMatchObject({ reason: "do_not_contact" });
    expect(run({ account: { refunded: true } })).toMatchObject({ reason: "refunded" });
    expect(run({ excluded: ["u1"] })).toMatchObject({ reason: "excluded" });
    expect(run({ events: [redirect(3, "notes_pro_trial")] })).toMatchObject({ reason: "unpaid_plan" });
    expect(run({ events: [redirect(3, null)] })).toMatchObject({ reason: "unpaid_plan" });
  });
  it("a settling checkout does not hide the measurement", () => {
    expect(run({ events: [redirect(0.5)] })).toMatchObject({ show: true, bucket: "lt_1m" });
  });
});

describe("analytics registry", () => {
  it("allows the three events with bounded fields only", () => {
    for (const n of ["checkout_return", "checkout_stall_shown", "checkout_stall_answered"]) expect(isAllowedEvent(n)).toBe(true);
    expect(sanitizeEventData("checkout_return", { bucket: "1_5m", tier: "flex", page: "/pricing?x=1", email: "user-0a322b44@example.com", payment_id: "pay_1" }))
      .toEqual({ bucket: "1_5m", tier: "flex", page: "/pricing" });
    expect(sanitizeEventData("checkout_stall_answered", { reason: "price", tier: "t", surface: "pricing", details: "free text" }))
      .toEqual({ reason: "price", tier: "t", surface: "pricing" });
  });
});

describe("browser marker", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    const sess = new Map<string, string>();
    vi.stubGlobal("window", { dispatchEvent: () => true, sessionStorage: { getItem: (k: string) => sess.get(k) ?? null, setItem: (k: string, v: string) => void sess.set(k, v), removeItem: (k: string) => void sess.delete(k) }, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  });
  it("round-trips a fresh marker and drops an old, future or malformed one", () => {
    const t = Date.now();
    markCheckoutLeft("flex_month", t);
    expect(readCheckoutLeft(t + 1000)).toEqual({ at: t, tier: "flex_month" });
    expect(readCheckoutLeft(t + MARKER_MAX_AGE_MS + 1)).toBeNull();
    markCheckoutLeft("flex_month", t + 10 * 60_000);
    expect(readCheckoutLeft(t)).toBeNull();
    store.set("medpruef_checkout_left", "{nope");
    expect(readCheckoutLeft(t)).toBeNull();
    markCheckoutLeft("x", t); clearCheckoutLeft();
    expect(readCheckoutLeft(t)).toBeNull();
  });
  it("the /pricing prompt flag expires with the 2 hour window", () => {
    const t = Date.now();
    armPricingPrompt(t);
    expect(pricingPromptArmed(t + 1000)).toBe(true);
    expect(pricingPromptArmed(t + MARKER_MAX_AGE_MS + 1)).toBe(false);
    expect(pricingPromptArmed(t + 1000)).toBe(false);
  });
});
