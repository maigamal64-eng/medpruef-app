import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), record: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/user-events", () => ({ recordEventSafe: mocks.record }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/session", () => ({ signSession: () => "synthetic-session", verifySession: () => null }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

import { INIT_DATA_MAX_AGE_SEC, validateInitData, verifyInitData } from "@/lib/telegram";
import { POST as auth } from "@/app/api/auth/route";

// Synthetic fixtures only. No Telegram or database calls.
const BOT = "unit-test-bot-token";
const NOW = 1_800_000_000;
const user = { id: 4242, first_name: "T", language_code: "de" };

function initData(authDate: number | null, extra: Record<string, string> = {}, token = BOT): string {
  const data: Record<string, string> = { user: JSON.stringify(user), query_id: "q", ...extra };
  if (authDate !== null) data.auth_date = String(authDate);
  const check = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", key).update(check).digest("hex");
  return new URLSearchParams({ ...data, hash }).toString();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("verifyInitData", () => {
  it("accepts a fresh signed payload", () => {
    expect(verifyInitData(initData(NOW - 60), BOT)).toEqual({ ok: true, user });
  });
  it("accepts up to the 24 hour lifetime, refuses one second later", () => {
    expect(verifyInitData(initData(NOW - INIT_DATA_MAX_AGE_SEC), BOT).ok).toBe(true);
    expect(verifyInitData(initData(NOW - INIT_DATA_MAX_AGE_SEC - 1), BOT)).toEqual({ ok: false, reason: "stale" });
  });
  it("refuses an auth_date far in the future, allows small clock skew", () => {
    expect(verifyInitData(initData(NOW + 60), BOT).ok).toBe(true);
    expect(verifyInitData(initData(NOW + 3600), BOT)).toEqual({ ok: false, reason: "stale" });
  });
  it("signature failures are invalid, never stale", () => {
    expect(verifyInitData(initData(NOW - 999_999), "other-bot")).toEqual({ ok: false, reason: "invalid" });
    const tampered = new URLSearchParams(initData(NOW));
    tampered.set("user", JSON.stringify({ ...user, id: 1 }));
    expect(verifyInitData(tampered.toString(), BOT)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyInitData("", BOT)).toEqual({ ok: false, reason: "invalid" });
  });
  it("a signed payload without auth_date is invalid", () => {
    expect(validateInitData(initData(null), BOT)).toEqual(user);
    expect(verifyInitData(initData(null), BOT)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("/api/auth initData path", () => {
  function post(body: unknown) {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT);
    return auth(new NextRequest("https://medpruf.com/api/auth", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  }
  function database() {
    const fake = createFakeSupabase((call) => {
      if (call.table === "users" && call.op === "select") return { data: null };
      if (call.table === "users" && call.op === "upsert") return { data: { id: "00000000-0000-4000-8000-000000000009", telegram_id: 4242, role: "user", tier: "free" } };
      return { data: {} };
    });
    mocks.db.mockReturnValue(fake.sb);
    return fake;
  }
  it("fresh initData signs in through the existing Mini App path and keeps the campaign", async () => {
    const fake = database();
    const res = await post({ initData: initData(NOW - 5), attribution: { utm_source: "telegram", utm_medium: "bot", utm_campaign: "fristen-17-okt" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionToken).toBe("synthetic-session");
    const log = fake.calls.find((c) => c.table === "user_activity_log" && c.op === "insert");
    expect((log?.payload as { metadata: Record<string, unknown> }).metadata).toMatchObject({ method: "miniapp", source: "telegram", attribution: { utm_campaign: "fristen-17-okt" } });
  });
  it("stale initData: 401 INITDATA_STALE, nothing written", async () => {
    const fake = database();
    const res = await post({ initData: initData(NOW - INIT_DATA_MAX_AGE_SEC - 10) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "INITDATA_STALE" });
    expect(fake.calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });
  it("tampered initData: 401 without the stale code", async () => {
    database();
    const tampered = new URLSearchParams(initData(NOW));
    tampered.set("user", JSON.stringify({ ...user, id: 1 }));
    const res = await post({ initData: tampered.toString() });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBeUndefined();
  });
});
