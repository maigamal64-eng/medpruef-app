// a40 (MUX-98): mentor revenue next to cost. Shared money rules, refunds on their
// own day, Pro-included cost from lots, margin only with a verified fee model.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLedger, type LedgerEventRow } from "@/lib/admin/money-rules";
import {
  computeMentorRevenue,
  marginTone,
  mentorCostInWindow,
  mentorPaymentIds,
} from "@/lib/mentor/admin/revenue";
import { MENTOR_FINANCE_MODEL, type MentorFinanceModel } from "@/lib/mentor/finance";

const NOW = new Date("2026-11-20T10:00:00Z");
let seq = 0;
function row(p: Partial<LedgerEventRow>): LedgerEventRow {
  return {
    id: ++seq, event: "grant_succeeded", provider: "whop", user_id: "u1", tier: null, plan_id: null,
    payment_id: null, amount_cents: null, currency: "EUR", reason: null, matched: true, metadata: null,
    created_at: "2026-11-10T09:00:00Z", ...p,
  };
}
const mentor = (payment_id: string, amount_cents: number | null, created_at: string, extra: Partial<LedgerEventRow> = {}) =>
  row({ payment_id, amount_cents, created_at, metadata: { kind: "mentor_credits" }, ...extra });

const base = {
  planPackages: new Map([["plan_basis", "mentor_basis"], ["plan_plus", "mentor_plus"]]),
  includedLots: [] as Array<{ spent_micro: number; starts_at: string }>,
  revoked: [] as Array<{ payment_id: string; at: string }>,
  costMicro: 1_000_000 as number | null,
  now: NOW,
};

describe("mentorPaymentIds", () => {
  it("recognises mentor payments by metadata kind or a mentor plan id, not Pro payments", () => {
    const rows = [
      mentor("pay_m1", 490, "2026-11-10T09:00:00Z"),
      row({ payment_id: "pay_plan", plan_id: "plan_plus", amount_cents: 990 }),
      row({ payment_id: "pay_pro", plan_id: "plan_pro_monthly", amount_cents: 1900, tier: "pro" }),
      row({ payment_id: null, metadata: { kind: "mentor_credits" } }),
    ];
    expect([...mentorPaymentIds(rows, new Set(["plan_plus"]))].sort()).toEqual(["pay_m1", "pay_plan"]);
  });
});

describe("computeMentorRevenue", () => {
  it("sums gross per currency inside the last 30 Vienna days and groups by package", () => {
    const rows = [
      mentor("pay_a", 490, "2026-11-01T09:00:00Z", { plan_id: "plan_basis" }),
      mentor("pay_b", 990, "2026-11-19T09:00:00Z", { plan_id: "plan_plus" }),
      mentor("pay_old", 990, "2026-10-01T09:00:00Z", { plan_id: "plan_plus" }),
      mentor("pay_usd", 1000, "2026-11-15T09:00:00Z", { currency: "USD" }),
      row({ payment_id: "pay_pro", amount_cents: 1900, created_at: "2026-11-15T09:00:00Z" }),
    ];
    const r = computeMentorRevenue({ ...base, ledger: buildLedger(rows), mentorIds: mentorPaymentIds(rows, new Set()) });
    expect(r.by_currency).toEqual([
      { currency: "EUR", gross_cents: 1480, refunded_cents: 0, net_cents: 1480, payments: 2, refunds: 0 },
      { currency: "USD", gross_cents: 1000, refunded_cents: 0, net_cents: 1000, payments: 1, refunds: 0 },
    ]);
    expect(r.by_package).toEqual([
      { package_id: "mentor_basis", currency: "EUR", gross_cents: 490, payments: 1 },
      { package_id: "mentor_plus", currency: "EUR", gross_cents: 990, payments: 1 },
      { package_id: "other", currency: "USD", gross_cents: 1000, payments: 1 },
    ]);
    expect(r.window_days).toBe(30);
    expect(r.since).toBe("2026-10-22");
  });

  it("uses the highest amount Whop reported for one payment id (gross), never double counts", () => {
    const rows = [mentor("pay_a", 473, "2026-11-10T09:00:00Z"), mentor("pay_a", 490, "2026-11-10T09:01:00Z", { event: "webhook_received", metadata: { kind: "mentor_credits", whop_event: "payment.succeeded" } })];
    const r = computeMentorRevenue({ ...base, ledger: buildLedger(rows), mentorIds: mentorPaymentIds(rows, new Set()) });
    expect(r.by_currency[0]).toMatchObject({ gross_cents: 490, payments: 1 });
  });

  it("subtracts a clawback on its own day, once per payment, even for a payment paid before the window", () => {
    const rows = [mentor("pay_old", 990, "2026-10-01T09:00:00Z"), mentor("pay_new", 490, "2026-11-10T09:00:00Z")];
    const r = computeMentorRevenue({
      ...base,
      ledger: buildLedger(rows),
      mentorIds: mentorPaymentIds(rows, new Set()),
      revoked: [
        { payment_id: "pay_old", at: "2026-11-12T09:00:00Z" },
        { payment_id: "pay_old", at: "2026-11-12T09:00:05Z" },
        { payment_id: "pay_new", at: "2026-10-01T09:00:00Z" },
        { payment_id: "pay_ghost", at: "2026-11-13T09:00:00Z" },
      ],
    });
    expect(r.by_currency[0]).toEqual({ currency: "EUR", gross_cents: 490, refunded_cents: 990, net_cents: -500, payments: 1, refunds: 1 });
    expect(r.refunds_without_amount).toBe(1);
  });

  it("keeps payments with no amount out of the totals and says so", () => {
    const rows = [mentor("pay_x", null, "2026-11-10T09:00:00Z")];
    const r = computeMentorRevenue({ ...base, ledger: buildLedger(rows), mentorIds: mentorPaymentIds(rows, new Set()) });
    expect(r.by_currency).toEqual([]);
    expect(r.payments_without_amount).toBe(1);
  });

  it("excludes payments resolved as test or not ours", () => {
    const rows = [mentor("pay_t", 490, "2026-11-10T09:00:00Z")];
    const ledger = buildLedger(rows, [{ payment_id: "pay_t", kind: "test", user_id: null, reason: "staff test", created_at: "2026-11-10T10:00:00Z" }]);
    expect(computeMentorRevenue({ ...base, ledger, mentorIds: new Set(["pay_t"]) }).by_currency).toEqual([]);
  });

  it("Pro-included cost counts lots that started in the window", () => {
    const r = computeMentorRevenue({
      ...base,
      ledger: buildLedger([]),
      mentorIds: new Set(),
      includedLots: [
        { spent_micro: 120_000, starts_at: "2026-11-02T00:00:00Z" },
        { spent_micro: 30_000, starts_at: "2026-11-19T00:00:00Z" },
        { spent_micro: 999_999, starts_at: "2026-10-01T00:00:00Z" },
      ],
    });
    expect(r.pro_included).toEqual({ cost_micro: 150_000, lots: 2 });
  });

  it("never shows a margin while the fee model is unverified (pick-mentor-cost-assumption A, no assumed fee)", () => {
    expect(MENTOR_FINANCE_MODEL.whopFee).toBeNull();
    const rows = [mentor("pay_a", 490, "2026-11-10T09:00:00Z")];
    const r = computeMentorRevenue({ ...base, ledger: buildLedger(rows), mentorIds: new Set(["pay_a"]) });
    expect(r.margin.available).toBe(false);
    if (!r.margin.available) expect(r.margin.reason).toMatch(/not verified/);
  });

  it("computes margin from verified evidence only, in EUR, with the fee kept on a refunded charge", () => {
    const finance: MentorFinanceModel = {
      creditMicroUsd: 5000,
      whopFee: { fixedEurCents: 60, percent: 3.4, verifiedAt: "2026-11-01", evidence: "fixture" },
      usdPerEur: { value: 1.1, verifiedAt: "2026-11-01", evidence: "fixture" },
    };
    const rows = [mentor("pay_a", 990, "2026-11-10T09:00:00Z"), mentor("pay_b", 990, "2026-11-11T09:00:00Z")];
    const r = computeMentorRevenue({ ...base, finance, costMicro: 2_200_000, ledger: buildLedger(rows), mentorIds: new Set(["pay_a", "pay_b"]), revoked: [{ payment_id: "pay_b", at: "2026-11-12T09:00:00Z" }] });
    // net 990; fee 2 x (60 + 33.66) = 187; cost USD 2.20 / 1.1 = EUR 2.00 = 200 cents.
    expect(r.margin).toEqual({ available: true, net_eur_cents: 990, fee_eur_cents: 187, cost_eur_cents: 200, margin_eur_cents: 603, margin_pct: 60.9, tone: "ok" });
    const usd = computeMentorRevenue({ ...base, finance, ledger: buildLedger([mentor("pay_u", 990, "2026-11-10T09:00:00Z", { currency: "USD" })]), mentorIds: new Set(["pay_u"]) });
    expect(usd.margin.available).toBe(false);
    const noCost = computeMentorRevenue({ ...base, finance, costMicro: null, ledger: buildLedger(rows), mentorIds: new Set(["pay_a"]) });
    expect(noCost.margin.available).toBe(false);
  });

  it("margin tone: amber under 50 percent, red under 30 percent", () => {
    expect(marginTone(71)).toBe("ok");
    expect(marginTone(49.9)).toBe("warn");
    expect(marginTone(29.9)).toBe("danger");
    expect(marginTone(null)).toBe("warn");
  });

  it("cost window sums the Vienna rollup days inside the window only", () => {
    expect(mentorCostInWindow([{ day: "2026-11-20", mentor_micro: 5 }, { day: "2026-10-22", mentor_micro: "7" }, { day: "2026-10-21", mentor_micro: 100 }], NOW)).toBe(12);
  });
});

const h = vi.hoisted(() => ({ ledgerRows: vi.fn(), resolutions: vi.fn() }));
vi.mock("@/lib/admin/moneyMetrics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/moneyMetrics")>("@/lib/admin/moneyMetrics");
  return { ...actual, loadLedgerRows: h.ledgerRows, loadResolutions: h.resolutions };
});
import { loadMentorRevenue, mentorPlanPackages } from "@/lib/mentor/admin/revenue-load";
import { stubClient } from "./stub-client";

describe("loadMentorRevenue", () => {
  beforeEach(() => {
    h.ledgerRows.mockReset();
    h.resolutions.mockReset();
    h.resolutions.mockResolvedValue({ rows: [], available: true });
  });

  it("maps configured mentor plans to packages and ignores blanks", () => {
    expect([...mentorPlanPackages({ WHOP_PLAN_MENTOR_BASIS: " plan_b ", WHOP_PLAN_MENTOR_PLUS: "" })]).toEqual([["plan_b", "mentor_basis"]]);
  });

  it("reads clawbacks, tombstones, included lots and the Vienna rollup, paging past 1000 lots", async () => {
    h.ledgerRows.mockResolvedValue([mentor("pay_a", 490, "2026-11-10T09:00:00Z"), mentor("pay_b", 990, "2026-11-11T09:00:00Z")]);
    const lots = Array.from({ length: 1500 }, (_, i) => ({ source: "pro_included", status: "live", spent_micro: 100, starts_at: `2026-11-1${i % 9}T00:00:00Z`, whop_payment_id: null, updated_at: "2026-11-10T00:00:00Z" }));
    lots.push({ source: "whop_payment", status: "clawed_back", spent_micro: 0, starts_at: "2026-11-10T00:00:00Z", whop_payment_id: "pay_a" as never, updated_at: "2026-11-15T00:00:00Z" });
    const { client } = stubClient({
      tables: {
        ai_credit_lot: lots,
        ai_mentor_revoked_payment: [{ payment_id: "pay_b", created_at: "2026-11-16T00:00:00Z" }],
        ai_mentor_daily_cost: [{ timezone: "Europe/Vienna", day: "2026-11-10", mentor_micro: 400 }, { timezone: "UTC", day: "2026-11-10", mentor_micro: 999 }],
      },
    });
    const r = await loadMentorRevenue(client, NOW, {});
    expect(r.pro_included).toEqual({ cost_micro: 150_000, lots: 1500 });
    expect(r.by_currency[0]).toMatchObject({ gross_cents: 1480, refunded_cents: 1480, net_cents: 0, refunds: 2 });
    expect(r.cost_micro).toBe(400);
  });

  it("an unreadable rollup leaves cost unknown, never zero", async () => {
    h.ledgerRows.mockResolvedValue([]);
    const { client } = stubClient({ tables: { ai_credit_lot: [], ai_mentor_revoked_payment: [] }, errors: { ai_mentor_daily_cost: { code: "42P01" } } });
    expect((await loadMentorRevenue(client, NOW, {})).cost_micro).toBeNull();
  });

  it("a failed lot read rejects instead of reporting zero", async () => {
    h.ledgerRows.mockResolvedValue([]);
    const { client } = stubClient({ tables: { ai_mentor_revoked_payment: [], ai_mentor_daily_cost: [] }, errors: { ai_credit_lot: { code: "XX000", message: "boom" } } });
    await expect(loadMentorRevenue(client, NOW, {})).rejects.toBeTruthy();
  });
});
