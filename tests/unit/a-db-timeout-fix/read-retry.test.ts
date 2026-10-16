import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createTimedFetch,
  dbFastFailOpen,
  dbReadRetryEnabled,
  dbRecentlyUnavailable,
  DbUnavailableError,
  READ_FIRST_ATTEMPT_TIMEOUT_MS,
  READ_RETRY_TIMEOUT_MS,
  __resetDbUnavailableState,
} from "@/lib/db-unavailable";

// a-db-timeout-diagnose: production showed single PostgREST reads (the auth
// guard's users lookup, 174 ms worst case inside Postgres) hanging for the
// full 8 s deadline with the database idle. An isolated stall of a UUID-scoped
// read now gets a 4.5 s first deadline and one 3 s retry on a new request
// (both under the browser's 8 s); other reads, writes, RPCs, gateway answers
// and instances already seeing failures keep a single attempt.

const REST = "https://synthetic.supabase.invalid/rest/v1/users?select=id&id=eq.11111111-1111-4111-8111-111111111111";

/** Answers per call from `plan`: "hang" never answers (but honours abort), "ok" a JSON 200, "503" a gateway answer, "fail" a network error. */
function scripted(plan: Array<"hang" | "ok" | "503" | "fail">) {
  const calls: Array<{ method: string; url: string }> = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(input) });
    const step = plan[Math.min(calls.length - 1, plan.length - 1)];
    if (step === "ok") return Promise.resolve(new Response('[{"id":"u"}]', { status: 200, headers: { "content-type": "application/json" } }));
    if (step === "503") return Promise.resolve(new Response("busy", { status: 503 }));
    if (step === "fail") return Promise.reject(new TypeError("fetch failed"));
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetDbUnavailableState();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetDbUnavailableState();
});

describe("isolated read retry", () => {
  it("a stalled GET is retried once on a new request and its answer is returned, with no outage trace", async () => {
    const { fn, calls } = scripted(["hang", "ok"]);
    const res = await createTimedFetch(fn, () => 40)(REST, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "u" }]);
    expect(calls).toHaveLength(2);
    // Recovered: the breaker, the analytics skip and the route probe never saw it.
    expect(dbRecentlyUnavailable()).toBe(false);
    expect(dbFastFailOpen()).toBe(false);
    // The log names the table only, never the query string or an id.
    const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("GET users stalled 40 ms, retrying once");
    expect(logged).toContain("GET users retry answered 200");
    expect(logged).not.toContain("1111");
  });

  it("works through supabase-js: the guard-style maybeSingle read recovers", async () => {
    const { fn, calls } = scripted(["hang", "ok"]);
    const sb = createClient("https://synthetic.supabase.invalid", "synthetic-key", { global: { fetch: createTimedFetch(fn, () => 40) } });
    const { data, error } = await sb.from("users").select("id").eq("id", "11111111-1111-4111-8111-111111111111").maybeSingle();
    expect(error).toBeNull();
    expect(data).toEqual({ id: "u" });
    expect(calls).toHaveLength(2);
  });

  it("a HEAD (count) read is retried too", async () => {
    const { fn, calls } = scripted(["hang", "ok"]);
    expect((await createTimedFetch(fn, () => 40)(REST, { method: "HEAD" })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("a read that stalls twice fails as a timeout after two attempts and marks the instance", async () => {
    const { fn, calls } = scripted(["hang", "hang"]);
    const err = await createTimedFetch(fn, () => 40)(REST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbUnavailableError);
    expect((err as DbUnavailableError).reason).toBe("timeout");
    expect(calls).toHaveLength(2);
    expect(dbRecentlyUnavailable()).toBe(true);
    expect(dbFastFailOpen()).toBe(true);
  });

  it("an 8 s client gets 4.5 s, a pause and a 3 s retry: done within 7.8 s, under the browser's 8 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { fn, calls } = scripted(["hang", "hang"]);
    let settled = false;
    const work = createTimedFetch(fn, () => 8_000)(REST).catch((e: unknown) => e).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(READ_FIRST_ATTEMPT_TIMEOUT_MS);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(READ_RETRY_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(READ_FIRST_ATTEMPT_TIMEOUT_MS + 299 + READ_RETRY_TIMEOUT_MS).toBeLessThan(8_000);
    expect(String((await work as Error).message)).toContain(`${READ_RETRY_TIMEOUT_MS} ms`);
  });

  it("reads without a UUID filter (bank scans take 4 to 7 s) keep one attempt under the full deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (const url of [
      "https://synthetic.supabase.invalid/rest/v1/questions?select=id&is_active=eq.true",
      "https://synthetic.supabase.invalid/rest/v1/questions?select=id&id=eq.7",
      "https://synthetic.supabase.invalid/rest/v1/users?select=id&id=in.(11111111-1111-4111-8111-111111111111)",
    ]) {
      __resetDbUnavailableState();
      const { fn, calls } = scripted(["hang", "ok"]);
      let settled = false;
      void createTimedFetch(fn, () => 8_000)(url).catch(() => null).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(7_999);
      expect(settled, url).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled, url).toBe(true);
      expect(calls, url).toHaveLength(1);
    }
  });

  it("many reads stalling together: only the first retries, the rest fail and open the breaker", async () => {
    const { fn, calls } = scripted(["hang", "hang", "hang", "ok"]);
    const timed = createTimedFetch(fn, () => 40);
    const results = await Promise.all([timed(REST), timed(REST), timed(REST)].map((p) => p.then((r) => r.status, (e: unknown) => e)));
    expect(calls).toHaveLength(4);
    expect(results.filter((r) => r === 200)).toHaveLength(1);
    expect(results.filter((r) => r instanceof DbUnavailableError)).toHaveLength(2);
    expect(dbRecentlyUnavailable()).toBe(true);
  });

  it("a second isolated stall within 30 s is not retried (one retry per instance per 30 s)", async () => {
    const first = scripted(["hang", "ok"]);
    expect((await createTimedFetch(first.fn, () => 40)(REST)).status).toBe(200);
    const second = scripted(["hang", "ok"]);
    await expect(createTimedFetch(second.fn, () => 40)(REST)).rejects.toBeInstanceOf(DbUnavailableError);
    expect(second.calls).toHaveLength(1);
  });

  it("a caller who leaves during the retry still leaves the first stall recorded", async () => {
    const { fn, calls } = scripted(["hang", "hang"]);
    const caller = new AbortController();
    const pending = createTimedFetch(fn, () => 40)(REST, { signal: caller.signal }).catch((e: unknown) => e);
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    caller.abort(new Error("client went away"));
    expect(String((await pending as Error).message)).toBe("client went away");
    expect(dbRecentlyUnavailable()).toBe(true);
  });

  it("writes and RPCs are never retried", async () => {
    for (const [method, url] of [["POST", REST], ["PATCH", REST], ["DELETE", REST], ["POST", "https://synthetic.supabase.invalid/rest/v1/rpc/record_quiz_answer"]] as const) {
      __resetDbUnavailableState();
      const { fn, calls } = scripted(["hang", "ok"]);
      const err = await createTimedFetch(fn, () => 30)(url, { method, body: "{}" }).catch((e: unknown) => e);
      expect(err, method).toBeInstanceOf(DbUnavailableError);
      expect(calls, method).toHaveLength(1);
      expect(dbRecentlyUnavailable(), method).toBe(true);
    }
  });

  it("no retry while the instance already saw a failure in the last 30 s (a real outage)", async () => {
    await createTimedFetch(scripted(["fail"]).fn, () => 30)(REST).catch(() => null);
    expect(dbRecentlyUnavailable()).toBe(true);
    const { fn, calls } = scripted(["hang", "ok"]);
    await expect(createTimedFetch(fn, () => 30)(REST)).rejects.toBeInstanceOf(DbUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("no retry when another call failed during the first attempt", async () => {
    const { fn, calls } = scripted(["hang", "ok"]);
    const pending = createTimedFetch(fn, () => 60)(REST).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 10));
    await createTimedFetch(scripted(["fail"]).fn, () => 30)(REST).catch(() => null);
    expect(await pending).toBeInstanceOf(DbUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("gateway answers are not retried (an outage signal)", async () => {
    const { fn, calls } = scripted(["503", "ok"]);
    const err = await createTimedFetch(fn, () => 40)(REST).catch((e: unknown) => e);
    expect((err as DbUnavailableError).reason).toBe("gateway");
    expect(calls).toHaveLength(1);
  });

  it("a caller abort is not retried", async () => {
    const { fn, calls } = scripted(["hang", "ok"]);
    const caller = new AbortController();
    const pending = createTimedFetch(fn, () => 5_000)(REST, { signal: caller.signal }).catch((e: unknown) => e);
    caller.abort(new Error("client went away"));
    expect(String((await pending as Error).message)).toBe("client went away");
    expect(calls).toHaveLength(1);
    expect(dbRecentlyUnavailable()).toBe(false);
  });

  it("explicit numeric deadlines (crons, admin scans, health probe) keep a single attempt", async () => {
    const { fn, calls } = scripted(["hang", "ok"]);
    await expect(createTimedFetch(fn, 30)(REST)).rejects.toBeInstanceOf(DbUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("DB_GET_RETRY=false turns it off; anything else leaves it on", async () => {
    expect(dbReadRetryEnabled({})).toBe(true);
    expect(dbReadRetryEnabled({ DB_GET_RETRY: "0" })).toBe(true);
    expect(dbReadRetryEnabled({ DB_GET_RETRY: "false" })).toBe(false);
    vi.stubEnv("DB_GET_RETRY", "false");
    const { fn, calls } = scripted(["hang", "ok"]);
    await expect(createTimedFetch(fn, () => 30)(REST)).rejects.toBeInstanceOf(DbUnavailableError);
    expect(calls).toHaveLength(1);
  });
});
