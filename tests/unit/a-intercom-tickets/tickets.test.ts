import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createFeedbackTicket, createQuestionReportTicket, moveTicket, pageOf, resetTicketStateCache, storedTicketId, ticketsEnabled,
} from "@/lib/intercom/tickets";
import { intercomRequest, intercomRestBase } from "@/lib/intercom/tickets-api";

type Row = { id: number; context: Record<string, unknown> };

function fakeDb(opts: { users?: Record<string, { email: string; email_verified_at?: string | null; email_status?: string | null }>; rows?: Record<string, Row>; questionExam?: string; storeBlocked?: boolean } = {}) {
  const rows = opts.rows ?? {};
  const updates: Array<{ table: string; context: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let id: unknown;
      const chain = {
        select: () => chain,
        eq: (_c: string, v: unknown) => { id = v; return chain; },
        is: () => chain,
        update: (patch: { context: Record<string, unknown> }) => { updates.push({ table, context: patch.context }); q.upd = patch; return chain; },
        maybeSingle: async () => {
          if (q.upd) {
            if (opts.storeBlocked) return { data: null, error: null };
            const r = rows[`${table}:${id}`]; if (r) r.context = (q.upd as { context: Record<string, unknown> }).context;
            return { data: { id }, error: null };
          }
          if (table === "users") return { data: opts.users?.[String(id)] ?? null, error: null };
          if (table === "questions") return { data: { exam_type: opts.questionExam ?? "kenntnispruefung" }, error: null };
          return { data: rows[`${table}:${id}`] ?? null, error: null };
        },
      };
      return chain;
    },
  };
  return { db: db as never, updates, rows };
}

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; json?: unknown }) {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    const r = handler(url, init);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json ?? {} } as Response;
  });
  return { f: f as unknown as typeof fetch, calls };
}

const contactFound = (url: string) => url.endsWith("/contacts/search");

beforeEach(() => {
  resetTicketStateCache();
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok_test";
  process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED = "true";
  process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS = "true"; // build copy (a-intercom-into-n2n3-1021)
  process.env.MEDPRUF_INTERCOM_TICKET_TYPE_QUESTION = "111";
  process.env.MEDPRUF_INTERCOM_TICKET_TYPE_FEEDBACK = "222";
});
afterEach(() => {
  for (const k of ["MEDPRUF_INTERCOM_ACCESS_TOKEN", "NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS", "MEDPRUF_INTERCOM_TICKETS_ENABLED", "MEDPRUF_INTERCOM_TICKET_TYPE_QUESTION", "MEDPRUF_INTERCOM_TICKET_TYPE_FEEDBACK", "INTERCOM_ACCESS_TOKEN", "MEDPRUF_INTERCOM_REGION"]) delete process.env[k];
});

describe("flag off", () => {
  it("makes no call and creates nothing", async () => {
    delete process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED;
    const { f, calls } = fakeFetch(() => ({}));
    const { db } = fakeDb();
    expect(ticketsEnabled()).toBe(false);
    expect((await createQuestionReportTicket(db, { suggestionId: 1, questionId: 5, userId: "u1", type: "flag", reason: "x", details: null }, f)).reason).toBe("disabled");
    expect((await createFeedbackTicket(db, { feedbackId: 1, userId: "u1", message: "hello", context: {} }, f)).reason).toBe("disabled");
    expect((await moveTicket(db, "question", 1, "resolved", f)).reason).toBe("disabled");
    expect(calls).toHaveLength(0);
  });
  it("only the literal true switches it on, and a token is required", () => {
    process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED = "1";
    expect(ticketsEnabled()).toBe(false);
    process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED = "true";
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS = "true"; // build copy (a-intercom-into-n2n3-1021)
    delete process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN;
    expect(ticketsEnabled()).toBe(false);
  });
});

describe("create", () => {
  it("creates a Fragenmeldung ticket with question_id, exam_type, reason and stores the id", async () => {
    const { f, calls } = fakeFetch((url) => (contactFound(url) ? { json: { data: [{ id: "c9" }] } } : { json: { id: "t77" } }));
    const { db, rows } = fakeDb({ rows: { "question_suggestions:5": { id: 5, context: { a: 1 } } }, questionExam: "pharma" });
    const out = await createQuestionReportTicket(db, { suggestionId: 5, questionId: 123, userId: "u1", type: "flag", reason: "wrong key", details: "Option B is right" }, f);
    expect(out).toEqual({ created: true, ticketId: "t77" });
    const post = calls.find((c) => c.url.endsWith("/tickets"))!;
    expect(post.method).toBe("POST");
    expect(post.headers["Intercom-Version"]).toBe("2.17");
    expect(post.body).toMatchObject({
      ticket_type_id: "111", contacts: [{ id: "c9" }],
      ticket_attributes: { question_id: "123", exam_type: "pharma", reason: "flag: wrong key", _default_description_: "Option B is right" },
    });
    expect(rows["question_suggestions:5"].context).toMatchObject({ a: 1, intercom_ticket_id: "t77" });
  });

  it("creates a Feedback ticket with source and page path only (no query)", async () => {
    const { f, calls } = fakeFetch((url) => (contactFound(url) ? { json: { data: [{ id: "c9" }] } } : { json: { id: "t78" } }));
    const { db } = fakeDb({ rows: { "user_feedback:9": { id: 9, context: {} } } });
    const out = await createFeedbackTicket(db, { feedbackId: 9, userId: "u1", message: "Nice app", context: { source: "mentor", url: "https://medpruf.com/quiz?token=abc&q=1" } }, f);
    expect(out.created).toBe(true);
    const body = calls.find((c) => c.url.endsWith("/tickets"))!.body as { ticket_type_id: string; ticket_attributes: Record<string, string> };
    expect(body.ticket_type_id).toBe("222");
    expect(body.ticket_attributes).toMatchObject({ source: "mentor", page: "/quiz" });
    expect(JSON.stringify(body)).not.toContain("token=abc");
  });

  it("anonymous reports and testimonials get no ticket and no call", async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const { db } = fakeDb();
    expect((await createFeedbackTicket(db, { feedbackId: 1, userId: null, message: "hello", context: {} }, f)).reason).toBe("anonymous");
    expect((await createFeedbackTicket(db, { feedbackId: 1, userId: "u1", message: "hello", context: { kind: "testimonial" } }, f)).created).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("falls back to the account email, and creates no contact when none exists", async () => {
    let searches = 0;
    const { f, calls } = fakeFetch((url) => { if (contactFound(url)) { searches += 1; return { json: { data: [] } }; } return { json: { id: "x" } }; });
    const { db } = fakeDb({ users: { u1: { email: "A@Example.com", email_verified_at: "2026-10-01T00:00:00Z" } } });
    const out = await createFeedbackTicket(db, { feedbackId: 1, userId: "u1", message: "hello", context: {} }, f);
    expect(out.reason).toBe("no_contact");
    expect(searches).toBe(2);
    expect((calls[1].body as { query: { field: string; value: string } }).query).toMatchObject({ field: "email", value: "a@example.com" });
    expect(calls.some((c) => c.url.endsWith("/contacts") || c.url.endsWith("/tickets"))).toBe(false);
  });

  it("an unverified account email is never used to find a contact", async () => {
    let searches = 0;
    const { f } = fakeFetch((url) => { if (contactFound(url)) searches += 1; return { json: { data: [] } }; });
    const { db } = fakeDb({ users: { u1: { email: "victim@example.com", email_verified_at: null } } });
    expect((await createFeedbackTicket(db, { feedbackId: 1, userId: "u1", message: "hello", context: {} }, f)).reason).toBe("no_contact");
    expect(searches).toBe(1);
  });

  it("a confirmed date with email_status unverified is not proof either (a-n3-head-1022 Reviewer P2)", async () => {
    let searches = 0;
    const { f } = fakeFetch((url) => { if (contactFound(url)) searches += 1; return { json: { data: [] } }; });
    const { db } = fakeDb({ users: { u1: { email: "old@example.com", email_verified_at: "2026-10-01T00:00:00Z", email_status: "unverified" } } });
    expect((await createFeedbackTicket(db, { feedbackId: 1, userId: "u1", message: "hello", context: {} }, f)).reason).toBe("no_contact");
    expect(searches).toBe(1);
  });

  it("a failed ticket create never throws and reports the reason", async () => {
    const { f } = fakeFetch((url) => (contactFound(url) ? { json: { data: [{ id: "c9" }] } } : { status: 500 }));
    const { db } = fakeDb();
    expect((await createFeedbackTicket(db, { feedbackId: 1, userId: "u1", message: "hello", context: {} }, f)).reason).toBe("create_failed");
  });

  it("a network error is a typed result, not a throw", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const r = await intercomRequest("GET", "/x", undefined, f);
    expect(r).toEqual({ ok: false, status: 0, reason: "network" });
  });
});

describe("resolve", () => {
  const typeJson = { ticket_states: { data: [{ id: "s1", category: "submitted" }, { id: "s2", category: "in_progress" }, { id: "s3", category: "resolved" }] } };

  it("moves the stored ticket to the resolved state id of its type", async () => {
    const { f, calls } = fakeFetch((url) => (url.includes("/ticket_types/") ? { json: typeJson } : { json: {} }));
    const { db } = fakeDb({ rows: { "question_suggestions:5": { id: 5, context: { intercom_ticket_id: "t77" } } } });
    expect(await moveTicket(db, "question", 5, "resolved", f)).toEqual({ moved: true });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/tickets\/t77$/);
    expect(put.body).toEqual({ ticket_state_id: "s3" });
    expect(calls[0].url).toMatch(/\/ticket_types\/111$/);
  });

  it("reopen uses the in_progress state; feedback uses its own type", async () => {
    const { f, calls } = fakeFetch((url) => (url.includes("/ticket_types/") ? { json: typeJson } : { json: {} }));
    const { db } = fakeDb({ rows: { "user_feedback:2": { id: 2, context: { intercom_ticket_id: "t5" } } } });
    expect((await moveTicket(db, "feedback", 2, "in_progress", f)).moved).toBe(true);
    expect(calls[0].url).toMatch(/\/ticket_types\/222$/);
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ ticket_state_id: "s2" });
  });

  it("a row with no ticket has nothing to move (the mail path stays)", async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const { db } = fakeDb({ rows: { "question_suggestions:5": { id: 5, context: {} } } });
    expect(await moveTicket(db, "question", 5, "resolved", f)).toEqual({ moved: false, reason: "no_ticket" });
    expect(calls).toHaveLength(0);
  });

  it("a failed update is reported", async () => {
    const { f } = fakeFetch((url) => (url.includes("/ticket_types/") ? { json: typeJson } : { status: 502 }));
    const { db } = fakeDb({ rows: { "question_suggestions:5": { id: 5, context: { intercom_ticket_id: "t77" } } } });
    expect((await moveTicket(db, "question", 5, "resolved", f)).reason).toBe("update_failed");
  });
});

describe("credentials and helpers", () => {
  it("never reads the old shared token", async () => {
    delete process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN;
    process.env.INTERCOM_ACCESS_TOKEN = "old";
    const { f, calls } = fakeFetch(() => ({}));
    expect((await intercomRequest("GET", "/me", undefined, f)).ok).toBe(false);
    expect(calls).toHaveLength(0);
    for (const file of ["src/lib/intercom/tickets-api.ts", "src/lib/intercom/tickets.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/process\.env\.INTERCOM_ACCESS_TOKEN|BLINK_/);
    }
  });
  it("host follows the region allowlist", () => {
    expect(intercomRestBase("eu")).toBe("https://api.eu.intercom.io");
    expect(intercomRestBase(undefined)).toBe("https://api.intercom.io");
    expect(intercomRestBase("mars")).toBeNull();
  });
  it("pageOf keeps the path only; storedTicketId reads the context", () => {
    expect(pageOf("/quiz?x=1")).toBe("/quiz");
    expect(pageOf(42)).toBe("");
    expect(storedTicketId({ intercom_ticket_id: "t1" })).toBe("t1");
    expect(storedTicketId({})).toBeNull();
  });
});

describe("a-intercom-into-n2n3-1021 Reviewer fixes", () => {
  it("never uses a learner-supplied or non-numeric ticket id (P2-1)", async () => {
    const { storedTicketId } = await import("@/lib/intercom/tickets");
    expect(storedTicketId({ intercom_ticket_id: "12345" })).toBe("12345");
    expect(storedTicketId({ intercom_ticket_id: "1 2" })).toBeNull();
    expect(storedTicketId({ intercom_ticket_id: "../contacts/1" })).toBeNull();
    expect(storedTicketId({ intercom_ticket_id: 12345 })).toBeNull();
    const { SERVER_OWNED_REPORT_KEYS } = await import("@/lib/reports/report-status");
    const { ADMIN_ONLY_CONTEXT_KEYS } = await import("@/lib/mentor/credits/experience");
    for (const k of ["intercom_ticket_id", "intercom_ticket_error"]) {
      expect(SERVER_OWNED_REPORT_KEYS as readonly string[]).toContain(k);
      expect(ADMIN_ONLY_CONTEXT_KEYS as readonly string[]).toContain(k);
    }
  });
  it("tickets need the build copy as well as the runtime flag (P2-2)", async () => {
    const { ticketsEnabled } = await import("@/lib/intercom/tickets");
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok";
    process.env.MEDPRUF_INTERCOM_TICKETS_ENABLED = "true";
    delete process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS;
    expect(ticketsEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS = "true";
    expect(ticketsEnabled()).toBe(true);
  });
});
