import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { middleware } from "@/middleware";
import { miniAppWelcomeMessage, welcomeMessage } from "@/lib/telegram-welcome";
import { TG_WELCOME_COPY, parseTgWelcomeQuery, tgMiniappWelcomeEnabled, tgWelcomeUrl } from "@/lib/tg-welcome";

const SITE = "https://medpruf.com";
const DEEP_DE = "https://t.me/MedPruefBot?start=web_login_de";

type Button = { text: string; url?: string; web_app?: { url: string } };
type Sent = { chat_id: number; text: string; reply_markup?: { inline_keyboard: Button[][] } };

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("miniAppWelcomeMessage", () => {
  it("DE: today's text plus one line, three web_app banks, 'not sure' link, browser button last", () => {
    const w = miniAppWelcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, browserLoginUrl: DEEP_DE });
    const today = welcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_DE });
    expect(w.text).toBe(`${today.text}\n\nMedPrüf öffnet sich direkt hier in Telegram. Sie brauchen kein eigenes Passwort.`);
    const flat = w.inline_keyboard.flat() as Button[];
    expect(flat.map((b) => b.text)).toEqual(["SIP4a / SIP5a Wien", "Stichprobentest (Innsbruck)", "Pharmakologie / Rezeptierkunde", "Ich weiß es noch nicht", "Im Browser öffnen"]);
    const banks = flat.slice(0, 3).map((b) => new URL(b.web_app!.url));
    expect(flat.slice(0, 3).every((b) => b.url === undefined)).toBe(true);
    expect(banks.map((u) => u.pathname)).toEqual(["/tg-welcome", "/tg-welcome", "/tg-welcome"]);
    expect(banks.map((u) => u.searchParams.get("exam"))).toEqual(["kenntnispruefung", "kmp_innsbruck", "pharma"]);
    expect(banks.every((u) => u.searchParams.get("lang") === "de" && u.protocol === "https:")).toBe(true);
    // No credential of any kind in a Mini App URL.
    for (const u of banks) expect([...u.searchParams.keys()].sort()).toEqual(["exam", "lang"]);
    expect(new URL(flat[3].url!).pathname).toBe("/find-your-path");
    expect(flat[4].url).toBe(DEEP_DE);
  });

  it("EN labels and lang=en", () => {
    const w = miniAppWelcomeMessage({ isDE: false, siteUrl: SITE, campaign: null, browserLoginUrl: "https://t.me/MedPruefBot?start=web_login_en" });
    const flat = w.inline_keyboard.flat() as Button[];
    expect(flat.map((b) => b.text)).toEqual(["SIP4a / SIP5a Wien", "Stichprobentest (Innsbruck)", "Pharmacology / Rezeptierkunde", "I am not sure yet", "Open in browser"]);
    expect(w.text.endsWith("MedPrüf opens right here in Telegram. You do not need a separate password.")).toBe(true);
    expect(new URL(flat[0].web_app!.url).searchParams.get("lang")).toBe("en");
  });

  it("a campaign start tags every site button, never the deep link", () => {
    const w = miniAppWelcomeMessage({ isDE: true, siteUrl: SITE, campaign: "fristen-17-okt", browserLoginUrl: DEEP_DE });
    const flat = w.inline_keyboard.flat() as Button[];
    for (const b of flat.slice(0, 4)) {
      const u = new URL(b.web_app?.url ?? b.url!);
      expect(Object.fromEntries(u.searchParams)).toMatchObject({ utm_source: "telegram", utm_medium: "bot", utm_campaign: "fristen-17-okt" });
    }
    expect(new URL(flat[4].url!).searchParams.has("utm_campaign")).toBe(false);
  });

  it("copy: Sie, no em or en dashes, no exclamation marks", () => {
    for (const { de, en } of Object.values(TG_WELCOME_COPY)) {
      expect(`${de} ${en}`).not.toMatch(/[–—!]/);
      expect(de).not.toMatch(/\b(du|dich|dein|deine|dir)\b/i);
    }
  });
});

describe("flag and query helpers", () => {
  it("only the literal 'true' switches it on", () => {
    expect(tgMiniappWelcomeEnabled({})).toBe(false);
    expect(tgMiniappWelcomeEnabled({ TG_MINIAPP_WELCOME_ENABLED: "1" })).toBe(false);
    expect(tgMiniappWelcomeEnabled({ TG_MINIAPP_WELCOME_ENABLED: "true" })).toBe(true);
  });
  it("parseTgWelcomeQuery keeps known banks only and reads non-de as English", () => {
    expect(parseTgWelcomeQuery({ exam: "pharma", lang: "de" })).toEqual({ exam: "pharma", lang: "de" });
    expect(parseTgWelcomeQuery({ exam: "x<script>", lang: "ru" })).toEqual({ exam: null, lang: "en" });
    expect(parseTgWelcomeQuery({ exam: ["pharma"], lang: undefined })).toEqual({ exam: null, lang: "en" });
  });
  it("tgWelcomeUrl trims a trailing slash", () => {
    expect(tgWelcomeUrl({ siteUrl: "https://medpruf.com/", exam: "pharma", lang: "en", campaign: null })).toBe("https://medpruf.com/tg-welcome?exam=pharma&lang=en");
  });
});

describe("webhook welcome", () => {
  async function start(opts: { flag?: string; chatType?: string; text?: string }): Promise<Sent> {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    if (opts.flag !== undefined) vi.stubEnv("TG_MINIAPP_WELCOME_ENABLED", opts.flag);
    const sent: Sent[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}"); }));
    mocks.db.mockReturnValue(createFakeSupabase(() => ({ data: null })).sb);
    const chat = opts.chatType ? { id: 7, type: opts.chatType } : { id: 7, type: "private" };
    const req = new NextRequest(`${SITE}/api/telegram/webhook`, {
      method: "POST",
      body: JSON.stringify({ message: { text: opts.text ?? "/start", chat, from: { id: 7, first_name: "T", language_code: "de" } } }),
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "synthetic-secret" },
    });
    expect((await webhook(req)).status).toBe(200);
    expect(sent).toHaveLength(1);
    return sent[0];
  }
  const today = welcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_DE });

  it("flag off: today's message, byte for byte", async () => {
    const s = await start({});
    expect(s.text).toBe(today.text);
    expect(s.reply_markup?.inline_keyboard).toEqual(today.inline_keyboard);
  });
  it("flag set to anything but 'true': today's message", async () => {
    const s = await start({ flag: "TRUE" });
    expect(s.reply_markup?.inline_keyboard).toEqual(today.inline_keyboard);
  });
  it("flag on, private chat: web_app banks", async () => {
    const s = await start({ flag: "true" });
    const flat = s.reply_markup!.inline_keyboard.flat();
    expect(flat.slice(0, 3).every((b) => b.web_app && !b.url)).toBe(true);
    expect(flat[4]).toEqual({ text: "Im Browser öffnen", url: DEEP_DE });
  });
  it.each(["group", "supergroup", "channel"])("flag on, %s chat: today's keyboard (web_app is private-chat only)", async (chatType) => {
    const s = await start({ flag: "true", chatType });
    expect(s.text).toBe(today.text);
    expect(s.reply_markup?.inline_keyboard).toEqual(today.inline_keyboard);
  });
  it("flag on: a campaign start carries its tags onto the Mini App URL", async () => {
    const s = await start({ flag: "true", text: "/start c_fristen-17-okt" });
    const u = new URL(s.reply_markup!.inline_keyboard[0][0].web_app!.url);
    expect(u.searchParams.get("utm_campaign")).toBe("fristen-17-okt");
  });
});

describe("/tg-welcome is a real 404 while the flag is off", () => {
  it("off: rewritten to an unmatched path", () => {
    const res = middleware(new NextRequest(`${SITE}/tg-welcome?exam=pharma&lang=de`));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__tg-welcome-off");
  });
  it("on: passes", () => {
    vi.stubEnv("TG_MINIAPP_WELCOME_ENABLED", "true");
    const res = middleware(new NextRequest(`${SITE}/tg-welcome?exam=pharma&lang=de`));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("query hardening", () => {
  it("prototype keys never become a language", () => {
    expect(parseTgWelcomeQuery({ exam: "constructor", lang: "constructor" })).toEqual({ exam: null, lang: "en" });
    expect(parseTgWelcomeQuery({ exam: "__proto__", lang: "__proto__" })).toEqual({ exam: null, lang: "en" });
  });
});

describe("review fixes", () => {
  it("a rejected Mini App keyboard falls back to today's welcome", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("TG_MINIAPP_WELCOME_ENABLED", "true");
    const sent: Sent[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response("{}", { status: sent.length === 1 ? 400 : 200 });
    }));
    mocks.db.mockReturnValue(createFakeSupabase(() => ({ data: null })).sb);
    const req = new NextRequest(`${SITE}/api/telegram/webhook`, {
      method: "POST",
      body: JSON.stringify({ message: { text: "/start", chat: { id: 7, type: "private" }, from: { id: 7, first_name: "T", language_code: "de" } } }),
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "synthetic-secret" },
    });
    expect((await webhook(req)).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[0].reply_markup!.inline_keyboard[0][0].web_app).toBeDefined();
    const today = welcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_DE });
    expect(sent[1]).toEqual({ chat_id: 7, text: today.text, reply_markup: { inline_keyboard: today.inline_keyboard } });
  });

  it("initDataTelegramId reads the id, never throws", async () => {
    const { initDataTelegramId } = await import("@/lib/tg-welcome");
    expect(initDataTelegramId("user=%7B%22id%22%3A4242%7D&hash=x")).toBe(4242);
    expect(initDataTelegramId("user=%7B&hash=x")).toBeNull();
    expect(initDataTelegramId("")).toBeNull();
    expect(initDataTelegramId("user=%7B%22id%22%3A-1%7D")).toBeNull();
  });

  it("sitting_set is server-only: /api/track never accepts it", async () => {
    const { isAllowedEvent } = await import("@/lib/analytics-events");
    expect(isAllowedEvent("sitting_set")).toBe(false);
    expect(isAllowedEvent("tg_welcome_open")).toBe(true);
  });
});
