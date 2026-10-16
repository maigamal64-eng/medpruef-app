import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// a-db-timeouts, end to end through the real server client: when PostgREST
// stops answering, a learner route answers 503 + Retry-After within about
// one deadline (instead of holding the function for the 300 s platform
// limit), and an answer save fails in a way the device outbox retries.

vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

import { signSession } from "@/lib/session";
import { GET as authMe } from "@/app/api/auth/me/route";
import { POST as answer } from "@/app/api/answer/route";
import { isRetryableSaveStatus } from "@/lib/offlineSync";
import { __resetDbUnavailableState } from "@/lib/db-unavailable";

const USER = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

type Route = (url: URL, init?: RequestInit) => Response | "hang";

function stubDatabase(route: Route) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const out = route(url, init);
    if (out !== "hang") return Promise.resolve(out);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  }));
  return calls;
}

const json = (body: unknown, init?: RequestInit) => {
  const wantsObject = new Headers(init?.headers).get("Accept")?.includes("vnd.pgrst.object");
  const value = wantsObject && Array.isArray(body) ? body[0] : body;
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
};

const userRow = { id: USER, role: "user", tier: "pro", tier_expires_at: null, is_banned: false, session_invalidated_at: null };

const authed = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    headers: { "x-session-token": signSession(USER), "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

beforeEach(() => {
  __resetDbUnavailableState();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  vi.stubEnv("SESSION_SIGNING_SECRET", "synthetic-signing-secret-0123456789");
  vi.stubEnv("SUPABASE_FETCH_TIMEOUT_MS", "1000");
  vi.stubEnv("SUPABASE_DEGRADED_MODE", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("frozen database", () => {
  it("/api/auth/me answers 503 with Retry-After within the deadline plus one isolated retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = stubDatabase(() => "hang");
    const started = Date.now();
    const res = await authMe(authed("https://medpruf.com/api/auth/me"));
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    // The signed session stays valid: a lookup failure is never a logout.
    expect(res.status).not.toBe(401);
    // a-db-timeout-diagnose: the guard's UUID lookup stalling on a healthy
    // instance gets one short retry (1 s here, capped at the first attempt's), then 503.
    expect(calls.filter((c) => c.includes("/rest/v1/users"))).toHaveLength(2);
    warn.mockRestore();
  });

  it("an answer whose save RPC hangs gets 503 + Retry-After, which the outbox retries", async () => {
    stubDatabase((url, init) => {
      if (url.pathname.endsWith("/rest/v1/users")) return json([userRow], init);
      if (url.pathname.endsWith("/rest/v1/questions")) return json([{ difficulty: 1, topic: "Kardiologie", exam_type: "kenntnispruefung" }], init);
      return "hang";
    });
    const started = Date.now();
    const res = await answer(authed("https://medpruf.com/api/answer", { method: "POST", body: { questionId: 101, isCorrect: true, requestId: REQUEST_ID } }));
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(await res.json()).toMatchObject({ code: "DB_UNAVAILABLE" });
    expect(isRetryableSaveStatus(res.status)).toBe(true);
  });

  it("a healthy database still saves the answer normally", async () => {
    stubDatabase((url, init) => {
      if (url.pathname.endsWith("/rest/v1/users")) return json([userRow], init);
      if (url.pathname.endsWith("/rest/v1/questions")) return json([{ difficulty: 1, topic: "Kardiologie", exam_type: "kenntnispruefung" }], init);
      if (url.pathname.endsWith("/rpc/record_quiz_answer")) return json({ saved: true, duplicate: false, xp: 10, totalXp: 110, gamification: null }, init);
      return json([], init);
    });
    const res = await answer(authed("https://medpruf.com/api/answer", { method: "POST", body: { questionId: 101, isCorrect: true, requestId: REQUEST_ID } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saved: true, xp: 10 });
  });
});
