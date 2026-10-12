import { describe, expect, it } from "vitest";
import {
  buildLedger,
  classifyPayers,
  computeMoneyIn,
  computePaymentHealth,
  firstPaidAtByUser,
  isStaffOrTestAccount,
  isUnresolvedPayment,
  lastViennaDays,
  lastViennaMonths,
  viennaDay,
  type LedgerEventRow,
  type SubscriptionLike,
} from "@/lib/admin/money-rules";

// Synthetic rows shaped after the 2026-10-10 ground truth (aggregates only):
// October = 2 paid EUR 19 charges (one reported as 1900 and 1772), one EUR 0
// trial start, one EUR 19 refund on 10 Oct for a 17 Sep payment; a USD 50
// unmapped payment on 20 Sep that never granted.
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";

let id = 0;
function row(p: Partial<LedgerEventRow> & { event: string; created_at: string }): LedgerEventRow {
  id += 1;
  return {
    id,
    provider: "whop",
    user_id: null,
    tier: null,
    plan_id: null,
    payment_id: null,
    amount_cents: null,
    currency: "eur",
    reason: null,
    matched: true,
    metadata: null,
    ...p,
  };
}
const paid = (payment_id: string, at: string, amount: number, extra: Partial<LedgerEventRow> = {}) =>
  row({ event: "webhook_received", payment_id, amount_cents: amount, created_at: at, metadata: { whop_event: "payment.succeeded" }, ...extra });
const granted = (payment_id: string, at: string, amount: number, user: string, extra: Partial<LedgerEventRow> = {}) =>
  row({ event: "grant_succeeded", payment_id, amount_cents: amount, created_at: at, user_id: user, tier: "first_month_19", ...extra });

const ROWS: LedgerEventRow[] = [
  // 17 Sep: the payment later refunded.
  paid("pay_sep17", "2026-09-17T09:00:00Z", 1900),
  granted("pay_sep17", "2026-09-17T09:00:05Z", 1900, U3),
  // 20 Sep 11:27 UTC: USD 50 unmapped, delivered twice, never granted.
  paid("pay_usd50", "2026-09-20T11:27:00Z", 5000, { currency: "usd", matched: false, plan_id: "plan_other" }),
  paid("pay_usd50", "2026-09-20T11:27:30Z", 5000, { currency: "usd", matched: false, plan_id: "plan_other" }),
  row({ event: "grant_failed", payment_id: "pay_usd50", reason: "unmapped", amount_cents: 5000, currency: "usd", created_at: "2026-09-20T11:27:31Z" }),
  // 1 Oct: EUR 0 trial start (never money).
  paid("pay_trial", "2026-10-01T08:00:00Z", 0),
  granted("pay_trial", "2026-10-01T08:00:02Z", 0, U2, { tier: "notes_pro_trial" }),
  // 7 Oct: EUR 19, Whop reported net first (1772), verify logged the charge.
  paid("pay_oct7", "2026-10-07T10:00:00Z", 1772),
  granted("pay_oct7", "2026-10-07T10:00:03Z", 1772, U1),
  granted("pay_oct7", "2026-10-07T10:01:00Z", 1900, U1),
  ...Array.from({ length: 12 }, (_, i) => paid("pay_oct7", `2026-10-07T1${Math.min(i, 9)}:30:00Z`, 1772)),
  // 9 Oct: trial converts, EUR 19.
  paid("pay_oct9", "2026-10-09T21:30:00Z", 1900),
  granted("pay_oct9", "2026-10-09T21:30:04Z", 1900, U2, { tier: "notes_pro_trial" }),
  // 10 Oct: refund of the 17 Sep payment, delivered twice.
  row({ event: "webhook_received", payment_id: "r_1", amount_cents: 1900, matched: false, created_at: "2026-10-10T12:00:00Z", metadata: { whop_event: "refund.created" } }),
  row({ event: "webhook_received", payment_id: "r_1", amount_cents: 1900, matched: false, created_at: "2026-10-10T12:00:40Z", metadata: { whop_event: "refund.created" } }),
];

describe("money in, cash basis (ADM-01 A)", () => {
  const ledger = buildLedger(ROWS);
  const now = new Date("2026-10-11T10:00:00Z");

  it("collapses repeated deliveries into one payment with gross and Whop net", () => {
    const oct7 = ledger.payments.find((p) => p.payment_id === "pay_oct7")!;
    expect(oct7.gross_cents).toBe(1900);
    expect(oct7.net_cents).toBe(1772);
    expect(oct7.granted).toBe(true);
    expect(ledger.payments.filter((p) => p.payment_id === "pay_oct7")).toHaveLength(1);
    // Only one amount ever delivered: net stays unknown, not equal to gross.
    expect(ledger.payments.find((p) => p.payment_id === "pay_oct9")!.net_cents).toBeNull();
  });

  it("books October as 3800 paid and 1900 refunded, cash 1900", () => {
    const m = computeMoneyIn(ledger, now);
    expect(m.month_to_date).toEqual({ gross_cents: 3800, refunds_cents: 1900, cash_cents: 1900 });
    const oct = m.months.find((x) => x.month === "2026-10")!;
    expect(oct).toMatchObject({ paid_payments: 2, trial_starts: 1, gross_cents: 3800, refunds_cents: 1900, refunds: 1, cash_cents: 1900, fees_known_cents: 128, payments_with_fee_known: 1 });
    // The refund stays on its own day: September is untouched.
    expect(m.months.find((x) => x.month === "2026-09")!.gross_cents).toBe(1900);
    expect(m.months.find((x) => x.month === "2026-09")!.refunds_cents).toBe(0);
  });

  it("never sums USD into EUR", () => {
    const m = computeMoneyIn(ledger, now);
    expect(m.lifetime_gross_cents).toBe(5700);
    expect(m.other_currencies).toEqual([{ currency: "USD", paid_payments: 1, gross_cents: 5000, refunds_cents: 0 }]);
  });

  it("drops a payment marked test from money in and from the queue", () => {
    const before = buildLedger(ROWS);
    expect(before.payments.filter(isUnresolvedPayment).map((p) => p.payment_id)).toEqual(["pay_usd50"]);
    const after = buildLedger(ROWS, [{ payment_id: "pay_usd50", kind: "test", user_id: null, reason: "Synthetic Whop test", created_at: "2026-10-12T08:00:00Z" }]);
    expect(after.payments.filter(isUnresolvedPayment)).toHaveLength(0);
    expect(computeMoneyIn(after, now).other_currencies).toEqual([]);
  });

  it("uses Vienna calendar days at the midnight boundary", () => {
    // 22:30 UTC on 9 Oct is 00:30 on 10 Oct in Vienna (CEST, UTC+2).
    expect(viennaDay("2026-10-09T22:30:00Z")).toBe("2026-10-10");
    const late = buildLedger([paid("pay_late", "2026-10-31T23:30:00Z", 4900), granted("pay_late", "2026-10-31T23:30:01Z", 4900, U1)]);
    const m = computeMoneyIn(late, new Date("2026-11-01T09:00:00Z"));
    // 31 Oct 23:30 UTC is 1 Nov 00:30 in Vienna (CET after the DST change).
    expect(m.today.gross_cents).toBe(4900);
    expect(m.months.find((x) => x.month === "2026-11")!.gross_cents).toBe(4900);
  });

  it("lists 7 distinct Vienna days and 6 months across DST", () => {
    const days = lastViennaDays(new Date("2026-10-27T10:00:00Z"), 7);
    expect(days).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(lastViennaMonths(new Date("2026-02-10T10:00:00Z"), 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("dates a new payer by the first counted, granted payment", () => {
    const first = firstPaidAtByUser(ledger);
    expect(first.get(U2)).toBe("2026-10-09T21:30:00Z");
    expect(first.has(U3)).toBe(true);
  });
});

describe("paying learners (one definition)", () => {
  const now = new Date("2026-10-11T10:00:00Z");
  const users = new Map([
    [U1, { email: "user-610e28c1@example.com", role: "user", tier: "pro" }],
    [U2, { email: null, role: "user", tier: "pro" }],
    [U3, { email: "user-4eeaf88f@example.com", role: "user", tier: "pro" }],
    ["u4", { email: "fixture@medpruf-test.invalid", role: "user", tier: "pro" }],
    ["u5", { email: "user-3c524757@example.com", role: "user", tier: "pro" }],
  ]);
  const sub = (user_id: string, s: Partial<SubscriptionLike>): SubscriptionLike => ({
    user_id, tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: 1900, expires_at: "2026-11-01T00:00:00Z", ...s,
  });
  const subs: SubscriptionLike[] = [
    sub(U1, {}),
    sub(U1, { expires_at: "2026-12-01T00:00:00Z" }), // stacked: still one person
    sub(U2, { tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: [{ payment_id: "pay_t", amount_cents: 0 }, { payment_id: "pay_r", amount_cents: 1900 }] }),
    sub(U3, {}),
    sub("u4", {}),
    sub("u5", { tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: [{ payment_id: "pay_t5", amount_cents: 0 }] }),
    sub("u6", { payment_provider: "manual" }),
    sub("u7", { expires_at: "2026-10-01T00:00:00Z" }),
  ];

  it("counts people, not rows; converted trials pay; plain trials are apart", () => {
    const c = classifyPayers(subs, users, now);
    expect([...c.paying].sort()).toEqual([U1, U2].sort());
    expect([...c.inTrial]).toEqual(["u5"]);
    expect([...c.staffExcluded].sort()).toEqual([U3, "u4"].sort());
  });

  it("excludes staff and test accounts with one predicate", () => {
    expect(isStaffOrTestAccount({ email: "admin@medpruf.com" })).toBe(true);
    expect(isStaffOrTestAccount({ email: "x@medpruf-test.invalid" })).toBe(true);
    expect(isStaffOrTestAccount({ email: "user-68d44865@example.com" })).toBe(true);
    expect(isStaffOrTestAccount({ email: "someone@example.com" })).toBe(true);
    expect(isStaffOrTestAccount({ role: "admin", email: null })).toBe(true);
    expect(isStaffOrTestAccount({ email: "user-0eba670f@example.com" })).toBe(false);
    expect(isStaffOrTestAccount({ email: null })).toBe(false);
  });
});

describe("payment health (ADM-02 A, UX-ADM-04)", () => {
  const now = new Date("2026-10-11T10:00:00Z");
  const ledger = buildLedger(ROWS);
  const probe = (at: string) => ({ result: "sig_invalid", error: "no recognized auth header", received_at: at });
  const mismatch = (at: string) => ({ result: "sig_invalid", error: "verification failed despite webhook-secret/svix header (likely WHOP_WEBHOOK_SECRET mismatch)", received_at: at });
  const processed = (at: string) => ({ result: "processed", error: null, received_at: at });

  it("never raises an ALARM for unsigned probes while deliveries process", () => {
    const h = computePaymentHealth([probe("2026-10-10T12:00:00Z"), probe("2026-10-09T08:00:00Z"), probe("2026-10-05T08:00:00Z"), processed("2026-10-09T21:30:00Z")], ledger, now);
    expect(h.level).not.toBe("alarm");
    expect(h.probes_7d).toBe(3);
    expect(h.probes_24h).toBe(1);
    expect(h.diagnosis).not.toMatch(/ALARM/);
    // The old unmapped USD 50 payment keeps the queue open, but is not a 24h failure.
    expect(h.level).toBe("attention");
    expect(h.unresolved_total).toBe(1);
    expect(h.failures_24h).toBe(0);
  });

  it("raises an ALARM only when signed-looking rejections exist and nothing processed in 7 days", () => {
    const h = computePaymentHealth([mismatch("2026-10-11T09:00:00Z"), mismatch("2026-10-08T09:00:00Z")], buildLedger([]), now);
    expect(h.level).toBe("alarm");
    expect(h.failures_24h).toBe(1);
    const mixed = computePaymentHealth([mismatch("2026-10-11T09:00:00Z"), processed("2026-10-10T09:00:00Z")], buildLedger([]), now);
    expect(mixed.level).toBe("attention");
  });

  it("raises an ALARM on server errors with nothing processed (secret unset), and the 24h count sees them", () => {
    const err = (at: string) => ({ result: "other_error", error: "WHOP_WEBHOOK_SECRET not configured", received_at: at });
    const h = computePaymentHealth([err("2026-10-11T09:00:00Z"), err("2026-10-09T09:00:00Z")], buildLedger([]), now);
    expect(h.level).toBe("alarm");
    expect(h.server_errors_7d).toBe(2);
    expect(h.failures_24h).toBe(1);
  });

  it("never says ok when signed deliveries arrived and none processed", () => {
    const h = computePaymentHealth([{ result: "user_not_found", error: null, received_at: "2026-10-10T09:00:00Z" }], buildLedger([]), now);
    expect(h.level).toBe("attention");
  });

  it("puts a paid payment known only from a failed grant into the queue", () => {
    const l = buildLedger([row({ event: "grant_failed", payment_id: "pay_verify_only", amount_cents: 4900, reason: "unmapped", created_at: "2026-10-10T09:00:00Z" }), row({ event: "grant_failed", payment_id: "pay_release", amount_cents: null, reason: "db_error", created_at: "2026-10-10T09:00:00Z" })]);
    expect(l.payments.filter(isUnresolvedPayment).map((p) => p.payment_id)).toEqual(["pay_verify_only"]);
  });

  it("is quiet, not green, with no delivery and nothing unresolved", () => {
    const h = computePaymentHealth([], buildLedger([]), now);
    expect(h.level).toBe("quiet");
    expect(h.failures_24h).toBe(0);
  });

  it("counts a fresh unresolved payment as a 24h failure", () => {
    const fresh = buildLedger([paid("pay_new", "2026-10-11T08:00:00Z", 1900, { matched: false })]);
    const h = computePaymentHealth([processed("2026-10-11T08:00:00Z")], fresh, now);
    expect(h.failures_24h).toBe(1);
    expect(h.level).toBe("attention");
  });

  it("does not count a refund as an unmatched payment", () => {
    expect(ledger.payments.find((p) => p.payment_id === "r_1")).toBeUndefined();
    expect(ledger.refunds).toHaveLength(1);
  });
});
