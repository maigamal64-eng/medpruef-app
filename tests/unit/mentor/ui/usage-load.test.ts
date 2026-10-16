import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  USAGE_CACHE_MAX_AGE_MS,
  USAGE_FAILURE_COOLDOWN_MS,
  createUsageLoader,
  isRetryableUsageFailure,
  readUsageCache,
  usageCacheKey,
  usageDurationBucket,
  usageRetryDelayMs,
  usageStatusBucket,
  writeUsageCache,
  type UsageAttempt,
} from "@/components/mentor/usage-load";
import { FIXTURE_USAGE } from "@/lib/mentor/fixtures";
import { mentorEventData } from "@/lib/mentor/telemetry";
import type { MentorUsageResponse } from "@/lib/mentor/contract";

const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
const OK: UsageAttempt = { ok: true, usage: FIXTURE_USAGE.ok as MentorUsageResponse };
const NET: UsageAttempt = { ok: false, status: 0, error: "network" };
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe("a-mentor-reliability R3: usage cache", () => {
  it("round-trips for 10 minutes per user, then expires; junk and other users read null", () => {
    const s = memory();
    writeUsageCache(s, USER, OK.ok ? OK.usage : (null as never), 1_000);
    expect(readUsageCache(s, USER, 1_000 + USAGE_CACHE_MAX_AGE_MS - 1)?.usage.credits_left).toBe((FIXTURE_USAGE.ok as MentorUsageResponse).credits_left);
    expect(readUsageCache(s, USER, 1_000 + USAGE_CACHE_MAX_AGE_MS)).toBeNull();
    expect(readUsageCache(s, USER, 500)).toBeNull(); // clock went backwards
    expect(readUsageCache(s, "other", 1_000)).toBeNull();
    s.setItem(usageCacheKey(USER), JSON.stringify({ usage: { state: "ok" }, at: 1_000 }));
    expect(readUsageCache(s, USER, 1_000)).toBeNull();
    s.setItem(usageCacheKey(USER), "{not json");
    expect(readUsageCache(s, USER, 1_000)).toBeNull();
    expect(readUsageCache(null, USER, 1_000)).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readUsageCache(throwing, USER, 1)).toBeNull();
    expect(() => writeUsageCache(throwing, USER, (FIXTURE_USAGE.ok as MentorUsageResponse), 1)).not.toThrow();
  });
});

describe("a-mentor-reliability R3: backoff rules", () => {
  it("retries network, server, reserve, unknown and rate limits; never sign-out or a switched-off mentor", () => {
    for (const error of ["network", "upstream_error", "reserve_failed", "unknown", "rate_limited"] as const) expect(isRetryableUsageFailure({ ok: false, status: 0, error })).toBe(true);
    for (const error of ["unauthenticated", "mentor_disabled", "invalid_input"] as const) expect(isRetryableUsageFailure({ ok: false, status: 401, error })).toBe(false);
  });
  it("about 2, 6, 15 s with at most 20 % jitter, then null; retry_after wins when longer", () => {
    expect(usageRetryDelayMs(0, NET as never, () => 0.5)).toBe(2_000);
    expect(usageRetryDelayMs(1, NET as never, () => 0)).toBe(4_800);
    expect(usageRetryDelayMs(2, NET as never, () => 1)).toBe(18_000);
    expect(usageRetryDelayMs(3, NET as never, () => 0.5)).toBeNull();
    expect(usageRetryDelayMs(0, { ok: false, status: 429, error: "rate_limited", retryAfterSeconds: 31 }, () => 0.5)).toBe(31_000);
    expect(usageRetryDelayMs(0, { ok: false, status: 401, error: "unauthenticated" }, () => 0.5)).toBeNull();
  });
  it("R8 buckets are text-free and pass the mentor event allowlist", () => {
    expect([usageDurationBucket(100), usageDurationBucket(6_000), usageDurationBucket(13_000), usageDurationBucket(28_000)]).toEqual(["under_5s", "5_to_12s", "12_to_28s", "28s_or_more"]);
    expect([usageStatusBucket(0), usageStatusBucket(429), usageStatusBucket(503), usageStatusBucket(404), usageStatusBucket(200)]).toEqual(["0", "429", "5xx", "4xx", "2xx"]);
    const data = { error: "network", http: "0", duration: "12_to_28s", attempts: "4", email: "x@y.z", user_id: USER };
    expect(mentorEventData(data)).toEqual({ error: "network", http: "0", duration: "12_to_28s", attempts: "4" });
  });
});

describe("a-mentor-reliability R3: single-flight loader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins overlapping runs into one request", async () => {
    let resolve!: (r: UsageAttempt) => void;
    const load = vi.fn(() => new Promise<UsageAttempt>((r) => { resolve = r; }));
    const onResult = vi.fn();
    const loader = createUsageLoader({ load, onResult, random: () => 0.5 });
    const a = loader.run(); const b = loader.run(); const c = loader.run();
    expect(load).toHaveBeenCalledTimes(1);
    expect(loader.active()).toBe(true);
    resolve(OK);
    await Promise.all([a, b, c]);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][1]).toMatchObject({ final: true, attempt: 0 });
    expect(loader.active()).toBe(false);
  });

  it("retries a failure three times (2, 6, 15 s), then reports one final failure", async () => {
    const load = vi.fn(async () => NET);
    const onResult = vi.fn();
    const loader = createUsageLoader({ load, onResult, random: () => 0.5 });
    const done = loader.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(load).toHaveBeenCalledTimes(4);
    await done;
    expect(onResult.mock.calls.map((c) => c[1].final)).toEqual([false, false, false, true]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(4); // no loop: the next tick starts a new cycle
  });

  it("review P3: after a cycle ran out, the 60 s tick waits 3 minutes; a tab return or Try again does not", async () => {
    let t = 0;
    const load = vi.fn(async () => NET);
    const loader = createUsageLoader({ load, onResult: () => {}, random: () => 0.5, now: () => t });
    const first = loader.run();
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    expect(load).toHaveBeenCalledTimes(4);
    t = 60_000;
    await loader.run({ tick: true });
    expect(load).toHaveBeenCalledTimes(4);
    const visible = loader.run();
    await vi.advanceTimersByTimeAsync(30_000);
    await visible;
    expect(load).toHaveBeenCalledTimes(8);
    t = 60_000 + USAGE_FAILURE_COOLDOWN_MS;
    const tick = loader.run({ tick: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await tick;
    expect(load).toHaveBeenCalledTimes(12);
  });

  it("stops at once on sign-out or a switched-off mentor", async () => {
    const load = vi.fn(async (): Promise<UsageAttempt> => ({ ok: false, status: 401, error: "unauthenticated" }));
    const onResult = vi.fn();
    await createUsageLoader({ load, onResult }).run();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0][1].final).toBe(true);
  });

  it("Try again skips the backoff wait; a tick during the wait joins it", async () => {
    const results: UsageAttempt[] = [NET, OK];
    const load = vi.fn(async () => results.shift()!);
    const onResult = vi.fn();
    const loader = createUsageLoader({ load, onResult, random: () => 0.5 });
    const done = loader.run();
    await vi.advanceTimersByTimeAsync(0);
    void loader.run();
    expect(load).toHaveBeenCalledTimes(1);
    await loader.retryNow();
    await done;
    expect(load).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.at(-1)?.[0]).toEqual(OK);
  });

  it("again: a finished turn during a load asks for one more cycle", async () => {
    let resolve!: (r: UsageAttempt) => void;
    const load = vi.fn(() => new Promise<UsageAttempt>((r) => { resolve = r; }));
    const loader = createUsageLoader({ load, onResult: () => {} });
    const done = loader.run();
    void loader.run({ again: true });
    resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    resolve(OK);
    await done;
  });

  it("dispose aborts the request, drops late results and cancels a scheduled retry", async () => {
    let signal!: AbortSignal;
    const load = vi.fn(async (s: AbortSignal) => { signal = s; return NET; });
    const onResult = vi.fn();
    const loader = createUsageLoader({ load, onResult, random: () => 0.5 });
    const done = loader.run();
    await vi.advanceTimersByTimeAsync(0);
    loader.dispose();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(load).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledTimes(1);
    await loader.run();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a throwing load counts as a network failure", async () => {
    const load = vi.fn(async (): Promise<UsageAttempt> => { throw new Error("boom"); });
    const onResult = vi.fn();
    const loader = createUsageLoader({ load, onResult, random: () => 0.5 });
    const done = loader.run();
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(onResult.mock.calls[0][0]).toEqual(NET);
  });
});
