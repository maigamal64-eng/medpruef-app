/**
 * a-fo-08 (DB_FAST_FAIL): while this instance saw the database fail in the
 * last 30 s, every normal server client (the auth guard's lookup included)
 * gives PostgREST 3 s instead of 8 s. Explicit deadlines (LONG_DB_TIMEOUT_MS)
 * are unchanged. Real supabase-js clients over a hanging global fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createTimedFetch,
  dbRecentlyUnavailable,
  defaultDbTimeoutMs,
  isDbUnavailable,
  LONG_DB_TIMEOUT_MS,
  __resetDbUnavailableState,
} from "@/lib/db-unavailable";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { signSession, SESSION_HEADER } from "@/lib/session";

const REST = "https://synthetic.supabase.invalid/rest/v1/users?select=id";
const USER = "11111111-1111-4111-8111-111111111111";

/** A fetch that never answers but honours its abort signal, like undici. */
function hang(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Open the instance breaker the way production does: one failed PostgREST call. */
async function openBreaker() {
  const broken = vi.fn(() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
  await createTimedFetch(broken)(REST).catch(() => undefined);
  expect(dbRecentlyUnavailable()).toBe(true);
}

/** Milliseconds until `work` settles, measured on the fake clock (1 ms steps around the edge). */
async function settleTime(work: Promise<unknown>, expectMs: number): Promise<{ settled: boolean; value: unknown }> {
  let settled = false;
  let value: unknown;
  void work.then((v) => { settled = true; value = v; }, (e) => { settled = true; value = e; });
  await vi.advanceTimersByTimeAsync(expectMs - 1);
  expect(settled, `settled before ${expectMs} ms`).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  return { settled, value };
}

beforeEach(() => {
  __resetDbUnavailableState();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-24T03:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  vi.stubEnv("SESSION_SIGNING_SECRET", "a-fo-08-synthetic-signing-secret");
  vi.stubEnv("SUPABASE_DEGRADED_MODE", "");
  vi.stubEnv("SUPABASE_FETCH_TIMEOUT_MS", "");
  vi.stubGlobal("fetch", vi.fn(hang));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetDbUnavailableState();
});

describe("defaultDbTimeoutMs", () => {
  it("is 8 s when the flag is off, even with the breaker open", async () => {
    await openBreaker();
    expect(defaultDbTimeoutMs({})).toBe(8_000);
    expect(defaultDbTimeoutMs({ DB_FAST_FAIL: "1" })).toBe(8_000);
  });

  it("is 3 s with the flag on and the breaker open, 8 s again after 30 s", async () => {
    expect(defaultDbTimeoutMs({ DB_FAST_FAIL: "true" })).toBe(8_000);
    await openBreaker();
    expect(defaultDbTimeoutMs({ DB_FAST_FAIL: "true" })).toBe(3_000);
    vi.advanceTimersByTime(30_000);
    expect(defaultDbTimeoutMs({ DB_FAST_FAIL: "true" })).toBe(8_000);
  });

  it("never raises a configured deadline below 3 s", async () => {
    await openBreaker();
    expect(defaultDbTimeoutMs({ DB_FAST_FAIL: "true", SUPABASE_FETCH_TIMEOUT_MS: "2000" })).toBe(2_000);
    expect(defaultDbTimeoutMs({ DB_FAST_FAIL: "true", SUPABASE_FETCH_TIMEOUT_MS: "12000" })).toBe(3_000);
  });
});

const guardRequest = () =>
  new NextRequest("https://x/api/answer", { headers: { [SESSION_HEADER]: signSession(USER) } });

/** The three reads the acceptance names, each through a fresh normal client. */
const READS = {
  "auth guard lookup": () => requireUser(guardRequest()),
  "questions read": () => getServiceClient().from("questions").select("id, choices").eq("id", 7).maybeSingle(),
  "answer RPC": () => getServiceClient().rpc("record_quiz_answer", { p_user_id: USER, p_question_id: 7, p_is_correct: true }),
} as const;

describe("normal server clients", () => {
  for (const [name, run] of Object.entries(READS)) {
    it(`${name}: 3 s with DB_FAST_FAIL and the breaker open`, async () => {
      vi.stubEnv("DB_FAST_FAIL", "true");
      await openBreaker();
      const { settled, value } = await settleTime(run(), 3_000);
      expect(settled).toBe(true);
      if (name === "auth guard lookup") {
        const guard = value as { error?: Response };
        expect(guard.error?.status).toBe(503);
      } else {
        expect(isDbUnavailable((value as { error: unknown }).error)).toBe(true);
      }
    });

    it(`${name}: 8 s with the breaker closed`, async () => {
      vi.stubEnv("DB_FAST_FAIL", "true");
      const { settled } = await settleTime(run(), 8_000);
      expect(settled).toBe(true);
    });

    it(`${name}: 8 s with the breaker open but the flag off`, async () => {
      await openBreaker();
      const { settled } = await settleTime(run(), 8_000);
      expect(settled).toBe(true);
    });
  }
});

describe("explicit deadlines are unchanged", () => {
  it("a LONG_DB_TIMEOUT_MS client keeps 25 s with the breaker open", async () => {
    vi.stubEnv("DB_FAST_FAIL", "true");
    await openBreaker();
    const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
    const { settled, value } = await settleTime(sb.rpc("commit_whop_revoke", {}) as unknown as Promise<unknown>, 25_000);
    expect(settled).toBe(true);
    expect(isDbUnavailable((value as { error: unknown }).error)).toBe(true);
  });

  it("a deadline read once at the start of a call is not shortened mid-flight", async () => {
    vi.stubEnv("DB_FAST_FAIL", "true");
    // postgrest builders are lazy: .then() starts the request now.
    const pending = getServiceClient().from("users").select("id").maybeSingle().then((r) => r);
    await vi.advanceTimersByTimeAsync(1_000);
    await openBreaker();
    const { settled } = await settleTime(pending, 7_000);
    expect(settled).toBe(true);
  });
});
