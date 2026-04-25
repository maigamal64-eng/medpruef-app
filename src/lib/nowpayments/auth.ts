/**
 * NOWPayments JWT authentication helper (review-2026-04-25-A2).
 *
 * Most NOWPayments REST endpoints — `POST /v1/invoice`, `GET /v1/payment/{id}`,
 * the webhook IPN verifier — accept the simple `x-api-key: <key>` header.
 * That's what `src/lib/nowpayments.ts` and the rest of the app use.
 *
 * BUT a small set of endpoints require a Bearer JWT minted from the
 * account email + password. The list-by-invoice-id call we use to
 * reconcile stuck pending subscriptions is one of them:
 *
 *     GET /v1/payment/?invoiceId={id}&limit=10
 *
 * Calling that with x-api-key returns:
 *
 *     HTTP 401 — Authorization header is empty (Bearer JWTtoken is required)
 *
 * which is exactly the failure pattern we hit on the post-PR-#7 prod tour
 * (8 stuck subs, all `outcome: "error"`).
 *
 * This module mints a JWT via `POST /v1/auth { email, password }`,
 * caches it in-memory for ~55 minutes (NOWPayments tokens are typically
 * valid for 1 hour — we expire 5 minutes early so a request mid-flight
 * never racing the boundary), and exposes `getNowPaymentsJwt()` for
 * callers. The cache survives across requests within the same Lambda
 * worker; cold starts re-mint, which is fine because the auth call is
 * cheap (~150 ms).
 *
 * If `NOWPAYMENTS_EMAIL` / `NOWPAYMENTS_PASSWORD` are unset, we throw a
 * deliberate error. The reconcile route catches it and degrades to the
 * api-key-only path — better than 500-ing the admin endpoint.
 *
 * Reference: https://documenter.getpostman.com/view/7907941/S1a32n38#6d80fdde-6211-49fb-9750-ff871615572e
 *
 * Tested: scripts/test_nowpayments_jwt.mjs (manual, gated on real creds).
 */

const NOWPAYMENTS_AUTH_URL = "https://api.nowpayments.io/v1/auth";

interface CachedToken {
  token: string;
  /** Unix ms when this token should be considered stale and re-fetched. */
  expiresAtMs: number;
}

let cached: CachedToken | null = null;

/**
 * Force-clear the in-memory JWT cache. Used by tests and by callers
 * that want to retry after a 401 (e.g. NOWPayments rotated their
 * server-side secret and our cached token is now invalid).
 */
export function clearNowPaymentsJwtCache(): void {
  cached = null;
}

/**
 * Get a Bearer JWT for NOWPayments JWT-gated endpoints.
 *
 * Returns the cached token if it's still fresh; otherwise mints a new
 * one via /v1/auth. Throws if the required env vars are missing or if
 * the mint call fails.
 */
export async function getNowPaymentsJwt(): Promise<string> {
  // Cache hit — return the existing token if it's not within 5 min of
  // expiry.
  if (cached && cached.expiresAtMs > Date.now()) {
    return cached.token;
  }

  const email = process.env.NOWPAYMENTS_EMAIL;
  const password = process.env.NOWPAYMENTS_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "NOWPayments JWT auth not configured: set NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD env vars",
    );
  }

  // 8s timeout — auth is fast in the happy path. Longer budget than the
  // payment-list call because cold-start latency on NOWPayments side
  // can spike to 3-4 seconds.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(NOWPAYMENTS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `NOWPayments /v1/auth failed: HTTP ${res.status} — ${text.slice(0, 200)}`,
      );
    }
    const parsed = JSON.parse(text) as { token?: string };
    if (!parsed.token) {
      throw new Error(
        `NOWPayments /v1/auth response missing 'token' field: ${text.slice(0, 200)}`,
      );
    }
    // Cache for 55 minutes (NOWPayments tokens are 1h-valid; expire
    // 5 min early to avoid mid-flight expiration races).
    cached = {
      token: parsed.token,
      expiresAtMs: Date.now() + 55 * 60 * 1000,
    };
    return parsed.token;
  } finally {
    clearTimeout(timer);
  }
}
