import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), audit: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: vi.fn(() => "00000000-0000-4000-8000-0000000000b1") }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.audit, resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, rateKey: () => "fixture", callerIdentity: () => "fixture", callerIp: () => "fixture", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/admin/permissions", () => ({ loadAdminPermissionSnapshot: vi.fn(async () => ["content.moderate"]), canAccessAdminPermission: () => true }));
vi.mock("@/lib/bank-cache", () => ({ purgeBankCachesForEdit: vi.fn(async () => null) }));

import { PATCH as resolveSuggestion, POST as submitSuggestion } from "@/app/api/suggestions/route";
import { POST as submitFeedback } from "@/app/api/feedback/route";

const USER = "00000000-0000-4000-8000-0000000000b1";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`https://medpruf.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
}
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const rpcs = (calls: FakeCall[], fn: string) => calls.filter((c) => c.table === `rpc:${fn}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.rate.mockReturnValue({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 });
  vi.stubEnv("REWARDS_FIX_ENABLED", "true");
  vi.stubEnv("REWARDS_EXAM_REPORT_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

function reportDb(o: { status?: string; context?: Record<string, unknown>; type?: string; userId?: string } = {}) {
  return database(reportDbHandler(o));
}
function reportDbHandler(o: { status?: string; context?: Record<string, unknown>; type?: string; userId?: string } = {}): FakeHandler {
  return ((c: FakeCall) => {
    if (c.table === "question_suggestions" && c.op === "select") return { data: { id: 5, question_id: 1, user_id: o.userId ?? USER, type: o.type ?? "flag", status: o.status ?? "pending", suggested_changes: { explanation: "Neu" }, context: o.context ?? {}, admin_note: null, resolved_at: new Date().toISOString() } };
    if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 5 } };
    if (c.table === "questions" && c.op === "select") return { data: { id: 1, question: "Stem", explanation: o.status === "approved" ? "Neu" : "Alt", topic: "Innere" } };
    if (c.table === "users") return { data: { is_banned: false } };
    if (c.table === "ai_credit_lot") return { data: [] };
    if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "lot-f", granted_micro: 50_000 } };
    if (c.table === "rpc:mentor_clawback") return { data: { ok: true, duplicate: false, user_id: USER, clawed_micro: 50_000 } };
    return {};
  });
}

describe("applied fix reward in the resolve route", () => {
  it("a submitted report alone never grants anything", async () => {
    const { calls } = database((c) => (c.op === "insert" ? { data: { id: 9 } } : c.table === "users" ? { data: { id: USER } } : {}));
    expect((await submitSuggestion(req("/api/suggestions", "POST", { questionId: 1, type: "flag", reason: "wrong_answer", context: { fix_reward: { credits: 500 } } }))).status).toBe(200);
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
    const inserted = calls.find((c) => c.table === "question_suggestions" && c.op === "insert")!.payload as { context: Record<string, unknown> };
    expect(inserted.context.fix_reward).toBeUndefined();
  });
  it("Confirm as fixed grants 10 credits under reward:fix:<id> and stamps the report", async () => {
    const { calls } = reportDb();
    const res = await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", outcome: "fixed" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "approved", reward: { status: "granted", credits: 10 } });
    expect(rpcs(calls, "mentor_grant_credits")[0].payload).toMatchObject({ p_source: "admin_gift", p_source_id: "reward:fix:5", p_user: USER });
    const stamp = calls.filter((c) => c.table === "question_suggestions" && c.op === "update").at(-1)!;
    expect((stamp.payload as { context: { fix_reward: { credits: number } } }).context.fix_reward.credits).toBe(10);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "mentor_fix_reward_granted" }));
  });
  it("Confirm as accepted (not fixed) and Dismiss grant nothing", async () => {
    for (const body of [{ action: "approve", outcome: "accepted" }, { action: "reject", outcome: "not_an_error" }]) {
      const { calls } = reportDb();
      const res = await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, ...body }));
      expect(res.status).toBe(200);
      expect((await res.json()).reward).toBeUndefined();
      expect(rpcs(calls, "mentor_grant_credits")).toHaveLength(0);
    }
  });
  it("flag off: same response shape, no ledger call", async () => {
    vi.stubEnv("REWARDS_FIX_ENABLED", "");
    const { calls } = reportDb();
    const body = await (await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", outcome: "fixed" }))).json();
    expect(body).toEqual({ ok: true, status: "approved", applied: false });
    expect(calls.some((c) => c.table.startsWith("rpc:") || c.table === "ai_credit_lot")).toBe(false);
  });
  it("revert of an applied edit claws the reward back, even with the flag off once stamped", async () => {
    vi.stubEnv("REWARDS_FIX_ENABLED", "");
    const { calls } = reportDb({ type: "edit", status: "approved", context: { applied_edit: { before: { explanation: "Alt" }, after: { explanation: "Neu" } }, fix_reward: { credits: 10, at: "x", lot_id: "lot-f" } } });
    const res = await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "revert" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "reverted", reward: { status: "clawed_back", credits: 10 } });
    expect(rpcs(calls, "mentor_clawback")[0].payload).toMatchObject({ p_source: "admin_gift", p_source_id: "reward:fix:5" });
  });
  it("undo keeps the reward; re-resolving as fixed keeps it, as not fixed claws back", async () => {
    const stamped = { reporter_outcome: "fixed", fix_reward: { credits: 10, at: "x" } };
    const undo = reportDb({ status: "approved", context: stamped });
    expect((await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "reopen" }))).status).toBe(200);
    expect(rpcs(undo.calls, "mentor_clawback")).toHaveLength(0);
    const base = reportDbHandler({ context: { fix_reward: { credits: 10, at: "x" } } });
    database((c) => c.table === "rpc:mentor_grant_credits" ? { data: { ok: true, duplicate: true, lot_id: "lot-f", granted_micro: 50_000 } } : c.table === "ai_credit_lot" ? { data: [{ id: "lot-f" }] } : base(c));
    const fixed = await (await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", outcome: "fixed" }))).json();
    expect(fixed.reward).toEqual({ status: "skipped", reason: "already_rewarded" });
    const notFixed = reportDb({ context: { fix_reward: { credits: 10, at: "x" } } });
    const body = await (await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "reject", outcome: "not_an_error" }))).json();
    expect(body.reward).toEqual({ status: "clawed_back", credits: 10 });
    expect(rpcs(notFixed.calls, "mentor_clawback")).toHaveLength(1);
  });
  it("an admin never rewards their own report", async () => {
    const { calls } = database(reportDbHandler({ userId: ADMIN }));
    await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", outcome: "fixed" }));
    expect(rpcs(calls, "mentor_grant_credits")).toHaveLength(0);
  });
});

describe("exam report submission", () => {
  const eligible = (c: FakeCall) => {
    if (c.table === "users") return { data: { id: USER } };
    if (c.table === "answer_history") return { data: Array.from({ length: 20 }, (_, i) => ({ question_id: i, created_at: i < 10 ? "2026-11-01T08:00:00Z" : "2026-11-02T08:00:00Z" })) };
    if (c.table === "subscriptions") return { data: [] };
    if (c.table === "user_feedback" && c.op === "select") return { data: [] };
    if (c.table === "user_feedback" && c.op === "insert") return { data: null };
    return {};
  };
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T10:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("stores consent and the sitting server-side; admin-only keys from the body are dropped; nothing is granted", async () => {
    const { calls } = database(eligible);
    const res = await submitFeedback(req("/api/feedback", "POST", { message: "Die Organisation war gut, viele Fragen zur Kardiologie.", context: { kind: "exam_report", sitting_key: "sip4a:2026-11-18", consent_public: true, reward_granted_at: "forged", exam_report: { consent_public: false } } }));
    expect(res.status).toBe(200);
    const row = calls.find((c) => c.table === "user_feedback" && c.op === "insert")!.payload as { context: Record<string, unknown> };
    expect(row.context).toMatchObject({ kind: "exam_report", sitting_key: "sip4a:2026-11-18", exam_report: { consent_public: true, sitting_key: "sip4a:2026-11-18" } });
    expect(row.context.reward_granted_at).toBeUndefined();
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
  });
  it("refuses a closed sitting, a second report and the flag off", async () => {
    database(eligible);
    expect((await submitFeedback(req("/api/feedback", "POST", { message: "Bericht zum Termin im Februar, alles gut.", context: { kind: "exam_report", sitting_key: "sip4a:2027-02-19", consent_public: false } }))).status).toBe(409);
    database((c) => (c.table === "user_feedback" && c.op === "select" ? { data: [{ id: 1 }] } : eligible(c)));
    const dup = await submitFeedback(req("/api/feedback", "POST", { message: "Noch ein Bericht zu derselben Prüfung.", context: { kind: "exam_report", sitting_key: "sip4a:2026-11-18", consent_public: false } }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("already_sent");
    vi.stubEnv("REWARDS_EXAM_REPORT_ENABLED", "");
    database(eligible);
    expect((await submitFeedback(req("/api/feedback", "POST", { message: "Bericht bei ausgeschaltetem Schalter.", context: { kind: "exam_report", sitting_key: "sip4a:2026-11-18", consent_public: false } }))).status).toBe(404);
  });
});
