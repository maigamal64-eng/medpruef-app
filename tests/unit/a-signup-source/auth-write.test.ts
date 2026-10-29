/**
 * a-signup-source-1029: /api/auth writes users.signup_source once for a new
 * account (email, bot deep link, Mini App), never for a sign-in, and makes no
 * database call at all while SIGNUP_SOURCE_ENABLED is off.
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
import { resetSignupSourceWarnings, writeSignupSource } from "@/lib/signup-source/server";

const BOT = "unit-test-bot-token";
const UID = "00000000-0000-4000-8000-0000000000f2";
let ip = 0;

function post(body: unknown, ua = "Mozilla/5.0 Safari") {
  ip += 1;
  return auth(new NextRequest("https://medpruf.com/api/auth", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${ip % 250}`, "user-agent": ua },
  }));
}

function initData(extra: Record<string, string> = {}): string {
  const data: Record<string, string> = { user: JSON.stringify({ id: 4343, first_name: "T", language_code: "de" }), auth_date: String(Math.floor(Date.now() / 1000) - 5), ...extra };
  const check = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(BOT).digest();
  return new URLSearchParams({ ...data, hash: crypto.createHmac("sha256", key).update(check).digest("hex") }).toString();
}

function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const sourceWrites = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === "users" && c.op === "update" && "signup_source" in ((c.payload as object) ?? {}));
const written = (c: FakeCall) => c.payload as { signup_source: string; signup_source_basis: string };

function emailDb(existing: Record<string, unknown> | null = null, updateError = false) {
  return database((call) => {
    if (call.table === "users" && call.op === "select") return { data: existing };
    if (call.table === "users" && call.op === "insert") return { data: { id: UID, email: "learner@example.at", role: "user", tier: "free" } };
    if (call.table === "users" && call.op === "update" && updateError) return { error: { code: "42703", message: "column does not exist" } };
    if (call.table === "user_events" && call.op === "select") return { data: [] };
    return { data: {} };
  });
}

function telegramDb(existing = false) {
  return database((call) => {
    if (call.table === "telegram_login_tokens" && call.op === "select") return { data: { token: "t", telegram_id: 4343, first_name: "T", expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null } };
    if (call.table === "users" && call.op === "select") return { data: existing ? { id: UID } : null };
    if (call.table === "users" && call.op === "upsert") return { data: { id: UID, telegram_id: 4343, role: "user", tier: "free", created_at: null } };
    if (call.table === "user_events" && call.op === "select") return { data: [] };
    return { data: {} };
  });
}

const register = (extra: Record<string, unknown> = {}, attribution?: unknown, ua?: string) =>
  post({ emailRegister: { email: "learner@example.at", password: "synthetic-pass-1", firstName: "L", attribution }, ...extra }, ua);

beforeEach(() => {
  vi.clearAllMocks();
  resetSignupSourceWarnings();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT);
});
afterEach(() => vi.unstubAllEnvs());

describe("flag off", () => {
  it("no signup_source call on any path", async () => {
    let fake = emailDb();
    expect((await register({ refHost: "google.com" })).status).toBe(200);
    expect(sourceWrites(fake.calls)).toHaveLength(0);
    fake = telegramDb();
    expect((await post({ tokenExchange: "[secret]" })).status).toBe(200);
    expect(sourceWrites(fake.calls)).toHaveLength(0);
  });
});

describe("flag on", () => {
  beforeEach(() => vi.stubEnv("SIGNUP_SOURCE_ENABLED", "true"));

  it("an untagged email signup records direct, guarded by signup_source IS NULL", async () => {
    const fake = emailDb();
    expect((await register()).status).toBe(200);
    const w = sourceWrites(fake.calls);
    expect(w).toHaveLength(1);
    expect(written(w[0])).toEqual({ signup_source: "direct", signup_source_basis: "direct" });
    expect(w[0].filters).toEqual(expect.arrayContaining([
      { kind: "eq", column: "id", value: UID },
      { kind: "is", column: "signup_source", value: null },
    ]));
  });

  it("email signup: utm beats the referrer host; the host beats direct; referral beats the host", async () => {
    let fake = emailDb();
    await register({ refHost: "google.com", pendingReferral: true }, { utm_source: "newsletter" });
    expect(written(sourceWrites(fake.calls)[0]).signup_source).toBe("utm:newsletter");
    fake = emailDb();
    await register({ refHost: "www.google.com" });
    expect(written(sourceWrites(fake.calls)[0])).toEqual({ signup_source: "ref:google", signup_source_basis: "referrer" });
    fake = emailDb();
    await register({ refHost: "google.com", pendingReferral: true });
    expect(written(sourceWrites(fake.calls)[0]).signup_source).toBe("referral");
  });

  it("the app shell user agent is named when nothing else is", async () => {
    const fake = emailDb();
    await register({}, undefined, "Mozilla/5.0 (Linux; Android 14) MedPrufApp/1.0");
    expect(written(sourceWrites(fake.calls)[0]).signup_source).toBe("app_shell");
  });

  it("a new bot deep-link account records tg:bot_deeplink; a returning one writes nothing", async () => {
    let fake = telegramDb();
    await post({ tokenExchange: "[secret]" });
    expect(written(sourceWrites(fake.calls)[0])).toEqual({ signup_source: "tg:bot_deeplink", signup_source_basis: "telegram" });
    fake = telegramDb(true);
    await post({ tokenExchange: "[secret]" });
    expect(sourceWrites(fake.calls)).toHaveLength(0);
  });

  it("a bot deep-link signup with an earlier first touch records that touch", async () => {
    const fake = telegramDb();
    await post({ tokenExchange: "[secret]", refHost: "google.de" });
    expect(written(sourceWrites(fake.calls)[0]).signup_source).toBe("ref:google");
  });

  it("a new Mini App account records its signed start param", async () => {
    const fake = telegramDb();
    await post({ initData: initData({ start_param: "c_fristen" }) });
    expect(written(sourceWrites(fake.calls)[0]).signup_source).toBe("tg_start:fristen");
  });

  it("a sign-in writes nothing", async () => {
    const fake = emailDb({ id: UID, email: "learner@example.at", password_hash: await bcrypt.hash("synthetic-pass-1", 4), role: "user", tier: "free" });
    expect((await post({ emailLogin: { email: "learner@example.at", password: "synthetic-pass-1" } })).status).toBe(200);
    expect(sourceWrites(fake.calls)).toHaveLength(0);
  });

  it("a failed write (migration not applied) never fails the signup and warns once", async () => {
    let fake = emailDb(null, true);
    expect((await register()).status).toBe(200);
    expect(sourceWrites(fake.calls)).toHaveLength(1);
    fake = emailDb(null, true);
    expect((await register()).status).toBe(200);
    const warnings = mocks.capture.mock.calls.filter((c) => (c[1] as { phase?: string })?.phase === "signup_source");
    expect(warnings).toHaveLength(1);
  });

  it("refuses a key outside the shape without a database call", async () => {
    const fake = emailDb();
    expect(await writeSignupSource(fake.sb, UID, { key: "ref:evil.com/x", basis: "referrer" })).toBe("noop");
    expect(fake.calls).toHaveLength(0);
  });
});
