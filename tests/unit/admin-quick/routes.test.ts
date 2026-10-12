import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeHandler } from "../helpers/fake-supabase";
const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), capture: vi.fn(), audit: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: vi.fn() }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.audit, resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: mocks.capture }));
vi.mock("@/lib/admin/permissions", () => ({ loadAdminPermissionSnapshot: mocks.snapshot, canAccessAdminPermission: (snapshot: string[], permission: string) => snapshot.includes(permission) }));
import { GET as audit } from "@/app/api/admin/audit/route";
import { GET as latest } from "@/app/api/admin/audit-log/latest/route";
import { GET as webhooks } from "@/app/api/admin/webhooks/route";
import { GET as env } from "@/app/api/admin/env/route";
import { GET as crons } from "@/app/api/admin/crons/route";
import { GET as subscriptions } from "@/app/api/admin/subscriptions/route";
import { GET as overview } from "@/app/api/admin/overview/route";
import { GET as questions, PATCH as editQuestion } from "@/app/api/stats/admin/questions/route";
import { GET as suggestions } from "@/app/api/suggestions/route";
import { GET as feedback } from "@/app/api/feedback/route";
import { POST as markPaid } from "@/app/api/admin/referrals/mark-paid/route";
import { computeGrowthMetrics } from "@/lib/admin/growthMetrics";
import type { SupabaseClient } from "@supabase/supabase-js";
function request(path: string, body?: unknown) { return new NextRequest(`https://medpruf.com${path}`, body ? { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}); }
function database(handler: FakeHandler = () => ({ data: [], count: 0 })) { const fake = createFakeSupabase(handler); mocks.db.mockReturnValue(fake.sb); return fake; }
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: "synthetic-admin", role: "admin", tier: "admin" }); mocks.snapshot.mockResolvedValue(["users.read", "revenue.read", "system.read"]); database(); });

describe("ADM-Q04 minimal responses", () => {
  it("audit excludes IP and caps to the 200 displayed rows", async () => {
    const { calls } = database(); await audit(request("/api/admin/audit"));
    expect(calls[0].columns).not.toContain("ip_address"); expect(calls[0].limit).toBe(200);
  });
  it("webhook query does not select raw payload", async () => {
    const { calls } = database(); await webhooks(request("/api/admin/webhooks")); expect(calls[0].columns).not.toContain("payload");
  });
  it("audit summary exposes counts/action time only", async () => {
    database(() => ({ data: [{ action: "edit_question", created_at: "2026-10-11T12:00:00Z" }], count: 7 }));
    expect(await (await latest(request("/api/admin/audit-log/latest"))).json()).toEqual({ today_count: 7, last_action_at: "2026-10-11T12:00:00Z", last_action: "edit_question" });
  });
  it("env returns names and presence with no prefix/suffix/length hints", async () => {
    const response = await env(request("/api/admin/env")); const body = await response.json();
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(["name", "present"]);
  });
  it("overview activity queries use HEAD counts instead of identities", async () => {
    const { calls } = database(); const response = await overview(request("/api/admin/overview")); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.tiles.recent_events_aggregate).toEqual({ total_last_24h: 0 }); expect(body.tiles.recent_events).toBeNull();
    // a14: the money tiles read payment/subscription owners server-side to
    // count distinct payers; the response carries counts only. The activity
    // feed itself must still never select identities.
    expect(calls.some((call) => call.table === "user_events" && call.columns?.includes("user_id"))).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/user_id/);
  });
});
describe("ADM-Q05 sanitized database failures", () => {
  it.each([["latest", latest], ["crons", crons], ["questions", questions]] as const)("%s failure has a request id and no DB text", async (_, route) => {
    database(() => ({ error: { message: "private table and SQL details" } }));
    const response = await route(request("/api/admin/test")); expect(response.status).toBe(500); const body = await response.json(); expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/); expect(JSON.stringify(body)).not.toContain("private table");
  });
  it("browse query errors are sanitized too", async () => { database(() => ({ error: { message: "SQL detail" } })); const response = await questions(request("/api/stats/admin/questions?mode=browse")); expect(await response.json()).toHaveProperty("requestId"); });
});
describe("ADM-Q07/Q08 failures stay failures", () => {
  it.each(["subscriptions", "users", "user_events", "referrals", "exam_attempts", "user_feedback", "cron_runs"])("overview does not emit colored zeros when %s fails", async (table) => {
    database((call) => call.table === table ? { error: { message: "synthetic failure" } } : { data: [], count: 0 }); expect((await overview(request("/api/admin/overview"))).status).toBe(500);
  });
  it("audit count failure cannot look like zero actions", async () => { database((call) => call.columns === "id" ? { error: { message: "count failed" } } : { data: [] }); expect((await latest(request("/api/admin/audit-log/latest"))).status).toBe(500); });
  it("subscriptions fails when either read fails", async () => { database((call) => call.columns?.includes("expires_at") ? { error: { message: "failed" } } : { data: [] }); expect((await subscriptions(request("/api/admin/subscriptions"))).status).toBe(500); });
  it.each(["users", "subscriptions", "answer_history"])("growth fails on %s errors", async (table) => {
    const { sb } = database((call) => call.table === table ? { error: { message: "failed" } } : { data: [{ id: "synthetic-learner", user_id: "synthetic-learner", email: null, role: "user" }], count: 0 });
    await expect(computeGrowthMetrics(sb as unknown as SupabaseClient)).rejects.toMatchObject({ message: "failed" });
  });
});
describe("ADM-Q09 feedback queue", () => {
  it("includes both new and reviewed before applying the limit", async () => { const { calls } = database(); await feedback(request("/api/feedback?status=needs_action")); expect(calls[0].filters).toContainEqual({ kind: "in", column: "status", value: ["new", "reviewed"] }); });
});
describe("ADM-Q10/Q12 counts", () => {
  it("uses complete RPC counts and preserves exam filter", async () => {
    const { calls } = database((call) => call.table === "rpc:get_topic_counts" ? { data: [{ topic: "Full bank", count: "5000" }, { topic: "Other", count: 80 }] } : { data: [], count: 100 });
    const body = await (await questions(request("/api/stats/admin/questions?examType=kmp_innsbruck"))).json();
    expect(body.byTopic).toEqual([{ topic: "Full bank", count: 5000 }, { topic: "Other", count: 80 }]);
    expect(calls.find((call) => call.table === "rpc:get_topic_counts")?.payload).toEqual({ p_exam_type: "kmp_innsbruck" });
  });
  it("does not dilute MCQ share with pharma", async () => {
    const { calls } = database((call) => ({ data: [], count: call.filters.some((f) => f.kind === "in") ? 100 : 150 }));
    const body = await (await questions(request("/api/stats/admin/questions"))).json(); expect(body.mcqPct).toBe(100);
    expect(calls.filter((call) => call.filters.some((f) => f.column === "exam_type" && f.kind === "in"))).toHaveLength(2);
  });
});
describe("ADM-Q14 audited question deltas", () => {
  it("saves and audits only the changed field", async () => {
    const { calls } = database((call) => call.single ? { data: { explanation: "old", topic: "same", is_active: true } } : {});
    expect((await editQuestion(request("/api/stats/admin/questions", { questionId: 42, updates: { explanation: "new", topic: "same" } }))).status).toBe(200);
    expect(calls.find((call) => call.op === "update")?.payload).toEqual({ explanation: "new" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ payload: { applied_fields: ["explanation"], before: { explanation: "old" }, after: { explanation: "new" } } }));
  });
  it("does not write or audit a no-op", async () => { const { calls } = database(() => ({ data: { explanation: null, topic: "same", is_active: true } })); expect(await (await editQuestion(request("/api/stats/admin/questions", { questionId: 42, updates: { explanation: "", topic: "same" } }))).json()).toMatchObject({ unchanged: true }); expect(calls.some((call) => call.op === "update")).toBe(false); expect(mocks.audit).not.toHaveBeenCalled(); });
});
describe("ADM-Q16 learner identity permissions", () => {
  it("content-only reviewers see Learner and never query learner identities", async () => {
    mocks.snapshot.mockResolvedValue(["content.read"]);
    const { calls } = database((call) => call.table === "question_suggestions" && call.columns?.includes("question_id") ? { data: [{ id: 1, user_id: "synthetic-learner", question_id: 42 }] } : { data: [], count: 0 });
    const body = await (await suggestions(request("/api/suggestions"))).json(); expect(body.suggestions[0].user_name).toBe("Learner"); expect(body.suggestions[0]).not.toHaveProperty("user_id"); expect(calls.some((call) => call.table === "users")).toBe(false);
  });
});
describe("ADM-Q25 referral compare-and-set", () => {
  it("two overlapping requests produce one payout audit and one 409", async () => {
    let claimed = false;
    const { calls } = database((call) => {
      if (call.op === "select") return { data: { id: "synthetic-referral", status: "qualified", reward_type: "cash" } };
      if (claimed) return { data: null };
      claimed = true; return { data: { id: "synthetic-referral" } };
    });
    const responses = await Promise.all([markPaid(request("/api/admin/referrals/mark-paid", { referral_id: "synthetic-referral" })), markPaid(request("/api/admin/referrals/mark-paid", { referral_id: "synthetic-referral" }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]); expect(mocks.audit).toHaveBeenCalledOnce();
    for (const call of calls.filter((c) => c.op === "update")) expect(call.filters).toContainEqual({ kind: "eq", column: "status", value: "qualified" });
  });
});
