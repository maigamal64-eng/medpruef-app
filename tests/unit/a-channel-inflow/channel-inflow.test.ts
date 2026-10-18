import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

import { POST as webhook } from "@/app/api/telegram/webhook/route";
import { miniAppWelcomeMessage, welcomeMessage } from "@/lib/telegram-welcome";
import { FRISTEN_CHANNEL_COPY, FRISTEN_CHANNEL_URL, fristenChannelLinkEnabled } from "@/lib/fristen-channel";
import FristenChannelLine from "@/components/fristen-channel/FristenChannelLine";

(globalThis as { React?: typeof React }).React = React;

const SITE = "https://medpruf.com";
const DEEP_DE = "https://t.me/MedPruefBot?start=web_login_de";
const DEEP_EN = "https://t.me/MedPruefBot?start=web_login_en";

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("flag", () => {
  it("only the literal 'true' turns it on", () => {
    expect(fristenChannelLinkEnabled({})).toBe(false);
    for (const v of ["TRUE", "1", "yes", "on", " true", ""]) expect(fristenChannelLinkEnabled({ FRISTEN_CHANNEL_LINK_ENABLED: v })).toBe(false);
    expect(fristenChannelLinkEnabled({ FRISTEN_CHANNEL_LINK_ENABLED: "true" })).toBe(true);
  });
});

describe("Lektor copy (handover a-channel-inflow/lektor.md)", () => {
  it("is byte for byte the approved text", () => {
    expect(FRISTEN_CHANNEL_COPY.de.page_line).toBe("Neue Prüfungs- und Anmeldetermine aus offiziellen Quellen, immer mit Lesedatum: unser Telegram-Kanal „Fristen Nostrifizierung Österreich“.");
    expect(FRISTEN_CHANNEL_COPY.en.page_line).toBe("New exam dates and registration deadlines from official sources, always with the date we read them: our Telegram channel “Fristen Nostrifizierung Österreich”.");
    expect(FRISTEN_CHANNEL_COPY.de.page_link).toBe("Kanal auf Telegram öffnen");
    expect(FRISTEN_CHANNEL_COPY.en.page_link).toBe("Open the channel on Telegram");
    expect(FRISTEN_CHANNEL_COPY.de.bot_line).toBe("Neue Prüfungs- und Anmeldetermine aus offiziellen Quellen, immer mit Lesedatum, finden Sie in unserem Telegram-Kanal: https://t.me/fristen_nostrifizierung");
    expect(FRISTEN_CHANNEL_COPY.en.bot_line).toBe("New exam dates and registration deadlines from official sources, always with the date we read them, are in our Telegram channel: https://t.me/fristen_nostrifizierung");
  });
  it("carries no dash, date, price or Germany framing", () => {
    for (const lang of ["de", "en"] as const) {
      for (const s of Object.values(FRISTEN_CHANNEL_COPY[lang])) {
        expect(s).not.toMatch(/[–—]/);
        expect(s.replace(FRISTEN_CHANNEL_URL, "")).not.toMatch(/\d|€|EUR/);
        expect(s).not.toMatch(/Deutschland|Germany|\bdu\b|\bdein/i);
      }
    }
  });
  it("links our own channel over https", () => {
    expect(FRISTEN_CHANNEL_URL).toBe("https://t.me/fristen_nostrifizierung");
  });
});

describe("FristenChannelLine", () => {
  it.each(["de", "en"] as const)("%s: line plus a new-tab link to the channel", (lang) => {
    const html = renderToStaticMarkup(createElement(FristenChannelLine, { lang, surface: "calendar" }));
    expect(html).toContain(`href="${FRISTEN_CHANNEL_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-surface="calendar"');
    expect(html).toContain(FRISTEN_CHANNEL_COPY[lang].page_link);
  });
});

describe("pages gate the line on the flag", () => {
  it.each(["src/app/pruefungskalender/page.tsx", "src/app/lernplan/page.tsx"])("%s", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/fristenChannelLinkEnabled\(\) && <FristenChannelLine/);
  });
  it("/lernplan keeps its own page flag first", () => {
    const src = readFileSync("src/app/lernplan/page.tsx", "utf8");
    expect(src.indexOf("if (!publicPlanEnabled()) notFound();")).toBeGreaterThan(-1);
  });
});

describe("welcome builders", () => {
  it("off (default): today's text unchanged", () => {
    const a = welcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_DE });
    const b = welcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_DE, channelLine: false });
    expect(b).toEqual(a);
    expect(a.text).not.toContain("fristen_nostrifizierung");
  });
  it("on: one paragraph appended, keyboard unchanged", () => {
    const a = welcomeMessage({ isDE: false, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_EN });
    const b = welcomeMessage({ isDE: false, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_EN, channelLine: true });
    expect(b.text).toBe(`${a.text}\n\n${FRISTEN_CHANNEL_COPY.en.bot_line}`);
    expect(b.inline_keyboard).toEqual(a.inline_keyboard);
  });
  it("Mini App variant: the line comes once, after the Mini App line", () => {
    const off = miniAppWelcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, browserLoginUrl: DEEP_DE });
    const on = miniAppWelcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, browserLoginUrl: DEEP_DE, channelLine: true });
    expect(on.text).toBe(`${off.text}\n\n${FRISTEN_CHANNEL_COPY.de.bot_line}`);
    expect(on.text.split("fristen_nostrifizierung")).toHaveLength(2);
    expect(on.inline_keyboard).toEqual(off.inline_keyboard);
  });
});

describe("webhook /start", () => {
  async function start(opts: { flag?: string; miniApp?: string; chatType?: string; lang?: string }): Promise<{ text: string }> {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    if (opts.flag !== undefined) vi.stubEnv("FRISTEN_CHANNEL_LINK_ENABLED", opts.flag);
    if (opts.miniApp !== undefined) vi.stubEnv("TG_MINIAPP_WELCOME_ENABLED", opts.miniApp);
    const sent: { text: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}"); }));
    mocks.db.mockReturnValue(createFakeSupabase(() => ({ data: null })).sb);
    const req = new NextRequest(`${SITE}/api/telegram/webhook`, {
      method: "POST",
      body: JSON.stringify({ message: { text: "/start", chat: { id: 7, type: opts.chatType ?? "private" }, from: { id: 7, first_name: "T", language_code: opts.lang ?? "de" } } }),
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "synthetic-secret" },
    });
    expect((await webhook(req)).status).toBe(200);
    expect(sent).toHaveLength(1);
    return sent[0];
  }
  const todayDE = welcomeMessage({ isDE: true, siteUrl: SITE, campaign: null, miniAppUrl: DEEP_DE });

  it("flag off: today's message, byte for byte", async () => {
    expect((await start({})).text).toBe(todayDE.text);
    expect((await start({ flag: "TRUE" })).text).toBe(todayDE.text);
  });
  it("flag on, private chat, DE and EN: the line is appended", async () => {
    expect((await start({ flag: "true" })).text).toBe(`${todayDE.text}\n\n${FRISTEN_CHANNEL_COPY.de.bot_line}`);
    expect((await start({ flag: "true", lang: "en" })).text).toContain(FRISTEN_CHANNEL_COPY.en.bot_line);
  });
  it.each(["group", "supergroup", "channel"])("flag on, %s chat: no channel link (never into a group)", async (chatType) => {
    expect((await start({ flag: "true", chatType })).text).toBe(todayDE.text);
  });
  it("flag on with the Mini App welcome: the line is appended once", async () => {
    const t = (await start({ flag: "true", miniApp: "true" })).text;
    expect(t.endsWith(FRISTEN_CHANNEL_COPY.de.bot_line)).toBe(true);
    expect(t.split("fristen_nostrifizierung")).toHaveLength(2);
  });
  it("flag on, rejected Mini App keyboard: the fallback welcome still carries the line once", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "synthetic-token");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("FRISTEN_CHANNEL_LINK_ENABLED", "true");
    vi.stubEnv("TG_MINIAPP_WELCOME_ENABLED", "true");
    const sent: { text: string }[] = [];
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
    expect(sent[1].text).toBe(`${todayDE.text}\n\n${FRISTEN_CHANNEL_COPY.de.bot_line}`);
  });
});
