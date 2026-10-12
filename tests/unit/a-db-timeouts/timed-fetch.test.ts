import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  createTimedFetch,
  dbRecentlyUnavailable,
  DbUnavailableError,
  isDbUnavailable,
  supabaseFetchTimeoutMs,
  __resetDbUnavailableState,
} from "@/lib/db-unavailable";
import { dbUnavailableResponse, withDbUnavailable } from "@/lib/db-unavailable-route";

// a-db-timeouts: a frozen free-plan database must answer within seconds with
// a typed, retryable failure, never hold a function for 300 s.

const REST = "https://synthetic.supabase.invalid/rest/v1/users?select=id";
const STORAGE = "https://synthetic.supabase.invalid/storage/v1/object/x";

/** A fetch that never answers but honours its abort signal, like undici. */
function hangingFetch() {
  const calls: string[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => __resetDbUnavailableState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("SUPABASE_FETCH_TIMEOUT_MS", () => {
  it("defaults to 8 s and clamps to 1..25 s", () => {
    expect(supabaseFetchTimeoutMs({})).toBe(8_000);
    expect(supabaseFetchTimeoutMs({ SUPABASE_FETCH_TIMEOUT_MS: "abc" })).toBe(8_000);
    expect(supabaseFetchTimeoutMs({ SUPABASE_FETCH_TIMEOUT_MS: "-5" })).toBe(8_000);
    expect(supabaseFetchTimeoutMs({ SUPABASE_FETCH_TIMEOUT_MS: "5000" })).toBe(5_000);
    expect(supabaseFetchTimeoutMs({ SUPABASE_FETCH_TIMEOUT_MS: "200" })).toBe(1_000);
    expect(supabaseFetchTimeoutMs({ SUPABASE_FETCH_TIMEOUT_MS: "120000" })).toBe(25_000);
  });
});

describe("createTimedFetch", () => {
  it("turns a hung PostgREST call into a typed timeout within the deadline", async () => {
    const { fn } = hangingFetch();
    const timed = createTimedFetch(fn, 50);
    const started = Date.now();
    const err = await timed(REST).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(err).toBeInstanceOf(DbUnavailableError);
    expect((err as DbUnavailableError).reason).toBe("timeout");
    // postgrest-js retries a failed GET unless the error looks like an abort.
    expect((err as DbUnavailableError).code).toBe("ABORT_ERR");
    expect(isDbUnavailable(err)).toBe(true);
    expect(dbRecentlyUnavailable()).toBe(true);
  });

  it("also bounds a response whose body never finishes", async () => {
    const stalled = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("[{"));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;
    const err = await createTimedFetch(stalled, 50)(REST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbUnavailableError);
  });

  it("leaves storage calls and fast answers untouched", async () => {
    const ok = vi.fn(async () => new Response('[{"id":1}]', { status: 200, headers: { "content-type": "application/json" } }));
    const timed = createTimedFetch(ok as unknown as typeof fetch, 50);
    const res = await timed(REST);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(dbRecentlyUnavailable()).toBe(false);

    const { fn } = hangingFetch();
    const storage = createTimedFetch(fn, 20)(STORAGE);
    const raced = await Promise.race([storage.then(() => "settled", () => "settled"), new Promise((r) => setTimeout(() => r("still-open"), 120))]);
    expect(raced).toBe("still-open");
  });

  it("rethrows a caller's own abort unchanged and records no outage", async () => {
    const { fn } = hangingFetch();
    const caller = new AbortController();
    const pending = createTimedFetch(fn, 5_000)(REST, { signal: caller.signal });
    const reason = new Error("caller gave up");
    caller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(dbRecentlyUnavailable()).toBe(false);
  });

  it("types a connection failure as unavailable (network) without the abort code", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const err = await createTimedFetch(down, 50)(REST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbUnavailableError);
    expect((err as DbUnavailableError).reason).toBe("network");
    expect((err as DbUnavailableError).code).toBeUndefined();
    expect(dbRecentlyUnavailable()).toBe(true);
  });

  it("marks gateway errors and statement timeouts as an outage but returns the response", async () => {
    const gateway = vi.fn(async () => new Response("Web server is down", { status: 521 })) as unknown as typeof fetch;
    const res = await createTimedFetch(gateway, 50)(REST);
    expect(res.status).toBe(521);
    expect(await res.text()).toBe("Web server is down");
    expect(dbRecentlyUnavailable()).toBe(true);

    __resetDbUnavailableState();
    const statement = vi.fn(async () => new Response('{"code":"57014","message":"canceling statement due to statement timeout"}', { status: 500 })) as unknown as typeof fetch;
    await createTimedFetch(statement, 50)(REST);
    expect(dbRecentlyUnavailable()).toBe(true);

    __resetDbUnavailableState();
    const plain = vi.fn(async () => new Response('{"code":"23505"}', { status: 409 })) as unknown as typeof fetch;
    await createTimedFetch(plain, 50)(REST);
    expect(dbRecentlyUnavailable()).toBe(false);
  });
});

describe("through the real supabase-js client", () => {
  const client = (fetchImpl: typeof fetch) =>
    createClient("https://synthetic.supabase.invalid", "synthetic-key", { global: { fetch: createTimedFetch(fetchImpl, 50) } });

  it("a hung select returns one typed error after one attempt (no retry loop)", async () => {
    const { fn, calls } = hangingFetch();
    const started = Date.now();
    const { data, error, status } = await client(fn).from("users").select("id").eq("id", "x").maybeSingle();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toHaveLength(1);
    expect(data).toBeNull();
    expect(status).toBe(0);
    expect(error?.message).toMatch(/^DbUnavailableError/);
    expect(isDbUnavailable(error)).toBe(true);
  });

  it("a hung RPC is bounded the same way, and throwOnError throws the typed error", async () => {
    const { fn, calls } = hangingFetch();
    const { error } = await client(fn).rpc("get_topic_counts", { p_exam_type: "pharma" });
    expect(isDbUnavailable(error)).toBe(true);
    const thrown = await client(fn).rpc("get_topic_counts", { p_exam_type: "pharma" }).throwOnError().then(() => null, (e: unknown) => e);
    expect(isDbUnavailable(thrown)).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("isDbUnavailable", () => {
  it("recognises our error, its PostgREST shape and statement timeouts only", () => {
    expect(isDbUnavailable(new DbUnavailableError("timeout", "x"))).toBe(true);
    expect(isDbUnavailable({ message: "DbUnavailableError: Database did not answer within 8000 ms", code: "" })).toBe(true);
    expect(isDbUnavailable({ code: "57014", message: "statement timeout" })).toBe(true);
    expect(isDbUnavailable({ code: "DB_UNAVAILABLE" })).toBe(true);
    expect(isDbUnavailable(new Error("wrapped", { cause: new DbUnavailableError("network", "y") }))).toBe(true);
    expect(isDbUnavailable({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isDbUnavailable(new Error("Answer could not be saved"))).toBe(false);
    expect(isDbUnavailable(null)).toBe(false);
  });
});

describe("withDbUnavailable", () => {
  const hungDb = async () => {
    const { fn } = hangingFetch();
    return createTimedFetch(fn, 30)(REST).catch(() => null);
  };

  it("maps a 500 after an unavailable database to 503 with Retry-After", async () => {
    const route = withDbUnavailable(async () => {
      await hungDb();
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    });
    const res = await route();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(await res.json()).toMatchObject({ code: "DB_UNAVAILABLE", retryAfter: 15 });
  });

  it("maps a thrown unavailable error to 503 and rethrows anything else", async () => {
    await expect(withDbUnavailable(async () => { throw new DbUnavailableError("timeout", "x"); })()).resolves.toHaveProperty("status", 503);
    await expect(withDbUnavailable(async () => { throw new Error("bug"); })()).rejects.toThrow("bug");
  });

  it("passes success, client errors and unrelated 500s through untouched", async () => {
    expect((await withDbUnavailable(async () => NextResponse.json({ ok: true }))()).status).toBe(200);
    const notFound = await withDbUnavailable(async () => { await hungDb(); return NextResponse.json({ error: "Unknown question" }, { status: 404 }); })();
    expect(notFound.status).toBe(404);
    __resetDbUnavailableState();
    const bug = await withDbUnavailable(async () => NextResponse.json({ error: "Internal error" }, { status: 500 }))();
    expect(bug.status).toBe(500);
  });

  it("keeps an existing 503 body (auth guard) and adds a Retry-After only when missing", async () => {
    const guarded = await withDbUnavailable(async () => {
      await hungDb();
      return NextResponse.json({ code: "SUPABASE_DEGRADED" }, { status: 503, headers: { "Retry-After": "30" } });
    })();
    expect(guarded.headers.get("Retry-After")).toBe("30");
    expect(await guarded.json()).toEqual({ code: "SUPABASE_DEGRADED" });
    const bare = await withDbUnavailable(async () => { await hungDb(); return NextResponse.json({ error: "x" }, { status: 503 }); })();
    expect(bare.headers.get("Retry-After")).toBe("15");
  });

  it("counts a failure of a read shared with another request (no probe in its context)", async () => {
    const sharedRead = (async () => hungDb())(); // started outside the route's context
    const route = withDbUnavailable(async () => {
      await sharedRead;
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    });
    expect((await route()).status).toBe(503);
  });

  it("dbUnavailableResponse is never cached", () => {
    const res = dbUnavailableResponse();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
