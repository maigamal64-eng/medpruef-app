/**
 * a-first-touch: every new-account path of /api/auth writes exactly one
 * user_registered row, a sign-in writes none, unknown keys are dropped.
 * Synthetic fixtures only; recordEventSafe runs for real against the fake.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeHandler } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/session", () => ({ signSession: () => "synthetic-session", verifySession: () => null }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: mocks.capture, addBreadcrumb: vi.fn() }));

import { POST as auth } from "@/app/api/auth/route";
import { resetSignupWarnings } from "@/lib/first-touch/server";

const BOT = "unit-test-bot-token";
const UID = "00000000-0000-4000-8000-0000000000f1";
let ip = 0;

function post(body: unknown) {
  ip += 1;
  return auth(new NextRequest("https://medpruf.com/api/auth", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${ip % 250}` },
  }));
}

function initData(extra: Record<string, string> = {}): string {
  const data: Record<string, string> = { user: JSON.stringify({ id: 4242, first_name: "T", language_code: "de" }), auth_date: String(Math.floor(Date.now() / 1000) - 5), ...extra };
  const check = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(BOT).digest();
  return new URLSearchParams({ ...data, hash: crypto.createHmac("sha256", key).update(check).digest("hex") }).toString();
}

function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const signupRows = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type?: string }).event_type === "user_registered");
const eventData = (c: FakeCall) => (c.payload as { event_data: Record<string, unknown> }).event_data;

function emailDb(opts: { existing?: Record<string, unknown> | null; priorRow?: boolean } = {}) {
  return database((call) => {
    if (call.table === "users" && call.op === "select") return { data: opts.existing ?? null };
    if (call.table === "users" && call.op === "insert") return { data: { id: UID, email: "learner@example.at", role: "user", tier: "free" } };
    if (call.table === "user_events" && call.op === "select") return { data: opts.priorRow ? [{ id: 1 }] : [] };
    return { data: {} };
  });
}

function telegramDb(opts: { existing?: boolean; lookupError?: boolean; createdAt?: string } = {}) {
  return database((call) => {
    if (call.table === "telegram_login_tokens" && call.op === "select") return { data: { token: "t", telegram_id: 4242, first_name: "T", expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null } };
    if (call.table === "users" && call.op === "select") return opts.lookupError ? { error: { code: "PGRST000", message: "timeout" } } : { data: opts.existing ? { id: UID } : null };
    if (call.table === "users" && call.op === "upsert") return { data: { id: UID, telegram_id: 4242, role: "user", tier: "free", created_at: opts.createdAt ?? null } };
    if (call.table === "user_events" && call.op === "select") return { data: [] };
    return { data: {} };
  });
}

const register = (attribution?: unknown) => post({ emailRegister: { email: "learner@example.at", password: "synthetic-pass-1", firstName: "L", attribution } });

beforeEach(() => {
  vi.clearAllMocks();
  resetSignupWarnings();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT);
});
afterEach(() => vi.unstubAllEnvs());

describe.each([["flag off", undefined], ["flag on", "true"]])("%s", (_label, flag) => {
  beforeEach(() => { if (flag) vi.stubEnv("FIRST_TOUCH_ENABLED", flag); });

  it("email register writes exactly one row", async () => {
    const fake = emailDb();
    expect((await register()).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(1);
    expect(eventData(signupRows(fake.calls)[0])).toMatchObject({ source: "email", method: "email" });
  });

  it("email login writes none", async () => {
    const fake = emailDb({ existing: { id: UID, email: "learner@example.at", password_hash: await bcrypt.hash("synthetic-pass-1", 4), role: "user", tier: "free" } });
    expect((await post({ emailLogin: { email: "learner@example.at", password: "synthetic-pass-1" } })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(0);
  });

  it("a register retried with the matching password signs in and writes none", async () => {
    const fake = emailDb({ existing: { id: UID, email: "learner@example.at", password_hash: await bcrypt.hash("synthetic-pass-1", 4), role: "user", tier: "free" } });
    const res = await register();
    expect((await res.json()).existing).toBe(true);
    expect(signupRows(fake.calls)).toHaveLength(0);
  });

  it("a new Telegram account (bot deep link) writes one row; a returning one writes none", async () => {
    let fake = telegramDb();
    expect((await post({ tokenExchange: "[secret]" })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(1);
    expect(eventData(signupRows(fake.calls)[0])).toMatchObject({ source: "telegram", method: "bot_deeplink" });
    fake = telegramDb({ existing: true });
    expect((await post({ tokenExchange: "[secret]" })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(0);
  });

  it("a new Mini App account writes one row; a returning one writes none", async () => {
    let fake = telegramDb();
    expect((await post({ initData: initData() })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(1);
    fake = telegramDb({ existing: true });
    expect((await post({ initData: initData() })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(0);
  });

  it("a failed newness lookup decides by the row's created_at: old account none, fresh account one", async () => {
    let fake = telegramDb({ lookupError: true, createdAt: "2026-01-01T00:00:00Z" });
    expect((await post({ tokenExchange: "[secret]" })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(0);
    expect(fake.calls.find((c) => c.table === "user_activity_log")?.payload).toMatchObject({ event_type: "login" });
    fake = telegramDb({ lookupError: true, createdAt: new Date().toISOString() });
    expect((await post({ tokenExchange: "[secret]" })).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(1);
  });
});

describe("flag off keeps today's row byte for byte", () => {
  it("no first_touch fields, utm attribution only", async () => {
    const fake = emailDb();
    await register({ utm_source: "arrival", utm_medium: "organic", utm_campaign: "lernplan", rdt_cid: "click" });
    expect(eventData(signupRows(fake.calls)[0])).toEqual({ source: "email", method: "email", attribution: { utm_source: "arrival", utm_medium: "organic", utm_campaign: "lernplan" } });
  });
  it("the analytics kill switch still drops it", async () => {
    vi.stubEnv("DISABLE_ANALYTICS_WRITES", "true");
    const fake = emailDb();
    expect((await register()).status).toBe(200);
    expect(signupRows(fake.calls)).toHaveLength(0);
  });
  it("the Mini App start_param is not read", async () => {
    const fake = telegramDb();
    await post({ initData: initData({ start_param: "c_fristen" }) });
    expect(eventData(signupRows(fake.calls)[0]).first_touch).toBeUndefined();
  });
});

describe("flag on", () => {
  beforeEach(() => vi.stubEnv("FIRST_TOUCH_ENABLED", "true"));

  it("email register carries the derived key and its basis", async () => {
    const fake = emailDb();
    await register({ utm_source: "code", utm_medium: "typed", utm_campaign: "wien26" });
    expect(eventData(signupRows(fake.calls)[0])).toEqual({ source: "email", method: "email", attribution: { utm_source: "code", utm_medium: "typed", utm_campaign: "wien26" }, first_touch: "code:wien26", first_touch_basis: "code" });
  });

  it("an untagged signup stores first_touch null; unknown keys and hints are dropped", async () => {
    const fake = emailDb();
    await post({ emailRegister: { email: "learner@example.at", password: "synthetic-pass-1", firstName: "L", attribution: { utm_source: "arrival", utm_campaign: "evil:x" }, firstTouch: "tg_welcome" } });
    expect(eventData(signupRows(fake.calls)[0])).toMatchObject({ first_touch: null, first_touch_basis: null });
  });

  it("Mini App: signed start_param, then the tg_welcome hint; an unknown hint is dropped", async () => {
    let fake = telegramDb();
    await post({ initData: initData({ start_param: "c_fristen-17-okt" }), firstTouch: "tg_welcome" });
    expect(eventData(signupRows(fake.calls)[0])).toMatchObject({ first_touch: "tg_start:fristen-17-okt", first_touch_basis: "start_param" });
    fake = telegramDb();
    await post({ initData: initData(), firstTouch: "tg_welcome" });
    expect(eventData(signupRows(fake.calls)[0])).toMatchObject({ first_touch: "tg_welcome", first_touch_basis: "hint" });
    fake = telegramDb();
    await post({ initData: initData(), firstTouch: "partner:evil" });
    expect(eventData(signupRows(fake.calls)[0])).toMatchObject({ first_touch: null });
  });

  it("a stored first touch beats the start_param", async () => {
    const fake = telegramDb();
    await post({ initData: initData({ start_param: "c_other" }), attribution: { utm_source: "arrival", utm_medium: "organic", utm_campaign: "selbsttest" } });
    expect(eventData(signupRows(fake.calls)[0]).first_touch).toBe("selbsttest");
  });

  it("writes through the analytics kill switch", async () => {
    vi.stubEnv("DISABLE_ANALYTICS_WRITES", "true");
    const fake = emailDb();
    await register();
    expect(signupRows(fake.calls)).toHaveLength(1);
  });

  it("never adds a second row when one exists", async () => {
    const fake = emailDb({ priorRow: true });
    await register();
    expect(signupRows(fake.calls)).toHaveLength(0);
  });

  it("a failed insert is a warning, never an auth error", async () => {
    database((call) => {
      if (call.table === "users" && call.op === "select") return { data: null };
      if (call.table === "users" && call.op === "insert") return { data: { id: UID, email: "learner@example.at", role: "user", tier: "free" } };
      if (call.table === "user_events" && call.op === "select") return { data: [] };
      if (call.table === "user_events" && call.op === "insert") return { error: { code: "42501", message: "denied" } };
      return { data: {} };
    });
    const res = await register();
    expect(res.status).toBe(200);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    await register();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});
