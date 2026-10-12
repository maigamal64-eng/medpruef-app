import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), rate: vi.fn(), perms: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: vi.fn(() => null) }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn(), resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, rateKey: () => "fixture", callerIdentity: () => "fixture", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/admin/permissions", () => ({
  loadAdminPermissionSnapshot: vi.fn(async () => ({ roles: [], permissions: mocks.perms() })),
  canAccessAdminPermission: (s: { permissions: string[] } | null, p: string) => Boolean(s?.permissions.includes(p)),
}));

import { GET as directory } from "@/app/api/stats/admin/users/route";
import { GET as dossier } from "@/app/api/stats/admin/users/[id]/route";
import { GET as audit } from "@/app/api/admin/audit/route";
import { GET as names } from "@/app/api/admin/users/names/route";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const MISSING = { error: { code: "PGRST202", message: "Could not find the function" } };

const req = (path: string) => new NextRequest(`https://medpruf.com${path}`);
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.rate.mockReturnValue({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 });
  mocks.perms.mockReturnValue(["users.read", "revenue.read", "system.read"]);
});

describe("GET /api/stats/admin/users (UX-ADM-19, ADM-07)", () => {
  const item = { id: LEARNER, tier: "free", name: "Lea", last_active: null, status: "none" };

  it("uses directory v2 with the segment and reports learner activity", async () => {
    const { calls } = database((c) => (c.table === "rpc:admin_user_directory_v2" ? { data: { total: 1, items: [item] } } : { data: [] }));
    const res = await directory(req("/api/stats/admin/users?segment=never_answered"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity_basis).toBe("learner");
    expect(calls.find((c) => c.table === "rpc:admin_user_directory_v2")?.payload).toMatchObject({ p_segment: "never_answered" });
  });

  it("falls back to v1 before the changeset, and refuses segments with 503", async () => {
    database((c) => (c.table === "rpc:admin_user_directory" ? { data: { total: 1, items: [item] } } : c.table.startsWith("rpc:") ? MISSING : { data: [] }));
    const legacy = await directory(req("/api/stats/admin/users"));
    expect((await legacy.json()).activity_basis).toBe("legacy");
    expect((await directory(req("/api/stats/admin/users?segment=no_exam_date"))).status).toBe(503);
    const counts = await directory(req("/api/stats/admin/users?view=segments"));
    expect(await counts.json()).toEqual({ available: false, counts: null });
  });

  it("hides the Pro segment without revenue.read and rejects junk segments", async () => {
    mocks.perms.mockReturnValue(["users.read"]);
    database((c) => (c.table === "rpc:admin_user_segment_counts" ? { data: { learners: 4, never_answered: 1, pro_inactive_7d: 2 } } : { data: [] }));
    expect((await directory(req("/api/stats/admin/users?segment=pro_inactive_7d"))).status).toBe(403);
    expect((await directory(req("/api/stats/admin/users?segment=everyone"))).status).toBe(400);
    const body = await (await directory(req("/api/stats/admin/users?view=segments"))).json();
    expect(body.counts).toEqual({ learners: 4, never_answered: 1 });
  });
});

describe("GET /api/stats/admin/users/[id] (ADM-07 A, ADM-15 A)", () => {
  function world(opts: { opsMissing?: boolean } = {}): FakeHandler {
    return (c) => {
      if (c.table === "users") {
        return { data: { id: LEARNER, email: "user-78b2999e@example.com", first_name: "Lea", last_name: null, role: "user", tier: "pro", tier_expires_at: "2099-01-01T00:00:00Z", is_banned: false, created_at: "2026-01-01T00:00:00Z", updated_at: new Date().toISOString() } };
      }
      if (c.table === "answer_history") return { data: [{ id: "a1", question_id: 7, user_answer: "A", is_correct: true, time_spent_ms: 1000, xp_earned: 5, created_at: "2026-09-01T10:00:00Z" }] };
      if (c.table === "user_events") return { data: [{ event_type: "whop_subscription_activated", event_data: {}, created_at: new Date().toISOString() }, { event_type: "page_view", event_data: {}, created_at: "2026-09-02T10:00:00Z" }] };
      if (c.table === "subscriptions") return { data: [{ tier: "premium_pass_guaranteed", status: "cancelled", payment_provider: "nowpayments", amount_cents: 11400, currency: "EUR", created_at: "2026-05-01T00:00:00Z", expires_at: null }] };
      if (c.table === "questions") return { data: [{ id: 7, topic: "Kardiologie", exam_type: "kenntnispruefung", question: "Stem" }] };
      if (c.table === "admin_audit_log") {
        if (eqVal(c, "action") === "grant_free_access") return { data: [] };
        return { data: [{ id: "h1", actor_email: "user-b7e46e80@example.com", action: "edit_user", target_type: "user", payload: { applied_fields: ["email"] }, created_at: "2026-10-01T00:00:00Z" }], count: 1 };
      }
      if (c.table === "rpc:admin_ops_decisions") {
        return opts.opsMissing ? MISSING : { data: { total: 1, items: [{ id: 9, at: "2026-10-02T00:00:00Z", event: "action.approved", operation: "entitlement.grant", actor_email: "user-b7e46e80@example.com", days: "7", reason: "Goodwill" }] } };
      }
      return { data: [] };
    };
  }

  it("no phantom payer, learner-only last active, outside-admin access, merged history", async () => {
    const { calls } = database(world());
    const res = await dossier(req(`/api/stats/admin/users/${LEARNER}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.money.isPayer).toBe(false);
    expect(body.money.unpaidInvoiceRows).toBe(1);
    expect(body.stats.lastActivity).toBe("2026-09-02T10:00:00.000Z");
    expect(body.access).toMatchObject({ state: "pro", source: "outside_admin" });
    expect(body.adminHistory.map((h: { origin: string }) => h.origin)).toEqual(["ops", "admin"]);
    expect(body.adminHistoryTotal).toBe(2);
    expect(calls.find((c) => c.table === "answer_history")?.op).toBe("select");
  });

  it("says Ops decisions are unavailable before the changeset", async () => {
    database(world({ opsMissing: true }));
    const body = await (await dossier(req(`/api/stats/admin/users/${LEARNER}`))).json();
    expect(body.adminHistoryOpsAvailable).toBe(false);
    expect(body.adminHistory).toHaveLength(1);
  });

  it("hides access and money without revenue.read", async () => {
    mocks.perms.mockReturnValue(["users.read"]);
    database(world());
    const body = await (await dossier(req(`/api/stats/admin/users/${LEARNER}`))).json();
    expect(body.access).toBeNull();
    expect(body.money).toBeNull();
  });
});

describe("GET /api/admin/audit (ADM-15 A, UX-ADM-34)", () => {
  const rows = [
    { id: "00000000-0000-4000-8000-000000000001", actor_email: "user-b7e46e80@example.com", action: "grant_free_access", target_type: "user", target_id: LEARNER, payload: { reason: "x" }, created_at: "2026-10-03T00:00:00Z" },
    { id: "00000000-0000-4000-8000-000000000002", actor_email: "user-b7e46e80@example.com", action: "revert_question_edit", target_type: "question", target_id: null, payload: {}, created_at: "2026-10-02T00:00:00Z" },
    { id: "00000000-0000-4000-8000-000000000003", actor_email: "user-b7e46e80@example.com", action: "env_read", target_type: null, target_id: null, payload: {}, created_at: "2026-10-01T00:00:00Z" },
  ];

  it("filters by category while scanning and reports the total", async () => {
    database((c) => (c.table === "admin_audit_log" ? { data: rows, count: 3 } : { data: [] }));
    const body = await (await audit(req("/api/admin/audit?category=content"))).json();
    expect(body.items.map((r: { id: string }) => r.id)).toEqual(["00000000-0000-4000-8000-000000000002"]);
    expect(body).toMatchObject({ total: 3, scanned: 3, next_before: null });
  });

  it("pages with a compound cursor and only reports the total on the first page", async () => {
    const { calls } = database((c) => (c.table === "admin_audit_log" ? { data: rows.slice(0, 2), count: 3 } : { data: [] }));
    const first = await (await audit(req("/api/admin/audit?limit=2"))).json();
    expect(first.next_before).toBe("2026-10-02T00:00:00Z|00000000-0000-4000-8000-000000000002");
    const second = await (await audit(req(`/api/admin/audit?limit=2&before=${encodeURIComponent(first.next_before)}`))).json();
    expect(second.total).toBeNull();
    expect(calls.at(-1)?.filters).toContainEqual({ kind: "or", column: "created_at.lt.2026-10-02T00:00:00Z,and(created_at.eq.2026-10-02T00:00:00Z,id.lt.00000000-0000-4000-8000-000000000002)", value: undefined });
    await audit(req(`/api/admin/audit?before=${encodeURIComponent("2026-10-02T07:34:28.123456+00:00|00000000-0000-4000-8000-000000000002")}`));
    expect(calls.at(-1)?.filters).toContainEqual({ kind: "or", column: "created_at.lt.2026-10-02T07:34:28.123456+00:00,and(created_at.eq.2026-10-02T07:34:28.123456+00:00,id.lt.00000000-0000-4000-8000-000000000002)", value: undefined });
  });

  it("filters a learner by target or payload, validates input", async () => {
    const { calls } = database((c) => (c.table === "admin_audit_log" ? { data: rows.slice(0, 1), count: 1 } : { data: [] }));
    await audit(req(`/api/admin/audit?learner=${LEARNER}`));
    expect(calls[0].filters).toContainEqual({ kind: "or", column: `target_id.eq.${LEARNER},payload->>user_id.eq.${LEARNER}`, value: undefined });
    expect((await audit(req("/api/admin/audit?learner=abc"))).status).toBe(400);
    expect((await audit(req("/api/admin/audit?category=secrets"))).status).toBe(400);
    expect((await audit(req("/api/admin/audit?actor=a%2Cb"))).status).toBe(400);
  });

  it("reads Ops decisions through the named function, or says unavailable", async () => {
    database((c) => (c.table === "rpc:admin_ops_decisions" ? MISSING : { data: [] }));
    expect(await (await audit(req("/api/admin/audit?category=ops"))).json()).toMatchObject({ available: false, items: [] });
    const { calls } = database((c) => (c.table === "rpc:admin_ops_decisions" ? { data: { total: 1, items: [{ id: 1, at: "2026-10-01T00:00:00Z" }] } } : { data: [] }));
    const body = await (await audit(req("/api/admin/audit?category=ops"))).json();
    expect(body).toMatchObject({ available: true, total: 1 });
    expect(calls[0].payload).toMatchObject({ p_actor_id: ADMIN, p_user_id: null });
  });
});

describe("GET /api/admin/users/names (UX-ADM-21)", () => {
  it("returns labels without full emails", async () => {
    database((c) => (c.table === "users" ? { data: [
      { id: LEARNER, first_name: null, last_name: null, telegram_username: null, email: "user-b38e3a08@example.com", role: "user" },
    ] } : { data: [] }));
    const body = await (await names(req(`/api/admin/users/names?ids=${LEARNER}`))).json();
    expect(body.names[LEARNER].label).toBe("le…@gmail.com");
    expect(JSON.stringify(body)).not.toContain("user-b38e3a08@example.com");
  });

  it("rejects missing, junk or too many ids", async () => {
    database(() => ({ data: [] }));
    expect((await names(req("/api/admin/users/names"))).status).toBe(400);
    expect((await names(req("/api/admin/users/names?ids=x"))).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
    expect((await names(req(`/api/admin/users/names?ids=${many}`))).status).toBe(400);
  });
});
