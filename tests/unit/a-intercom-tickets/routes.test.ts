import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), user: vi.fn(), email: vi.fn(), perms: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard, resolveOptionalUser: mocks.user }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: vi.fn(), resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 9, resetAt: 0, retryAfterSec: 0 }), rateKey: () => "k", callerIdentity: () => "c", callerIp: () => "1.1.1.1", rateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: mocks.email }));
vi.mock("@/lib/admin/permissions", () => ({
  loadAdminPermissionSnapshot: vi.fn(async () => mocks.perms()),
  canAccessAdminPermission: (snapshot: string[], permission: string) => snapshot.includes(permission),
}));

import { PATCH, POST } from "@/app/api/suggestions/route";
import { PATCH as feedbackPatch, POST as feedbackPost } from "@/app/api/feedback/route";
import { resetTicketStateCache } from "@/lib/intercom/tickets";

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`https://medpruf.com${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
const row = (context: Record<string, unknown>) => ({ id: 7, question_id: 11, user_id: LEARNER, type: "flag", status: "pending", suggested_changes: null, context, admin_note: null, created_at: "2026-10-10T08:00:00Z", resolved_at: null });
const typeJson = { ticket_states: { data: [{ id: "s2", category: "in_progress" }, { id: "s3", category: "resolved" }] } };

let fetchCalls: Array<{ url: string; method: string }>;
function stubIntercom(over: { putStatus?: number } = {}) {
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, method: String(init.method) });
    const status = init.method === "PUT" ? over.putStatus ?? 200 : 200;
    const json = url.includes("/contacts/search") ? { data: [{ id: "c1" }] } : url.includes("/ticket_types/") ? typeJson : { id: "t1" };
    return { ok: status < 400, status, json: async () => json } as Response;
  }));
}
function database(handler: FakeHandler) {
  // a-intercom-into-n2n3-1021: the reporter mail now reads the do-not-email
  // list first (a-intercom-suppression-sync); an empty list lets it go out.
  const fake = createFakeSupabase((c) => (c.table === "mail_suppression" && c.op === "select" ? { data: [] } : handler(c)));
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTicketStateCache();
  mocks.guard.mockResolvedValue({ userId: ADMIN, role: "admin", tier: "admin" });
  mocks.user.mockReturnValue(LEARNER);
  mocks.perms.mockReturnValue(["content.read", "content.moderate", "users.read", "feedback.manage"]);
  mocks.email.mockResolvedValue({ ok: true });
  stubIntercom();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS", "MEDPRUF_INTERCOM_TICKETS_ENABLED", "MEDPRUF_INTERCOM_ACCESS_TOKEN", "MEDPRUF_INTERCOM_TICKET_TYPE_QUESTION", "MEDPRUF_INTERCOM_TICKET_TYPE_FEEDBACK", "SUGGESTION_RESOLVED_EMAIL_ENABLED"]) delete process.env[k];
});
function ticketsOn() {
  process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED = "true";
  process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS = "true"; // build copy (a-intercom-into-n2n3-1021)
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok_test";
  process.env.MEDPRUF_INTERCOM_TICKET_TYPE_QUESTION = "111";
  process.env.MEDPRUF_INTERCOM_TICKET_TYPE_FEEDBACK = "222";
}

describe("flag off: no ticket, no Intercom call", () => {
  it("POST /api/suggestions and /api/feedback store the row and call nothing", async () => {
    database((c) => (c.op === "insert" ? { data: { id: 9 } } : c.table === "users" ? { data: { id: LEARNER } } : {}));
    expect((await POST(req("/api/suggestions", "POST", { questionId: 1, type: "flag", reason: "typo" }))).status).toBe(200);
    expect((await feedbackPost(req("/api/feedback", "POST", { message: "Gut so", context: { url: "/quiz" } }))).status).toBe(200);
    expect(fetchCalls).toHaveLength(0);
  });
  it("admin resolve keeps the mail path and makes no Intercom call", async () => {
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ intercom_ticket_id: "t1" }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: "A", language_code: "de" } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "fixed" }));
    expect(await res.json()).toEqual({ ok: true, status: "approved", applied: false, notified: true });
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("flag on", () => {
  it("POST /api/suggestions creates the ticket after the insert", async () => {
    ticketsOn();
    database((c) => (c.op === "insert" ? { data: { id: 9 } } : c.table === "users" ? { data: { id: LEARNER } } : c.table === "questions" ? { data: { exam_type: "pharma" } } : c.op === "update" ? { data: { id: 9 } } : { data: { context: {} } }));
    expect((await POST(req("/api/suggestions", "POST", { questionId: 1, type: "flag", reason: "typo" }))).status).toBe(200);
    expect(fetchCalls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /contacts/search", "POST /tickets"]);
  });

  it("a ticket failure never fails the learner request", async () => {
    ticketsOn();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    database((c) => (c.op === "insert" ? { data: { id: 9 } } : c.table === "users" ? { data: { id: LEARNER } } : {}));
    expect((await POST(req("/api/suggestions", "POST", { questionId: 1, type: "flag", reason: "typo" }))).status).toBe(200);
  });

  it("resolve sets the ticket Resolved instead of mailing", async () => {
    ticketsOn();
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ intercom_ticket_id: "t1" }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "fixed", adminNote: "Antwort B" }));
    expect(await res.json()).toEqual({ ok: true, status: "approved", applied: false, notified: false, ticket_resolved: true });
    expect(mocks.email).not.toHaveBeenCalled();
    expect(fetchCalls.some((c) => c.method === "PUT" && c.url.endsWith("/tickets/t1"))).toBe(true);
    // The admin note never leaves the app.
    expect(JSON.stringify(fetchCalls)).not.toContain("Antwort B");
  });

  it("notifyReporter:false leaves the ticket alone", async () => {
    ticketsOn();
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ intercom_ticket_id: "t1" }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reject", outcome: "not_an_error", notifyReporter: false }));
    expect(res.status).toBe(200);
    expect(fetchCalls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("notify with a ticket retries the move and never mails", async () => {
    ticketsOn();
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: row({ intercom_ticket_id: "t1" }) } : {}));
    const ok = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "notify" }));
    // The fake row is still pending, so the retry is refused until the report is decided.
    expect(ok.status).toBe(409);
    database((c) => (c.table === "question_suggestions" && c.op === "select" ? { data: { ...row({ intercom_ticket_id: "t1" }), status: "approved" } } : {}));
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "notify" }));
    expect(await res.json()).toEqual({ ok: true, notified: false, ticket_resolved: true });
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("a report with no ticket still takes the mail path", async () => {
    ticketsOn();
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({}) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      if (c.table === "users") return { data: { email: "learner@example.invalid", first_name: "A", language_code: "de" } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "reject", outcome: "not_an_error" }));
    expect((await res.json()).notified).toBe(true);
    expect(mocks.email).toHaveBeenCalledTimes(1);
  });

  it("a ticket that cannot be moved is not mailed on top", async () => {
    ticketsOn();
    process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
    stubIntercom({ putStatus: 502 });
    database((c) => {
      if (c.table === "question_suggestions" && c.op === "select") return { data: row({ intercom_ticket_id: "t1" }) };
      if (c.table === "question_suggestions" && c.op === "update") return { data: { id: 7 } };
      return {};
    });
    const res = await PATCH(req("/api/suggestions", "PATCH", { suggestionId: 7, action: "approve", outcome: "fixed" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", notified: false, ticket_resolved: false });
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("feedback: create after insert, resolved moves the ticket, new does not", async () => {
    ticketsOn();
    database((c) => {
      if (c.op === "insert") return { data: { id: 4 } };
      if (c.table === "users") return { data: { id: LEARNER } };
      if (c.table === "user_feedback" && c.op === "update") return { data: { id: 4 } };
      if (c.table === "user_feedback") return { data: { context: { intercom_ticket_id: "t5" } } };
      return {};
    });
    expect((await feedbackPost(req("/api/feedback", "POST", { message: "Gut so", context: { source: "mentor", url: "/mentor?x=1" } }))).status).toBe(200);
    expect(fetchCalls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /contacts/search", "POST /tickets"]);
    fetchCalls.length = 0;
    expect((await feedbackPatch(req("/api/feedback", "PATCH", { id: 4, status: "new" }))).status).toBe(200);
    expect(fetchCalls).toHaveLength(0);
    expect((await feedbackPatch(req("/api/feedback", "PATCH", { id: 4, status: "resolved" }))).status).toBe(200);
    expect(fetchCalls.some((c) => c.method === "PUT" && c.url.endsWith("/tickets/t5"))).toBe(true);
  });
});
