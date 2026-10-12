
/**
 * Database deadline and "database unavailable" contract (a-db-timeouts,
 * after the 12 Oct 2026 free-plan freeze: 313 functions each held 300 s).
 *
 * - `createTimedFetch` is the global fetch of every server Supabase client.
 *   PostgREST and RPC calls (`/rest/v1/`) get a deadline
 *   (SUPABASE_FETCH_TIMEOUT_MS, default 8 s) that also covers reading the
 *   body. A deadline or network failure becomes a `DbUnavailableError`.
 * - The timeout error carries `code = "ABORT_ERR"`: postgrest-js retries a
 *   failed GET three times (1 s, 2 s, 4 s) unless the error looks like an
 *   abort, and each retry would get a fresh deadline. Network failures keep
 *   postgrest's retry (a short blip recovers).
 * - postgrest-js does not throw by default: callers see
 *   `{ error: { message: "DbUnavailableError: ..." }, status: 0 }`.
 *   `isDbUnavailable` recognises that shape, the thrown error and the
 *   Postgres statement timeout (57014).
 * - `withDbUnavailable(handler)` (src/lib/db-unavailable-route.ts, server
 *   only) maps a 5xx (or a throw) of a request that met an unavailable
 *   database to 503 + Retry-After. This module stays free of Node and Next
 *   imports because a client page reaches `src/lib/supabase.ts` through
 *   shared libs (pricing -> puyp).
 * - `dbRecentlyUnavailable()` is a per-instance hint for optional writes
 *   (analytics): skip them while the database is failing.
 *
 * Storage, auth and functions calls are left as they are (uploads can be
 * slow by nature); the route maxDuration still bounds them.
 */

export const DB_UNAVAILABLE_CODE = "DB_UNAVAILABLE";
export const DEFAULT_SUPABASE_FETCH_TIMEOUT_MS = 8_000;
export const DB_RETRY_AFTER_SECONDS = 15;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 25_000;

export type DbUnavailableReason = "timeout" | "network";

export class DbUnavailableError extends Error {
  readonly reason: DbUnavailableReason;
  /** Makes postgrest-js treat the timeout like an abort (no retry loop). */
  readonly code: string | undefined;

  constructor(reason: DbUnavailableReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DbUnavailableError";
    this.reason = reason;
    this.code = reason === "timeout" ? "ABORT_ERR" : undefined;
  }
}

/** SUPABASE_FETCH_TIMEOUT_MS, clamped to 1..25 s; invalid values use 8 s. */
export function supabaseFetchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.SUPABASE_FETCH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SUPABASE_FETCH_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(raw)));
}

// ── Instance hint and listeners ─────────────────────────────────────────

let lastUnavailableAt = 0;
const listeners = new Set<() => void>();

function markDbUnavailable(): void {
  lastUnavailableAt = Date.now();
  for (const listener of listeners) listener();
}

/** Called on every failure the fetch wrapper sees (the route probe uses it). */
export function onDbUnavailable(listener: () => void): void {
  listeners.add(listener);
}

/** Epoch ms of the last failure this instance saw, 0 when none. */
export function lastDbUnavailableAt(): number {
  return lastUnavailableAt;
}

/** True when this instance saw the database fail within `withinMs`. */
export function dbRecentlyUnavailable(withinMs = 30_000, now = Date.now()): boolean {
  return lastUnavailableAt > 0 && now - lastUnavailableAt < withinMs;
}

/** Test hook. */
export function __resetDbUnavailableState(): void {
  lastUnavailableAt = 0;
}

// ── Fetch wrapper ───────────────────────────────────────────────────────

const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isPostgrestUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes("/rest/v1/");
  } catch {
    return false;
  }
}

/**
 * Wrap `baseFetch` with the PostgREST deadline. Exported for tests; servers
 * use it through `getServiceClient`.
 */
export function createTimedFetch(
  baseFetch?: typeof fetch,
  timeoutMs: number | (() => number) = supabaseFetchTimeoutMs,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Resolved per call, like supabase-js does without a custom fetch.
    const doFetch = baseFetch ?? globalThis.fetch;
    if (!isPostgrestUrl(requestUrl(input))) return doFetch(input, init);

    const ms = typeof timeoutMs === "function" ? timeoutMs() : timeoutMs;
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DbUnavailableError("timeout", `Database did not answer within ${ms} ms`));
    }, ms);
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort();
      else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      const res = await doFetch(input, { ...init, signal: controller.signal });
      // The deadline also covers the body: a stalled stream must not hold the function.
      const body = await res.arrayBuffer();
      if (GATEWAY_STATUSES.has(res.status)) markDbUnavailable();
      else if (res.status >= 500 && new TextDecoder().decode(body.slice(0, 2_048)).includes('"57014"')) markDbUnavailable();
      const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(nullBody ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      if (timedOut) {
        markDbUnavailable();
        throw new DbUnavailableError("timeout", `Database did not answer within ${ms} ms`, { cause: err });
      }
      if (callerSignal?.aborted) throw err;
      // undici reports connection failures as TypeError("fetch failed").
      if (err instanceof TypeError) {
        markDbUnavailable();
        throw new DbUnavailableError("network", `Database unreachable: ${err.message}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}

// ── Recognition and response ────────────────────────────────────────────

/**
 * True for an unavailable database: the thrown `DbUnavailableError`, the
 * PostgREST error object built from it (`message: "DbUnavailableError: ..."`),
 * a Postgres statement timeout (57014) or our own response code.
 */
export function isDbUnavailable(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DbUnavailableError) return true;
  if (typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  if (e.name === "DbUnavailableError") return true;
  if (e.code === "57014" || e.code === DB_UNAVAILABLE_CODE) return true;
  if (typeof e.message === "string" && e.message.startsWith("DbUnavailableError")) return true;
  return e.cause !== undefined && e.cause !== error && isDbUnavailable(e.cause);
}
