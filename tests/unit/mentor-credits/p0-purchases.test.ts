import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (c: unknown) => unknown,
  create: vi.fn(), flag: vi.fn(async () => true), resting: vi.fn(async () => false as boolean | null),
  plan: vi.fn(async () => ({ ok: true })), log: vi.fn(async () => {}),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: h.log }));
vi.mock("@/lib/admin/flags", () => ({ flag: h.flag }));
vi.mock("@/lib/mentor/guard", () => ({ mentorResting: h.resting }));
vi.mock("@/lib/mentor/credits/plan-check", () => ({ checkMentorPlan: h.plan }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "66666666-6666-4666-8666-666666666666" }), isPaidAccess: () => false }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "k", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult).sb }));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), createWhopCheckoutSession: h.create }));

import { POST } from "@/app/api/mentor/checkout/route";
import { GET as verifyRoute } from "@/app/api/mentor/checkout/verify/route";
import { verifyMentorCheckout, type LedgerFn } from "@/lib/mentor/credits/verify";
import { createMentorWhopRouter } from "@/lib/mentor/credits/whop-branch";
import { resetPackageCache } from "@/lib/mentor/credits/packages";
import { PURCHASE_EXPIRY_MS, PURCHASE_RETRY_MS, readPendingPurchase, type MentorPurchase } from "@/lib/mentor/credits/purchases";

const U = "66666666-6666-4666-8666-666666666666";
const SESSION = "88888888-8888-4888-8888-888888888888";
const OLD_SESSION = "99999999-9999-4999-8999-999999999999";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const ENV = { WHOP_PLAN_MENTOR_BASIS: "plan_b", MENTOR_BETA_USER_IDS: "66666666-6666-4666-8666-666666666666" };
const PACKAGES = [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }];
const purchase = (over: Partial<MentorPurchase> = {}): MentorPurchase => ({
  checkout_session_id: SESSION, whop_checkout_session_id: "ch_1", user_id: U, package_id: "mentor_basis",
  created_at: new Date(NOW - 60_000).toISOString(), expires_at: new Date(NOW - 60_000 + PURCHASE_EXPIRY_MS).toISOString(),
  status: "pending", payment_id: null, lot_id: null, granted_micro: null, ...over,
});
const metadata = { kind: "mentor_credits", package: "mentor_basis", medpruef_user_id: U, checkout_session_id: SESSION };
const payment = { id: "pay_new", status: "paid", metadata, plan: { id: "plan_b" }, membership: { id: "mem_1" }, created_at: new Date(NOW).toISOString(), final_amount: 4.9, currency: "eur" };
const ledger = (payments: unknown[], memberships: unknown[] = [], truncated = false): LedgerFn => async (args) => ({ rows: args.endpoint === "memberships" ? memberships : payments, truncated });
const req = (body: unknown) => new NextRequest("https://medpruf.com/api/mentor/checkout", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  resetPackageCache(); vi.clearAllMocks();
  h.resting.mockResolvedValue(false); h.flag.mockResolvedValue(true);
  h.create.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.com/checkout/ch_1", planId: "plan_b" });
  for (const [key, value] of Object.entries({ AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_PACKAGES_ENABLED: "true", ...ENV })) vi.stubEnv(key, value);
  h.handler = (call) => {
    const c = call as FakeCall;
    if (c.table === "ai_credit_package") return { data: PACKAGES };
    if (c.table === "rpc:mentor_begin_purchase") return { data: { ok: true } };
    if (c.table === "ai_mentor_purchase") return { data: c.op === "select" ? purchase() : { checkout_session_id: SESSION } };
    return {};
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("MUX-78/79/85 checkout guards", () => {
  it("MUX-81: two tabs with different click UUIDs recover one durable provider session", async () => {
    let active: string | null = null;
    let url: string | null = null;
    const base = h.handler;
    h.handler = raw => {
      const call = raw as FakeCall;
      if (call.table === "rpc:mentor_begin_purchase") {
        if (active) return { data: { ok: false, reason: "pending_purchase", checkout_session_id: active } };
        active = SESSION; return { data: { ok: true } };
      }
      if (call.table === "ai_mentor_purchase") {
        if (call.op === "select") return { data: purchase({ purchase_url: url }) };
        url = "https://whop.com/checkout/ch_1";
        return { data: { checkout_session_id: SESSION } };
      }
      return base(raw);
    };
    const [first, second] = await Promise.all([
      POST(req({ package_id: "mentor_basis", idempotency_key: SESSION })),
      POST(req({ package_id: "mentor_basis", idempotency_key: OLD_SESSION })),
    ]);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it("MUX-81 rejects malformed click IDs before the provider call", async () => {
    expect((await POST(req({ package_id: "mentor_basis", idempotency_key: "invalid" }))).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("MUX-78: rejects an active same-package subscription with 409 and creates no provider session", async () => {
    const base = h.handler;
    h.handler = (c) => (c as FakeCall).table === "rpc:mentor_begin_purchase" ? { data: { ok: false, reason: "already_subscribed" } } : base(c);
    const response = await POST(req({ package_id: "mentor_basis" }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "already_subscribed" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("MUX-79: rejects resting with 403 mentor_resting before calling Whop", async () => {
    h.resting.mockResolvedValue(true);
    const response = await POST(req({ package_id: "mentor_basis" }));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "mentor_resting" });
    expect(h.create).not.toHaveBeenCalled(); expect(h.plan).not.toHaveBeenCalled();
  });

  it("fails closed when the breaker cannot be read", async () => {
    h.resting.mockResolvedValue(null);
    expect((await POST(req({ package_id: "mentor_basis" }))).status).toBe(503);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a kill-switch pause for a previous credit holder returns mentor_resting without minting credits", async () => {
    vi.stubEnv("MENTOR_ENABLED", "false");
    const calls: FakeCall[] = []; const base = h.handler;
    h.handler = (raw) => {
      const c = raw as FakeCall; calls.push(c);
      if (c.table === "rpc:mentor_balance") return { data: { lots_micro: 750000, available_micro: 750000, reserved_micro: 0, debt_micro: 0, ever_granted: true, lots: [] } };
      return base(c);
    };
    const response = await POST(req({ package_id: "mentor_basis" }));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "mentor_resting" });
    expect(h.create).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "rpc:mentor_grant_credits" || c.table === "rpc:mentor_begin_purchase")).toBe(false);
  });

  it("MUX-85: atomically persists pending BEFORE the provider call, so two concurrent taps create one session", async () => {
    let pending = false;
    const base = h.handler;
    h.handler = (c) => {
      if ((c as FakeCall).table !== "rpc:mentor_begin_purchase") return base(c);
      if (pending) return { data: { ok: false, reason: "pending_purchase" } };
      pending = true; return { data: { ok: true } };
    };
    h.create.mockImplementation(async () => {
      expect(pending).toBe(true);
      return { id: "ch_1", purchaseUrl: "https://whop.com/checkout/ch_1" };
    });
    const responses = await Promise.all([POST(req({ package_id: "mentor_basis" })), POST(req({ package_id: "mentor_basis" }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]); expect(h.create).toHaveBeenCalledTimes(1);
  });

  it("MUX-83: stores both session IDs and passes the app correlation in metadata, response and redirect", async () => {
    const calls: FakeCall[] = []; const base = h.handler;
    h.handler = (c) => { calls.push(c as FakeCall); return base(c); };
    const response = await POST(req({ package_id: "mentor_basis" }));
    expect(response.status).toBe(200);
    const body = await response.json(); const id = body.checkout_session_id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ checkout_session_id: id }), redirectUrl: expect.stringContaining(`checkout_session_id=${id}`) }));
    expect(calls.find((c) => c.table === "rpc:mentor_begin_purchase")?.payload).toMatchObject({ p_checkout_session_id: id, p_retry: false });
    expect(calls.find((c) => c.table === "ai_mentor_purchase" && c.op === "update")?.payload).toMatchObject({ whop_checkout_session_id: "ch_1" });
  });

  it("MUX-85: an explicit retry is passed to the atomic guard, never inferred from another tap", async () => {
    const calls: FakeCall[] = []; const base = h.handler;
    h.handler = (c) => { calls.push(c as FakeCall); return base(c); };
    await POST(req({ package_id: "mentor_basis", retry_pending: true }));
    expect(calls.find((c) => c.table === "rpc:mentor_begin_purchase")?.payload).toMatchObject({ p_retry: true });
    expect((await POST(req({ package_id: "mentor_basis", retry_pending: "true" }))).status).toBe(400);
  });

  it("keeps pending on a provider-ID persistence failure and never returns an untracked URL", async () => {
    const calls: FakeCall[] = []; const base = h.handler;
    h.handler = (raw) => {
      const c = raw as FakeCall; calls.push(c);
      return c.table === "ai_mentor_purchase" && c.op === "update" ? { error: { message: "db down" } } : base(c);
    };
    const response = await POST(req({ package_id: "mentor_basis" }));
    expect(response.status).toBe(503); expect(h.create).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.table === "ai_mentor_purchase" && (c.payload as { status?: string })?.status === "failed")).toBe(false);
  });

  it("fails closed when pending cannot be persisted", async () => {
    const base = h.handler;
    h.handler = (c) => (c as FakeCall).table === "rpc:mentor_begin_purchase" ? { error: { message: "db down" } } : base(c);
    expect((await POST(req({ package_id: "mentor_basis" }))).status).toBe(503);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("MUX-83 purchase-scoped verification", () => {
  function fake(over: (c: FakeCall) => FakeResult | undefined = () => undefined) {
    return createFakeSupabase((c) => over(c) ?? (c.table === "ai_mentor_purchase" ? { data: purchase() } : c.table === "ai_credit_package" ? { data: PACKAGES } : c.table === "rpc:mentor_grant_credits" ? { data: { ok: true, lot_id: "lot_new", granted_micro: 750000 } } : {}));
  }
  const deps = { apiKey: "k", companyId: "biz", env: ENV, now: () => NOW, ledger: ledger([]) };

  it("an older lot for this user and package does NOT count, even in the old 48-hour window", async () => {
    const { sb, calls } = fake((c) => c.table === "ai_credit_lot" ? { data: [{ id: "old_lot", source_id: "pay_old" }] } : undefined);
    expect(await verifyMentorCheckout({ ...deps, db: sb as never, apiKey: null }, U, "mentor_basis", SESSION)).toBe("pending");
    expect(calls.some((c) => c.table === "ai_credit_lot")).toBe(false);
  });

  it("an old session's paid payment and membership never confirm the new checkout", async () => {
    const { sb, calls } = fake();
    const oldMetadata = { ...metadata, checkout_session_id: OLD_SESSION };
    expect(await verifyMentorCheckout({ ...deps, db: sb as never, ledger: ledger([{ ...payment, metadata: oldMetadata }], [{ id: "mem_1", status: "active", metadata: oldMetadata }]) }, U, null, SESSION)).toBe("pending");
    expect(calls.some((c) => c.table === "rpc:mentor_grant_credits")).toBe(false);
  });

  it("a payment predating checkout is not accepted even with copied session metadata", async () => {
    const { sb } = fake();
    expect(await verifyMentorCheckout({ ...deps, db: sb as never, ledger: ledger([{ ...payment, created_at: new Date(NOW - 120_000).toISOString() }]) }, U, null, SESSION)).toBe("pending");
  });

  it("grants a paid payment linked to this session and persists the new credit amount", async () => {
    const { sb, calls } = fake();
    expect(await verifyMentorCheckout({ ...deps, db: sb as never, ledger: ledger([payment]) }, U, null, SESSION)).toBe("granted");
    expect(calls.find((c) => c.table === "ai_mentor_purchase" && c.op === "update")?.payload).toMatchObject({ status: "granted", payment_id: "pay_new", granted_micro: 750000 });
  });

  it("requires a purchase belonging to the signed-in user; mismatched package and missing session remain pending", async () => {
    const { sb, calls } = fake((c) => c.table === "ai_mentor_purchase" ? { data: null } : undefined);
    expect(await verifyMentorCheckout({ ...deps, db: sb as never }, U, null, SESSION)).toBe("pending");
    expect(calls[0].filters).toContainEqual({ kind: "eq", column: "user_id", value: U });
    const own = fake();
    expect(await verifyMentorCheckout({ ...deps, db: own.sb as never }, U, "mentor_plus", SESSION)).toBe("pending");
    expect(await verifyMentorCheckout({ ...deps, db: own.sb as never }, U, null)).toBe("pending");
  });

  it("verify endpoint requires the session and responds with credits_added for this purchase", async () => {
    const base = h.handler;
    h.handler = (raw) => {
      const c = raw as FakeCall;
      if (c.table === "ai_mentor_purchase") return { data: purchase({ status: "granted", payment_id: "pay_new", lot_id: "lot_new", granted_micro: 750000 }) };
      if (c.table === "ai_credit_lot") return { data: c.single ? { id: "lot_new", package_id: "mentor_basis", granted_micro: 750000, expires_at: "2026-11-13T12:00:00Z", renews_at: null } : [{ id: "lot_new" }] };
      if (c.table === "rpc:mentor_balance") return { data: { available_micro: 810000, reserved_micro: 0, debt_micro: 0 } };
      return base(c);
    };
    expect((await verifyRoute(new NextRequest("https://medpruf.com/api/mentor/checkout/verify?package=mentor_basis"))).status).toBe(400);
    const response = await verifyRoute(new NextRequest(`https://medpruf.com/api/mentor/checkout/verify?checkout_session_id=${SESSION}`));
    expect(await response.json()).toMatchObject({ status: "granted", credits_added: 150 });
  });
});

describe("MUX-85 pending lifecycle", () => {
  it("shows pending since/retry state until 30 minutes, then allows explicit retry; hides at 24 hours", async () => {
    for (const age of [PURCHASE_RETRY_MS - 1, PURCHASE_RETRY_MS, PURCHASE_EXPIRY_MS - 1, PURCHASE_EXPIRY_MS]) {
      const row = purchase({ created_at: new Date(NOW - age).toISOString(), expires_at: new Date(NOW - age + PURCHASE_EXPIRY_MS).toISOString() });
      const { sb } = createFakeSupabase(() => ({ data: [row] }));
      const state = await readPendingPurchase(sb as never, U, NOW);
      if (age === PURCHASE_EXPIRY_MS) expect(state).toBeNull();
      else expect(state).toMatchObject({ package_id: "mentor_basis", since: row.created_at, retry_allowed: age >= PURCHASE_RETRY_MS });
    }
  });

  function routerDb() {
    let current = purchase(); let grants = 0;
    const { sb, calls } = createFakeSupabase((c) => {
      if (c.table === "ai_credit_package") return { data: PACKAGES };
      if (c.table === "users") return { data: { id: U } };
      if (c.table === "ai_mentor_purchase") {
        if (c.op === "update") {
          const session = eqVal(c, "checkout_session_id");
          if (session === SESSION) current = { ...current, ...(c.payload as Partial<MentorPurchase>) };
        }
        return { data: current };
      }
      if (c.table === "ai_credit_lot") return { data: { granted_micro: 750000 } };
      if (c.table === "rpc:mentor_grant_credits") { grants++; return { data: { ok: true, duplicate: grants > 1, lot_id: "lot_new", granted_micro: grants > 1 ? null : 750000 } }; }
      if (c.table === "rpc:mentor_whop_lookup") return { data: { mentor: false } };
      if (c.table === "rpc:mentor_revoke_payment") return { data: { ok: true } };
      return {};
    });
    const route = createMentorWhopRouter({ db: () => sb as never, env: ENV, log: h.log });
    return { route, calls, row: () => current };
  }

  it("a failed webhook releases the matching pending checkout", async () => {
    const { route, row } = routerDb();
    expect(await route("payment.failed", { ...payment, status: "failed" })).toMatchObject({ handled: true, status: 200 });
    expect(row().status).toBe("failed");
  });

  it("a refund that beats the grant tombstones the payment and clears the pending checkout", async () => {
    const { route, row, calls } = routerDb();
    expect(await route("refund.created", { id: "refund_1", payment, membership_id: "mem_1" })).toMatchObject({ handled: true, status: 200 });
    expect(row().status).toBe("refunded");
    const tombstone = calls.findIndex((c) => c.table === "rpc:mentor_revoke_payment");
    const clear = calls.findIndex((c) => c.table === "ai_mentor_purchase" && c.op === "update");
    expect(tombstone).toBeGreaterThanOrEqual(0); expect(clear).toBeGreaterThan(tombstone);
  });

  it("MUX-78: replay grants the payment once and keeps its original added-credit receipt", async () => {
    const { route, row } = routerDb();
    expect(await route("payment.succeeded", payment)).toMatchObject({ body: { action: "granted" } });
    expect(await route("payment.succeeded", payment)).toMatchObject({ body: { action: "duplicate" } });
    expect(row()).toMatchObject({ status: "granted", payment_id: "pay_new", granted_micro: 750000 });
  });

  it("a failed event for an old checkout cannot release the replacement purchase", async () => {
    const { route, row } = routerDb();
    await route("payment.failed", { ...payment, metadata: { ...metadata, checkout_session_id: OLD_SESSION } });
    expect(row().status).toBe("pending");
  });

  it("a renewal carrying initial membership metadata cannot replace the initial checkout receipt", async () => {
    const { route, row } = routerDb();
    await route("payment.succeeded", payment);
    await route("payment.succeeded", { ...payment, id: "pay_renewal" });
    expect(row().payment_id).toBe("pay_new");
  });
});
