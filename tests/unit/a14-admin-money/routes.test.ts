import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  guard: vi.fn(),
  audit: vi.fn(),
  rate: vi.fn(),
  grant: vi.fn(),
  reconcile: vi.fn(),
  release: vi.fn(),
  log: vi.fn(),
  perms: vi.fn(),
  repair: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: vi.fn(() => null) }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.audit, resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, rateKey: () => "fixture", callerIdentity: () => "fixture", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: mocks.log }));
vi.mock("@/lib/whop-entitlement", () => ({ repairWhopUserAccess: mocks.repair }));
vi.mock("@/lib/whop-grant", () => ({ extendOrInsertWhopSubscription: mocks.grant, reconcileUserTierPro: mocks.reconcile, releaseWhopClaim: mocks.release }));
vi.mock("@/lib/admin/permissions", () => ({
  loadAdminPermissionSnapshot: vi.fn(async () => ({ roles: [], permissions: mocks.perms() })),
  canAccessAdminPermission: (s: { permissions: string[] } | null, p: string) => Boolean(s?.permissions.includes(p)),
}));

import { POST as resolve } from "@/app/api/admin/payments/resolve/route";
import { GET as roster } from "@/app/api/admin/subscriptions/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { GET as payments } from "@/app/api/stats/admin/payments/route";
import { GET as trace } from "@/app/api/stats/admin/payments/trace/route";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const PLAN = "plan_synthetic_month";

function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`https://medpruf.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
}
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const writes = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table && c.op !== "select");

const paidRows = (opts: { granted?: boolean; plan?: string; amount?: number } = {}) => [
  { id: 1, event: "webhook_received", provider: "whop", user_id: null, tier: null, plan_id: opts.plan ?? PLAN, payment_id: "pay_unmapped", amount_cents: opts.amount ?? 1900, currency: "eur", reason: null, matched: false, metadata: { whop_event: "payment.succeeded" }, created_at: "2026-10-05T10:00:00Z" },
  { id: 2, event: "grant_failed", provider: "whop", user_id: null, tier: null, plan_id: opts.plan ?? PLAN, payment_id: "pay_unmapped", amount_cents: opts.amount ?? 1900, currency: "eur", reason: "unmapped", matched: false, metadata: {}, created_at: "2026-10-05T10:00:01Z" },
  ...(opts.granted ? [{ id: 3, event: "grant_succeeded", provider: "whop", user_id: LEARNER, tier: "first_month_19", plan_id: PLAN, payment_id: "pay_unmapped", amount_cents: 1900, currency: "EUR", reason: null, matched: true, metadata: {}, created_at: "2026-10-05T10:01:00Z" }] : []),
];

interface World {
  resolutions?: unknown[] | "missing";
  ledger?: unknown[];
  claimError?: { code: string } | null;
  resolutionInsertError?: { code: string } | null;
}

function resolveWorld(w: World): FakeHandler {
  return (c) => {
    if (c.table === "payment_resolutions" && c.op === "select") {
      if (w.resolutions === "missing") return { error: { code: "42P01", message: "relation does not exist" } };
      return { data: w.resolutions ?? [] };
    }
    if (c.table === "payment_resolutions" && c.op === "insert") return { error: w.resolutionInsertError ?? null };
    if (c.table === "payment_events" && c.op === "select") {
      if (eqVal(c, "event") === "grant_succeeded") return { data: [] };
      return { data: w.ledger ?? paidRows() };
    }
    if (c.table === "users" && c.op === "select") return { data: [{ id: LEARNER, email: "user-610e28c1@example.com", first_name: "Lea", tier: "free", tier_expires_at: null }] };
    if (c.table === "processed_webhook_events" && c.op === "insert") return w.claimError ? { error: w.claimError } : { data: { event_id: "pay_unmapped" } };
    return {};
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHOP_PLAN_FIRST_MONTH_19 = PLAN;
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.rate.mockReturnValue({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 });
  mocks.perms.mockReturnValue(["revenue.read", "revenue.manage", "users.read", "users.entitlements.write", "system.read"]);
  mocks.grant.mockResolvedValue({ mode: "inserted", subscriptionId: "sub-1", expiresAt: "2026-11-12T00:00:00.000Z", previousExpiresAt: null });
  mocks.reconcile.mockResolvedValue(undefined);
});

describe("POST /api/admin/payments/resolve", () => {
  it("returns 503 and writes nothing before the a14 changeset is applied", async () => {
    const { calls } = database(resolveWorld({ resolutions: "missing" }));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "test", reason: "Synthetic Whop test delivery", confirm: true }));
    expect(res.status).toBe(503);
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("marks a paid, ungranted payment as test with an audit row and no access change", async () => {
    const { calls } = database(resolveWorld({}));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "test", reason: "Synthetic Whop test delivery", confirm: true }));
    expect(res.status).toBe(200);
    expect(writes(calls, "payment_resolutions")[0].payload).toMatchObject({ payment_id: "pay_unmapped", kind: "test", user_id: null, actor_id: ADMIN });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_marked_test", targetId: "pay_unmapped" }));
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(writes(calls, "processed_webhook_events")).toHaveLength(0);
  });

  it("previews a link without writing anything", async () => {
    const { calls } = database(resolveWorld({}));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: "user-610e28c1@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toMatchObject({ learner_id: LEARNER, tier: "first_month_19", months: 1, gross_cents: 1900 });
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
    // Email lookup is exact (wildcards escaped), case-insensitive.
    const lookup = calls.find((c) => c.table === "users");
    expect(lookup?.filters).toContainEqual({ kind: "ilike", column: "email", value: "user-610e28c1@example.com" });
  });

  it("links through the shared grant path: lock, stale-claim release, claim, grant, ledger, audit", async () => {
    const { calls } = database(resolveWorld({}));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: LEARNER, confirm: true }));
    expect(res.status).toBe(200);
    const order = calls.filter((c) => c.op !== "select").map((c) => `${c.table}:${c.op}`);
    expect(order.slice(0, 3)).toEqual(["payment_resolutions:insert", "processed_webhook_events:delete", "processed_webhook_events:insert"]);
    // Only a claim older than 10 minutes is released.
    expect(calls.find((c) => c.table === "processed_webhook_events" && c.op === "delete")?.filters.some((f) => f.kind === "lt" && f.column === "processed_at")).toBe(true);
    expect(mocks.grant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: LEARNER, tier: "first_month_19", paymentId: "pay_unmapped", amountCents: 1900 }));
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.anything(), LEARNER, "2026-11-12T00:00:00.000Z");
    expect(mocks.log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: "grant_succeeded", paymentId: "pay_unmapped", metadata: expect.objectContaining({ source: "admin_payment_link" }) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_linked_to_learner", targetId: LEARNER }));
  });

  it("refuses to link a plan that is not a MedPrüf Pro plan (the USD 50 case)", async () => {
    const { calls } = database(resolveWorld({ ledger: paidRows({ plan: "plan_other_product", amount: 5000 }) }));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Trying to link", user_ref: LEARNER, confirm: true }));
    expect(res.status).toBe(422);
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("refuses an already granted payment", async () => {
    database(resolveWorld({ ledger: paidRows({ granted: true }) }));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "not_ours", reason: "Other product payment", confirm: true }));
    expect(res.status).toBe(409);
  });

  it("replays a repeated submit and rejects a conflicting second resolution", async () => {
    database(resolveWorld({ resolutions: [{ payment_id: "pay_unmapped", kind: "test", user_id: null, reason: "x", created_at: "2026-10-12T08:00:00Z" }] }));
    const same = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "test", reason: "Synthetic Whop test delivery", confirm: true }));
    expect((await same.json()).duplicate).toBe(true);
    const other = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "not_ours", reason: "Other product payment", confirm: true }));
    expect(other.status).toBe(409);
  });

  it("undoes the lock and releases the claim when the grant fails", async () => {
    mocks.grant.mockResolvedValue({ mode: "failed", subscriptionId: null, expiresAt: "", previousExpiresAt: null, error: "db down" });
    const { calls } = database(resolveWorld({}));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: LEARNER, confirm: true }));
    expect(res.status).toBe(500);
    expect(calls.some((c) => c.table === "payment_resolutions" && c.op === "delete")).toBe(true);
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), "pay_unmapped");
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("backs off when a live delivery holds the claim", async () => {
    const { calls } = database(resolveWorld({ claimError: { code: "23505" } }));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: LEARNER, confirm: true }));
    expect(res.status).toBe(409);
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === "payment_resolutions" && c.op === "delete")).toBe(true);
  });

  it("requires users.read and users.entitlements.write to link", async () => {
    mocks.perms.mockReturnValue(["revenue.read", "revenue.manage"]);
    const { calls } = database(resolveWorld({}));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: "user-610e28c1@example.com" }));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.table === "users")).toBe(false);
  });

  it("refuses to link a payment already carried by a subscription row", async () => {
    const world = resolveWorld({});
    const { calls } = database((c) => (c.table === "subscriptions" && eqVal(c, "provider_payment_id") === "pay_unmapped" ? { data: [{ id: "sub-old" }] } : world(c)));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: LEARNER, confirm: true }));
    expect(res.status).toBe(409);
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  // a-db-timeouts: a link whose grant committed after its deadline left the
  // payment on this learner's active row; linking again replays and repairs.
  it("replays a link already on this learner's active row and repairs access", async () => {
    mocks.grant.mockResolvedValue({ mode: "extended", subscriptionId: "sub-own", expiresAt: "2026-11-12T00:00:00.000Z", previousExpiresAt: "2026-11-12T00:00:00.000Z", replayed: true, entitlementReconciled: false });
    mocks.repair.mockResolvedValue({ granted: true, tier_expires_at: "2026-11-12T00:00:00.000Z" });
    const world = resolveWorld({});
    database((c) => (c.table === "subscriptions" && eqVal(c, "provider_payment_id") === "pay_unmapped" ? { data: [{ id: "sub-own", user_id: LEARNER, status: "active" }] } : world(c)));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: LEARNER, confirm: true }));
    expect(res.status).toBe(200);
    expect(mocks.repair).toHaveBeenCalledWith(expect.anything(), LEARNER);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: "grant_succeeded", paymentId: "pay_unmapped" }));
  });

  it("still refuses when the carrying row is another learner's or no longer active", async () => {
    const world = resolveWorld({});
    for (const row of [{ id: "sub-x", user_id: "00000000-0000-4000-8000-0000000000c9", status: "active" }, { id: "sub-own", user_id: LEARNER, status: "refunded" }]) {
      database((c) => (c.table === "subscriptions" && eqVal(c, "provider_payment_id") === "pay_unmapped" ? { data: [row] } : world(c)));
      const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: LEARNER, confirm: true }));
      expect(res.status).toBe(409);
    }
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it("rejects wildcard email references", async () => {
    database(resolveWorld({}));
    const res = await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_unmapped", action: "link", reason: "Paid via concierge link", user_ref: "*@gmail.com" }));
    expect(res.status).toBe(400);
  });

  it("validates ids and reasons", async () => {
    database(resolveWorld({}));
    expect((await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "bad id;", action: "test", reason: "Long enough", confirm: true }))).status).toBe(400);
    expect((await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_x", action: "test", reason: "no", confirm: true }))).status).toBe(400);
    expect((await resolve(req("/api/admin/payments/resolve", "POST", { payment_id: "pay_x", action: "refund", reason: "Long enough", confirm: true }))).status).toBe(400);
  });
});

// ── Read routes over one shared synthetic world ────────────────────────
const NOW = Date.now();
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * 86_400_000).toISOString();
const ACCOUNTS = [
  { id: ADMIN, email: "admin@medpruf.com", role: "admin", tier: "admin", first_name: "Admin", last_name: null, created_at: iso(-300), tier_expires_at: null },
  { id: LEARNER, email: "user-610e28c1@example.com", role: "user", tier: "pro", first_name: "Lea", last_name: "Learner", created_at: iso(-3), tier_expires_at: iso(5) },
  { id: "u2", email: null, role: "user", tier: "pro", first_name: null, last_name: null, created_at: iso(-40), tier_expires_at: iso(40) },
  { id: "u3", email: "user-4e9e9c7a@example.com", role: "user", tier: "pro", first_name: "Tia", last_name: null, created_at: iso(-2), tier_expires_at: iso(6) },
];
const SUBS = [
  { id: "s1", user_id: LEARNER, tier: "first_month_19", status: "active", payment_provider: "whop", payment_method: "card", amount_cents: 1900, currency: "EUR", provider_payment_id: "pay_a", granted_payment_ids: null, expires_at: iso(5), started_at: iso(-25), created_at: iso(-25), updated_at: iso(-25) },
  { id: "s2", user_id: "u2", tier: "notes_pro_trial", status: "active", payment_provider: "whop", payment_method: "card", amount_cents: 1900, currency: "EUR", provider_payment_id: "pay_b", granted_payment_ids: null, expires_at: iso(20), started_at: iso(-40), created_at: iso(-40), updated_at: iso(-10) },
  { id: "s3", user_id: "u3", tier: "notes_pro_trial", status: "active", payment_provider: "whop", payment_method: "card", amount_cents: 0, currency: "EUR", provider_payment_id: "pay_t", granted_payment_ids: [{ payment_id: "pay_t", amount_cents: 0 }], expires_at: iso(6), started_at: iso(-1), created_at: iso(-1), updated_at: iso(-1) },
  { id: "s4", user_id: ADMIN, tier: "first_month_19", status: "active", payment_provider: "whop", payment_method: "card", amount_cents: 1900, currency: "EUR", provider_payment_id: "pay_admin", granted_payment_ids: null, expires_at: iso(25), started_at: iso(-5), created_at: iso(-5), updated_at: iso(-5) },
];
const LEDGER = [
  { id: 1, event: "grant_succeeded", provider: "whop", user_id: LEARNER, tier: "first_month_19", plan_id: "plan_redacted07253e20", payment_id: "pay_a", amount_cents: 1900, currency: "EUR", reason: null, matched: true, metadata: {}, created_at: iso(-2) },
  { id: 2, event: "grant_succeeded", provider: "whop", user_id: "u2", tier: "notes_pro_trial", plan_id: "plan_redactedec56d4df", payment_id: "pay_b", amount_cents: 1900, currency: "EUR", reason: null, matched: true, metadata: {}, created_at: iso(-10) },
  { id: 3, event: "grant_succeeded", provider: "whop", user_id: "u3", tier: "notes_pro_trial", plan_id: "plan_redactedec56d4df", payment_id: "pay_t", amount_cents: 0, currency: "EUR", reason: null, matched: true, metadata: {}, created_at: iso(-1) },
  { id: 4, event: "webhook_received", provider: "whop", user_id: null, tier: null, plan_id: "plan_other", payment_id: "pay_usd", amount_cents: 5000, currency: "usd", reason: null, matched: false, metadata: { whop_event: "payment.succeeded" }, created_at: iso(-22) },
];

function readWorld(): FakeHandler {
  return (c) => {
    if (c.table === "users" && c.op === "select") {
      if (c.columns?.includes("tier_expires_at") && c.columns.includes("first_name")) return { data: ACCOUNTS };
      return { data: [], count: 1 };
    }
    if (c.table === "subscriptions") {
      if (eqVal(c, "status") === "active") return { data: SUBS };
      if (eqVal(c, "status") === "pending") return { data: [{ id: "p1", user_id: "u2", tier: "premium_pass_guaranteed", payment_provider: "nowpayments", amount_cents: 12900, currency: "EUR", created_at: iso(-120) }], count: 1 };
      return { data: [], count: 0 };
    }
    if (c.table === "payment_events") {
      if (c.columns?.startsWith("id, event, provider, user_id, tier, plan_id")) return { data: LEDGER };
      return { data: [] };
    }
    if (c.table === "payment_resolutions") return { data: [] };
    if (c.table === "webhook_attempts") return { data: [{ result: "sig_invalid", error: "no recognized auth header", received_at: iso(-0.5) }, { result: "processed", error: null, received_at: iso(-2) }] };
    return { data: [], count: 0 };
  };
}

describe("read routes use the shared money rules", () => {
  it("roster: one row per real payer, trials apart, staff excluded, ending-soon count", async () => {
    database(readWorld());
    const res = await roster(req("/api/admin/subscriptions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis.paying).toBe(2);
    expect(body.kpis.in_trial).toBe(1);
    expect(body.kpis.lose_7d).toBe(1); // LEARNER: one-time plan, 5 days left
    expect(body.rows.map((r: { user_id: string }) => r.user_id)).not.toContain(ADMIN);
    const learner = body.rows.find((r: { user_id: string }) => r.user_id === LEARNER);
    expect(learner).toMatchObject({ status: "paying", cadence: "one_time", paid_to_date_cents: 1900, days_left: 5 });
    expect(learner.label).toContain("user-610e28c1@example.com");
    expect(body.kpis.stuck_pending_24h).toBe(1);
  });

  it("roster hides learner names from viewers without users.read", async () => {
    mocks.perms.mockReturnValue(["revenue.read"]);
    database(readWorld());
    const body = await (await roster(req("/api/admin/subscriptions"))).json();
    expect(body.names_visible).toBe(false);
    expect(body.rows.every((r: { label: string | null }) => r.label === null)).toBe(true);
  });

  it("overview: cash money in, paying learners, and a neutral probe never counts as a failure", async () => {
    database(readWorld());
    const body = await (await overview(req("/api/admin/overview"))).json();
    expect(body.tiles.revenue.month_to_date.gross_cents).toBeGreaterThanOrEqual(0);
    expect(body.tiles.active_subs).toMatchObject({ total: 2, in_trial: 1 });
    expect(body.tiles.payment_health.probes_24h).toBe(1);
    expect(body.tiles.payment_health.failures_24h).toBe(0);
    expect(body.tiles.payment_health.level).not.toBe("alarm");
    expect(body.tiles).not.toHaveProperty("webhook_failures_24h");
  });

  it("overview withholds money tiles without revenue.read", async () => {
    mocks.perms.mockReturnValue(["overview.read", "system.read"]);
    database(readWorld());
    const body = await (await overview(req("/api/admin/overview"))).json();
    expect(body.tiles.revenue).toBeNull();
    expect(body.tiles.payment_health).toBeNull();
    expect(body.tiles.new_payers_7d).toBeNull();
  });

  it("payments: same diagnosis, unresolved USD payment listed and not linkable", async () => {
    database(readWorld());
    const body = await (await payments(req("/api/stats/admin/payments"))).json();
    expect(body.health.level).toBe("attention");
    expect(body.unresolved).toHaveLength(1);
    expect(body.unresolved[0]).toMatchObject({ payment_id: "pay_usd", currency: "USD", gross_cents: 5000, linkable_tier: null });
    expect(body.money.other_currencies[0]).toMatchObject({ currency: "USD", gross_cents: 5000 });
    expect(body.resolutions_available).toBe(true);
  });

  it("trace validates the payment id and never selects claim payloads", async () => {
    const { calls } = database(readWorld());
    expect((await trace(req("/api/stats/admin/payments/trace?payment_id=a%20b"))).status).toBe(400);
    const res = await trace(req("/api/stats/admin/payments/trace?payment_id=pay_a"));
    expect(res.status).toBe(200);
    const claims = calls.find((c) => c.table === "processed_webhook_events");
    expect(claims?.columns).not.toContain("payload");
    expect(calls.find((c) => c.table === "webhook_attempts")?.columns).not.toContain("body_preview");
  });
});
