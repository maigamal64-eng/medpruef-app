import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ send: vi.fn(), existing: null as Record<string, unknown> | null, calls: [] as FakeCall[] }));
vi.mock("@/lib/email-confirm/server", async (orig) => ({ ...(await orig<typeof import("@/lib/email-confirm/server")>()), sendConfirmMail: m.send }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), signSession: (id: string) => `signed:${id}` }));
vi.mock("@/lib/telegram", async (orig) => ({ ...(await orig<typeof import("@/lib/telegram")>()), validateInitData: () => ({ id: 4242, first_name: "T" }) }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall): FakeResult => {
      if (c.table === "users" && c.op === "select") return { data: m.existing };
      if (c.table === "users" && (c.op === "insert" || c.op === "upsert")) return { data: { id: "55555555-2222-4333-8444-555555555555", email: "new@example.at", first_name: "Lea", created_at: new Date().toISOString(), role: "user", tier: "free", tier_expires_at: null, telegram_id: 4242 } };
      return { data: { user_id: "x" } };
    });
    m.calls = calls;
    return sb;
  },
}));

import { POST } from "@/app/api/auth/route";

let ip = 0;
const register = () => new NextRequest("http://unit.test/api/auth", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${++ip}`, "accept-language": "de-AT" },
  body: JSON.stringify({ emailRegister: { email: "New@Example.at", password: "long-enough-1", firstName: "Lea" } }),
});

beforeEach(() => {
  m.send.mockReset().mockResolvedValue("sent");
  m.existing = null;
});
afterEach(() => {
  delete process.env.EMAIL_CONFIRM_ENABLED;
  delete process.env.REMINDER_LINK_SIGNING_SECRET;
});

describe("register hook", () => {
  it("flag off: the register response is unchanged and no mail is sent", async () => {
    const res = await POST(register());
    expect(res.status).toBe(200);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("flag on without the secret: no mail", async () => {
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    await POST(register());
    expect(m.send).not.toHaveBeenCalled();
  });

  it("flag on: one confirmation mail for the new account in the browser language", async () => {
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    process.env.REMINDER_LINK_SIGNING_SECRET = "k".repeat(40);
    const res = await POST(register());
    expect(res.status).toBe(200);
    expect((await res.json()).sessionToken).toBe("signed:55555555-2222-4333-8444-555555555555");
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "55555555-2222-4333-8444-555555555555", email: "new@example.at", lang: "de", source: "register" }));
  });

  it("flag on: a register retry of an existing account sends nothing", async () => {
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    process.env.REMINDER_LINK_SIGNING_SECRET = "k".repeat(40);
    m.existing = { id: "u-1", email: "new@example.at", password_hash: null };
    expect((await POST(register())).status).toBe(409);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("flag on: the email login and Telegram paths send nothing", async () => {
    process.env.EMAIL_CONFIRM_ENABLED = "true";
    process.env.REMINDER_LINK_SIGNING_SECRET = "k".repeat(40);
    m.existing = null;
    await POST(new NextRequest("http://unit.test/api/auth", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.3.0.1" }, body: JSON.stringify({ emailLogin: { email: "user-65abd062@example.com", password: "whatever-1" } }) }));
    await POST(new NextRequest("http://unit.test/api/auth", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.3.0.2" }, body: JSON.stringify({ initData: "query_id=1&user=%7B%7D&hash=x" }) }));
    expect(m.send).not.toHaveBeenCalled();
  });
});
