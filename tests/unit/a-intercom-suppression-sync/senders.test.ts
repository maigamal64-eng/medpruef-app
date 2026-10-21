import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ sendZohoEmail: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));

import { sendPuypDecisionEmail } from "@/lib/admin/puyp-decision";
import { notifyReporter } from "@/lib/reports/notify-reporter";
import { suppressionKey } from "@/lib/mail-suppression";

const USER = "cc94a1a5-1188-4d03-9a41-1b1c977e2f42";
const bounce = { id: "s1", email_key: suppressionKey("learner@example.com"), cause: "hard_bounce", scope: "all", source: "zoho-bounce", created_at: "2026-10-13T00:00:00Z" };
const optOut = { ...bounce, id: "s2", cause: "opt_out", scope: "marketing", source: "intercom:contact.unsubscribed" };

function db(suppression: FakeResult, extra?: (c: FakeCall) => FakeResult | undefined) {
  const calls: FakeCall[] = [];
  const { sb } = createFakeSupabase((c) => {
    calls.push(c);
    const x = extra?.(c);
    if (x) return x;
    if (c.table === "mail_suppression") return suppression;
    if (c.table === "users") return { data: { email: "learner@example.com", first_name: "Ada", language_code: "de" } };
    return {};
  });
  return { sb: sb as never, calls };
}

beforeEach(() => {
  h.sendZohoEmail.mockReset();
  h.sendZohoEmail.mockResolvedValue({ ok: true, messageId: "m1" });
  process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED = "true";
});
afterEach(() => {
  delete process.env.SUGGESTION_RESOLVED_EMAIL_ENABLED;
});

describe("PUYP decision mail goes through the do-not-email list", () => {
  it("a scope-all row withholds it and the queue sees 'suppressed'", async () => {
    const { sb, calls } = db({ data: [bounce] });
    const r = await sendPuypDecisionEmail(sb, USER, "att-1", "rejected", { reason: "Datum fehlt" });
    expect(r).toEqual({ sent: false, reason: "suppressed" });
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    const ev = calls.find((c) => c.table === "user_events");
    expect(JSON.stringify(ev?.payload ?? {})).not.toContain("@");
  });

  it("a marketing opt-out does not stop it; an unreadable list does (fail closed)", async () => {
    expect(await sendPuypDecisionEmail(db({ data: [optOut] }).sb, USER, "att-2", "approved", { newExpiresAtIso: "2027-03-20T12:00:00Z" })).toEqual({ sent: true, reason: null });
    expect(await sendPuypDecisionEmail(db({ error: { message: "down" } }).sb, USER, "att-3", "approved", { newExpiresAtIso: "2027-03-20T12:00:00Z" })).toEqual({ sent: false, reason: "suppression_check_failed" });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });
});

describe("report outcome mail goes through the do-not-email list", () => {
  const report = { id: 7, question_id: 63854, user_id: USER, status: "approved", created_at: "2026-10-10T08:00:00Z", context: {} };

  it("a withheld address releases the claim and records the reason", async () => {
    const { sb, calls } = db({ data: [bounce] }, (c) => (c.table === "question_suggestions" && c.op === "update" ? { data: { id: 7 } } : undefined));
    const r = await notifyReporter(sb, report, { outcome: "fixed" as never, adminNote: null });
    expect(r).toEqual({ notified: false, reason: "send_failed" });
    expect(h.sendZohoEmail).not.toHaveBeenCalled();
    const updates = calls.filter((c) => c.table === "question_suggestions" && c.op === "update");
    expect(updates).toHaveLength(2);
    const release = updates[1].payload as { context: Record<string, unknown> };
    expect(release.context.notified_at).toBeUndefined();
    expect(release.context.notify_error).toMatchObject({ reason: "suppressed" });
  });

  it("a clear address is mailed once", async () => {
    const { sb } = db({ data: [] }, (c) => (c.table === "question_suggestions" && c.op === "update" ? { data: { id: 7 } } : undefined));
    expect(await notifyReporter(sb, report, { outcome: "fixed" as never, adminNote: null })).toEqual({ notified: true });
    expect(h.sendZohoEmail).toHaveBeenCalledTimes(1);
  });
});
