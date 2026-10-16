/**
 * a-first-touch: a campaign welcome's bot sign-in link keeps the slug, and the
 * login URL carries the same utm triple, only while FIRST_TOUCH_ENABLED is on.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));

import { POST as webhook } from "@/app/api/telegram/webhook/route";

type Sent = { text?: string; reply_markup?: { inline_keyboard: Array<Array<{ url?: string }>> } };

async function start(text: string): Promise<Sent[]> {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://medpruf.com");
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}"); }));
  mocks.db.mockReturnValue(createFakeSupabase(() => ({ data: null })).sb);
  const res = await webhook(new NextRequest("https://medpruf.com/api/telegram/webhook", {
    method: "POST",
    body: JSON.stringify({ message: { text, chat: { id: 7, type: "private" }, from: { id: 7, first_name: "T", language_code: "de" } } }),
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "synthetic-secret" },
  }));
  expect(res.status).toBe(200);
  return sent;
}
const urls = (sent: Sent[]) => sent.flatMap((m) => (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.url).filter((u): u is string => !!u));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("welcome sign-in link", () => {
  it("off: the bot sign-in link stays web_login_<lang>", async () => {
    const links = urls(await start("/start c_fristen-17-okt"));
    expect(links).toContain("https://t.me/MedPruefBot?start=web_login_de");
  });
  it("on: a campaign welcome links web_login_c_<slug>_<lang>; an untagged one is unchanged", async () => {
    vi.stubEnv("FIRST_TOUCH_ENABLED", "true");
    expect(urls(await start("/start c_fristen-17-okt"))).toContain("https://t.me/MedPruefBot?start=web_login_c_fristen-17-okt_de");
    expect(urls(await start("/start"))).toContain("https://t.me/MedPruefBot?start=web_login_de");
  });
});

describe("sign-in from a tagged link", () => {
  it("is a sign-in whatever the flag says (a sent link keeps working)", async () => {
    const sent = await start("/start web_login_c_fristen-17-okt_de");
    const login = urls(sent).find((u) => u.includes("tg_token="));
    expect(login).toBeTruthy();
    expect(new URL(login as string).searchParams.has("utm_campaign")).toBe(false);
  });
  it("on: the login URL carries the utm triple of the post", async () => {
    vi.stubEnv("FIRST_TOUCH_ENABLED", "true");
    const login = urls(await start("/start web_login_c_fristen-17-okt_en")).find((u) => u.includes("tg_token="));
    expect(Object.fromEntries(new URL(login as string).searchParams)).toMatchObject({ utm_source: "telegram", utm_medium: "bot", utm_campaign: "fristen-17-okt" });
  });
  it("a malformed tagged payload is not a sign-in", async () => {
    vi.stubEnv("FIRST_TOUCH_ENABLED", "true");
    const sent = await start("/start web_login_c_Bad_de");
    expect(urls(sent).some((u) => u.includes("tg_token="))).toBe(false);
  });
});
