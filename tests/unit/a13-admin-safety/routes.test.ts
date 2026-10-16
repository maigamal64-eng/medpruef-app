import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), audit: vi.fn(), email: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: vi.fn(() => null) }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.audit, resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, rateKey: () => "fixture", callerIdentity: () => "fixture", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: mocks.email }));
vi.mock("@/lib/user-events", () => ({ recordEventSafe: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/admin/permissions", () => ({ loadAdminPermissionSnapshot: vi.fn(async () => ["users.read", "revenue.read"]), canAccessAdminPermission: () => true }));

import { PATCH as resolveSuggestion, POST as submitSuggestion } from "@/app/api/suggestions/route";
import { PATCH as editUser } from "@/app/api/stats/admin/users/route";
import { POST as grant } from "@/app/api/admin/users/grant/route";
import { POST as puyp } from "@/app/api/puyp/admin/route";
import { POST as bulk } from "@/app/api/admin/puyp/bulk-approve/route";
import { GET as duplicates } from "@/app/api/stats/admin/duplicates/route";
import { POST as revokeAll } from "@/app/api/admin/session/revoke-all/route";

const USER = "00000000-0000-4000-8000-0000000000b1";
const ATTEMPT = "00000000-0000-4000-8000-0000000000d1";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`https://medpruf.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
}
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const writes = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table && c.op !== "select");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.rate.mockReturnValue({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 });
  mocks.email.mockResolvedValue({ ok: true });
});

describe("ADM-05 suggestions", () => {
  it("throttles the public report endpoint", async () => {
    mocks.rate.mockReturnValue({ allowed: false, remaining: 0, resetAt: 0, retryAfterSec: 60 });
    database(() => ({}));
    expect((await submitSuggestion(req("/api/suggestions", "POST", { questionId: 1, type: "flag" }))).status).toBe(429);
  });
  it("stores only question/explanation/topic proposals", async () => {
    const { calls } = database((c) => (c.op === "insert" ? { data: { id: 9 } } : {}));
    const res = await submitSuggestion(req("/api/suggestions", "POST", { questionId: 1, type: "edit", suggestedChanges: { explanation: "Neu", answer: "B", choices: [{ text: "x" }] } }));
    expect(res.status).toBe(200);
    expect((writes(calls, "question_suggestions")[0].payload as { suggested_changes: unknown }).suggested_changes).toEqual({ explanation: "Neu" });
  });
  it("refuses to resolve a report that is no longer pending", async () => {
    const { calls } = database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: { id: 5, question_id: 1, type: "edit", status: "approved", suggested_changes: { question: "x" }, context: {} } } : {}));
    expect((await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", applyEdit: true }))).status).toBe(409);
    expect(writes(calls, "questions")).toHaveLength(0);
  });
  it("applies only the shown diff, never answer/choices, and keeps the before copy", async () => {
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: { id: 5, question_id: 1, type: "edit", status: "pending", suggested_changes: { explanation: "Neu", answer: "B", choices: [] }, context: { ip: null } } };
      if (c.table === "questions" && c.op === "select") return { data: { id: 1, question: "Stem", explanation: "Alt", topic: "Innere" } };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 5 } };
      return {};
    });
    const res = await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", applyEdit: true, expectedBefore: { explanation: "Alt" } }));
    expect(res.status).toBe(200);
    const claim = writes(calls, "question_suggestions")[0];
    expect(claim.filters).toContainEqual({ kind: "eq", column: "status", value: "pending" });
    expect((claim.payload as { context: { applied_edit: unknown } }).context.applied_edit).toMatchObject({ before: { explanation: "Alt" }, after: { explanation: "Neu" } });
    expect(writes(calls, "questions")[0].payload).toEqual({ explanation: "Neu" });
  });
  it("refuses when the live text moved after the admin opened the diff", async () => {
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: { id: 5, question_id: 1, type: "edit", status: "pending", suggested_changes: { explanation: "Neu" }, context: {} } };
      if (c.table === "questions" && c.op === "select") return { data: { id: 1, question: "Stem", explanation: "Edited by someone", topic: "Innere" } };
      return {};
    });
    expect((await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "approve", applyEdit: true, expectedBefore: { explanation: "Alt" } }))).status).toBe(409);
    expect(writes(calls, "questions")).toHaveLength(0);
  });
  it("reverts an applied edit only while the question still shows it", async () => {
    const applied = { before: { explanation: "Alt" }, after: { explanation: "Neu" } };
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: { id: 5, question_id: 1, type: "edit", status: "approved", suggested_changes: {}, context: { applied_edit: applied } } };
      if (c.table === "questions" && c.op === "select") return { data: { id: 1, question: "Stem", explanation: "Neu", topic: "Innere" } };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 5 } };
      return {};
    });
    expect((await resolveSuggestion(req("/api/suggestions", "PATCH", { suggestionId: 5, action: "revert" }))).status).toBe(200);
    expect(writes(calls, "questions")[0].payload).toEqual({ explanation: "Alt" });
  });
});

describe("ADM-06 learner edits and grants", () => {
  it("rejects a duplicate email and writes nothing", async () => {
    const { calls } = database((c) => {
      if (c.table === "users" && c.single) return { data: { id: USER, email: "old@example.invalid", first_name: null, last_name: null } };
      if (c.table === "users" && c.filters.some((f) => f.kind === "ilike")) return { data: [{ id: "someone-else" }] };
      return {};
    });
    const res = await editUser(req("/api/stats/admin/users", "PATCH", { userId: USER, updates: { email: "Taken@Example.invalid" } }));
    expect(res.status).toBe(409);
    expect(writes(calls, "users")).toHaveLength(0);
  });
  it("a-release-int-7: an email change clears email_verified_at and audits it", async () => {
    const { calls } = database((c) => {
      if (c.table === "users" && c.single) return { data: { id: USER, email: "old@example.invalid", first_name: null, last_name: null, email_verified_at: "2026-10-20T08:00:00Z" } };
      if (c.table === "users" && c.filters.some((f) => f.kind === "ilike")) return { data: [] };
      return {};
    });
    const res = await editUser(req("/api/stats/admin/users", "PATCH", { userId: USER, updates: { email: " New@Example.invalid " } }));
    expect(res.status).toBe(200);
    const [update] = writes(calls, "users");
    expect(update.payload).toMatchObject({ email: "new@example.invalid", email_verified_at: null });
    expect(mocks.audit.mock.calls[0][0].payload).toMatchObject({
      before: { email: "old@example.invalid", email_verified_at: "2026-10-20T08:00:00Z" },
      after: { email: "new@example.invalid", email_verified_at: null },
    });
  });
  it("a-release-int-7: a name-only edit or an unchanged address keeps email_verified_at", async () => {
    const { calls } = database((c) => {
      if (c.table === "users" && c.single) return { data: { id: USER, email: "same@example.invalid", first_name: "Old", last_name: null, email_verified_at: "2026-10-20T08:00:00Z" } };
      return {};
    });
    const res = await editUser(req("/api/stats/admin/users", "PATCH", { userId: USER, updates: { first_name: "New", email: "Same@Example.invalid" } }));
    expect(res.status).toBe(200);
    const [update] = writes(calls, "users");
    expect(update.payload).toMatchObject({ first_name: "New" });
    expect(update.payload as Record<string, unknown>).not.toHaveProperty("email_verified_at");
    expect(update.payload as Record<string, unknown>).not.toHaveProperty("email");
  });
  it("a-release-int-7: a case-only rewrite of the stored address keeps email_verified_at", async () => {
    const { calls } = database((c) => {
      if (c.table === "users" && c.single) return { data: { id: USER, email: "Mixed@Example.invalid", first_name: null, last_name: null, email_verified_at: "2026-10-20T08:00:00Z" } };
      if (c.table === "users" && c.filters.some((f) => f.kind === "ilike")) return { data: [] };
      return {};
    });
    const res = await editUser(req("/api/stats/admin/users", "PATCH", { userId: USER, updates: { email: "mixed@example.invalid" } }));
    expect(res.status).toBe(200);
    const [update] = writes(calls, "users");
    expect(update.payload).toMatchObject({ email: "mixed@example.invalid" });
    expect(update.payload as Record<string, unknown>).not.toHaveProperty("email_verified_at");
  });
  it("audits before and after values and keeps reset counters", async () => {
    database((c) => {
      if (c.table === "users" && c.single) return { data: { id: USER, email: null, first_name: "Old", last_name: null } };
      if (c.table === "user_gamification" && c.single) return { data: { total_xp: 120, current_streak: 4 } };
      return {};
    });
    const res = await editUser(req("/api/stats/admin/users", "PATCH", { userId: USER, updates: { first_name: "New", email: "", reset_gamification: true } }));
    expect(res.status).toBe(200);
    expect(mocks.audit.mock.calls[0][0].payload).toMatchObject({ before: { first_name: "Old" }, after: { first_name: "New" }, previous_gamification: { total_xp: 120 } });
  });
  it("blocks a dated grant on permanent Pro before calling the database function", async () => {
    const { calls } = database((c) => (c.table === "users" ? { data: { tier: "pro", tier_expires_at: null } } : {}));
    expect((await grant(req("/api/admin/users/grant", "POST", { user_id: USER, days: 30, reason: "Goodwill" }))).status).toBe(409);
    expect(calls.some((c) => c.table === "rpc:admin_grant_entitlement")).toBe(false);
  });
  it("replays a repeated idempotency key instead of stacking", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    const { calls } = database((c) => {
      if (c.table === "users") return { data: { tier: "pro", tier_expires_at: "2026-12-01T00:00:00Z" } };
      if (c.table === "admin_audit_log") return { data: [{ payload: { new_expiry: "2027-01-01T00:00:00Z" } }] };
      return {};
    });
    const body = await (await grant(req("/api/admin/users/grant", "POST", { user_id: USER, days: 30, reason: "Goodwill", idempotency_key: key }))).json();
    expect(body).toMatchObject({ ok: true, duplicate: true });
    expect(calls.some((c) => c.table === "rpc:admin_grant_entitlement")).toBe(false);
  });
});

describe("ADM-19 / UX-ADM-22 PUYP", () => {
  const attempt = { id: ATTEMPT, user_id: USER, subscription_id: "sub", exam_type: "kenntnispruefung", result: "fail", verified_at: null, rejection_reason: null };
  it("approves through the guarded function and never writes access directly", async () => {
    const { calls } = database((c) => {
      if (c.table === "exam_attempts") return { data: attempt };
      if (c.table === "rpc:admin_puyp_approve") return { data: { new_expires_at: "2027-04-01T00:00:00Z", previous_expires_at: "2027-05-01T00:00:00Z", user_id: USER, user_access: "kept_permanent", extensions_used: 1 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: "Ada", language_code: "de" } };
      return {};
    });
    const res = await puyp(req("/api/puyp/admin", "POST", { attempt_id: ATTEMPT, action: "approve" }));
    expect(res.status).toBe(200);
    expect(writes(calls, "subscriptions")).toHaveLength(0);
    expect(writes(calls, "users")).toHaveLength(0);
    expect((calls.find((c) => c.table === "rpc:admin_puyp_approve")?.payload as { p_via: string }).p_via).toBe("single");
  });
  it("returns 503 until the a13 migration exists, for single and bulk", async () => {
    database((c) => {
      if (c.table === "exam_attempts") return { data: attempt };
      if (c.table === "rpc:admin_puyp_approve") return { error: { code: "PGRST202", message: "missing" } };
      return {};
    });
    expect((await puyp(req("/api/puyp/admin", "POST", { attempt_id: ATTEMPT, action: "approve" }))).status).toBe(503);
    const bulkBody = await (await bulk(req("/api/admin/puyp/bulk-approve", "POST", { attempt_ids: [ATTEMPT, "00000000-0000-4000-8000-0000000000d2"] }))).json();
    expect(bulkBody.results).toHaveLength(1);
    expect(bulkBody.results[0].ok).toBe(false);
  });
  it("reports a rejection the learner did not receive", async () => {
    mocks.email.mockResolvedValue({ ok: false, reason: "not_configured" });
    database((c) => {
      if (c.table === "exam_attempts" && c.op === "select") return { data: attempt };
      if (c.table === "exam_attempts" && c.op === "update") return { data: { id: ATTEMPT } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: null, language_code: "de" } };
      return {};
    });
    const body = await (await puyp(req("/api/puyp/admin", "POST", { attempt_id: ATTEMPT, action: "reject", reason: "Datum fehlt" }))).json();
    expect(body).toMatchObject({ ok: true, learner_notified: false });
    expect(mocks.audit.mock.calls.map((call) => call[0].action)).toEqual(["reject_puyp"]);
  });
  it("records a manual notification for a rejected claim", async () => {
    database((c) => (c.table === "exam_attempts" ? { data: { ...attempt, verified_at: "2026-10-12T00:00:00Z", rejection_reason: "Datum fehlt" } } : {}));
    expect((await puyp(req("/api/puyp/admin", "POST", { attempt_id: ATTEMPT, action: "mark_notified" }))).status).toBe(200);
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({ action: "puyp_rejection_notified", payload: { channel: "manual" } });
  });
});

describe("ADM-21 duplicates and ADM-17 session revocation", () => {
  it("pages through the whole bank when the function is missing", async () => {
    let page = 0;
    const { calls } = database((c) => {
      if (c.table === "rpc:find_duplicate_questions") return { error: { code: "PGRST202" } };
      page += 1;
      const base = (page - 1) * 1000;
      const size = page === 1 ? 1000 : 3;
      return { data: Array.from({ length: size }, (_, i) => ({ id: base + i + 1, question: i === 0 ? "Gleiche Frage mit genug Zeichen" : `Frage ${base + i} mit genug Zeichen`, topic: "T", exam_type: "kenntnispruefung", exam_dates: null, anki_note_id: null })) };
    });
    const body = await (await duplicates(req("/api/stats/admin/duplicates?exam=kenntnispruefung", "GET"))).json();
    expect(body).toMatchObject({ source: "paged", totalGroups: 1, totalExtraCopies: 1, examType: "kenntnispruefung" });
    expect(calls.filter((c) => c.table === "questions")).toHaveLength(2);
    expect(eqVal(calls.filter((c) => c.table === "questions")[0], "exam_type")).toBe("kenntnispruefung");
  });
  it("revoke-all stamps only the caller's own account", async () => {
    const { calls } = database(() => ({}));
    expect((await revokeAll(req("/api/admin/session/revoke-all", "POST"))).status).toBe(200);
    const update = writes(calls, "users")[0];
    expect(eqVal(update, "id")).toBe(ADMIN);
    expect(Object.keys(update.payload as object)).toEqual(["session_invalidated_at"]);
  });
});
