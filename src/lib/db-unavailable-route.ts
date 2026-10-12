import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";
import { captureServerError } from "@/lib/sentry-capture";
import {
  DB_RETRY_AFTER_SECONDS,
  DB_UNAVAILABLE_CODE,
  isDbUnavailable,
  lastDbUnavailableAt,
  onDbUnavailable,
} from "@/lib/db-unavailable";

/**
 * Route side of the database-unavailable contract (a-db-timeouts). Server
 * only: it uses AsyncLocalStorage for a request-scoped probe that the fetch
 * wrapper in src/lib/db-unavailable.ts marks on every failure.
 */

type Probe = { unavailable: boolean };
const probeStore = new AsyncLocalStorage<Probe>();
onDbUnavailable(() => {
  const probe = probeStore.getStore();
  if (probe) probe.unavailable = true;
});

/** 503 with a retry hint. Never a logout and never a final failure. */
export function dbUnavailableResponse(retryAfterSeconds = DB_RETRY_AFTER_SECONDS): NextResponse {
  return NextResponse.json(
    { error: "The service is temporarily unavailable. Please retry shortly.", code: DB_UNAVAILABLE_CODE, retryAfter: retryAfterSeconds },
    { status: 503, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

/**
 * Route wrapper: when the request met an unavailable database (probe) or
 * threw one, a 5xx becomes 503 + Retry-After. 2xx/4xx answers pass through
 * untouched, and an existing 503 keeps its body (it gains a Retry-After when
 * it has none).
 */
export function withDbUnavailable<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const probe: Probe = { unavailable: false };
    const startedAt = Date.now();
    // A read shared between concurrent requests (auth lookup, bank counts)
    // runs in the first request's context, so a failure seen by this
    // instance during this request counts too.
    const sawUnavailable = () => probe.unavailable || lastDbUnavailableAt() >= startedAt;
    let res: Response;
    try {
      res = await probeStore.run(probe, () => handler(...args));
    } catch (err) {
      if (isDbUnavailable(err)) return dbUnavailableResponse();
      if (sawUnavailable()) {
        // Still answer 503 (the database was failing), but never hide a bug.
        captureServerError(err, { phase: "withDbUnavailable", note: "thrown while the database was unavailable" });
        return dbUnavailableResponse();
      }
      throw err;
    }
    if (res.status < 500 || !sawUnavailable()) return res;
    if (res.status === 503) {
      if (res.headers.has("Retry-After")) return res;
      const headers = new Headers(res.headers);
      headers.set("Retry-After", String(DB_RETRY_AFTER_SECONDS));
      return new Response(res.body, { status: 503, statusText: res.statusText, headers });
    }
    return dbUnavailableResponse();
  };
}
