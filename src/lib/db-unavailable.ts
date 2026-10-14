
/**
 * Database deadline and "database unavailable" contract (a-db-timeouts,
 * after the 12 Oct 2026 free-plan freeze: 313 functions each held 300 s).
 *
 * - `createTimedFetch` is the global fetch of every server Supabase client.
 *   PostgREST and RPC calls (`/rest/v1/`) get a deadline
 *   (SUPABASE_FETCH_TIMEOUT_MS, default 8 s) that also covers reading the
 *   body. A deadline or network failure becomes a `DbUnavailableError`.
 *   With DB_FAST_FAIL=true the default deadline drops to 3 s while the
 *   instance breaker is open (`defaultDbTimeoutMs`, a-fo-08).
 * - A gateway answer during a restart or overload (HTTP 502, 503, 504,
 *   520-524) or a 5xx whose body carries PostgREST's "cannot reach the
 *   database" codes (PGRST000-PGRST003) becomes a `DbUnavailableError` with
 *   reason "gateway" (a-fo-01). Before, it came back as a plain error object
 *   that callers could read as "nothing found" (a free learner's answer
 *   turned into a 402 during the restart window).
 * - The timeout and gateway errors carry `code = "ABORT_ERR"`: postgrest-js
 *   retries a failed GET three times (1 s, 2 s, 4 s, or the upstream
 *   Retry-After on a 503/520) unless the error looks like an abort, and each
 *   retry would get a fresh deadline. Network failures keep postgrest's
 *   retry (a short blip recovers).
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
/**
 * Per-client deadline for the few 60 s routes whose single queries are
 * legitimately heavy (crons, whole-bank admin scans, the Whop webhook's
 * locking grant/revoke functions): `getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS })`.
 */
export const LONG_DB_TIMEOUT_MS = 25_000;
export const DB_RETRY_AFTER_SECONDS = 15;
/**
 * a-fo-08 (DB_FAST_FAIL): the deadline of a normal server client while this
 * instance saw the database fail in the last 30 s. A brownout then costs a
 * request 3 s instead of 8 s, so functions free up and the client falls back
 * (outbox, pack, last-good copy) sooner. Clients with an explicit deadline
 * (LONG_DB_TIMEOUT_MS: crons, admin scans, the Whop webhook's locking
 * functions; the health probe) keep theirs.
 */
export const FAST_FAIL_TIMEOUT_MS = 3_000;
export const FAST_FAIL_WINDOW_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 25_000;

export type DbUnavailableReason = "timeout" | "network" | "gateway";

export class DbUnavailableError extends Error {
  readonly reason: DbUnavailableReason;
  /** Makes postgrest-js treat a timeout or gateway failure like an abort (no retry loop). */
  readonly code: string | undefined;

  constructor(reason: DbUnavailableReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DbUnavailableError";
    this.reason = reason;
    this.code = reason === "network" ? undefined : "ABORT_ERR";
  }
}

/** SUPABASE_FETCH_TIMEOUT_MS, clamped to 1..25 s; invalid values use 8 s. */
export function supabaseFetchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.SUPABASE_FETCH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SUPABASE_FETCH_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(raw)));
}

/** DB_FAST_FAIL: only the literal "true" turns the breaker-aware deadline on (default off). */
export function dbFastFailEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DB_FAST_FAIL === "true";
}

/**
 * Deadline of every normal server client, resolved per call: 3 s (never more
 * than SUPABASE_FETCH_TIMEOUT_MS) while DB_FAST_FAIL is on and the breaker is
 * open, else SUPABASE_FETCH_TIMEOUT_MS (default 8 s).
 */
export function defaultDbTimeoutMs(env: Record<string, string | undefined> = process.env, now = Date.now()): number {
  const normal = supabaseFetchTimeoutMs(env);
  if (!dbFastFailEnabled(env) || !dbRecentlyUnavailable(FAST_FAIL_WINDOW_MS, now)) return normal;
  return Math.min(FAST_FAIL_TIMEOUT_MS, normal);
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
/** PostgREST's "cannot reach the database" codes (connection, socket, schema cache, pool timeout). */
const UNAVAILABLE_PGRST_CODE = /"code"\s*:\s*"(PGRST00[0-3])"/;
const STATEMENT_TIMEOUT_CODE = '"57014"';

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
  timeoutMs: number | (() => number) = () => defaultDbTimeoutMs(),
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
      if (res.status >= 500) {
        const head = new TextDecoder().decode(body.slice(0, 2_048));
        const pgrst = UNAVAILABLE_PGRST_CODE.exec(head)?.[1];
        if (GATEWAY_STATUSES.has(res.status) || pgrst) {
          markDbUnavailable();
          // Status and code only: the body may be a gateway HTML page.
          throw new DbUnavailableError("gateway", `Database gateway answered ${res.status}${pgrst ? ` ${pgrst}` : ""}`);
        }
        if (head.includes(STATEMENT_TIMEOUT_CODE)) markDbUnavailable();
      }
      const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
      // The body is already decoded and complete: drop the transfer headers.
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      // postgrest-js sleeps for Retry-After only on a 503/520 GET; both now
      // throw above, so no uncapped upstream wait reaches it.
      return new Response(nullBody ? null : body, { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      if (timedOut) {
        markDbUnavailable();
        throw new DbUnavailableError("timeout", `Database did not answer within ${ms} ms`, { cause: err });
      }
      // The gateway error thrown above (breaker already marked).
      if (err instanceof DbUnavailableError) throw err;
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
 * True for an unavailable database: the thrown `DbUnavailableError` (timeout,
 * network or gateway), the PostgREST error object built from it
 * (`message: "DbUnavailableError: ..."`),
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
