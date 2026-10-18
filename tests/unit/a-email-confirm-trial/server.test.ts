import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ ensure: vi.fn(), forgetNo: vi.fn(), forgetGuard: vi.fn() }));
vi.mock("@/lib/pricing-v2/reverse-trial-server", () => ({ ensureReverseTrial: m.ensure, forgetReverseTrialNo: m.forgetNo }));
vi.mock("@/lib/auth-guard", () => ({ forgetGuardUser: m.forgetGuard }));
const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: capture, addBreadcrumb: vi.fn() }));

import { resetEmailConfirmFailureReports } from "@/lib/email-confirm/server";
import { confirmEmail, readPendingStatus, renderConfirmMail, requestMailLang, resendAllowed, sendConfirmMail } from "@/lib/email-confirm/server";
import { signConfirmToken } from "@/lib/email-confirm/token";
import { suppressionKey } from "@/lib/mail-suppression";

const UID = "11111111-2222-4333-8444-555555555555";
const SECRET = "k".repeat(40);
const NOW = new Date("2026-10-21T10:00:00Z");
const EMAIL = "learner@example.at";

type World = { user: Record<string, unknown> | null; updated?: unknown; updateError?: { message: string } | null; readError?: boolean; sends?: Array<{ created_at: string }>; suppressed?: boolean; listMissing?: boolean };
function baseUser(over: Record<string, unknown> = {}) {
  return { id: UID, email: EMAIL, email_verified_at: null, telegram_id: null, created_at: "2026-10-20T10:00:00Z", role: "user", tier: "free", tier_expires_at: null, is_banned: false, ...over };
}
function fake(w: World) {
  return createFakeSupabase((c: FakeCall): FakeResult => {
    if (c.table === "users" && c.op === "select") return w.readError ? { error: { message: "boom" } } : { data: w.user };
    if (c.table === "users" && c.op === "update") return w.updateError ? { error: w.updateError } : { data: w.updated ?? null };
    if (c.table === "user_events" && c.op === "select") return { data: w.sends ?? [] };
    if (c.table === "mail_suppression" && w.listMissing) return { error: { code: "42P01", message: "relation does not exist" } };
    if (c.table === "mail_suppression") return { data: w.suppressed ? [{ email_key: suppressionKey(EMAIL), scope: "all", cause: "opt_out" }] : [] };
    return {};
  });
}
const headers = new Headers({ "x-forwarded-for": "10.0.0.1" });
const token = () => signConfirmToken({ userId: UID, email: EMAIL, now: NOW });
const events = (calls: FakeCall[], type: string) => calls.filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type?: string }).event_type === type);

beforeEach(() => {
  process.env.REMINDER_LINK_SIGNING_SECRET = SECRET;
  process.env.EMAIL_CONFIRM_ENABLED = "true";
  m.ensure.mockReset().mockResolvedValue({ active: true, endsAt: "2026-10-24T10:00:00Z", started: true });
  m.forgetNo.mockReset();
  m.forgetGuard.mockReset();
  capture.mockReset();
  resetEmailConfirmFailureReports();
});
afterEach(() => {
  delete process.env.REMINDER_LINK_SIGNING_SECRET;
  delete process.env.EMAIL_CONFIRM_ENABLED;
});

describe("confirmEmail", () => {
  it("writes email_verified_at once with a compare-and-set, logs email_confirmed and starts the trial", async () => {
    const { sb, calls } = fake({ user: baseUser(), updated: { id: UID } });
    const r = await confirmEmail(sb as never, token(), { headers, now: NOW });
    expect(r).toEqual({ outcome: "confirmed", trialActive: true });
    const update = calls.find((c) => c.table === "users" && c.op === "update")!;
    expect(update.payload).toEqual({ email_verified_at: NOW.toISOString() });
    expect(update.filters).toEqual(expect.arrayContaining([
      { kind: "eq", column: "id", value: UID },
      { kind: "eq", column: "email", value: EMAIL },
      { kind: "is", column: "email_verified_at", value: null },
    ]));
    expect(events(calls, "email_confirmed")).toHaveLength(1);
    expect(m.forgetNo).toHaveBeenCalledWith(UID);
    expect(m.forgetGuard).toHaveBeenCalledWith(UID);
    expect(m.ensure).toHaveBeenCalledWith(sb, expect.objectContaining({ userId: UID, candidate: expect.objectContaining({ createdAt: "2026-10-20T10:00:00Z", tier: "free" }) }));
  });

  it("an already verified account: no write, no event, no trial work, idempotent already", async () => {
    const { sb, calls } = fake({ user: baseUser({ email_verified_at: "2026-10-20T11:00:00Z" }) });
    expect(await confirmEmail(sb as never, token(), { headers, now: NOW })).toEqual({ outcome: "already", trialActive: false });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    expect(events(calls, "email_confirmed")).toHaveLength(0);
    expect(m.ensure).not.toHaveBeenCalled();
    expect(m.forgetNo).not.toHaveBeenCalled();
  });

  it("a lost compare-and-set (confirmed meanwhile) reads as already without an event", async () => {
    const { sb, calls } = fake({ user: baseUser(), updated: null });
    expect((await confirmEmail(sb as never, token(), { headers, now: NOW })).outcome).toBe("already");
    expect(events(calls, "email_confirmed")).toHaveLength(0);
  });

  it("refuses a link for an address the account no longer has", async () => {
    const { sb, calls } = fake({ user: baseUser({ email: "new@example.at" }) });
    expect(await confirmEmail(sb as never, token(), { headers, now: NOW })).toEqual({ outcome: "invalid" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("expired and forged links never read the database", async () => {
    const { sb, calls } = fake({ user: baseUser() });
    expect(await confirmEmail(sb as never, token(), { headers, now: new Date(NOW.getTime() + 8 * 86_400_000) })).toEqual({ outcome: "expired" });
    expect(await confirmEmail(sb as never, "ec1.abc.def", { headers, now: NOW })).toEqual({ outcome: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a failed read or write asks to retry", async () => {
    expect((await confirmEmail(fake({ user: null, readError: true }).sb as never, token(), { headers, now: NOW })).outcome).toBe("retry");
    expect((await confirmEmail(fake({ user: baseUser(), updateError: { message: "x" } }).sb as never, token(), { headers, now: NOW })).outcome).toBe("retry");
  });
});

describe("sendConfirmMail", () => {
  const base = { userId: UID, email: EMAIL, lang: "de" as const, source: "register" as const, trial: true, now: NOW };

  it("sends one transactional mail with the signed link and logs email_confirm_sent", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, messageId: "m1" });
    const { sb, calls } = fake({ user: null });
    expect(await sendConfirmMail(sb as never, { ...base, send })).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe(EMAIL);
    expect(mail.subject).toContain("bestätigen");
    expect(mail.htmlBody).toMatch(/https:\/\/medpruf\.com\/confirm-email\?t=ec1\.[^"&]+&amp;lang=de/);
    expect(mail.htmlBody).toContain("mit Telegram verknüpfen");
    expect(events(calls, "email_confirm_sent")).toHaveLength(1);
    expect((events(calls, "email_confirm_sent")[0].payload as { event_data: unknown }).event_data).toEqual({ source: "register", lang: "de" });
  });

  it("does nothing while the flag is off or the secret is missing", async () => {
    const send = vi.fn();
    delete process.env.EMAIL_CONFIRM_ENABLED;
    expect(await sendConfirmMail(fake({ user: null }).sb as never, { ...base, send })).toBe("off");
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    delete process.env.REMINDER_LINK_SIGNING_SECRET;
    expect(await sendConfirmMail(fake({ user: null }).sb as never, { ...base, send })).toBe("off");
    expect(send).not.toHaveBeenCalled();
  });

  it("a suppressed address gets no mail and no event", async () => {
    const send = vi.fn();
    const { sb, calls } = fake({ user: null, suppressed: true });
    expect(await sendConfirmMail(sb as never, { ...base, send })).toBe("suppressed");
    expect(send).not.toHaveBeenCalled();
    expect(events(calls, "email_confirm_sent")).toHaveLength(0);
  });

  it("an unkeyable address is skipped without a send or an error", async () => {
    const send = vi.fn();
    expect(await sendConfirmMail(fake({ user: null }).sb as never, { ...base, email: "no-at-sign", send })).toBe("suppressed");
    expect(send).not.toHaveBeenCalled();
  });

  it("an unreadable do-not-email list sends nothing and reports once (never silent)", async () => {
    const send = vi.fn();
    const { sb, calls } = fake({ user: null, listMissing: true });
    expect(await sendConfirmMail(sb as never, { ...base, send })).toBe("failed");
    expect(await sendConfirmMail(sb as never, { ...base, send })).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(events(calls, "email_confirm_sent")).toHaveLength(0);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toMatchObject({ phase: "send_suppression_check_failed" });
  });

  it("a provider failure logs no event", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, reason: "http_error", status: 500 });
    const { sb, calls } = fake({ user: null });
    expect(await sendConfirmMail(sb as never, { ...base, send })).toBe("failed");
    expect(events(calls, "email_confirm_sent")).toHaveLength(0);
  });
});

describe("mail copy", () => {
  it("names the trial only when it can start, never a typed name, never a dash", () => {
    const withTrial = renderConfirmMail({ lang: "en", url: "https://medpruf.com/confirm-email?t=x&lang=en", trial: true });
    const without = renderConfirmMail({ lang: "de", url: "https://medpruf.com/confirm-email?t=x&lang=de", trial: false });
    expect(withTrial.htmlBody).toContain("<p>Hello,</p>");
    expect(without.htmlBody).toContain("<p>Guten Tag,</p>");
    expect(withTrial.htmlBody).toContain("3 days of full access");
    expect(without.htmlBody).not.toContain("Testzugang");
    for (const s of [withTrial.htmlBody, without.htmlBody]) expect(s).not.toMatch(/[–—]/);
  });
});

describe("readPendingStatus and limits", () => {
  it("pending only for an unconfirmed email account at most 7 days old without Telegram", async () => {
    expect((await readPendingStatus(fake({ user: baseUser() }).sb as never, UID, NOW))?.pending).toBe(true);
    expect(await readPendingStatus(fake({ user: baseUser({ telegram_id: 123 }) }).sb as never, UID, NOW)).toEqual({ pending: false });
    expect(await readPendingStatus(fake({ user: baseUser({ email_verified_at: "2026-10-20T11:00:00Z" }) }).sb as never, UID, NOW)).toEqual({ pending: false });
    expect(await readPendingStatus(fake({ user: baseUser({ created_at: "2026-10-01T00:00:00Z" }) }).sb as never, UID, NOW)).toEqual({ pending: false });
    expect(await readPendingStatus(fake({ user: baseUser({ email: null }) }).sb as never, UID, NOW)).toEqual({ pending: false });
    expect(await readPendingStatus(fake({ user: null, readError: true }).sb as never, UID, NOW)).toBeNull();
  });

  it("counts earlier sends for the durable limit", async () => {
    const s = await readPendingStatus(fake({ user: baseUser(), sends: [{ created_at: "2026-10-21T09:59:30Z" }, { created_at: "2026-10-19T09:00:00Z" }] }).sb as never, UID, NOW);
    expect(s && s.pending && { sent: s.sent, sentToday: s.sentToday }).toEqual({ sent: true, sentToday: 1 });
    expect(resendAllowed({ lastSentAt: NOW.getTime() - 30_000, sentToday: 1 }, NOW)).toBe(false);
    expect(resendAllowed({ lastSentAt: NOW.getTime() - 61_000, sentToday: 4 }, NOW)).toBe(true);
    expect(resendAllowed({ lastSentAt: NOW.getTime() - 3_600_000, sentToday: 5 }, NOW)).toBe(false);
    expect(resendAllowed({ lastSentAt: null, sentToday: 0 }, NOW)).toBe(true);
  });

  it("mail language: explicit choice first, then the browser", () => {
    expect(requestMailLang(new Headers({ cookie: "a=1; mp_lang=de", "accept-language": "en-US" }))).toBe("de");
    expect(requestMailLang(new Headers({ cookie: "mp_lang=ru", "accept-language": "de-AT" }))).toBe("en");
    expect(requestMailLang(new Headers({ "accept-language": "de-AT,de;q=0.9" }))).toBe("de");
    expect(requestMailLang(new Headers())).toBe("en");
  });
});
