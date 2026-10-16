
/**
 * Database deadline and "database unavailable" contract (a-db-timeouts,
 * after the 12 Oct 2026 free-plan freeze: 313 functions each held 300 s).
 *
 * - `createTimedFetch` is the global fetch of every server Supabase client.
 *   PostgREST and RPC calls (`/rest/v1/`) get a deadline
 *   (SUPABASE_FETCH_TIMEOUT_MS, default 8 s) that also covers reading the
 *   body. A deadline or network failure becomes a `DbUnavailableError`.
 *   With DB_FAST_FAIL=true the default deadline drops to 3 s while the
 *   instance's fast-fail breaker is open (`defaultDbTimeoutMs`, a-fo-08).
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
 * - Isolated read retry (a-db-timeout-diagnose): production showed single
 *   user-scoped reads (the auth guard's users lookup: 174 ms worst case in
 *   Postgres over about 12,000 calls) hanging for the full 8 s with the
 *   database idle and no trace at the Supabase edge: a stalled connection,
 *   not a slow query. A PostgREST GET or HEAD of a breaker-aware client that
 *   filters on a UUID (`=eq.<uuid>`, an indexed point or per-user read) now
 *   gets a 4.5 s first deadline and, when it passes on an instance with no
 *   other database failure or stall in the last 30 s, ONE retry on a new
 *   request with a 3 s deadline after a 100 to 300 ms pause. Both attempts
 *   end within 7.8 s, under the browser's 8 s authFetch deadline. The first
 *   timeout is recorded (breaker, analytics skip, route probe) only when the
 *   retry fails or is not taken, so a recovered read leaves no outage trace
 *   beyond its console.warn lines. Other reads (whole-bank scans legitimately
 *   take 4 to 7 s), writes, RPCs, gateway answers, explicit-deadline clients
 *   (crons, admin scans, the health probe) and caller aborts keep a single
 *   attempt under the normal deadline. DB_GET_RETRY=false turns it off.
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
 * instance's fast-fail breaker is open. A brownout then costs a request 3 s
 * instead of 8 s, so functions free up and the client falls back (outbox,
 * pack, last-good copy) sooner. The breaker opens on a failure, stays open
 * while failures keep coming (30 s window), and closes on the first
 * PostgREST answer (half-open): every 5 s one call is a trial that gets the
 * normal deadline, so a database that is slow but alive (3 to 8 s) closes it
 * instead of being cut forever. Clients with an explicit deadline
 * (LONG_DB_TIMEOUT_MS: crons, admin scans; the health probe) and the money
 * paths (`getServiceClient({ fastFail: false })`: Whop and NOWPayments webhooks,
 * grant verifications, PUYP approve, admin Grant) never get the 3 s cut.
 */
export const FAST_FAIL_TIMEOUT_MS = 3_000;
/** First deadline of a retry-eligible point read (never more than the normal one). */
export const READ_FIRST_ATTEMPT_TIMEOUT_MS = 4_500;
/** Deadline of the single isolated read retry (never more than the first attempt's). */
export const READ_RETRY_TIMEOUT_MS = 3_000;
const READ_RETRY_PAUSE_MIN_MS = 100;
const READ_RETRY_PAUSE_SPREAD_MS = 200;
export const FAST_FAIL_WINDOW_MS = 30_000;
export const FAST_FAIL_TRIAL_MS = 5_000;
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

/** DB_GET_RETRY: the isolated read retry is on unless the literal "false" (kill switch). */
export function dbReadRetryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DB_GET_RETRY !== "false";
}

/**
 * Deadline of a normal server client (pure): 3 s (never more than
 * SUPABASE_FETCH_TIMEOUT_MS) while DB_FAST_FAIL is on and the fast-fail
 * breaker is open, else SUPABASE_FETCH_TIMEOUT_MS (default 8 s).
 */
export function defaultDbTimeoutMs(env: Record<string, string | undefined> = process.env, now = Date.now()): number {
  const normal = supabaseFetchTimeoutMs(env);
  if (!dbFastFailEnabled(env) || !fastFailOpen(now)) return normal;
  return Math.min(FAST_FAIL_TIMEOUT_MS, normal);
}

/**
 * The deadline a normal client's call gets: `defaultDbTimeoutMs`, except that
 * while the breaker is open one call every 5 s is a half-open trial with the
 * normal deadline.
 */
export function resolveDefaultDbTimeoutMs(env: Record<string, string | undefined> = process.env, now = Date.now()): number {
  const ms = defaultDbTimeoutMs(env, now);
  const normal = supabaseFetchTimeoutMs(env);
  if (ms >= normal || now - lastTrialAt < FAST_FAIL_TRIAL_MS) return ms;
  lastTrialAt = now;
  return normal;
}

// ── Instance hint and listeners ─────────────────────────────────────────

let lastUnavailableAt = 0;
/** Epoch ms of the last first-attempt stall of a retry-eligible read (one retry per 30 s). */
let lastReadStallAt = 0;
const listeners = new Set<() => void>();
/** a-fo-08 fast-fail breaker: when the open window started (0 = closed), last half-open trial. */
let fastFailSince = 0;
let lastTrialAt = 0;

function fastFailOpen(now: number): boolean {
  return fastFailSince > 0 && dbRecentlyUnavailable(FAST_FAIL_WINDOW_MS, now);
}

function markDbUnavailable(): void {
  const now = Date.now();
  if (!fastFailOpen(now)) { fastFailSince = now; lastTrialAt = now; }
  lastUnavailableAt = now;
  for (const listener of listeners) listener();
}

/**
 * A PostgREST answer below 500 closes the fast-fail breaker. It never touches
 * `lastUnavailableAt`, so `dbRecentlyUnavailable` (analytics skips, the route
 * probe) keeps its meaning.
 */
function markDbAnswered(): void {
  fastFailSince = 0;
}

/** True while the fast-fail breaker is open (whether or not DB_FAST_FAIL is on). */
export function dbFastFailOpen(now = Date.now()): boolean {
  return fastFailOpen(now);
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
  fastFailSince = 0;
  lastTrialAt = 0;
  lastReadStallAt = 0;
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

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

/** First path segment after /rest/v1/ (table or rpc), for logs: never the query string or ids. */
function postgrestTarget(url: string): string {
  try {
    const rest = new URL(url).pathname.split("/rest/v1/")[1] ?? "";
    return rest.split("/").slice(0, rest.startsWith("rpc/") ? 2 : 1).join("/") || "?";
  } catch {
    return "?";
  }
}

/**
 * An equality filter on a UUID: an indexed point or per-user read (`id=eq.<uuid>`, `user_id=eq.<uuid>`).
 * These get a 4.5 s first deadline: a slow per-user read (an unbounded count or aggregate) must not
 * match it, or must use its own client with an explicit deadline.
 */
const UUID_EQ_FILTER = /[?&][a-z_]+=eq\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:&|$)/i;

function isPointRead(url: string): boolean {
  return UUID_EQ_FILTER.test(url);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One PostgREST attempt under `ms`. A timeout marks the instance only when
 * `markTimeout` is true (the isolated read retry defers it).
 */
async function timedAttempt(
  doFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  callerSignal: AbortSignal | null | undefined,
  ms: number,
  markTimeout: boolean,
): Promise<Response> {
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
    } else {
      markDbAnswered();
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
      if (markTimeout) markDbUnavailable();
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
}

/**
 * Wrap `baseFetch` with the PostgREST deadline. Exported for tests; servers
 * use it through `getServiceClient`. `readRetry` (the isolated read retry,
 * see the header) defaults to on for breaker-aware clients (a function
 * deadline) and off for an explicit numeric deadline.
 */
export function createTimedFetch(
  baseFetch?: typeof fetch,
  timeoutMs: number | (() => number) = () => resolveDefaultDbTimeoutMs(),
  options: { readRetry?: boolean } = {},
): typeof fetch {
  const readRetry = options.readRetry ?? typeof timeoutMs === "function";
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Resolved per call, like supabase-js does without a custom fetch.
    const doFetch = baseFetch ?? globalThis.fetch;
    const url = requestUrl(input);
    if (!isPostgrestUrl(url)) return doFetch(input, init);

    const ms = typeof timeoutMs === "function" ? timeoutMs() : timeoutMs;
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const method = requestMethod(input, init);
    const mayRetry = readRetry
      && (method === "GET" || method === "HEAD")
      && isPointRead(url)
      && dbReadRetryEnabled()
      && !dbRecentlyUnavailable(FAST_FAIL_WINDOW_MS);
    if (!mayRetry) return timedAttempt(doFetch, input, init, callerSignal, ms, true);

    const firstMs = Math.min(READ_FIRST_ATTEMPT_TIMEOUT_MS, ms);
    try {
      return await timedAttempt(doFetch, input, init, callerSignal, firstMs, false);
    } catch (err) {
      const stalled = err instanceof DbUnavailableError && err.reason === "timeout";
      if (!stalled) throw err;
      const now = Date.now();
      // Another call on this instance failed or stalled meanwhile (a real
      // outage, or many reads timing out together): no retry.
      const otherStall = lastReadStallAt > 0 && now - lastReadStallAt < FAST_FAIL_WINDOW_MS;
      lastReadStallAt = now;
      if (callerSignal?.aborted || otherStall || dbRecentlyUnavailable(FAST_FAIL_WINDOW_MS, now)) {
        markDbUnavailable();
        throw err;
      }
      const target = postgrestTarget(url);
      console.warn(`[db] ${method} ${target} stalled ${firstMs} ms, retrying once`);
      await pause(READ_RETRY_PAUSE_MIN_MS + Math.floor(Math.random() * READ_RETRY_PAUSE_SPREAD_MS));
      if (callerSignal?.aborted) {
        markDbUnavailable();
        throw err;
      }
      try {
        const res = await timedAttempt(doFetch, input, init, callerSignal, Math.min(READ_RETRY_TIMEOUT_MS, firstMs), true);
        console.warn(`[db] ${method} ${target} retry answered ${res.status}`);
        return res;
      } catch (retryErr) {
        // The first stall was real even when the caller left during the retry.
        if (!isDbUnavailable(retryErr)) markDbUnavailable();
        throw retryErr;
      }
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
