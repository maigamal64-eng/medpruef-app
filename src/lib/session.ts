import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed session tokens (HMAC-SHA256).
 *
 * ── Why this exists (S-1, 2026-06-02 security sweep) ────────────────
 * Until this module shipped, `requireUser` / `requireAdmin` trusted the
 * `x-user-id` request header on EXISTENCE alone: if the UUID was a real
 * row (and, for admin, role='admin') the caller was authenticated. No
 * signature, no secret — so anyone who learned the admin UUID could
 * forge full admin (the since-removed `/api/admin/sql` → all PII + bcrypt hashes,
 * `/api/admin/users/grant` → free Pro). The repo being private was the
 * only thing keeping that out of P0.
 *
 * The fix swaps the *guessable, leakable* identifier for an
 * *unforgeable, server-signed* token. The token binds the user id and
 * an issued-at timestamp under an HMAC keyed by a server-only secret.
 * Knowing the admin UUID is now useless — without `SESSION_SIGNING_SECRET`
 * you cannot produce a valid signature.
 *
 * ── Token format ────────────────────────────────────────────────────
 *   mp1.<userId>.<issuedAtMs>.<base64url(HMAC_SHA256(secret, "mp1.<userId>.<issuedAtMs>"))>
 * Four dot-separated parts. None of the first three can contain a `.`
 * (version literal, UUID, integer), and base64url never emits `.`, so
 * the split is unambiguous.
 *
 * ── What it deliberately does NOT bind ──────────────────────────────
 * Only `userId` + `issuedAt`. Role/tier/ban/invalidation are ALWAYS
 * re-read from the DB by the guard on every request — never trusted
 * from the token — so a demoted admin or banned user loses access
 * immediately, not at token expiry.
 *
 * ── Transport: header, not httpOnly cookie (deliberate) ─────────────
 * The token rides the `x-session-token` request header (set client-side
 * by `authFetch`), NOT an httpOnly cookie. Rationale + accepted
 * tradeoffs:
 *   + A custom header is CSRF-immune by construction (a cross-site page
 *     cannot set it without a CORS preflight the server never grants),
 *     so this fix introduces NO new CSRF surface on the admin/payment
 *     routes — unlike a cookie, which would rely on SameSite.
 *   + A header is always sent by `fetch`, so it is robust inside the
 *     Telegram Mini App webview, where cookie persistence is less
 *     certain.
 *   + It preserves the existing architecture ("authFetch attaches an
 *     auth header; the guard reads it") — the smallest correct change.
 *   − ACCEPTED: the token lives in localStorage (like the old
 *     `x-user-id` did), so a future XSS could exfiltrate it. The audit
 *     found XSS clean and CSP is tightening; this is no regression vs.
 *     the prior model. If we later want httpOnly-cookie XSS hardening,
 *     swap the transport — the sign/verify core here is unchanged.
 *   − ACCEPTED: logout is client-side only (drop the token). There is
 *     no server-side per-session revocation list. The kill switch for a
 *     *leaked* token is `users.session_invalidated_at`: bump it (e.g.
 *     POST /api/admin/users/<id>/force-refresh-session) and every token
 *     issued before that instant is rejected by the guard. That is why
 *     the guard compares the token's signed `issuedAt` against it.
 *
 * A reviewer comparing this to a JWT lib: we use a fixed-format HMAC
 * token on purpose — zero new dependencies and no JWT `alg`-confusion
 * footguns. A "signed cookie" and a signed token-in-header are
 * cryptographically identical; only the transport differs.
 */

const TOKEN_VERSION = "mp1";

/** Header the client sends the signed token on. */
export const SESSION_HEADER = "x-session-token";

/**
 * Maximum token lifetime. After this the guard treats the token as
 * expired and the client is bounced to re-login. 90 days balances "stay
 * logged in" UX (this audience studies daily over months) against
 * bearer-credential staleness; `session_invalidated_at` provides
 * earlier per-user revocation when needed.
 */
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the signing secret at call time (not module load) so tests can
 * set it before importing and so a build doesn't capture a stale value.
 * Throws when unset/too short — callers that MINT (signSession) surface
 * this as a loud 500; callers that VERIFY (verifySession) catch it and
 * deny (fail-closed). A missing secret must never silently authenticate.
 */
function getSecret(): string {
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SIGNING_SECRET is not configured (must be set, >=16 chars)",
    );
  }
  return secret;
}

function computeSig(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export interface VerifiedSession {
  userId: string;
  /** Epoch ms the token was minted — compared against session_invalidated_at. */
  issuedAtMs: number;
}

/**
 * Mint a signed session token for `userId`. Called by every successful
 * auth path in /api/auth. Throws if the secret is missing (login fails
 * loudly rather than handing out an unverifiable token).
 */
export function signSession(
  userId: string,
  issuedAtMs: number = Date.now(),
): string {
  if (!UUID_RE.test(userId)) {
    throw new Error("signSession: userId must be a UUID");
  }
  const payload = `${TOKEN_VERSION}.${userId}.${issuedAtMs}`;
  return `${payload}.${computeSig(payload)}`;
}

/**
 * Verify a token. Returns the bound { userId, issuedAtMs } on success,
 * or null for ANY failure mode (missing, malformed, bad version, bad
 * UUID, bad signature, expired, or missing secret). Pure + synchronous
 * — no DB. The guard does the DB read for role/tier/ban/invalidation.
 */
export function verifySession(
  token: string | null | undefined,
): VerifiedSession | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, userId, issuedAtRaw, providedSig] = parts;

  if (version !== TOKEN_VERSION) return null;
  if (!UUID_RE.test(userId)) return null;

  const issuedAtMs = Number(issuedAtRaw);
  if (!Number.isInteger(issuedAtMs) || issuedAtMs <= 0) return null;

  // Recompute the signature. If the secret is missing, getSecret throws
  // — catch and deny (fail-closed), never authenticate without a key.
  let expectedSig: string;
  try {
    expectedSig = computeSig(`${version}.${userId}.${issuedAtRaw}`);
  } catch {
    return null;
  }

  // Constant-time compare. timingSafeEqual throws on length mismatch, so
  // length-gate first (a short/garbage sig must deny, not 500).
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  // Expiry. Uses request-time wall clock — fine for a max-age check.
  if (Date.now() - issuedAtMs > SESSION_MAX_AGE_MS) return null;

  return { userId, issuedAtMs };
}
