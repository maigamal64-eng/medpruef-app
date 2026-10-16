import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ confirm: vi.fn(), status: vi.fn(), send: vi.fn(), guard: vi.fn(), client: vi.fn(() => ({})) }));
vi.mock("@/lib/email-confirm/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/email-confirm/server")>()),
  confirmEmail: m.confirm,
  readPendingStatus: m.status,
  sendConfirmMail: m.send,
}));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, isGuardFailure: (g: { error?: unknown }) => "error" in g }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { GET as pageGET, POST as pagePOST } from "@/app/confirm-email/route";
import { GET as statusGET, POST as resendPOST } from "@/app/api/email-confirm/route";
import { signConfirmToken } from "@/lib/email-confirm/token";

const UID = "11111111-2222-4333-8444-555555555555";
const SECRET = "k".repeat(40);
let ip = 0;
const form = (body: string) => new NextRequest("http://unit.test/confirm-email", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.1.0.${++ip}` },
  body,
});

beforeEach(() => {
  process.env.REMINDER_LINK_SIGNING_SECRET = SECRET;
  process.env.EMAIL_CONFIRM_ENABLED = "true";
  m.confirm.mockReset();
  m.status.mockReset();
  m.send.mockReset();
  m.guard.mockReset().mockResolvedValue({ userId: UID });
});
afterEach(() => {
  delete process.env.REMINDER_LINK_SIGNING_SECRET;
  delete process.env.EMAIL_CONFIRM_ENABLED;
});

describe("/confirm-email page", () => {
  it("GET shows a POST form and confirms nothing (mail scanners)", async () => {
    const token = signConfirmToken({ userId: UID, email: "user-65abd062@example.com" });
    const res = await pageGET(new NextRequest(`http://unit.test/confirm-email?t=${token}&lang=de`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form method="post" action="/confirm-email">');
    expect(html).toContain(`value="${token}"`);
    expect(html).toContain('lang="de"');
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(m.confirm).not.toHaveBeenCalled();
    expect(m.client).not.toHaveBeenCalled();
  });

  it("GET with a forged or expired link says so without a form", async () => {
    const forged = await pageGET(new NextRequest("http://unit.test/confirm-email?t=ec1.a.b&lang=en"));
    expect(forged.status).toBe(400);
    expect(await forged.text()).not.toContain("<form");
    const expired = signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now: new Date(Date.now() - 8 * 86_400_000) });
    expect((await pageGET(new NextRequest(`http://unit.test/confirm-email?t=${expired}`))).status).toBe(410);
  });

  it("answers 404 while the flag is off or the secret is missing", async () => {
    delete process.env.EMAIL_CONFIRM_ENABLED;
    expect((await pageGET(new NextRequest("http://unit.test/confirm-email?t=x"))).status).toBe(404);
    expect((await pagePOST(form("t=x"))).status).toBe(404);
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    delete process.env.REMINDER_LINK_SIGNING_SECRET;
    expect((await pageGET(new NextRequest("http://unit.test/confirm-email?t=x"))).status).toBe(404);
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it("POST (form) confirms and shows the trial line when it runs", async () => {
    m.confirm.mockResolvedValue({ outcome: "confirmed", trialActive: true });
    const res = await pagePOST(form("t=ec1.p.s&lang=de"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ihre E-Mail-Adresse ist bestätigt.");
    expect(html).toContain("Testzeitraum");
    expect(m.confirm).toHaveBeenCalledWith(expect.anything(), "ec1.p.s", expect.objectContaining({ headers: expect.anything() }));
  });

  it("POST without a form body or token never confirms", async () => {
    const json = new NextRequest("http://unit.test/confirm-email", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ t: "x" }) });
    expect((await pagePOST(json)).status).toBe(400);
    expect((await pagePOST(form("lang=en"))).status).toBe(400);
    expect(m.confirm).not.toHaveBeenCalled();
  });

  it("maps already, expired and retry", async () => {
    m.confirm.mockResolvedValueOnce({ outcome: "already", trialActive: false });
    const already = await pagePOST(form("t=x&lang=en"));
    expect(await already.text()).toContain("already confirmed");
    m.confirm.mockResolvedValueOnce({ outcome: "expired" });
    expect((await pagePOST(form("t=x"))).status).toBe(410);
    m.confirm.mockResolvedValueOnce({ outcome: "retry" });
    expect((await pagePOST(form("t=x"))).status).toBe(503);
  });
});

describe("/api/email-confirm", () => {
  const get = () => new NextRequest("http://unit.test/api/email-confirm");
  const post = (lang = "de") => new NextRequest("http://unit.test/api/email-confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang }) });
  const pending = (over = {}) => ({ pending: true, email: "user-65abd062@example.com", trial: true, sent: true, user: {}, lastSentAt: null, sentToday: 0, ...over });

  it("reads nothing while off", async () => {
    delete process.env.EMAIL_CONFIRM_ENABLED;
    expect(await (await statusGET(get())).json()).toEqual({ enabled: false });
    expect(m.guard).not.toHaveBeenCalled();
    expect((await resendPOST(post())).status).toBe(404);
  });

  it("status reports pending with the own address and the trial hint", async () => {
    m.status.mockResolvedValue(pending());
    expect(await (await statusGET(get())).json()).toEqual({ enabled: true, pending: true, email: "user-65abd062@example.com", trial: true, sent: true });
    m.status.mockResolvedValue({ pending: false });
    expect(await (await statusGET(get())).json()).toEqual({ enabled: true, pending: false });
  });

  it("resend sends in the asked language and respects the durable limit", async () => {
    m.status.mockResolvedValue(pending());
    m.send.mockResolvedValue("sent");
    const ok = await resendPOST(post("de"));
    expect(ok.status).toBe(200);
    expect(m.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: UID, email: "user-65abd062@example.com", lang: "de", source: "resend", trial: true }));
    m.send.mockClear();
    m.status.mockResolvedValue(pending({ lastSentAt: Date.now() - 10_000, sentToday: 1 }));
    m.guard.mockResolvedValue({ userId: "22222222-2222-4333-8444-555555555555" });
    expect((await resendPOST(post())).status).toBe(429);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("resend is capped at 3 an hour per account on this instance", async () => {
    m.guard.mockResolvedValue({ userId: "33333333-2222-4333-8444-555555555555" });
    m.status.mockResolvedValue(pending());
    m.send.mockResolvedValue("sent");
    for (let i = 0; i < 3; i += 1) expect((await resendPOST(post())).status).toBe(200);
    expect((await resendPOST(post())).status).toBe(429);
  });

  it("a confirmed account gets no mail", async () => {
    m.guard.mockResolvedValue({ userId: "44444444-2222-4333-8444-555555555555" });
    m.status.mockResolvedValue({ pending: false });
    expect(await (await resendPOST(post())).json()).toEqual({ ok: true, pending: false });
    expect(m.send).not.toHaveBeenCalled();
  });
});
