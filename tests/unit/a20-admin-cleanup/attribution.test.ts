import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeHandler } from "../helpers/fake-supabase";

// OW-46 / ADM-18 A (a20): a Telegram-tagged link reaches the signup record
// end to end. Each hop is proven here with no network and no database:
//   1. the bare-domain redirect keeps the utm tags (middleware);
//   2. a bot start code puts the same tags on the bot's site button;
//   3. the register call (email or Telegram) stores the tags on the
//      user_registered event the Growth "Sources" table reads;
//   4. the anonymous counters are rate limited per IP and still answer 204.
const mocks = vi.hoisted(() => ({ db: vi.fn(), record: vi.fn(async () => ({ ok: true })), reddit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/user-events", () => ({ recordEventSafe: mocks.record }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: mocks.reddit }));
vi.mock("@/lib/session", () => ({ signSession: () => "synthetic-session", verifySession: () => null }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

import { middleware } from "@/middleware";
import { POST as auth } from "@/app/api/auth/route";
import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { POST as beacon } from "@/app/api/beacon/landing/route";
import { POST as funnel } from "@/app/api/funnel-events/route";
import { attributionForEvent } from "@/lib/attribution";

const TAGS = { utm_source: "telegram", utm_medium: "post", utm_campaign: "fristen-17-okt" };

function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("1. bare-domain redirect keeps the campaign", () => {
  it("forwards utm_* and rdt_cid (and ref) onto /landing, nothing else", () => {
    const res = middleware(new NextRequest("https://medpruf.com/?utm_source=telegram&utm_medium=post&utm_campaign=fristen-17-okt&utm_content=a&rdt_cid=c1&ref=ABC&junk=1"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/landing");
    expect(Object.fromEntries(location.searchParams)).toEqual({ ref: "ABC", utm_source: "telegram", utm_medium: "post", utm_campaign: "fristen-17-okt", utm_content: "a", rdt_cid: "c1" });
  });
  it("still lets the bot welcome entry (?tg_start=1 with tags) through to the page that captures them", () => {
    const res = middleware(new NextRequest("https://medpruf.com/?tg_start=1&utm_source=telegram&utm_campaign=fristen-17-okt"));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("2. bot start code", () => {
  async function start(text: string) {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://medpruf.com");
    const sent: Array<{ reply_markup?: { inline_keyboard: Array<Array<{ url: string }>> } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}"); }));
    database(() => ({ data: null }));
    const res = await webhook(json("https://medpruf.com/api/telegram/webhook", { message: { text, chat: { id: 7 }, from: { id: 7, first_name: "T", language_code: "de" } } }, { "x-telegram-bot-api-secret-token": "synthetic-secret" }));
    expect(res.status).toBe(200);
    return new URL(sent[0].reply_markup!.inline_keyboard[0][0].url);
  }
  it("c_<slug> tags the site button with the same campaign (utm_medium=bot)", async () => {
    const url = await start("/start c_fristen-17-okt");
    expect(url.pathname).toBe("/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ tg_start: "1", utm_source: "telegram", utm_medium: "bot", utm_campaign: "fristen-17-okt" });
  });
  it("keeps the language suffix working", async () => {
    const url = await start("/start c_fristen-17-okt_en");
    expect(url.searchParams.get("utm_campaign")).toBe("fristen-17-okt");
  });
  it("an unknown or bare start keeps the untagged button", async () => {
    expect((await start("/start")).search).toBe("?tg_start=1");
    expect((await start("/start c_Bad")).search).toBe("?tg_start=1");
  });
});

describe("3. the signup event carries the first-touch tags", () => {
  it("email register: user_registered.data.attribution holds the four utm fields, never the click id", async () => {
    database((call) => {
      if (call.table === "users" && call.op === "select") return { data: null };
      if (call.table === "users" && call.op === "insert") return { data: { id: "00000000-0000-4000-8000-000000000001", email: "learner@example.invalid", role: "user", tier: "free" } };
      return { data: {} };
    });
    const res = await auth(json("https://medpruf.com/api/auth", { emailRegister: { email: "learner@example.invalid", password: "synthetic-pass-1", firstName: "L", attribution: { ...TAGS, utm_content: "pin", rdt_cid: "click-1", captured_at: "2026-10-12T08:00:00Z" } } }));
    expect(res.status).toBe(200);
    const event = mocks.record.mock.calls.find((c) => (c as unknown[])[1] && ((c as unknown[])[1] as { eventType: string }).eventType === "user_registered") as unknown[];
    expect((event[1] as { data: unknown }).data).toEqual({ source: "email", method: "email", attribution: { ...TAGS, utm_content: "pin" } });
  });

  it("Telegram code sign-in of a new account: the browser's tags reach user_registered", async () => {
    database((call) => {
      if (call.table === "telegram_login_tokens" && call.op === "select") return { data: { token: "t", telegram_id: 4242, first_name: "T", expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null } };
      if (call.table === "users" && call.op === "select") return { data: null };
      if (call.table === "users" && call.op === "upsert") return { data: { id: "00000000-0000-4000-8000-000000000002", telegram_id: 4242, role: "user", tier: "free" } };
      return { data: {} };
    });
    const res = await auth(json("https://medpruf.com/api/auth", { tokenExchange: "[secret]", attribution: { ...TAGS, utm_medium: "bot" } }));
    expect(res.status).toBe(200);
    const event = mocks.record.mock.calls.find((c) => ((c as unknown[])[1] as { eventType: string }).eventType === "user_registered") as unknown[];
    expect((event[1] as { data: Record<string, unknown> }).data).toMatchObject({ source: "telegram", method: "bot_deeplink", attribution: { ...TAGS, utm_medium: "bot" } });
  });

  it("no stored tags means no attribution key, and junk is dropped", () => {
    expect(attributionForEvent(null)).toBeNull();
    expect(attributionForEvent({ rdt_cid: "x", captured_at: "y" })).toBeNull();
  });
});

describe("4. anonymous counters are rate limited per IP", () => {
  it("landing beacon stores at most 20 hits a minute from one IP and still answers 204", async () => {
    const fake = database(() => ({ data: null }));
    const hit = () => beacon(json("https://medpruf.com/api/beacon/landing", { path: "/landing", ...TAGS }, { "x-forwarded-for": "203.0.113.9" }));
    for (let i = 0; i < 25; i++) expect((await hit()).status).toBe(204);
    expect(fake.calls.filter((c) => c.table === "landing_hits").length).toBe(20);
    expect(JSON.stringify(fake.calls.map((c) => c.payload))).not.toContain("203.0.113.9");
  });
  it("funnel events stop writing after 60 a minute from one IP", async () => {
    const fake = database(() => ({ data: null }));
    const send = () => funnel(json("https://medpruf.com/api/funnel-events", { sessionId: "s1", eventName: "landing_view", path: "/landing" }, { "x-forwarded-for": "203.0.113.10" }));
    for (let i = 0; i < 65; i++) await send();
    expect(fake.calls.filter((c) => c.table === "user_activity_log").length).toBe(60);
  });
});
