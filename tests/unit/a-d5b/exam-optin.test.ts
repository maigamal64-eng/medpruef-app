import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn(), auth: vi.fn(), optional: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: h.db }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.send }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: h.auth, resolveOptionalUser: h.optional }));
import { GET, POST, DELETE } from "@/app/api/reminders/me/route";
import { subscribeExamReminder } from "@/lib/reminders/exam-consent";
import { examOptInStateFromRows, reminderBankFor, CONFIRM_LINK_MS } from "@/lib/reminders/exam-optin";
import { reminderLinksConfigured, signReminderToken, verifyReminderToken } from "@/lib/reminders/tokens";
import { canOfferExamReminder, outcomeFromPost, parseExamReminderView } from "@/lib/hooks/useExamReminder";
import { examReminderCopy } from "@/components/reminders/exam-reminder-copy";

// a-d5b: in-app exam deadline reminder opt-in (D5b option A).
const SECRET = "[secret]";
const token = "00000000-0000-4000-8000-000000000001";
const accountEmail = "learner@example.invalid";
const now = new Date("2026-11-05T09:00:00Z");
const owner = { email: "  Learner@Example.invalid ", email_status: "valid", language_code: "de", active_exam: "kenntnispruefung" };
const pendingRow = { id: 7, exam_type: "kenntnispruefung", confirmation_token: token, confirmed: false, consent_email: null, consent_version: null, consent_confirmed_at: null, unsubscribed_at: null, confirmation_sent_at: null };

interface World { owner?: Record<string, unknown> | null; row?: Record<string, unknown> | null; rows?: Record<string, unknown>[]; recent?: boolean; claim?: boolean; suppressed?: boolean }
function world(w: World) {
  let live: Record<string, unknown> | null = null;
  const f = createFakeSupabase((c: FakeCall): FakeResult => {
    if (c.table === "mail_suppression") {
      const [key] = (c.filters.find((x) => x.kind === "in")?.value ?? []) as string[];
      return { data: w.suppressed ? [{ id: "s1", email_key: key, cause: "complaint", scope: "all", source: "test", created_at: "2026-09-01T00:00:00Z" }] : [] };
    }
    if (c.table === "users") return { data: w.owner === undefined ? owner : w.owner };
    if (c.table === "rpc:unsubscribe_exam_reminders") return { data: null };
    if (c.table !== "exam_reminders") return { data: null };
    if (c.op === "insert") return { data: { ...pendingRow, ...(c.payload as object) } };
    if (c.op === "update") {
      // Stateful enough for the view read after the action: a claimed slot is a live link.
      const sentAt = (c.payload as Record<string, unknown>).confirmation_sent_at;
      if (typeof sentAt === "string") live = { exam_type: "kenntnispruefung", confirmed: false, unsubscribed_at: null, consent_version: null, consent_email: null, confirmation_sent_at: sentAt };
      if (sentAt === null) live = null;
      return { data: c.single ? (w.claim === false ? null : { id: 7 }) : null };
    }
    if (c.filters.some((x) => x.kind === "gte")) return { data: w.recent ? [{ id: 7 }] : [] };
    if (c.filters.some((x) => x.kind === "in")) return { data: [...(w.rows ?? []), ...(live ? [live] : [])] };
    if (c.single) return { data: w.row ? { user_id: me(), ...w.row } : null };
    return { data: [] };
  });
  h.db.mockReturnValue(f.sb);
  return f;
}
let uid = 0;
const me = () => `owner-${uid}`;
const req = (method: string, body?: object) => new NextRequest("https://medpruf.com/api/reminders/me", { method, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", SECRET);
  vi.stubEnv("EXAM_REMINDERS_ENABLED", "false");
  h.send.mockResolvedValue({ ok: true });
  // A fresh account per test keeps the per-user burst limit out of the way.
  h.auth.mockImplementation(async () => ({ userId: `owner-${++uid}` }));
  h.optional.mockReturnValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("link signing secret", () => {
  it("signs and verifies with the secret and throws without it", () => {
    expect(reminderLinksConfigured()).toBe(true);
    const signed = signReminderToken("exam-confirm", token, now);
    expect(verifyReminderToken(signed, "exam-confirm", now)).toBe(token);
    vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", "too-short");
    expect(reminderLinksConfigured()).toBe(false);
    expect(() => signReminderToken("exam-confirm", token, now)).toThrow();
    vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", "");
    expect(reminderLinksConfigured()).toBe(false);
  });
  it("without the secret the surface does not exist: no session read, no database read", async () => {
    vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", "");
    world({});
    for (const res of [await GET(req("GET")), await POST(req("POST"))]) expect(await res.json()).toEqual({ available: false });
    expect(h.auth).not.toHaveBeenCalled(); expect(h.db).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
});

describe("in-app opt-in (option A: confirmation decoupled from the dated sender)", () => {
  it("mails the confirmation to the account address while EXAM_REMINDERS_ENABLED is off", async () => {
    const { calls } = world({});
    const res = await POST(req("POST", { email: "attacker@example.invalid", exam_type: "pharma" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, email: accountEmail, exam: "kenntnispruefung", state: "pending", mail: "sent" });
    const insert = calls.find((c) => c.table === "exam_reminders" && c.op === "insert");
    // Body fields are ignored: the account address and the account bank.
    expect(insert?.payload).toMatchObject({ email: accountEmail, exam_type: "kenntnispruefung", locale: "de", source: "app-optin", confirmed: false, user_id: me() });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0].to).toBe(accountEmail);
    expect(h.send.mock.calls[0][0].htmlBody).toContain("/api/reminders?confirm=v1.");
    expect(h.send.mock.calls[0][0].htmlBody).toContain('lang="de"');
  });
  it("the open signup form keeps its gate: no confirmation mail while the sender is off", async () => {
    world({});
    const res = await subscribeExamReminder(new NextRequest("https://medpruf.com/api/reminders", { method: "POST", body: JSON.stringify({ email: accountEmail, exam_type: "all" }) }));
    expect(await res.json()).toEqual({ ok: true, confirmation_pending: true });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a repeat inside the cooldown sends nothing and never clears an opt-out", async () => {
    const live = { exam_type: "kenntnispruefung", confirmed: false, unsubscribed_at: null, consent_version: null, consent_email: null, confirmation_sent_at: "2026-11-05T08:30:00Z" };
    const { calls } = world({ row: { ...pendingRow, unsubscribed_at: "2026-11-01T00:00:00Z" }, rows: [live], recent: true });
    const res = await POST(req("POST"));
    const body = await res.json();
    expect(body).toMatchObject({ state: "pending", mail: "cooldown" });
    expect(outcomeFromPost(200, body)).toBe("cooldown");
    expect(h.send).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
  });
  it("after a withdrawal the cooldown never points at the revoked link", async () => {
    const withdrawn = { exam_type: "kenntnispruefung", confirmed: false, unsubscribed_at: "2026-11-05T08:40:00Z", consent_version: null, consent_email: null, confirmation_sent_at: "2026-11-05T08:30:00Z" };
    world({ row: pendingRow, rows: [withdrawn], recent: true });
    const body = await (await POST(req("POST"))).json();
    expect(body).toMatchObject({ state: "off", mail: "cooldown" });
    expect(outcomeFromPost(200, body)).toBe("rate_limited");
  });
  it("never takes over or reveals an active subscription another sign-up made (reviewer P1)", async () => {
    const theirs = { ...pendingRow, user_id: null, confirmed: true, consent_version: 1, consent_email: accountEmail };
    const { calls } = world({ row: theirs });
    const res = await POST(req("POST"));
    expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "managed_elsewhere" });
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("takes over an unconfirmed row without an owner by compare-and-set, then mails the address itself", async () => {
    const { calls } = world({ row: { ...pendingRow, user_id: null } });
    expect((await POST(req("POST"))).status).toBe(200);
    const claim = calls.find((c) => c.op === "update" && (c.payload as Record<string, unknown>).user_id !== undefined);
    expect(claim?.payload).toEqual({ user_id: me() });
    expect(claim?.filters).toContainEqual({ kind: "is", column: "user_id", value: null });
    expect(h.send.mock.calls[0][0].to).toBe(accountEmail);
  });
  it("a withheld confirmation frees the slot so the card never shows a dead pending link", async () => {
    const { calls } = world({ suppressed: true });
    const res = await POST(req("POST"));
    expect(await res.json()).toMatchObject({ state: "off", mail: "withheld" });
    expect(h.send).not.toHaveBeenCalled();
    const writes = calls.filter((c) => c.table === "exam_reminders" && c.op === "update").map((c) => c.payload);
    // Claimed before the send, released once the list withheld it.
    expect(writes.at(-1)).toEqual({ confirmation_sent_at: null });
  });
  it("re-opting in after an opt-out writes only the cooldown stamp; the emailed link is the consent", async () => {
    const { calls } = world({ row: { ...pendingRow, unsubscribed_at: "2026-11-01T00:00:00Z" } });
    expect((await POST(req("POST"))).status).toBe(200);
    const writes = calls.filter((c) => c.op !== "select" && c.table === "exam_reminders");
    expect(writes.map((c) => Object.keys(c.payload as object))).toEqual([["confirmation_sent_at"]]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("is a no-op when reminders are already on for this bank or for every exam", async () => {
    world({ rows: [{ exam_type: "all", confirmed: true, unsubscribed_at: null, consent_version: 1, consent_email: accountEmail, confirmation_sent_at: null }] });
    const res = await POST(req("POST"));
    expect(await res.json()).toMatchObject({ state: "confirmed", mail: "skipped" });
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...owner, email: null }, "no_email"],
    [{ ...owner, email_status: "bounced" }, "no_email"],
    [{ ...owner, active_exam: "kmp_innsbruck" }, "unsupported_exam"],
  ])("refuses %j with 409 %s and sends nothing", async (o, reason) => {
    world({ owner: o });
    const res = await POST(req("POST"));
    expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: reason });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a provider failure releases the cooldown slot and answers 503", async () => {
    h.send.mockResolvedValue({ ok: false, reason: "provider_error" });
    const { calls } = world({});
    const res = await POST(req("POST"));
    expect(res.status).toBe(503);
    expect(calls.some((c) => c.op === "update" && (c.payload as Record<string, unknown>).confirmation_sent_at === null)).toBe(true);
  });
  it("answers 401 for a signed-out caller", async () => {
    world({});
    h.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
    expect((await POST(req("POST"))).status).toBe(401);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("status and opt-out", () => {
  it("GET reports pending for a link sent within 24 hours", async () => {
    world({ rows: [{ exam_type: "kenntnispruefung", confirmed: false, unsubscribed_at: null, consent_version: null, consent_email: null, confirmation_sent_at: "2026-11-05T08:00:00Z" }] });
    expect(await (await GET(req("GET"))).json()).toEqual({ available: true, email: accountEmail, exam: "kenntnispruefung", state: "pending" });
  });
  it("DELETE revokes only this account's rows, never by address (reviewer P1)", async () => {
    const { calls } = world({ rows: [{ exam_type: "kenntnispruefung" }] });
    const res = await DELETE(req("DELETE", { email: "someone@example.invalid" }));
    expect(await res.json()).toMatchObject({ state: "off" });
    const revoke = calls.filter((c) => c.table === "exam_reminders" && c.op === "update");
    expect(revoke).toHaveLength(1);
    expect(revoke[0].filters).toEqual([{ kind: "eq", column: "user_id", value: me() }]);
    expect(revoke[0].payload).toMatchObject({ confirmed: false, consent_email: null, consent_version: null });
    expect((revoke[0].payload as Record<string, unknown>).confirmation_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
  });
  it("GET reads only rows this account owns", async () => {
    const { calls } = world({});
    await GET(req("GET"));
    const read = calls.find((c) => c.table === "exam_reminders");
    expect(eqVal(read!, "user_id")).toBe(me());
    expect(eqVal(read!, "email")).toBe(accountEmail);
  });
});

describe("pure rules", () => {
  const base = { exam_type: "kenntnispruefung", confirmed: false, unsubscribed_at: null, consent_version: null, consent_email: null, confirmation_sent_at: null };
  it("derives off, pending and confirmed", () => {
    const t = now.getTime();
    expect(examOptInStateFromRows([], accountEmail, t)).toBe("off");
    expect(examOptInStateFromRows([{ ...base, confirmation_sent_at: new Date(t - 1000).toISOString() }], accountEmail, t)).toBe("pending");
    expect(examOptInStateFromRows([{ ...base, confirmation_sent_at: new Date(t - CONFIRM_LINK_MS).toISOString() }], accountEmail, t)).toBe("off");
    // An opt-out after the link revoked it.
    expect(examOptInStateFromRows([{ ...base, confirmation_sent_at: new Date(t - 2000).toISOString(), unsubscribed_at: new Date(t - 1000).toISOString() }], accountEmail, t)).toBe("off");
    expect(examOptInStateFromRows([{ ...base, confirmed: true, consent_version: 1, consent_email: accountEmail }], accountEmail, t)).toBe("confirmed");
    expect(examOptInStateFromRows([{ ...base, confirmed: true, consent_version: 1, consent_email: "old@example.invalid" }], accountEmail, t)).toBe("off");
  });
  it("offers a prompt only for banks the sender serves", () => {
    expect(reminderBankFor("kenntnispruefung")).toBe("kenntnispruefung");
    expect(reminderBankFor("pharma")).toBe("pharma");
    expect(reminderBankFor("kmp_innsbruck")).toBeNull();
    expect(reminderBankFor(null)).toBeNull();
  });
  it("client: the prompt is hidden without the surface, without an address or without a served bank", () => {
    expect(parseExamReminderView({ available: false })).toBeNull();
    expect(parseExamReminderView(null)).toBeNull();
    const view = parseExamReminderView({ available: true, email: accountEmail, exam: "pharma", state: "off" });
    expect(canOfferExamReminder(view)).toBe(true);
    expect(canOfferExamReminder(parseExamReminderView({ available: true, email: null, exam: "pharma", state: "off" }))).toBe(false);
    expect(canOfferExamReminder(parseExamReminderView({ available: true, email: accountEmail, exam: null, state: "off" }))).toBe(false);
    expect(canOfferExamReminder(parseExamReminderView({ available: true, email: accountEmail, exam: "pharma", state: "pending" }))).toBe(false);
  });
  it("client: maps POST answers to outcomes", () => {
    expect(outcomeFromPost(200, { state: "pending", mail: "sent" })).toBe("sent");
    expect(outcomeFromPost(200, { state: "pending", mail: "cooldown" })).toBe("cooldown");
    expect(outcomeFromPost(200, { state: "pending", mail: "withheld" })).toBe("withheld");
    expect(outcomeFromPost(200, { state: "confirmed", mail: "skipped" })).toBe("already_on");
    expect(outcomeFromPost(409, { error: "no_email" })).toBe("no_email");
    expect(outcomeFromPost(409, { error: "unsupported_exam" })).toBe("unsupported");
    expect(outcomeFromPost(429, null)).toBe("rate_limited");
    expect(outcomeFromPost(503, null)).toBe("failed");
  });
  it("copy: Sie, no dashes, every outcome worded in both languages", () => {
    for (const lang of ["de", "en"]) {
      const c = examReminderCopy(lang);
      const strings = [c.title, c.lead("X"), c.turnOn, c.off, c.pending("a@b.c"), c.on("a@b.c"), c.resend, c.cancel, c.turnOff, c.noEmail, c.footnote, c.homePrompt, c.homePending, ...Object.values(c.outcome)];
      for (const s of strings) { expect(s).not.toMatch(/[–—]/); expect(s.length).toBeGreaterThan(1); }
      if (lang === "de") for (const s of strings) expect(s).not.toMatch(/\b(du|dich|dir|dein|deine)\b/i);
    }
    expect(examReminderCopy("ru")).toBe(examReminderCopy("en"));
  });
});
