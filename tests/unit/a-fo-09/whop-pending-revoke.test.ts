/**
 * a-fo-09: Whop ordering safety. A refund or dispute that reaches the webhook
 * before its payment.succeeded is stored as a pending revoke; the grant is
 * then withheld and recorded once. Ledger rows are written with their error
 * read, and a failed one is completed on Whop's retry without a second grant.
 * Stateful in-memory database; WHOP_PENDING_REVOKE gates every new branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ handler: (() => ({})) as (call: FakeCall) => FakeResult, mail: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.mail }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => false }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase(h.handler).sb }));

import { POST } from "@/app/api/webhooks/whop/route";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { decideGrant } from "@/lib/whop-pending-revoke";
import { useWhopV1Secret, whopSigned } from "../helpers/whop-signed";

const USER = "00000000-0000-4000-8000-0000000000a9";

type Row = Record<string, unknown>;
let subs: Row[];
let events: Row[];
let claims: Map<string, Row>;
let user: Row;
let failEventType: string | null;
let failEventTimes: number;
let failDelete: boolean;
let eventSeq: number;

function value(row: Row, column: string): unknown {
  if (column.includes("->>")) {
    const [col, key] = column.split("->>");
    return String((row[col] as Row | null)?.[key] ?? "");
  }
  return row[column];
}
function contains(haystack: unknown, needle: unknown): boolean {
  if (Array.isArray(needle)) return Array.isArray(haystack) && needle.every((n) => haystack.some((h2) => contains(h2, n)));
  if (needle && typeof needle === "object") {
    return !!haystack && typeof haystack === "object" &&
      Object.entries(needle as Row).every(([k, v]) => contains((haystack as Row)[k], v));
  }
  return haystack === needle;
}
function matches(c: FakeCall, row: Row): boolean {
  return c.filters.every((f) => {
    const v = value(row, f.column);
    switch (f.kind) {
      case "eq": return v === f.value;
      case "neq": return v !== f.value;
      case "in": return (f.value as unknown[]).includes(v);
      case "is": return (v ?? null) === f.value;
      case "contains": return contains(v, f.value);
      case "filter:cs": return contains(v, JSON.parse(f.value as string));
      case "filter:eq": return JSON.stringify(v) === f.value;
      case "like": return typeof v === "string" && v.startsWith(String(f.value).replace(/%$/, ""));
      case "gte": return String(v) >= String(f.value);
      default: return true;
    }
  });
}

function handler(c: FakeCall): FakeResult {
  if (c.table === "user_events") {
    if (c.op === "insert") {
      const p = c.payload as Row;
      if (failEventType === p.event_type && failEventTimes > 0) { failEventTimes--; return { error: { message: "insert timed out" } }; }
      if (p.user_id == null) return { error: { code: "23502", message: "null value in column user_id" } };
      events.push({ id: ++eventSeq, created_at: new Date(Date.now() + eventSeq).toISOString(), ...p });
      return { data: null };
    }
    if (c.op === "select") return { data: events.filter((r) => matches(c, r)).slice(0, c.limit ?? 1000) };
  }
  if (c.table === "processed_webhook_events") {
    if (c.op === "insert") {
      const p = c.payload as Row;
      const id = p.event_id as string;
      if (claims.has(id)) return { error: { code: "23505", message: "duplicate key" } };
      claims.set(id, { event_id: id, provider: "whop", payload: p.payload, processed_at: new Date().toISOString() });
      return { data: { event_id: id } };
    }
    if (c.op === "delete") {
      if (failDelete) return { error: { message: "delete failed" } };
      for (const [k, r] of claims) if (matches(c, r)) claims.delete(k);
      return { data: null };
    }
    if (c.op === "update") {
      for (const r of claims.values()) if (matches(c, r)) Object.assign(r, c.payload as Row);
      return { data: null };
    }
    if (c.op === "select") {
      const rows = [...claims.values()].filter((r) => matches(c, r));
      return { data: c.single ? rows[0] ?? null : rows };
    }
  }
  if (c.table === "subscriptions") {
    if (c.op === "select") return { data: structuredClone(subs.filter((r) => matches(c, r))) };
    if (c.op === "insert") {
      const row = { id: `sub_${subs.length + 1}`, updated_at: new Date().toISOString(), cancelled_at: null, ...(c.payload as Row) };
      subs.push(row);
      return { data: { id: row.id } };
    }
    if (c.op === "update") {
      const changed = subs.filter((r) => matches(c, r));
      changed.forEach((r) => Object.assign(r, c.payload as Row));
      return { data: changed.map((r) => ({ id: r.id })) };
    }
  }
  if (c.table === "users") {
    if (c.op === "select") return { data: matches(c, user) ? structuredClone(user) : null };
    if (c.op === "update") {
      if (!matches(c, user)) return { data: [] };
      Object.assign(user, c.payload as Row);
      return { data: [{ id: USER }] };
    }
  }
  if (c.table === "referrals") return { data: [] };
  return { data: c.single ? null : [] };
}

function deliver(action: string, data: Row) {
  return POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
    method: "POST",
    ...whopSigned(JSON.stringify({ action, data })),
  }));
}
const paid = (id: string) => ({ id, amount: 19, currency: "eur", metadata: { medpruef_user_id: USER, tier: "first_month_19" } });
const refund = (id: string, paymentId: string) => ({ id, payment: { id: paymentId } });
const ofType = (type: string) => events.filter((e) => e.event_type === type);
const hasPro = () => user.tier === "pro";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
  useWhopV1Secret();
  vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "false");
  vi.stubEnv("WHOP_PENDING_REVOKE", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
  vi.clearAllMocks();
  h.mail.mockResolvedValue({ ok: true });
  subs = []; events = []; claims = new Map(); eventSeq = 0;
  failEventType = null; failEventTimes = 0; failDelete = false;
  user = { id: USER, email: "learner@example.com", first_name: "L", language_code: "de", tier: "free", role: "user", tier_expires_at: null, updated_at: "2026-10-01T00:00:00.000Z" };
  h.handler = handler;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("refund or dispute before the grant (flag on)", () => {
  it("refund-then-succeeded: no Pro, no subscription, exactly one whop_revoke_applied_late row", async () => {
    const r1 = await deliver("refund.created", refund("rf_1", "pay_late"));
    expect(r1.status).toBe(200);
    const pending = ofType("whop_revoke_unmatched");
    expect(pending).toHaveLength(1);
    expect(pending[0].user_id).toBe("whop-webhook");
    expect(pending[0].event_data).toMatchObject({ pending_revoke: true, payment_candidates: ["pay_late"], kind: "refunded" });

    const r2 = await deliver("payment.succeeded", paid("pay_late"));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ activated: false, reason: "refunded_before_grant" });
    expect(hasPro()).toBe(false);
    expect(subs).toHaveLength(0);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(1);
    expect(ofType("whop_revoke_applied_late")[0].event_data).toMatchObject({ payment_id: "pay_late", mapped_user_id: USER, granted: false });
    expect(ofType("whop_subscription_activated")).toHaveLength(0);
    expect(vi.mocked(logPaymentEvent).mock.calls.some(([, e]) => e.event === "grant_failed" && e.reason === "refunded_before_grant")).toBe(true);
    expect(vi.mocked(logPaymentEvent).mock.calls.some(([, e]) => e.event === "grant_succeeded")).toBe(false);

    // A later redelivery of the same payment never grants and never adds a row.
    const r3 = await deliver("payment.succeeded", paid("pay_late"));
    expect(r3.status).toBe(200);
    expect(await r3.json()).toMatchObject({ duplicate: true });
    expect(hasPro()).toBe(false);
    expect(subs).toHaveLength(0);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(1);
  });

  it("dispute-then-succeeded: no Pro and exactly one whop_revoke_applied_late row", async () => {
    expect((await deliver("dispute.created", refund("dp_1", "pay_disputed"))).status).toBe(200);
    expect((await deliver("payment.succeeded", paid("pay_disputed"))).status).toBe(200);
    expect(hasPro()).toBe(false);
    expect(subs).toHaveLength(0);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(1);
    expect(ofType("whop_revoke_applied_late")[0].event_data).toMatchObject({ revoke_event: "dispute.created" });
  });

  it("a refund of a renewal the learner's row never held withholds that renewal only", async () => {
    // Active row from an earlier payment; the refund names a later renewal.
    expect((await deliver("payment.succeeded", paid("pay_first"))).status).toBe(200);
    const expiry = subs[0].expires_at;
    const refundRenewal = { ...refund("rf_2", "pay_renewal"), metadata: { medpruef_user_id: USER } };
    expect((await deliver("refund.created", refundRenewal)).status).toBe(200);
    const pending = ofType("whop_revoke_unmatched");
    expect(pending).toHaveLength(1);
    expect(pending[0].event_data).toMatchObject({ reason: "no_granted_payment_match", pending_revoke: true, mapped_user_id: USER });
    expect((await deliver("payment.succeeded", paid("pay_renewal"))).status).toBe(200);
    expect(subs).toHaveLength(1);
    expect(subs[0].expires_at).toBe(expiry);
    expect(hasPro()).toBe(true); // the first payment's paid time is untouched
    expect(ofType("whop_revoke_applied_late")).toHaveLength(1);
  });

  it("a pending revoke of another payment never blocks this grant", async () => {
    await deliver("refund.created", refund("rf_3", "pay_other"));
    const res = await deliver("payment.succeeded", paid("pay_mine"));
    expect(await res.json()).toMatchObject({ activated: true });
    expect(hasPro()).toBe(true);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(0);
  });

  it("a failed applied-late write frees the claim and 503s; the retry withholds and records once", async () => {
    await deliver("refund.created", refund("rf_4", "pay_retry"));
    failEventType = "whop_revoke_applied_late"; failEventTimes = 1;
    const first = await deliver("payment.succeeded", paid("pay_retry"));
    expect(first.status).toBe(503);
    expect(claims.has("pay_retry")).toBe(false);
    const second = await deliver("payment.succeeded", paid("pay_retry"));
    expect(second.status).toBe(200);
    expect(hasPro()).toBe(false);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(1);
  });

  it("an unmatched refund that cannot be stored answers 503 so Whop retries", async () => {
    failEventType = "whop_revoke_unmatched"; failEventTimes = 1;
    expect((await deliver("refund.created", refund("rf_5", "pay_x"))).status).toBe(503);
    expect((await deliver("refund.created", refund("rf_5", "pay_x"))).status).toBe(200);
    expect(ofType("whop_revoke_unmatched")).toHaveLength(1);
  });
});

describe("review follow-ups (flag on)", () => {
  it("one refund's lifecycle (created, updated, payment.refunded) stores one pending row, without the payer email", async () => {
    const withEmail = { ...refund("rf_6", "pay_life"), user: { email: "payer@example.com" } };
    expect((await deliver("refund.created", withEmail)).status).toBe(200);
    expect((await deliver("refund.updated", withEmail)).status).toBe(200);
    expect((await deliver("payment.refunded", { id: "pay_life", user: { email: "payer@example.com" } })).status).toBe(200);
    const pending = ofType("whop_revoke_unmatched");
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending[0])).not.toContain("payer@example.com");
  });

  it("a buyer-less cancellation keeps the old best-effort call (no new pager rows)", async () => {
    expect((await deliver("membership.deactivated", { id: "mem_nobody" })).status).toBe(200);
    expect(ofType("whop_revoke_unmatched")).toHaveLength(0);
  });

  it("a payment already held by a subscription row is flagged granted_before_refund_seen, not 'withheld'", async () => {
    // A first attempt committed after its deadline: the row exists, the claim was released.
    subs.push({ id: "sub_late", user_id: USER, tier: "first_month_19", status: "active", payment_provider: "whop",
      provider_payment_id: "pay_race", granted_payment_ids: [{ payment_id: "pay_race", amount_cents: 1900, added_months: 1, granted_at: "2026-10-22T09:59:00Z" }],
      expires_at: "2026-11-22T09:59:00Z", amount_cents: 1900, started_at: "2026-10-22T09:59:00Z", whop_membership_id: null, updated_at: "2026-10-22T09:59:00Z" });
    events.push({ id: ++eventSeq, user_id: "whop-webhook", event_type: "whop_revoke_unmatched", created_at: "2026-10-22T09:59:30Z",
      event_data: { event: "refund.created", kind: "refunded", pending_revoke: true, payment_candidates: ["pay_race"], payment_id: "pay_race" } });
    expect((await deliver("payment.succeeded", paid("pay_race"))).status).toBe(200);
    const late = ofType("whop_revoke_applied_late");
    expect(late).toHaveLength(1);
    expect(late[0].event_data).toMatchObject({ reason: "granted_before_refund_seen", granted: true });
  });
});

describe("normal order is unchanged (flag on)", () => {
  it("succeeded-then-refund revokes as before and writes no applied-late row", async () => {
    expect((await deliver("payment.succeeded", paid("pay_norm"))).status).toBe(200);
    expect(hasPro()).toBe(true);
    const res = await deliver("refund.created", refund("rf_norm", "pay_norm"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revoked: true, pro_revoked: true });
    expect(hasPro()).toBe(false);
    expect(subs[0].status).toBe("refunded");
    expect(ofType("whop_revoke_unmatched")).toHaveLength(0);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(0);
    expect(ofType("whop_subscription_revoked")).toHaveLength(1);
  });

  it("a duplicate succeeded still grants once", async () => {
    expect((await deliver("payment.succeeded", paid("pay_dup"))).status).toBe(200);
    const until = user.tier_expires_at;
    const again = await deliver("payment.succeeded", paid("pay_dup"));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(subs).toHaveLength(1);
    expect(user.tier_expires_at).toBe(until);
    expect(ofType("whop_subscription_activated")).toHaveLength(1);
  });

  it("a failed activation ledger insert yields 5xx; the retry writes the row with no second grant", async () => {
    failEventType = "whop_subscription_activated"; failEventTimes = 1;
    const first = await deliver("payment.succeeded", paid("pay_ledger"));
    expect(first.status).toBe(503);
    expect(hasPro()).toBe(true); // the grant itself landed
    expect(claims.has("pay_ledger")).toBe(true); // claim kept: never a second window
    expect(ofType("whop_subscription_activated")).toHaveLength(0);
    // grant_succeeded is logged on the first attempt, so the payment never sits in Unresolved.
    expect(vi.mocked(logPaymentEvent).mock.calls.filter(([, e]) => e.event === "grant_succeeded")).toHaveLength(1);
    const until = user.tier_expires_at;

    const retry = await deliver("payment.succeeded", paid("pay_ledger"));
    expect(retry.status).toBe(200);
    expect(subs).toHaveLength(1);
    expect(user.tier_expires_at).toBe(until);
    expect(ofType("whop_subscription_activated")).toHaveLength(1);
    expect(ofType("whop_subscription_activated")[0]).toMatchObject({ user_id: USER, event_data: { payment_id: "pay_ledger", source: "webhook_ledger_retry" } });

    // A third delivery finds the row and writes nothing.
    expect((await deliver("payment.succeeded", paid("pay_ledger"))).status).toBe(200);
    expect(ofType("whop_subscription_activated")).toHaveLength(1);
  });

  it("a ledger retry that fails again keeps answering 503", async () => {
    failEventType = "whop_subscription_activated"; failEventTimes = 2;
    expect((await deliver("payment.succeeded", paid("pay_twice"))).status).toBe(503);
    expect((await deliver("payment.succeeded", paid("pay_twice"))).status).toBe(503);
    expect((await deliver("payment.succeeded", paid("pay_twice"))).status).toBe(200);
    expect(subs).toHaveLength(1);
    expect(ofType("whop_subscription_activated")).toHaveLength(1);
  });
});

describe("dunning ledger row (flag on)", () => {
  const failed = { id: "pay_fail", status: "failed", metadata: { medpruef_user_id: USER }, recovery_url: "https://whop.com/recover/x" };
  it("a failed recovery row frees the claim and 503s; the retry writes it and emails once", async () => {
    failEventType = "whop_payment_recovery_needed"; failEventTimes = 1;
    expect((await deliver("payment.failed", failed)).status).toBe(503);
    expect(h.mail).not.toHaveBeenCalled();
    expect((await deliver("payment.failed", failed)).status).toBe(200);
    expect(h.mail).toHaveBeenCalledTimes(1);
    expect(ofType("whop_payment_recovery_needed")).toHaveLength(1);
  });
  it("when the claim cannot be freed the email still goes out (no lost dunning)", async () => {
    failEventType = "whop_payment_recovery_needed"; failEventTimes = 1; failDelete = true;
    expect((await deliver("payment.failed", failed)).status).toBe(200);
    expect(h.mail).toHaveBeenCalledTimes(1);
  });
});

describe("flag off (ships dark): behaviour as before", () => {
  beforeEach(() => vi.stubEnv("WHOP_PENDING_REVOKE", "false"));
  it("refund-then-succeeded still grants, and the buyer-less unmatched row is dropped as today", async () => {
    expect((await deliver("refund.created", refund("rf_dark", "pay_dark"))).status).toBe(200);
    expect(ofType("whop_revoke_unmatched")).toHaveLength(0); // user_id NULL insert fails silently today
    expect(await (await deliver("payment.succeeded", paid("pay_dark"))).json()).toMatchObject({ activated: true });
    expect(hasPro()).toBe(true);
    expect(ofType("whop_revoke_applied_late")).toHaveLength(0);
  });
  it("a failed activation ledger insert is swallowed (200), as today", async () => {
    failEventType = "whop_subscription_activated"; failEventTimes = 1;
    expect((await deliver("payment.succeeded", paid("pay_dark2"))).status).toBe(200);
    expect(hasPro()).toBe(true);
  });
});

describe("decideGrant (pure)", () => {
  const row = (data: Row) => ({ id: 1, created_at: "2026-10-01T00:00:00Z", event_data: data });
  it("withholds only for a marked refund-class row naming the payment", () => {
    expect(decideGrant({ paymentId: "pay_a", pendingRows: [row({ pending_revoke: true, kind: "refunded", payment_candidates: ["pay_a"] })] }).action).toBe("withhold");
    expect(decideGrant({ paymentId: "pay_a", pendingRows: [row({ pending_revoke: true, kind: "refunded", payment_candidates: ["pay_b"] })] }).action).toBe("grant");
    expect(decideGrant({ paymentId: "pay_a", pendingRows: [row({ kind: "refunded", payment_id: "pay_a" })] }).action).toBe("grant");
    expect(decideGrant({ paymentId: "pay_a", pendingRows: [row({ pending_revoke: true, kind: "cancelled", payment_candidates: ["pay_a"] })] }).action).toBe("grant");
    expect(decideGrant({ paymentId: "pay_a", pendingRows: [row({ pending_revoke: true, kind: "refunded", payment_candidates: [], original_payment_id: "pay_a" })] }).action).toBe("withhold");
    expect(decideGrant({ paymentId: null, pendingRows: [row({ pending_revoke: true, kind: "refunded", payment_candidates: ["pay_a"] })] }).action).toBe("grant");
  });
});
