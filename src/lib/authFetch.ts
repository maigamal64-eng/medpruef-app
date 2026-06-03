"use client";

/**
 * Client-side fetch wrapper that automatically adds the signed
 * `x-session-token` header that the server-side guards in
 * `src/lib/auth-guard.ts` verify.
 *
 * Usage:
 *   import { authFetch } from "@/lib/authFetch";
 *   const r = await authFetch("/api/stats/admin/users");
 *
 * Signature mirrors `fetch()` — drop-in replacement. It reads the
 * signed session token from localStorage (written at login by
 * setSessionToken) and merges the header into whatever the caller
 * passed.
 *
 * Context: this is the client half of the session layer. The S-1 fix
 * (2026-06-02) replaced the forgeable `x-user-id` header with a
 * server-signed token — see `src/lib/session.ts` + `src/lib/auth-guard.ts`.
 *
 * Added 2026-04-22 (launch-readiness sprint):
 * - **401 interceptor**: if the server-side guard rejects the request
 *   with 401, we clear the stale session from localStorage and force
 *   a redirect to /login. Previously the UI stayed in a half-logged-
 *   in state where every API call returned "not authenticated" but
 *   the nav chrome still showed the user as signed in. The redirect
 *   only fires once per page load to avoid an infinite loop if /login
 *   itself is the page that's 401-ing.
 * - **Timeout**: an AbortController fires after `DEFAULT_TIMEOUT_MS`
 *   so a hung Vercel function or a stalled upstream doesn't leave a
 *   spinner spinning forever. Callers can override with
 *   `init.signal` (we chain AbortControllers) or by passing
 *   `timeoutMs: 0` to disable.
 */

import { getSessionToken, clearSession } from "@/lib/auth";

/** Default per-request client-side timeout. Long enough for slow mobile
 * networks on Austrian trains, short enough that a hung function doesn't
 * leave the UI stuck for the full Vercel 60s platform timeout. */
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Reentrancy guard — prevents every in-flight request on the page
 * from racing to redirect when a 401 lands. The first 401 wins and
 * everyone else exits cleanly.
 */
let isRedirectingToLogin = false;

/** Window key we stamp when a redirect is in flight, so navigation
 * code elsewhere on the page can short-circuit any in-progress render
 * work that would otherwise flash a "you're logged in!" surface. */
type AuthFetchInit = RequestInit & {
  /** Override the default timeout. Pass `0` to disable entirely. */
  timeoutMs?: number;
  /** Opt out of the 401 → /login redirect for this call. Useful for
   * heartbeat / background polling where a 401 shouldn't nuke the UI. */
  skipAuthRedirect?: boolean;
};

export async function authFetch(
  input: RequestInfo | URL,
  init: AuthFetchInit = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    skipAuthRedirect = false,
    signal: callerSignal,
    ...rest
  } = init;

  // Attach the signed session token (S-1, 2026-06-02). This is THE auth
  // credential the server-side guards verify. The token binds a signed
  // issued-at, so the old client-controlled `x-user-id` +
  // `x-session-issued-at` headers (both forgeable) are gone. The header
  // name mirrors SESSION_HEADER in src/lib/session.ts — not imported
  // here because that module pulls node:crypto (server-only).
  const token = getSessionToken();

  const headers = new Headers(rest.headers);
  if (token) headers.set("x-session-token", token);

  // Build the abort signal. If the caller passed their own signal,
  // chain ours so either side can cancel. If timeoutMs is 0/undefined,
  // skip the timeout entirely.
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal | undefined = callerSignal ?? undefined;
  if (timeoutMs && timeoutMs > 0) {
    const ctrl = new AbortController();
    // If caller's signal aborts first, forward it to our controller.
    if (callerSignal) {
      if (callerSignal.aborted) {
        ctrl.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener("abort", () => ctrl.abort(callerSignal.reason), {
          once: true,
        });
      }
    }
    timerId = setTimeout(() => ctrl.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
    signal = ctrl.signal;
  }

  let response: Response;
  try {
    response = await fetch(input, { ...rest, headers, signal });
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }

  // 401 interceptor — only triggers when the server-side guard says
  // the session is gone. Local error states (network offline, timeout)
  // fall through as normal exceptions and don't clear the session.
  if (response.status === 401 && !skipAuthRedirect && typeof window !== "undefined") {
    // Ignore 401s from the /api/auth endpoint itself — that's just a
    // "wrong password" and shouldn't nuke the session layer.
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const isAuthRoute = urlStr.includes("/api/auth");

    if (!isAuthRoute && !isRedirectingToLogin) {
      // Peek at the response body (clone first — body can only be read
      // once) to detect the REFRESH_REQUIRED code from the new
      // force-refresh-session flow (review-2026-04-26-B1). If found,
      // we ALSO purge SW caches and reload in-place rather than just
      // bouncing to /login.
      let isRefreshRequired = false;
      try {
        const peek = response.clone();
        const body = await peek.json();
        if (body && body.code === "REFRESH_REQUIRED") {
          isRefreshRequired = true;
        }
      } catch {
        /* not JSON / no body — treat as a normal 401 */
      }

      isRedirectingToLogin = true;
      // Drop the stale session so the login page renders cleanly
      // instead of bouncing the user back to /.
      try {
        clearSession();
      } catch {
        /* noop */
      }
      try {
        window.localStorage.removeItem("medpruef_session_issued_at");
      } catch {
        /* noop */
      }

      if (isRefreshRequired) {
        // Force-refresh path: purge service-worker caches so a stale
        // tier='free' snapshot can't render after re-login. Then
        // reload in-place — the user goes through /login again with
        // their cached credentials (Telegram or email autofill).
        try {
          if ("caches" in window) {
            void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
          }
        } catch {
          /* noop */
        }
        window.location.assign("/login?reason=refresh_required");
        return response;
      }

      // Only redirect if we're not already at /login — otherwise we
      // loop forever on a page that's legitimately 401-protected.
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/landing") {
        // Remember where the user was so post-login we can send them
        // back. `next` query matches the convention used by /login.
        const next = encodeURIComponent(path + window.location.search);
        window.location.assign(`/login?next=${next}`);
      }
    }
  }

  return response;
}

/**
 * Test-only helper — resets the one-shot redirect guard so unit tests
 * can exercise the 401 path more than once. Not exported from the
 * barrel; callers who care reach in directly.
 */
export function __resetAuthFetchRedirectGuardForTests(): void {
  isRedirectingToLogin = false;
}
