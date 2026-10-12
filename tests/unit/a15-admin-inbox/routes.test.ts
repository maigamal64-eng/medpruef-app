import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), user: vi.fn(), audit: vi.fn(), email: vi.fn(), perms: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, requireUser: mocks.user, resolveOptionalUser: vi.fn(() => null) }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: mocks.audit, resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 }), rateKey: () => "k", callerIdentity: () => "c", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: mocks.email }));
vi.mock("@/lib/admin/permissions", () => ({
  loadAdminPermissionSnapshot: vi.fn(async () => mocks.perms()),
  canAccessAdminPermission: (snapshot: string[], permission: string) => snapshot.includes(permission),
}));

import { GET as adminList, PATCH, POST } from "@/app/api/suggestions/route";
import { GET as mine } from "@/app/api/suggestions/mine/route";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`https://medpruf.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const writes = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table && c.op !== "select");
const row = (over: Record<string, unknown> = {}) => ({ id: 7, question_id: 11, user_id: LEARNER, type: "flag", status: "pending", suggested_changes: null, context: { url: "/quiz" }, admin_note: null, created_at: "2026-10-10T08:00:00Z", resolved_at: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED;
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.user.mockResolvedValue({ userId: LEARNER });
  mocks.perms.mockReturnValue(["content.read", "content.moderate", "users.read"]);
  mocks.email.mockResolvedValue({ ok: true });
});
afterEach(() => { delete process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED; });

describe("a15 PATCH /api/suggestions", () => {
  it("needs content.moderate", async () => {
    mocks.perms.mockReturnValue(["content.read"]);
    const { calls } = database(() => ({}));
    expect((await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve" }))).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("with the email flag off: same response shape, no mail, outcome stored", async () => {
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row() };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reject", outcome: "needs_info", adminNote: "Bitte Bild senden" }));
    expect(await res.json()).toEqual({ ok: true, status: "rejected", applied: false });
    expect(mocks.email).not.toHaveBeenCalled();
    const claim = writes(calls, "question_suggestions")[0];
    expect((claim.payload as { context: Record<string, unknown> }).context.reporter_outcome).toBe("needs_info");
  });

  it("rejects an outcome that does not fit the action", async () => {
    database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: row() } : {}));
    expect((await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "not_an_error" }))).status).toBe(400);
  });

  it("with the flag on: mails once, claims notified_at before sending", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row() };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: "Amira", language_code: "de" } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "fixed", adminNote: "Neuer Schlüssel: B" }));
    expect(await res.json()).toEqual({ ok: true, status: "approved", applied: false, notified: true });
    expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(mocks.email.mock.calls[0][0].to).toBe("learner@example.invalid");
    const claim = writes(calls, "question_suggestions")[1];
    expect(claim.filters).toContainEqual({ kind: "is", column: "context->>notified_at", value: null });
    expect((claim.payload as { context: Record<string, unknown> }).context.notified_at).toEqual(expect.any(String));
  });

  it("never mails an anonymous report", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ user_id: null }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reject", outcome: "not_an_error" }));
    expect((await res.json()).notified).toBe(false);
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("a mail failure never changes the resolution and releases the claim", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    mocks.email.mockResolvedValue({ ok: false, reason: "send_failed" });
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row() };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: null, language_code: "en" } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "accepted" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", notified: false });
    const release = writes(calls, "question_suggestions")[2];
    expect((release.payload as { context: Record<string, unknown> }).context.notified_at).toBeUndefined();
    expect((release.payload as { context: Record<string, unknown> }).context.notify_error).toMatchObject({ reason: "send_failed" });
  });

  it("notify refuses a report that was already emailed", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: row({ status: "approved", context: { reporter_outcome: "fixed", notified_at: "2026-10-11T00:00:00Z" } }) } : {}));
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "notify" }));
    expect(res.status).toBe(409);
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("reopen undoes a recent decision with a compare-and-set", async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ status: "rejected", resolved_at: recent, admin_note: "n", context: { reporter_outcome: "not_an_error" } }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reopen" }));
    expect(await res.json()).toEqual({ ok: true, status: "pending" });
    const write = writes(calls, "question_suggestions")[0];
    expect(write.filters).toContainEqual({ kind: "eq", column: "status", value: "rejected" });
    expect(write.payload).toMatchObject({ status: "pending", admin_note: null, resolved_at: null, context: {} });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "reopen_question_report" }));
  });

  it("reopen refuses old decisions and applied edits", async () => {
    database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: row({ status: "approved", resolved_at: "2026-01-01T00:00:00Z" }) } : {}));
    expect((await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reopen" }))).status).toBe(409);
    database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: row({ status: "approved", resolved_at: new Date().toISOString(), context: { applied_edit: { before: {}, after: {} } } }) } : {}));
    expect((await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reopen" }))).status).toBe(409);
  });
});

describe("a15 GET /api/suggestions (admin)", () => {
  it("needs content.read and resolves a deep link by id", async () => {
    mocks.perms.mockReturnValue([]);
    database(() => ({}));
    expect((await adminList(req("/api/suggestions?id=7", "GET"))).status).toBe(403);

    mocks.perms.mockReturnValue(["content.read"]);
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.columns?.startsWith("id, question_id")) return { data: [row({ context: { url: { bad: true }, reporter_outcome: "fixed" } })], count: 1 };
      if (c.table === "questions") return { data: [{ id: 11, question: "Voller Stamm", topic: "Innere", choices: [{ text: "A", correct: true }], answer: "A", explanation: "E", is_active: true }] };
      return { count: 0 };
    });
    const res = await adminList(req("/api/suggestions?id=7&status=all", "GET"));
    const body = await res.json();
    expect(calls[0].filters).toContainEqual({ kind: "eq", column: "id", value: 7 });
    expect(calls[0].filters.some((f) => f.column === "status")).toBe(false);
    expect(calls.some((c) => c.table === "users")).toBe(false);
    expect(body.suggestions[0]).toMatchObject({ question_full: "Voller Stamm", question_answer: "A", report_page: "/[object%20Object]", reporter_outcome: "fixed", reporter_contactable: null, reporter_id: null, user_name: "Learner" });
    expect(body.suggestions[0].context).toBeUndefined();
    expect(body.email_enabled).toBe(false);
  });
});

describe("a15 POST /api/suggestions", () => {
  it("drops an invalid page url instead of storing it", async () => {
    const { calls } = database((c) => (c.op === "insert" ? { data: { id: 9 } } : {}));
    const res = await POST(req("/api/suggestions", "POST", { questionId: 1, type: "flag", reason: "typo", context: { url: "javascript:alert(1)", viewport: "390x844" } }));
    expect(res.status).toBe(200);
    const stored = (writes(calls, "question_suggestions")[0].payload as { context: Record<string, unknown> }).context;
    expect(stored.url).toBeUndefined();
    expect(stored.viewport).toBe("390x844");
  });
});

describe("a15 GET /api/suggestions/mine", () => {
  it("returns a learner state and a turnaround, never context or notes", async () => {
    const resolved = (h: number) => ({ created_at: "2026-10-01T00:00:00Z", resolved_at: new Date(Date.parse("2026-10-01T00:00:00Z") + h * 3_600_000).toISOString() });
    database((c) => {
      if (c.columns?.includes("context")) return { data: [
        { id: 1, question_id: 5, type: "flag", status: "approved", created_at: "2026-10-01T00:00:00Z", resolved_at: "2026-10-02T00:00:00Z", context: { reporter_outcome: "fixed", ip: "1.2.3.4" } },
        { id: 2, question_id: 6, type: "flag", status: "rejected", created_at: "2026-10-01T00:00:00Z", resolved_at: "2026-10-02T00:00:00Z", context: { reporter_outcome: "needs_info" } },
      ], count: 2 };
      return { data: [resolved(7), resolved(20), resolved(21), resolved(30), resolved(40)] };
    });
    const res = await mine(new NextRequest("https://medpruf.com/api/suggestions/mine"));
    const body = await res.json();
    expect(body.suggestions.map((s: { state: string }) => s.state)).toEqual(["fixed", "needs_info"]);
    expect(JSON.stringify(body)).not.toContain("1.2.3.4");
    expect(body.suggestions[0].context).toBeUndefined();
    expect(body.turnaround).toMatchObject({ median_hours: 21, sample: 5 });
  });
});

describe("a15 review fixes", () => {
  it("POST never stores server-owned report keys from the learner", async () => {
    const { calls } = database((c) => (c.op === "insert" ? { data: { id: 9 } } : {}));
    await POST(req("/api/suggestions", "POST", { questionId: 1, type: "edit", suggestedChanges: { explanation: "x" }, context: { applied_edit: { before: { answer: "B" }, after: {} }, notified_at: "2026-01-01", reporter_outcome: "fixed", viewport: "1x1" } }));
    const stored = (writes(calls, "question_suggestions")[0].payload as { context: Record<string, unknown> }).context;
    expect(stored).not.toHaveProperty("applied_edit");
    expect(stored).not.toHaveProperty("notified_at");
    expect(stored).not.toHaveProperty("reporter_outcome");
    expect(stored.viewport).toBe("1x1");
  });

  it("revert refuses an empty or key-only applied edit and never writes answer or choices", async () => {
    const { calls } = database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: row({ type: "edit", status: "approved", context: { applied_edit: { before: { answer: "B", choices: [], is_active: false }, after: {} } } }) } : {}));
    expect((await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "revert" }))).status).toBe(409);
    expect(writes(calls, "questions")).toHaveLength(0);
  });

  it("the later Email reporter action leaves an internal note out of the mail", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ status: "rejected", admin_note: "internal: reporter is a competitor", context: { reporter_outcome: "not_an_error" } }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: null, language_code: "de" } };
      return {};
    });
    expect((await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "notify" }))).status).toBe(200);
    expect(mocks.email.mock.calls[0][0].htmlBody).not.toContain("competitor");
  });

  it("a timed-out send keeps the claim so a retry cannot mail twice", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    vi.useFakeTimers();
    mocks.email.mockImplementation(() => new Promise(() => {}));
    const { calls } = database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row() };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: null, language_code: "de" } };
      return {};
    });
    const pending = PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "fixed" }));
    await vi.advanceTimersByTimeAsync(13_000);
    const res = await pending;
    vi.useRealTimers();
    expect((await res.json()).notified).toBe(false);
    const last = writes(calls, "question_suggestions").at(-1)!;
    expect((last.payload as { context: Record<string, unknown> }).context.notified_at).toEqual(expect.any(String));
    expect((last.payload as { context: Record<string, unknown> }).context.notify_error).toMatchObject({ reason: "timeout" });
  });
});
