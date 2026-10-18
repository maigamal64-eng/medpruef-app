import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/mail-suppression", () => ({ sendUnlessSuppressed: vi.fn(async () => ({ ok: true })) }));

import { POST } from "@/app/api/telegram/webhook/route";
import { signTelegramLinkToken } from "@/lib/telegram-link/token";

const UID = "11111111-2222-4333-8444-555555555555";
const secret = "unit-test-webhook-secret";
const start = (text: string, chatType = "private") => new NextRequest("http://unit.test/api/telegram/webhook", {
  method: "POST",
  headers: { "x-telegram-bot-api-secret-token": secret },
  body: JSON.stringify({ message: { chat: { id: 900, type: chatType }, text, from: { id: 900, username: "doc", language_code: "de" } } }),
});

let calls: FakeCall[] = [];
beforeEach(() => {
  calls = [];
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", secret);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "unit-test-bot-token");
  vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", "s".repeat(40));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  m.client.mockReturnValue(createFakeSupabase((c) => {
    calls.push(c);
    if (c.table === "users" && c.op === "update") return { data: [{ id: UID }] };
    if (c.table === "users" && c.filters.some((f) => f.column === "telegram_id")) return { data: [] };
    if (c.table === "users") return { data: { id: UID, telegram_id: null, is_banned: false, session_invalidated_at: null } };
    return { data: null };
  }).sb);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const sentTexts = () => (fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls.map(([, init]) => JSON.parse(init.body).text as string);

describe("bot /start lk_<token>", () => {
  it("binds the sender's Telegram to the account and replies in German", async () => {
    vi.stubEnv("TELEGRAM_LINK_ENABLED", "true");
    const res = await POST(start(`/start ${signTelegramLinkToken({ userId: UID })}`));
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.op === "update")?.payload).toMatchObject({ telegram_id: 900 });
    expect(sentTexts()[0]).toContain("verknüpft");
  });
  it("never in a group", async () => {
    vi.stubEnv("TELEGRAM_LINK_ENABLED", "true");
    await POST(start(`/start ${signTelegramLinkToken({ userId: UID })}`, "group"));
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
  it("flag off: no bind, the start is answered like any unknown payload (welcome)", async () => {
    await POST(start(`/start ${signTelegramLinkToken({ userId: UID })}`));
    expect(calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
    expect(fetch).toHaveBeenCalled();
    expect(sentTexts()[0]).not.toContain("verknüpft");
  });
});
