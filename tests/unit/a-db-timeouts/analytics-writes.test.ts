import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeHandler } from "../helpers/fake-supabase";

// a-db-timeouts: analytics never holds the learner's response, and a failed
// paywall_hit write is reported instead of silently dropped.

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  guard: vi.fn(),
  optional: vi.fn(),
  capture: vi.fn(),
  deferred: [] as Array<() => Promise<unknown>>,
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.guard, resolveOptionalUser: mocks.optional }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: mocks.capture }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => Promise<unknown>) => { mocks.deferred.push(task); } };
});

import { POST as track } from "@/app/api/track/route";
import { POST as beacon } from "@/app/api/beacon/landing/route";
import { logFreeCapHit, __resetCapHitThrottle } from "@/lib/free-access";
import { __resetDbUnavailableState, createTimedFetch } from "@/lib/db-unavailable";

const USER = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";

function database(handler: FakeHandler) {
  const fake = createFakeSupabase(handler);
  mocks.db.mockReturnValue(fake.sb);
  return fake;
}
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const runDeferred = async () => { while (mocks.deferred.length) await mocks.deferred.shift()!(); };

/** Makes this instance remember a database failure, as the fetch wrapper does. */
async function seeOutage() {
  const hang = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  await createTimedFetch(hang, 10)("https://synthetic.supabase.invalid/rest/v1/x").catch(() => null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deferred.length = 0;
  __resetDbUnavailableState();
  __resetCapHitThrottle();
  mocks.optional.mockReturnValue(USER);
  mocks.guard.mockResolvedValue({ userId: USER, role: "user", tier: "free", tierExpiresAt: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/track", () => {
  it("answers 202 before any database work, then writes after the response", async () => {
    const fake = database((call) => (call.table === "user_sessions" && call.op === "select" ? { data: { user_id: USER } } : { data: null }));
    const res = await track(post("https://medpruf.com/api/track", { sessionId: SESSION, events: [{ type: "quiz_start", data: {}, timestamp: new Date().toISOString() }] }));
    expect(res.status).toBe(202);
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
    await runDeferred();
    // a-fo-10: the deferred write trusts the signature only, no users re-read.
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(fake.calls.some((c) => c.table === "users")).toBe(false);
    expect(fake.calls.some((c) => c.table === "user_events" && c.op === "insert")).toBe(true);
  });

  it("writes nothing for another account's visit", async () => {
    const fake = database((call) => (call.table === "user_sessions" && call.op === "select" ? { data: { user_id: "someone-else" } } : { data: null }));
    await track(post("https://medpruf.com/api/track", { sessionId: SESSION, events: [{ type: "quiz_start", data: {}, timestamp: new Date().toISOString() }] }));
    await runDeferred();
    expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
    expect(mocks.guard).not.toHaveBeenCalled();
  });

  it("refuses an unsigned caller and bad bodies synchronously", async () => {
    mocks.optional.mockReturnValueOnce(null);
    expect((await track(post("https://medpruf.com/api/track", { sessionId: SESSION }))).status).toBe(401);
    expect((await track(post("https://medpruf.com/api/track", { events: [] }))).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, () => ({ type: "quiz_start", data: {}, timestamp: "" }));
    expect((await track(post("https://medpruf.com/api/track", { sessionId: SESSION, events: tooMany }))).status).toBe(413);
    expect(mocks.deferred).toHaveLength(0);
  });

  it("is a no-op while this instance has just seen the database fail", async () => {
    await seeOutage();
    const fake = database(() => ({ data: null }));
    const res = await track(post("https://medpruf.com/api/track", { sessionId: SESSION, createSession: true }));
    expect(res.status).toBe(204);
    expect(mocks.deferred).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("does not report a database outage in the deferred write to Sentry", async () => {
    database((call) => (call.table === "user_sessions" && call.op === "select" ? { data: { user_id: USER } } : call.table === "user_events" ? { error: { code: "", message: "DbUnavailableError: Database did not answer within 8000 ms" } } : { data: null }));
    await track(post("https://medpruf.com/api/track", { sessionId: SESSION, events: [{ type: "quiz_start", data: {}, timestamp: new Date().toISOString() }] }));
    await runDeferred();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});

describe("/api/beacon/landing", () => {
  it("answers 204 first and stores the hit after the response", async () => {
    const fake = database(() => ({ data: null }));
    const res = await beacon(post("https://medpruf.com/api/beacon/landing", { path: "/landing", utm_source: "telegram" }, { "x-forwarded-for": "198.51.100.7" }));
    expect(res.status).toBe(204);
    expect(fake.calls).toHaveLength(0);
    await runDeferred();
    expect(fake.calls.filter((c) => c.table === "landing_hits")).toHaveLength(1);
  });
  it("skips the write while the database is failing", async () => {
    await seeOutage();
    const fake = database(() => ({ data: null }));
    expect((await beacon(post("https://medpruf.com/api/beacon/landing", { path: "/landing" }, { "x-forwarded-for": "198.51.100.8" }))).status).toBe(204);
    await runDeferred();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("paywall_hit write", () => {
  const args = { userId: USER, gate: "qbank_limit", route: "/api/questions", examType: "kenntnispruefung" };

  it("reads the insert error, reports it and releases the throttle so the next hit writes", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const fake = createFakeSupabase((call) => (call.table === "user_events" && fail ? { error: { code: "42501", message: "permission denied" } } : { data: null }));
    await logFreeCapHit(fake.sb as unknown as SupabaseClient, args);
    expect(spy).toHaveBeenCalledWith("[free-access] paywall_hit not stored", expect.objectContaining({ code: "42501", gate: "qbank_limit" }));
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    fail = false;
    await logFreeCapHit(fake.sb as unknown as SupabaseClient, args);
    expect(fake.calls.filter((c) => c.table === "user_events" && c.op === "insert")).toHaveLength(2);
    // A stored event keeps the hourly throttle.
    await logFreeCapHit(fake.sb as unknown as SupabaseClient, args);
    expect(fake.calls.filter((c) => c.table === "user_events" && c.op === "insert")).toHaveLength(2);
    spy.mockRestore();
  });

  it("a database outage is logged but not sent to Sentry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase(() => ({ error: { code: "57014", message: "statement timeout" } }));
    await logFreeCapHit(fake.sb as unknown as SupabaseClient, args);
    expect(spy).toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("/api/track backpressure", () => {
  it("drops batches past 120 a minute for one account without queuing work", async () => {
    database(() => ({ data: { user_id: USER } }));
    mocks.optional.mockReturnValue("66666666-6666-4666-8666-666666666666");
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      statuses.push((await track(post("https://medpruf.com/api/track", { sessionId: SESSION, events: [] }))).status);
      mocks.deferred.length = 0;
    }
    expect(statuses.filter((s) => s === 202)).toHaveLength(120);
    expect(statuses.slice(120).every((s) => s === 204)).toBe(true);
  });
});
