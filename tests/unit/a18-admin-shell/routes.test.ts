import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), perms: vi.fn(), owner: vi.fn(), ops: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: vi.fn(() => null) }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn(), resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 }), rateKey: () => "k", callerIdentity: () => "c", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/ops/owner", () => ({ opsWaitingCount: mocks.ops }));
vi.mock("@/lib/admin/permissions", () => ({
  loadAdminPermissionSnapshot: vi.fn(async () => ({ roles: mocks.owner() ? [{ key: "owner", name: "Owner" }] : [], permissions: mocks.perms() })),
  canAccessAdminPermission: (s: { permissions: string[] } | null, p: string) => Boolean(s?.permissions.includes(p)),
}));

import { GET as inbox } from "@/app/api/admin/inbox/route";
import { GET as overview } from "@/app/api/admin/overview/route";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const req = (path: string) => new NextRequest(`https://medpruf.com${path}`, { method: "GET" });
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const ALL = ["overview.read", "content.read", "feedback.read", "revenue.read", "users.read", "system.read"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.perms.mockReturnValue(ALL);
  mocks.owner.mockReturnValue(false);
  mocks.ops.mockResolvedValue(null);
});

describe("a18 GET /api/admin/inbox", () => {
  it("returns every queue with its oldest item, counts only", async () => {
    database((c) => {
      const head = c.columns === "id";
      if (c.table === "user_feedback") return head ? { count: 45 } : { data: [{ created_at: "2026-09-26T08:00:00Z" }] };
      if (c.table === "exam_attempts") return head ? { count: 1 } : { data: [{ created_at: "2026-10-11T08:00:00Z" }] };
      if (c.table === "referrals" && eqVal(c, "reward_type") === "pro_until_exam") return head ? { count: 3 } : { data: [{ hold_expires_at: "2026-10-01T00:00:00Z" }] };
      if (c.table === "referrals") return head ? { count: 0 } : { data: [] };
      return head ? { count: 0 } : { data: [] };
    });
    const res = await inbox(req("/api/admin/inbox"));
    const body = await res.json();
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(body).toMatchObject({ feedback: 45, puyp: 1, referral_rewards: 3, referral_payouts: 0, question_reports: 0, note_reports: 0, ops_actions: null, failed: [] });
    expect(body.oldest).toMatchObject({ feedback: "2026-09-26T08:00:00Z", puyp: "2026-10-11T08:00:00Z", referral_rewards: "2026-10-01T00:00:00Z", referral_payouts: null });
    expect(JSON.stringify(body)).not.toMatch(/email|user_id/);
  });

  it("a count that fails is null and listed in failed; one it may not read is null and not listed", async () => {
    mocks.perms.mockReturnValue(["content.read", "feedback.read"]);
    const { calls } = database((c) => {
      if (c.table === "user_feedback" && c.columns === "id") return { error: { message: "timeout" } };
      return c.columns === "id" ? { count: 2 } : { data: [] };
    });
    const body = await (await inbox(req("/api/admin/inbox"))).json();
    expect(body.feedback).toBeNull();
    expect(body.failed).toEqual(["feedback"]);
    expect(body.puyp).toBeNull();
    expect(body.referral_rewards).toBeNull();
    expect(calls.some((c) => c.table === "exam_attempts" || c.table === "referrals")).toBe(false);
  });

  it("owners see the Ops approvals count", async () => {
    mocks.owner.mockReturnValue(true);
    mocks.ops.mockResolvedValue(2);
    database((c) => (c.columns === "id" ? { count: 0 } : { data: [] }));
    expect((await (await inbox(req("/api/admin/inbox"))).json()).ops_actions).toBe(2);
  });
});

describe("a18 GET /api/admin/overview (Today)", () => {
  const world = (fail: string | null): FakeHandler => (c) => {
    if (fail === c.table) return { error: { message: "synthetic failure" } };
    if (c.table === "payment_events") return { data: [] };
    if (c.table === "payment_resolutions") return { data: [] };
    if (c.table === "webhook_attempts") return { data: [] };
    if (c.table === "subscriptions") return { data: [] };
    if (c.table === "users" && c.columns === "id") return { count: 4 };
    if (c.table === "users") return { data: [{ id: LEARNER, email: "user-610e28c1@example.com", role: "user", tier: "free", created_at: "2026-10-10T00:00:00Z" }] };
    if (c.table === "user_events" && c.columns === "id") return { count: 7 };
    if (c.table === "user_events") return { data: [] };
    if (c.table === "user_feedback") return { count: 3 };
    if (c.table === "cron_runs") return { data: [{ cron_name: "trial-reminder", status: "succeeded", started_at: "2026-10-12T05:00:00Z" }] };
    return {};
  };

  it("a failing block comes back null and named, the rest still loads", async () => {
    database(world("cron_runs"));
    const res = await overview(req("/api/admin/overview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failed).toEqual(["crons"]);
    expect(body.tiles.crons).toBeNull();
    expect(body.tiles.signups_today).toBe(4);
    expect(body.tiles.feedback_new).toBe(3);
    expect(body.tiles.free_limit_hits_today).toBe(7);
    expect(body.needs).toMatchObject({ unresolved: { count: 0 }, refunds_7d: { count: 0 }, ending_7d: { count: 0 } });
  });

  it("money failing never turns into zero money", async () => {
    database(world("payment_events"));
    const body = await (await overview(req("/api/admin/overview"))).json();
    expect(body.failed).toContain("money");
    expect(body.tiles.revenue).toBeNull();
    expect(body.needs).toBeNull();
    expect(body.tiles.signups_today).toBe(4);
  });

  it("counts the free-limit event since Vienna midnight, never paywall_hit, and returns no identity", async () => {
    const { calls } = database(world(null));
    const body = await (await overview(req("/api/admin/overview"))).json();
    const free = calls.find((c) => c.table === "user_events" && eqVal(c, "event_type") === "free_quota_cap_hit");
    expect(free).toBeTruthy();
    expect(calls.some((c) => eqVal(c, "event_type") === "paywall_hit")).toBe(false);
    const since = free!.filters.find((f) => f.kind === "gte")?.value as string;
    expect(new Date(since).toISOString().endsWith("T22:00:00.000Z") || new Date(since).toISOString().endsWith("T23:00:00.000Z")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/learner@gmail\.com/);
    expect(body.tiles).not.toHaveProperty("flagged_open");
  });

  it("withholds money and system blocks without the permissions", async () => {
    mocks.perms.mockReturnValue(["overview.read"]);
    const { calls } = database(world(null));
    const body = await (await overview(req("/api/admin/overview"))).json();
    expect(body.tiles.revenue).toBeNull();
    expect(body.tiles.crons).toBeNull();
    expect(body.tiles.feedback_new).toBeNull();
    expect(body.failed).toEqual([]);
    expect(calls.some((c) => c.table === "payment_events" || c.table === "cron_runs" || c.table === "user_feedback")).toBe(false);
  });
});
