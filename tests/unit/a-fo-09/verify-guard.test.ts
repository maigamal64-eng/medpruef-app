/**
 * a-fo-09 reviewer P2: /api/whop/checkout/verify is a second grant path. The
 * webhook withholds a payment whose refund arrived first and keeps its claim
 * without grant_succeeded; the payment_events fallback used to read that as a
 * stale claim, release it and grant. Both verify grant entries now check the
 * pending revoke first (WHOP_PENDING_REVOKE).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const USER = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({ handler: (() => ({})) as (c: FakeCall) => FakeResult }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn(), hashEmail: () => "hash_synthetic" }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "synthetic", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase(h.handler).sb }));

import { POST } from "@/app/api/whop/checkout/verify/route";

type Row = Record<string, unknown>;
let claims: Set<string>;
let subs: Row[];
let user: Row;
let pendingRows: Row[];
let paymentEventRows: Row[];
let calls: FakeCall[];

const pendingRow = (paymentId: string) => ({
  id: 1, created_at: "2026-10-22T09:00:00Z",
  event_data: { event: "refund.created", kind: "refunded", pending_revoke: true, payment_candidates: [paymentId], payment_id: paymentId },
});

beforeEach(() => {
  vi.stubEnv("WHOP_API_KEY", "synthetic_key");
  vi.stubEnv("WHOP_PLAN_FIRST_MONTH_19", "plan_m19");
  vi.stubEnv("WHOP_PENDING_REVOKE", "true");
  vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "false");
  claims = new Set(); subs = []; calls = []; pendingRows = []; paymentEventRows = [];
  user = { id: USER, tier: "free", role: "user", tier_expires_at: null, email: "buyer@example.test" };
  h.handler = (c) => {
    calls.push(c);
    if (c.table === "users") {
      if (c.op === "select") return { data: c.filters.some((f) => f.kind === "ilike") ? [{ id: USER }] : user };
      if (c.op === "update") { Object.assign(user, c.payload as Row); return { data: { id: USER } }; }
    }
    if (c.table === "user_events" && c.op === "select") {
      const isPending = c.filters.some((f) => f.column === "event_type" && f.value === "whop_revoke_unmatched");
      if (!isPending) return { data: [] };
      const wanted = (c.filters.find((f) => f.kind === "contains")?.value as { payment_candidates: string[] }).payment_candidates[0];
      return { data: pendingRows.filter((r) => ((r.event_data as Row).payment_candidates as string[]).includes(wanted)) };
    }
    if (c.table === "processed_webhook_events") {
      if (c.op === "insert") {
        const id = (c.payload as Row).event_id as string;
        if (claims.has(id)) return { error: { code: "23505", message: "duplicate" } };
        claims.add(id); return { data: { event_id: id } };
      }
      if (c.op === "delete") { claims.delete(c.filters.find((f) => f.column === "event_id")?.value as string); return { data: null }; }
    }
    if (c.table === "payment_events" && c.op === "select") {
      if (c.filters.some((f) => f.column === "event" && f.value === "webhook_received")) return { data: paymentEventRows };
      return { data: [] };
    }
    if (c.table === "subscriptions") {
      if (c.op === "insert") { subs.push({ id: "sub_v", ...(c.payload as Row) }); return { data: { id: "sub_v" } }; }
      if (c.op === "select") return { data: [] };
    }
    return { data: null };
  };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function whopApi(memberships: unknown[], payments: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    // a-whop-verify-fallback-guard: step 3b re-reads the one payment; Whop
    // still shows it paid on the plan (the refund has not reached it yet).
    const one = /\/payments\/(pay_[A-Za-z0-9_]+)/.exec(url);
    if (one) return new Response(JSON.stringify({ id: one[1], status: "paid", plan: { id: "plan_m19" }, final_amount: 19 }), { status: 200 });
    const body = url.includes("/memberships") ? memberships : url.includes("/payments") ? payments : [];
    return new Response(JSON.stringify({ data: body }), { status: 200 });
  }));
}
const req = () => new NextRequest("https://medpruf.test/api/whop/checkout/verify", { method: "POST", body: JSON.stringify({ tier: "first_month_19" }) });
const granted = () => subs.length > 0 || user.tier === "pro";

describe("verify payment_events fallback (reviewer P2 path)", () => {
  beforeEach(() => {
    // Membership invalid after the refund: no metadata or email match, so the
    // fallback ties the payment by the webhook's webhook_received row.
    whopApi([], []);
    paymentEventRows = [{ id: 9, payment_id: "pay_v", tier: "first_month_19", amount_cents: 1900, event: "webhook_received", metadata: { whop_event: "payment.succeeded" } }];
    claims.add("pay_v"); // the webhook kept its claim when it withheld the grant
  });

  it("never releases the withheld claim and never grants", async () => {
    pendingRows = [pendingRow("pay_v")];
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_v" });
    expect(granted()).toBe(false);
    expect(claims.has("pay_v")).toBe(true);
    expect(calls.some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(false);
  });

  it("an unreadable pending store refuses (db_error), never grants", async () => {
    pendingRows = [pendingRow("pay_v")];
    const prev = h.handler;
    h.handler = (c) => (c.table === "user_events" && c.op === "select" ? { error: { message: "timeout" } } : prev(c));
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ granted: false, reason: "db_error" });
    expect(granted()).toBe(false);
  });

  it("flag off: the fallback still releases a stale claim and grants (unchanged)", async () => {
    vi.stubEnv("WHOP_PENDING_REVOKE", "false");
    pendingRows = [pendingRow("pay_v")];
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(true);
    expect(granted()).toBe(true);
  });
});

describe("verify main path", () => {
  beforeEach(() => {
    whopApi(
      [{ id: "mem_v", valid: true, plan: { id: "plan_m19" }, metadata: { medpruef_user_id: USER } }],
      [{ id: "pay_main", member: { id: "mem_v" }, status: "paid", final_amount: 19, currency: "eur", created_at: new Date().toISOString() }],
    );
  });
  it("withholds a payment with a pending revoke, before any claim", async () => {
    pendingRows = [pendingRow("pay_main")];
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_main", withheld: "refunded_before_grant" });
    expect(granted()).toBe(false);
    expect(claims.has("pay_main")).toBe(false);
  });
  it("grants as before when no pending revoke names the payment", async () => {
    pendingRows = [pendingRow("pay_other")];
    const body = await (await POST(req())).json();
    expect(body.granted).toBe(true);
    expect(subs).toHaveLength(1);
  });
});
