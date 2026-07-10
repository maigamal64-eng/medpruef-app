import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { SESSION_HEADER, verifySession } from "@/lib/session";
import { isPaidTier } from "@/lib/free-tier";

/**
 * Server-side authorization guards for API routes.
 *
 * ── History ─────────────────────────────────────────────────────────
 * The 2026-04-15 audit found the app had NO server-side session layer:
 * every route trusted `userId` from the body/query, and the admin routes
 * had no auth at all (`curl …/api/stats/admin/users` dumped the user
 * table). The first fix introduced an `x-user-id` header verified
 * against the `users` table — but the header was client-controlled and
 * trusted on EXISTENCE alone, so anyone who learned the admin UUID could
 * forge full admin (S-1, latent P0, masked only by the repo being
 * private).
 *
 * ── This version (S-1 fix, 2026-06-02) ──────────────────────────────
 * Identity now comes from a server-SIGNED session token (HMAC-SHA256,
 * see `src/lib/session.ts`), sent on the `x-session-token` header by
 * `authFetch`. The token binds userId + issuedAt under a server-only
 * secret, so knowing a UUID is useless — you cannot forge a signature.
 * The `requireUser` / `requireAdmin` SIGNATURES are unchanged, so the
 * ~20 `/api/admin/*` routes and the AI/translate/answer routes did not
 * need rewrites — only the implementation swapped.
 *
 * Role/tier/ban/invalidation are still re-read from the DB on every
 * request (never trusted from the token), so demotions, bans, and
 * forced-refresh take effect immediately.
 */

export interface GuardSuccess {
  userId: string;
  role: "user" | "admin";
  tier: "free" | "pro" | "admin";
  /**
   * 2026-07-11 fix: previously not fetched, so `isPaidAccess` below
   * could not honor an expired tier='pro' row — a lapsed referral
   * exam-reward grant (or any other lapsed Pro) kept Notes clone/save
   * access forever. Nullable: a permanent grant (no expiry) or a
   * free/admin row both legitimately have no expiry.
   */
  tierExpiresAt: string | null;
}

export interface GuardFailure {
  error: NextResponse;
}

export type GuardResult = GuardSuccess | GuardFailure;

function unauthorized(message: string): GuardFailure {
  return {
    error: NextResponse.json({ error: message }, { status: 401 }),
  };
}

function forbidden(message: string): GuardFailure {
  return {
    error: NextResponse.json({ error: message }, { status: 403 }),
  };
}

/**
 * Resolve the caller's identity from the signed `x-session-token`
 * header, verify the row exists, and return role + tier so downstream
 * handlers can make per-tier decisions.
 *
 * On failure, returns a `{error: NextResponse}` envelope so callers can
 * early-return with a single line:
 *
 *     const guard = await requireUser(req);
 *     if ("error" in guard) return guard.error;
 *     const { userId, role, tier } = guard;
 */
export async function requireUser(req: NextRequest): Promise<GuardResult> {
  const token = req.headers.get(SESSION_HEADER);
  const session = verifySession(token);
  if (!session) {
    // Covers missing, malformed, bad-signature, and expired tokens. A
    // forged `x-user-id` no longer matters — that header is ignored.
    return unauthorized("Missing or invalid session");
  }

  const sb = getServiceClient();
  const { data: user, error } = await sb
    .from("users")
    .select("id, role, tier, tier_expires_at, is_banned, session_invalidated_at")
    .eq("id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("[auth-guard] user lookup error:", error);
    return unauthorized("Authentication lookup failed");
  }
  if (!user) return unauthorized("Unknown user");
  if (user.is_banned) return forbidden("Account suspended");

  // Force-refresh / leaked-token kill switch (review-2026-04-26-B1):
  // if an admin stamped session_invalidated_at AFTER this token was
  // minted, reject it so the client clears caches + re-auths. The
  // comparison now uses the token's SIGNED issuedAt (unforgeable) — the
  // old `x-session-issued-at` header was client-controlled and could be
  // set to now() to bypass this check.
  if (user.session_invalidated_at) {
    const invalidatedAt = new Date(
      user.session_invalidated_at as string,
    ).getTime();
    if (Number.isFinite(invalidatedAt) && session.issuedAtMs < invalidatedAt) {
      return {
        error: NextResponse.json(
          {
            error: "Session has been invalidated. Please refresh.",
            code: "REFRESH_REQUIRED",
            invalidated_at: user.session_invalidated_at,
          },
          { status: 401 },
        ),
      };
    }
  }

  return {
    userId: user.id as string,
    role: (user.role || "user") as "user" | "admin",
    tier: (user.tier || "free") as "free" | "pro" | "admin",
    tierExpiresAt: (user.tier_expires_at as string | null) ?? null,
  };
}

/**
 * Same as `requireUser`, but additionally requires `role === 'admin'`.
 * Use on every route under /api/admin/** and on the admin-intended
 * GET/PATCH methods of /api/feedback and /api/suggestions.
 */
export async function requireAdmin(req: NextRequest): Promise<GuardResult> {
  const result = await requireUser(req);
  if ("error" in result) return result;
  if (result.role !== "admin") return forbidden("Admin access required");
  return result;
}

/**
 * Optional-identity resolver for guest-friendly routes (questions tier
 * resolution, feedback/suggestions/waitlist attribution, rate-limit
 * keying). Returns the verified userId for a valid signed token, or
 * null for an anonymous caller (no/invalid token).
 *
 * Synchronous and DB-free: it only validates the signature + expiry.
 * It does NOT enforce ban/invalidation — those are privilege-boundary
 * concerns handled by `requireUser`; here the id is used for low-stakes
 * personalisation, where the safe default for an unknown caller is
 * simply "treat as guest". Crucially, it does NOT trust `x-user-id`, so
 * a forged header can no longer impersonate another user on these
 * routes. (Audit finding S-2 — the separate `?userId=` *query param* in
 * /api/questions practice modes — is out of this fix's scope and still
 * stands; it does not flow through this helper.)
 */
export function resolveOptionalUser(req: NextRequest): string | null {
  return verifySession(req.headers.get(SESSION_HEADER))?.userId ?? null;
}

/**
 * Type guard helper so call sites can discriminate without repeating
 * the `"error" in result` pattern.
 */
export function isGuardFailure(g: GuardResult): g is GuardFailure {
  return "error" in g;
}

/**
 * Server-side "does this guard have Pro-level access" check. Used by
 * every API paywall (AI chat upstream, translate quota, free-slice
 * gate, SR scheduling). Mirror of the client-side `hasProAccess` in
 * `@/lib/auth`.
 *
 * Must honour BOTH:
 *   - `role === 'admin'` — /admin/ operators always have access even
 *     when `tier='free'` in the users table (they may not subscribe).
 *   - `tier === 'pro'` or `tier === 'admin'`, AND not expired — a paid
 *     subscriber or a tier-flagged admin.
 *
 * 2026-07-11 fix: previously ignored `tier_expires_at` entirely, so a
 * lapsed Pro grant (e.g. a referral exam-reward whose window ended)
 * kept Notes clone/save access forever. Now delegates the expiry
 * comparison to `isPaidTier` (src/lib/free-tier.ts), the single source
 * of truth every other paywall already uses.
 *
 * Returns `false` for free + any non-admin/non-paid/expired combination.
 */
export function isPaidAccess(g: GuardSuccess): boolean {
  if (g.role === "admin") return true;
  return isPaidTier(g.tier, g.tierExpiresAt);
}

/** Convenience negation of {@link isPaidAccess}. */
export function isFreeAccess(g: GuardSuccess): boolean {
  return !isPaidAccess(g);
}
