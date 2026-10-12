import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SYSTEM_EVENT_PREFIXES, SYSTEM_EVENT_TYPES, activityStatus, isSystemEvent, latestStamp } from "@/lib/admin/learner-activity";
import { computeLearnerStudyStats, streaksFromDays } from "@/lib/admin/learner-stats";
import { describeLearnerAccess, learnerMoneyVerdict, type LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { classifyAuditRow, summarizeAuditPayload } from "@/lib/admin/learner-history";
import { isMissingFunction, readSegment } from "@/lib/admin/learner-segments";

const NOW = new Date("2026-10-12T10:00:00Z");

describe("learner activity (ADM-07 A)", () => {
  it("system events never count, learner events do", () => {
    for (const t of ["whop_subscription_activated", "nowpayments_webhook_received", "cron_trial_reminder_heartbeat", "trial_reminder_email_sent", "puyp_extension_granted", "", null]) {
      expect(isSystemEvent(t)).toBe(true);
    }
    for (const t of ["page_view", "question_answer", "ai_chat_completed", "login", "refund_requested", "referral_code_copied"]) {
      expect(isSystemEvent(t)).toBe(false);
    }
  });

  it("the SQL predicate lists exactly the same prefixes and types", () => {
    const sql = readFileSync(resolve("supabase/migrations/20261203090000_a16_admin_people.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.admin_is_learner_event"), sql.indexOf("REVOKE ALL ON FUNCTION public.admin_is_learner_event"));
    const prefixes = [...fn.matchAll(/starts_with\(p_event_type, '([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(prefixes).toEqual([...SYSTEM_EVENT_PREFIXES].sort());
    const list = fn.slice(fn.indexOf("NOT IN ("), fn.indexOf(")", fn.indexOf("NOT IN (")));
    const types = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(types).toEqual([...SYSTEM_EVENT_TYPES].sort());
  });

  it("latest stamp ignores junk and status bands follow it", () => {
    expect(latestStamp([null, "nope", "2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z"])).toBe("2026-10-11T00:00:00.000Z");
    expect(latestStamp([undefined, null])).toBeNull();
    expect(activityStatus(null, NOW)).toBe("no_activity");
    expect(activityStatus("2026-10-12T00:00:00Z", NOW)).toBe("active");
    expect(activityStatus("2026-09-01T00:00:00Z", NOW)).toBe("dormant");
  });
});

describe("learner study stats", () => {
  const answer = (created_at: string, ok = true, question_id = 1) => ({ question_id, is_correct: ok, time_spent_ms: 1000, xp_earned: 5, created_at });

  it("counts every row (no 1000-row cut) on Vienna days", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => answer(new Date(NOW.getTime() - i * 60_000).toISOString(), i % 2 === 0));
    const stats = computeLearnerStudyStats(rows, new Map([[1, { topic: "Kardiologie", exam_type: "kenntnispruefung" }]]), NOW);
    expect(stats.answersLogged).toBe(2500);
    expect(stats.accuracy).toBe(50);
    expect(stats.topics[0]).toMatchObject({ topic: "Kardiologie", answered: 2500 });
  });

  it("an answer at 23:30 UTC belongs to the next Vienna day", () => {
    const stats = computeLearnerStudyStats([answer("2026-10-11T23:30:00Z")], new Map(), NOW);
    expect(stats.heatmap.at(-1)).toEqual({ date: "2026-10-12", count: 1 });
  });

  it("streak comes from answer days and drops to 0 after a missed day", () => {
    expect(streaksFromDays(new Set(["2026-10-10", "2026-10-11", "2026-10-12"]), NOW)).toEqual({ current: 3, longest: 3 });
    expect(streaksFromDays(new Set(["2026-10-09", "2026-10-10", "2026-10-11"]), NOW)).toEqual({ current: 3, longest: 3 });
    expect(streaksFromDays(new Set(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-10"]), NOW)).toEqual({ current: 0, longest: 4 });
  });
});

describe("paid verdict (no phantom payers)", () => {
  const row = (over: Partial<LearnerSubscriptionRow>): LearnerSubscriptionRow => ({
    tier: "premium_pass_guaranteed", status: "cancelled", payment_provider: "nowpayments", amount_cents: 11400, currency: "EUR", expires_at: null, ...over,
  });

  it("a cancelled unpaid crypto invoice is not paid", () => {
    const v = learnerMoneyVerdict([row({})]);
    expect(v.isPayer).toBe(false);
    expect(v.paidByCurrency).toEqual({});
    expect(v.unpaidInvoiceRows).toBe(1);
  });

  it("payment references count, refunds are apart, currencies never mix", () => {
    const v = learnerMoneyVerdict([
      row({ status: "expired", crypto_tx_hash: "0xabc" }),
      row({ status: "active", payment_provider: "whop", amount_cents: 1772, granted_payment_ids: [{ payment_id: "pay_1", amount_cents: 1900 }] }),
      row({ status: "refunded", payment_provider: "whop", currency: "usd", amount_cents: 5000, provider_payment_id: "pay_2" }),
      row({ status: "pending", provider_payment_id: "pay_3" }),
    ]);
    expect(v.isPayer).toBe(true);
    expect(v.paidByCurrency).toEqual({ EUR: 11400 + 1900 });
    expect(v.refundedByCurrency).toEqual({ USD: 5000 });
  });
});

describe("Access strip", () => {
  const base = { role: "user", monthsForTier: () => 1, grants: [], subscriptions: [] as LearnerSubscriptionRow[] };

  it("names the subscription that explains the end date", () => {
    const a = describeLearnerAccess({
      ...base, tier: "pro", tier_expires_at: "2026-10-30T10:00:00Z",
      subscriptions: [{ tier: "notes_pro_trial", status: "active", payment_provider: "whop", amount_cents: 0, expires_at: "2026-10-30T10:00:20Z" }],
    }, NOW);
    expect(a).toMatchObject({ state: "pro", source: "subscription", renewal: "auto_renews" });
    expect(a.sourceLabel).toBe("Whop, Trial, then monthly, renews");
  });

  it("an audited grant explains it next, then 'set outside admin'", () => {
    const grant = { actor_email: "user-b7e46e80@example.com", created_at: "2026-10-01T00:00:00Z", days: 30, reason: "Support", new_expiry: "2026-10-31T00:00:00Z" };
    const g = describeLearnerAccess({ ...base, tier: "pro", tier_expires_at: "2026-10-31T00:00:00Z", grants: [grant] }, NOW);
    expect(g).toMatchObject({ source: "admin_grant", sourceLabel: "Admin grant by user-b7e46e80@example.com, 30 days" });
    const o = describeLearnerAccess({ ...base, tier: "pro", tier_expires_at: "2026-11-30T00:00:00Z", grants: [grant] }, NOW);
    expect(o.source).toBe("outside_admin");
  });

  it("free, ended and admin accounts", () => {
    expect(describeLearnerAccess({ ...base, tier: "free", tier_expires_at: null }, NOW).state).toBe("free");
    expect(describeLearnerAccess({ ...base, tier: "pro", tier_expires_at: "2026-10-01T00:00:00Z" }, NOW).state).toBe("ended");
    expect(describeLearnerAccess({ ...base, role: "admin", tier: "admin", tier_expires_at: null }, NOW).state).toBe("admin_account");
  });
});

describe("audit categories and summaries (ADM-15 A)", () => {
  it("every row lands in exactly one bucket", () => {
    expect(classifyAuditRow("grant_free_access", "user")).toBe("people");
    expect(classifyAuditRow("bulk_approve_puyp", null)).toBe("people");
    expect(classifyAuditRow("revert_question_edit", "question")).toBe("content");
    expect(classifyAuditRow("update_feedback_status", null)).toBe("content");
    expect(classifyAuditRow("nowpayments_webhook_self_test", null)).toBe("people");
    expect(classifyAuditRow("env_read", null)).toBe("system");
    expect(classifyAuditRow(null, null)).toBe("system");
  });

  it("summaries put the reason first and hide money without revenue.read", () => {
    const payload = { reason: "Goodwill", days: 7, new_expiry: "2026-10-19T00:00:00Z", target_email: "user-65abd062@example.com" };
    expect(summarizeAuditPayload("grant_free_access", payload, { revenue: true })).toBe("Reason: Goodwill · 7 days · until 2026-10-19");
    expect(summarizeAuditPayload("grant_free_access", payload, { revenue: false })).toBe("Reason: Goodwill · 7 days");
    expect(summarizeAuditPayload("x", { applied_fields: ["email"] }, { revenue: false })).toBe("Changed email");
  });
});

describe("segments helpers", () => {
  it("reads only known segments and spots missing functions", () => {
    expect(readSegment("never_answered")).toBe("never_answered");
    expect(readSegment("everyone")).toBe("all");
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
  });
});
