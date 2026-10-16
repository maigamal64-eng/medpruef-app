/**
 * a-fo-08 (DB_FAST_FAIL): while this instance saw the database fail in the
 * last 30 s, every normal server client (the auth guard's lookup included)
 * gives PostgREST 3 s instead of 8 s. Explicit deadlines (LONG_DB_TIMEOUT_MS)
 * are unchanged. Real supabase-js clients over a hanging global fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import {
  createTimedFetch,
  dbFastFailOpen,
  dbRecentlyUnavailable,
  defaultDbTimeoutMs,
  FAST_FAIL_TRIAL_MS,
  resolveDefaultDbTimeoutMs,
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

    it(`${name}: 8 s with the breaker closed (point reads: 4.5 s plus one 3 s retry)`, async () => {
      vi.stubEnv("DB_FAST_FAIL", "true");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(Math, "random").mockReturnValue(0);
      // a-db-timeout-diagnose: the guard's users lookup filters on the user's
      // UUID, so it gets 4.5 s, a 100 ms pause and one 3 s retry (7.6 s, under
      // the browser's 8 s). The questions read (numeric id) and the RPC keep 8 s.
      const expectMs = name === "auth guard lookup" ? 4_500 + 100 + 3_000 : 8_000;
      const { settled } = await settleTime(run(), expectMs);
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

  it("money paths keep 8 s with the breaker open (fastFail: false)", async () => {
    vi.stubEnv("DB_FAST_FAIL", "true");
    await openBreaker();
    const sb = getServiceClient({ fastFail: false });
    const { settled } = await settleTime(sb.rpc("commit_whop_revoke", {}) as unknown as Promise<unknown>, 8_000);
    expect(settled).toBe(true);
  });

  it("every grant and revoke route (Whop, NOWPayments, PUYP approve, admin Grant) uses the steady client", () => {
    const MONEY = [
      "src/app/api/webhooks/whop/route.ts", "src/app/api/webhooks/nowpayments/route.ts",
      "src/app/api/whop/trial/route.ts", "src/app/api/whop/trial/verify/route.ts",
      "src/app/api/whop/checkout/verify/route.ts", "src/app/api/mentor/checkout/verify/route.ts",
      "src/app/api/admin/payments/resolve/route.ts",
      // Access writes by an admin (reviewer round 2 P3-2).
      "src/app/api/puyp/admin/route.ts", "src/app/api/admin/users/grant/route.ts",
      // release-int reviewer P2/P3: bulk PUYP approval, the referral exam reward
      // grant, the mentor beta credit grant and the mentor Whop branch.
      "src/app/api/admin/puyp/bulk-approve/route.ts", "src/app/api/admin/referrals/grant-exam-reward/route.ts",
      "src/lib/mentor/credits/whop-branch.ts",
    ];
    for (const file of MONEY) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/getServiceClient\(\s*\)/);
      expect(src, file).toMatch(/getServiceClient\(\{ fastFail: false \}\)/);
    }
    // The mentor beta cohort route reads usage on GET (normal client) and
    // grants credits on POST (steady client).
    const cohort = readFileSync("src/app/api/mentor/admin/beta/cohort/route.ts", "utf8");
    expect(cohort).toMatch(/enrolBetaUsers\(getServiceClient\(\{ fastFail: false \}\)/);
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

describe("half-open breaker (reviewer P2: a slow but alive database must not stay cut)", () => {
  const ENV = { DB_FAST_FAIL: "true" };
  const ok = vi.fn(() => Promise.resolve(new Response("[]", { status: 200 }))) as unknown as typeof fetch;

  it("the first PostgREST answer closes it; dbRecentlyUnavailable keeps its own meaning", async () => {
    await openBreaker();
    expect(defaultDbTimeoutMs(ENV)).toBe(3_000);
    await createTimedFetch(ok)(REST);
    expect(dbFastFailOpen()).toBe(false);
    expect(defaultDbTimeoutMs(ENV)).toBe(8_000);
    expect(dbRecentlyUnavailable()).toBe(true); // analytics skips and the route probe are unchanged
  });

  it("a 5xx answer does not close it", async () => {
    await openBreaker();
    const err500 = vi.fn(() => Promise.resolve(new Response('{"code":"XX000"}', { status: 500 }))) as unknown as typeof fetch;
    await createTimedFetch(err500)(REST);
    expect(dbFastFailOpen()).toBe(true);
  });

  it("one call every 5 s is a trial with the normal deadline; the others get 3 s", async () => {
    await openBreaker();
    expect(resolveDefaultDbTimeoutMs(ENV)).toBe(3_000); // just opened: no trial yet
    vi.advanceTimersByTime(FAST_FAIL_TRIAL_MS);
    expect(resolveDefaultDbTimeoutMs(ENV)).toBe(8_000); // the trial
    expect(resolveDefaultDbTimeoutMs(ENV)).toBe(3_000); // concurrent calls stay cut
    vi.advanceTimersByTime(FAST_FAIL_TRIAL_MS - 1);
    expect(resolveDefaultDbTimeoutMs(ENV)).toBe(3_000);
    vi.advanceTimersByTime(1);
    expect(resolveDefaultDbTimeoutMs(ENV)).toBe(8_000);
  });

  it("a slow but alive database (6 s answers) closes it through a trial instead of failing forever", async () => {
    vi.stubEnv("DB_FAST_FAIL", "true");
    await openBreaker();
    // Every read answers after 6 s, honouring aborts.
    vi.stubGlobal("fetch", vi.fn((_i: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response("[]", { status: 200 })), 6_000);
      init?.signal?.addEventListener("abort", () => { clearTimeout(t); reject(init.signal?.reason); }, { once: true });
    })));
    const read = () => getServiceClient().from("questions").select("id").then((r) => r);
    const cut = read();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(isDbUnavailable((await cut).error)).toBe(true); // cut at 3 s, breaker stays open
    await vi.advanceTimersByTimeAsync(FAST_FAIL_TRIAL_MS);
    const trial = read();
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await trial).error).toBeNull(); // the trial had 8 s and got its answer
    expect(dbFastFailOpen()).toBe(false);
    const next = read();
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await next).error).toBeNull(); // back to the 8 s deadline
  });

  it("is inert with the flag off: the deadline stays 8 s and no trial is claimed", async () => {
    await openBreaker();
    expect(resolveDefaultDbTimeoutMs({})).toBe(8_000);
    vi.advanceTimersByTime(FAST_FAIL_TRIAL_MS);
    expect(resolveDefaultDbTimeoutMs({})).toBe(8_000);
  });
});
