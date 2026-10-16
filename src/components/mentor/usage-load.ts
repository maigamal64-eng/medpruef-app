/**
 * a-mentor-reliability R3/R8: the credit balance load of the mentor screens.
 * Framework-free so it runs under vitest with fake timers.
 *
 * - Single flight: a tick, a tab return or a finished turn joins the running
 *   cycle instead of starting a parallel request (three overlapping usage
 *   calls from one phone on 14 Oct).
 * - Backoff: a retryable failure is retried after about 2, 6 and 15 s (with
 *   jitter, never sooner than the server's retry_after), at most three times a
 *   cycle. 401 and 403/404 are final at once.
 * - Last good balance: sessionStorage `medpruef_mentor_<user>_usage` (written
 *   by the chat and packages screens) seeds the chat screen for 10 minutes.
 */

import type { MentorUsageResponse } from "@/lib/mentor/contract";
import { isUsage, type ApiFailure, type ApiResult } from "./api";

export const USAGE_RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000, 15_000];
export const USAGE_CACHE_MAX_AGE_MS = 10 * 60_000;
/** After a cycle ran out, the 60 s tick waits this long before the next cycle (tab return, online and Try again do not). */
export const USAGE_FAILURE_COOLDOWN_MS = 180_000;
/** Recursion guard: never more than this many requests in one cycle. */
const MAX_ATTEMPTS_PER_CYCLE = USAGE_RETRY_DELAYS_MS.length + 1;

export function usageCacheKey(userId: string): string {
  return `medpruef_mentor_${userId}_usage`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The last good balance when it is younger than 10 minutes, else null. Never throws. */
export function readUsageCache(storage: StorageLike | null | undefined, userId: string, now: number): { usage: MentorUsageResponse; at: number } | null {
  if (!storage || !userId) return null;
  try {
    const raw = JSON.parse(storage.getItem(usageCacheKey(userId)) ?? "null") as { usage?: unknown; at?: unknown } | null;
    if (!raw || typeof raw.at !== "number" || !Number.isFinite(raw.at) || !isUsage(raw.usage)) return null;
    const age = now - raw.at;
    if (age < 0 || age >= USAGE_CACHE_MAX_AGE_MS) return null;
    return { usage: raw.usage, at: raw.at };
  } catch {
    return null;
  }
}

export function writeUsageCache(storage: StorageLike | null | undefined, userId: string, usage: MentorUsageResponse, now: number): void {
  if (!storage || !userId) return;
  try { storage.setItem(usageCacheKey(userId), JSON.stringify({ usage, at: now })); } catch { /* storage is optional */ }
}

/** Network trouble, a server error or a rate limit; never a sign-out or a switched-off mentor. */
export function isRetryableUsageFailure(f: ApiFailure): boolean {
  return f.error === "network" || f.error === "upstream_error" || f.error === "reserve_failed" || f.error === "unknown" || f.error === "rate_limited";
}

/** Delay before retry number `retry` (0-based), or null when the cycle is over. */
export function usageRetryDelayMs(retry: number, f: ApiFailure, random: () => number = Math.random): number | null {
  if (!isRetryableUsageFailure(f) || retry < 0 || retry >= USAGE_RETRY_DELAYS_MS.length) return null;
  const base = USAGE_RETRY_DELAYS_MS[retry] * (0.8 + 0.4 * Math.min(1, Math.max(0, random())));
  const server = typeof f.retryAfterSeconds === "number" && f.retryAfterSeconds > 0 ? f.retryAfterSeconds * 1000 : 0;
  return Math.round(Math.max(base, server));
}

/** Text-free R8 buckets for mentor_usage_failed. */
export function usageDurationBucket(ms: number): string {
  return ms < 5_000 ? "under_5s" : ms < 12_000 ? "5_to_12s" : ms < 28_000 ? "12_to_28s" : "28s_or_more";
}
export function usageStatusBucket(status: number): string {
  return status === 0 ? "0" : status === 429 ? "429" : status >= 500 ? "5xx" : status >= 400 ? "4xx" : "2xx";
}

export type UsageAttempt = ApiResult<{ usage: MentorUsageResponse }>;

export interface UsageLoaderEvents {
  /** Every settled attempt. `final` is false while another retry is scheduled. */
  onResult(result: UsageAttempt, info: { final: boolean; attempt: number; durationMs: number }): void;
}

export interface UsageLoaderDeps extends UsageLoaderEvents {
  load(signal: AbortSignal): Promise<UsageAttempt>;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface UsageLoader {
  /** Joins the running cycle, or starts one. `again` asks for one more cycle after a running one (the balance changed). */
  run(opts?: { again?: boolean; tick?: boolean }): Promise<void>;
  /** Try again: skips a scheduled backoff wait, else behaves like run(). */
  retryNow(): Promise<void>;
  /** True while a request is in flight or a retry is scheduled. */
  active(): boolean;
  dispose(): void;
}

export function createUsageLoader(d: UsageLoaderDeps): UsageLoader {
  const now = d.now ?? (() => Date.now());
  const setTimer = d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const ctrl = new AbortController();
  let cycle: Promise<void> | null = null;
  let again = false;
  let disposed = false;
  let wait: { handle: unknown; resolve: () => void } | null = null;
  let failedAt: number | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const handle = setTimer(() => { wait = null; resolve(); }, ms);
    wait = { handle, resolve };
  });

  async function oneCycle(): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CYCLE && !disposed; attempt++) {
      const started = now();
      let result: UsageAttempt;
      try { result = await d.load(ctrl.signal); } catch { result = { ok: false, status: 0, error: "network" }; }
      if (disposed) return;
      const delay = result.ok ? null : usageRetryDelayMs(attempt, result, d.random);
      if (delay === null) failedAt = !result.ok && isRetryableUsageFailure(result) ? now() : null;
      d.onResult(result, { final: delay === null, attempt, durationMs: Math.max(0, now() - started) });
      if (delay === null) return;
      await sleep(delay);
    }
  }

  function start(): Promise<void> {
    const p = (async () => {
      do {
        again = false;
        await oneCycle();
      } while (again && !disposed);
    })().finally(() => { if (cycle === p) cycle = null; });
    cycle = p;
    return p;
  }

  return {
    run(opts) {
      if (disposed) return Promise.resolve();
      if (cycle) { if (opts?.again) again = true; return cycle; }
      if (opts?.tick && failedAt !== null && now() - failedAt < USAGE_FAILURE_COOLDOWN_MS) return Promise.resolve();
      return start();
    },
    retryNow() {
      if (disposed) return Promise.resolve();
      if (cycle && wait) {
        const w = wait;
        wait = null;
        clearTimer(w.handle);
        w.resolve();
        return cycle;
      }
      return this.run();
    },
    active: () => cycle !== null,
    dispose() {
      disposed = true;
      ctrl.abort();
      if (wait) { clearTimer(wait.handle); wait.resolve(); wait = null; }
    },
  };
}
