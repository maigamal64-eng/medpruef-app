import { describe, expect, it } from "vitest";
import { deriveFreshness, viennaClock } from "@/app/admin/_components/freshness";
import { ADMIN_NAV, INBOX_KEYS, SHORTCUT_ALIASES, adminDocumentTitle, navEntryFor, sumCounts } from "@/app/admin/_components/admin-nav";
import { parseInboxBody } from "@/app/admin/_components/admin-chrome";
import { computeTodayMoneyNeeds, viennaStartOfDay, waitedFor } from "@/lib/admin/today-rules";
import { viennaDay, type Ledger, type LedgerPayment, type SubscriptionLike } from "@/lib/admin/money-rules";

const NOW = Date.parse("2026-10-12T10:00:00Z");

describe("a18 freshness rule (UX-ADM-31, ADM-20 A)", () => {
  it("is NEAR-LIVE under 60 s, CACHED after, and never LIVE without realtime", () => {
    expect(deriveFreshness({ loading: false, updatedAt: NOW - 30_000 }, NOW).badge).toBe("near-live");
    expect(deriveFreshness({ loading: false, updatedAt: NOW - 61_000 }, NOW).badge).toBe("cached");
    expect(deriveFreshness({ loading: false, updatedAt: NOW }, NOW).badge).not.toBe("live");
    expect(deriveFreshness({ loading: false, updatedAt: NOW }, NOW, { realtimeConnected: true }).badge).toBe("live");
  });

  it("a failed load is DISCONNECTED with the last good time, even with old data", () => {
    const v = deriveFreshness({ loading: false, error: "boom", updatedAt: NOW - 5 * 60_000 }, NOW);
    expect(v.badge).toBe("disconnected");
    expect(v.stamp).toBe(`Last good ${viennaClock(NOW - 5 * 60_000)}`);
    expect(deriveFreshness({ loading: false, error: "boom", updatedAt: null }, NOW).stamp).toBe("Not loaded");
  });

  it("shows no badge before the first load and Updated hh:mm in Vienna time after", () => {
    expect(deriveFreshness({ loading: true, updatedAt: null }, NOW)).toEqual({ badge: null, stamp: "Loading", stale: false });
    expect(deriveFreshness({ loading: false, updatedAt: NOW }, NOW).stamp).toBe("Updated 12:00");
  });

  it("turns amber after three poll intervals", () => {
    expect(deriveFreshness({ loading: false, updatedAt: NOW - 179_000 }, NOW).stale).toBe(false);
    expect(deriveFreshness({ loading: false, updatedAt: NOW - 181_000 }, NOW).stale).toBe(true);
    expect(deriveFreshness({ loading: false, updatedAt: NOW - 181_000 }, NOW, { pollMs: 120_000 }).stale).toBe(false);
  });
});

describe("a18 admin menu (ADM-11 A)", () => {
  const PREVIOUS_ROUTES = [
    "/admin/overview", "/admin/flagged", "/admin/note-reports", "/admin/feedback", "/admin/ops", "/admin/growth",
    "/admin/users", "/admin/mentor", "/admin/payments", "/admin/subscriptions", "/admin/referrals", "/admin/waitlist",
    "/admin/questions", "/admin/media", "/admin/flags", "/admin/puyp", "/admin/crons", "/admin/deploys",
    "/admin/errors", "/admin/audit", "/admin/env", "/admin/access",
  ];
  const hrefs = ADMIN_NAV.flatMap((s) => [s.href, ...s.items.map((i) => i.href)]).filter(Boolean);

  it("groups the menu around the jobs, in order", () => {
    expect(ADMIN_NAV.map((s) => s.label)).toEqual(["Today", "Inbox", "Learners", "Money", "Content", "Growth", "System"]);
    expect(ADMIN_NAV.find((s) => s.key === "inbox")!.items.map((i) => i.label)).toEqual(["Feedback", "Question reports", "Note reports", "PUYP proofs", "Ops approvals"]);
  });

  it("keeps every route that was in the menu before, once each", () => {
    for (const route of PREVIOUS_ROUTES) expect(hrefs).toContain(route);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).not.toContain("/admin/system");
  });

  it("has unique shortcuts and keeps the old g o, g r, g w working", () => {
    const keys = ADMIN_NAV.map((s) => s.shortcut);
    expect(new Set(keys).size).toBe(keys.length);
    for (const alias of Object.keys(SHORTCUT_ALIASES)) expect(keys).not.toContain(alias);
    expect(SHORTCUT_ALIASES).toEqual({ o: "today", r: "money", w: "growth" });
  });

  it("finds the page entry for nested routes and query strings", () => {
    expect(navEntryFor("/admin/users/00000000-0000-4000-8000-000000000001")?.item?.label).toBe("Learners");
    expect(navEntryFor("/admin/overview")?.section.key).toBe("today");
    expect(navEntryFor("/admin/feedbackx")).toBeNull();
  });

  it("badges: a failed key makes the badge unknown, an unoffered null is skipped", () => {
    expect(sumCounts({ feedback: 3, question_reports: 2 }, ["feedback", "question_reports"])).toEqual({ total: 5, unknown: false });
    expect(sumCounts({ feedback: 3, ops_actions: null }, ["feedback", "ops_actions"])).toEqual({ total: 3, unknown: false });
    expect(sumCounts({ feedback: null }, ["feedback"], ["feedback"])).toEqual({ total: 0, unknown: true });
  });

  it("tab titles lead with a positive count only", () => {
    expect(adminDocumentTitle("Feedback", 4)).toBe("(4) Feedback · MedPrüf Admin");
    expect(adminDocumentTitle("Feedback", 0)).toBe("Feedback · MedPrüf Admin");
    expect(adminDocumentTitle("Today", null)).toBe("Today · MedPrüf Admin");
    expect(adminDocumentTitle("Feedback", 120)).toBe("(99+) Feedback · MedPrüf Admin");
  });

  it("parses the inbox body; malformed counts fail closed", () => {
    const parsed = parseInboxBody({ feedback: 2, question_reports: -1, puyp: "3", oldest: { feedback: "2026-10-01T00:00:00Z" }, failed: ["note_reports"] });
    expect(parsed.counts.feedback).toBe(2);
    expect(parsed.counts.question_reports).toBeNull();
    expect(parsed.counts.puyp).toBeNull();
    expect(parsed.oldest.feedback).toBe("2026-10-01T00:00:00Z");
    expect([...parsed.failed]).toEqual(["note_reports"]);
    expect([...parseInboxBody(null).failed].sort()).toEqual([...INBOX_KEYS].sort());
  });
});

describe("a18 Today money rows", () => {
  const pay = (over: Partial<LedgerPayment>): LedgerPayment => ({
    payment_id: "pay_x", provider: "whop", currency: "EUR", paid_at: "2026-10-01T10:00:00Z", gross_cents: 1900, net_cents: null,
    granted: true, user_id: null, plan_id: "plan_one_time", ...over,
  } as LedgerPayment);
  const sub = (over: Partial<SubscriptionLike>): SubscriptionLike => ({
    user_id: "u1", tier: "three_month", status: "active", payment_provider: "whop", amount_cents: 4900,
    provider_payment_id: "pay_a", expires_at: "2026-10-15T00:00:00Z", ...over,
  });

  it("counts unresolved payments with the oldest first and their currencies", () => {
    const ledger: Ledger = {
      payments: [
        pay({ payment_id: "p1", granted: false, paid_at: "2026-10-09T00:00:00Z", currency: "USD", gross_cents: 5000 }),
        pay({ payment_id: "p2", granted: false, paid_at: "2026-09-20T00:00:00Z" }),
        pay({ payment_id: "p3", granted: true }),
        pay({ payment_id: "p4", granted: false, gross_cents: 0 }),
      ],
      refunds: [],
    };
    const needs = computeTodayMoneyNeeds(ledger, [], new Set(), new Date(NOW), new Map());
    expect(needs.unresolved).toEqual({ count: 2, oldest_at: "2026-09-20T00:00:00Z", currencies: ["EUR", "USD"] });
  });

  it("counts refunds of the last 7 days per currency", () => {
    const ledger: Ledger = {
      payments: [],
      refunds: [
        { refund_id: "r1", provider: "whop", currency: "EUR", refunded_at: "2026-10-10T00:00:00Z", amount_cents: 1900, kind: "refund" },
        { refund_id: "r2", provider: "whop", currency: "EUR", refunded_at: "2026-09-01T00:00:00Z", amount_cents: 4900, kind: "refund" },
        { refund_id: "r3", provider: "whop", currency: "EUR", refunded_at: "2026-10-11T00:00:00Z", amount_cents: null, kind: "refund" },
      ],
    };
    // An unknown amount is reported apart, never added as 0.
    expect(computeTodayMoneyNeeds(ledger, [], new Set(), new Date(NOW), new Map()).refunds_7d).toEqual({ count: 2, by_currency: [{ currency: "EUR", cents: 1900 }], unknown_amounts: 1 });
  });

  it("ending within 7 days skips renewing, open-ended and later rows", () => {
    const subs = [
      sub({ user_id: "ends", expires_at: "2026-10-15T00:00:00Z" }),
      sub({ user_id: "later", expires_at: "2026-11-30T00:00:00Z" }),
      sub({ user_id: "open", expires_at: null }),
      sub({ user_id: "ends2", expires_at: "2026-10-13T00:00:00Z" }),
    ];
    const needs = computeTodayMoneyNeeds({ payments: [], refunds: [] }, subs, new Set(["ends", "later", "open", "ends2"]), new Date(NOW), new Map());
    expect(needs.ending_7d).toEqual({ count: 2, soonest_days: 1 });
  });

  it("waitedFor reads hours, then days", () => {
    expect(waitedFor(new Date(NOW - 20 * 60_000).toISOString(), NOW)).toBe("under an hour");
    expect(waitedFor(new Date(NOW - 5 * 3_600_000).toISOString(), NOW)).toBe("5 hours");
    expect(waitedFor(new Date(NOW - 4 * 86_400_000).toISOString(), NOW)).toBe("4 days");
    expect(waitedFor(null, NOW)).toBeNull();
  });

  it("starts the day at Vienna midnight in summer and winter time", () => {
    expect(viennaStartOfDay(new Date("2026-10-12T10:00:00Z"), viennaDay).toISOString()).toBe("2026-10-11T22:00:00.000Z");
    expect(viennaStartOfDay(new Date("2026-12-01T23:30:00Z"), viennaDay).toISOString()).toBe("2026-12-01T23:00:00.000Z");
  });
});
