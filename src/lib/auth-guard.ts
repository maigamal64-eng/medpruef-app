import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { SESSION_HEADER, verifySession } from "@/lib/session";
import { isPaidTier } from "@/lib/free-tier";
import { supabaseDegradedModeEnabled } from "@/lib/supabase-resilience";
import {
  canAuthorizeAdminRequest,
  loadAdminPermissionSnapshot,
} from "@/lib/admin/permissions";

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
 * Outside explicit degraded mode, role/tier/ban/invalidation are re-read
 * from the DB on every request (never trusted from the token). Emergency
 * mode permits a bounded 30-second cache for ordinary users only. Admin
 * checks and privileged identities always require a fresh database read.
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
  /**
   * The account fields /api/auth/me returns, read in the same users lookup
   * (a-db-relief-1: auth/me used to read the users row a second time; it was
   * about 4,270 of the 5,600 daily users statements). Absent only when a
   * test or caller builds a GuardSuccess by hand.
   */
  profile?: GuardProfile;
}

export interface GuardProfile {
  emailStatus: "valid" | "bounced" | "unverified" | null;
  languageCode: string | null;
  onboardingCompletedAt: string | null;
  referralsEnabled: boolean;
}

export interface GuardFailure {
  error: NextResponse;
}

export type GuardResult = GuardSuccess | GuardFailure;

type GuardUserRow = {
  id: string;
  role: "user" | "admin" | null;
  tier: "free" | "pro" | "admin" | null;
  tier_expires_at: string | null;
  is_banned: boolean | null;
  session_invalidated_at: string | null;
  email_status?: "valid" | "bounced" | "unverified" | null;
  language_code?: string | null;
  onboarding_completed_at?: string | null;
  referrals_enabled?: boolean | null;
};

const GUARD_USER_COLUMNS =
  "id, role, tier, tier_expires_at, is_banned, session_invalidated_at, email_status, language_code, onboarding_completed_at, referrals_enabled";

const GUARD_CACHE_TTL_MS = 30_000;
const GUARD_CACHE_MAX_ENTRIES = 1_000;
const guardUserCache = new Map<string, { value: GuardUserRow; expiresAt: number }>();
const guardLookups = new Map<string, Promise<{ user: GuardUserRow | null; error: unknown }>>();

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

function temporarilyUnavailable(): GuardFailure {
  return {
    error: NextResponse.json(
      { error: "Service is temporarily unavailable. Please retry shortly.", code: "SUPABASE_DEGRADED" },
      { status: 503, headers: { "Retry-After": "30" } },
    ),
  };
}

async function lookupGuardUser(userId: string): Promise<{ user: GuardUserRow | null; error: unknown }> {
  const active = guardLookups.get(userId);
  if (active) return active;

  const lookup = (async () => {
    try {
      const { data, error } = await getServiceClient()
        .from("users")
        .select(GUARD_USER_COLUMNS)
        .eq("id", userId)
        .maybeSingle();
      return { user: (data as GuardUserRow | null) ?? null, error };
    } catch (error) {
      return { user: null, error };
    }
  })();
  guardLookups.set(userId, lookup);
  // Register before attaching cleanup: getServiceClient can throw before
  // the first await. Cleaning up inside that IIFE would then run before
  // set(), retaining a failed promise and poisoning subsequent requests.
  try {
    return await lookup;
  } finally {
    if (guardLookups.get(userId) === lookup) guardLookups.delete(userId);
  }
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
export async function requireUser(
  req: NextRequest,
  options: { allowCached?: boolean } = {},
): Promise<GuardResult> {
  const token = req.headers.get(SESSION_HEADER);
  const session = verifySession(token);
  if (!session) {
    // Covers missing, malformed, bad-signature, and expired tokens. A
    // forged `x-user-id` no longer matters — that header is ignored.
    return unauthorized("Missing or invalid session");
  }

  const degradedMode = supabaseDegradedModeEnabled();
  if (!degradedMode) guardUserCache.clear();
  const allowCached = degradedMode && options.allowCached !== false;
  const cached = allowCached ? guardUserCache.get(session.userId) : undefined;
  const cacheHit = cached !== undefined && cached.expiresAt > Date.now();
  let user: GuardUserRow | null = null;
  let error: unknown = null;
  if (cacheHit) {
    user = cached.value;
  } else {
    // Any fresh lookup supersedes a prior cached authorization, including
    // a deleted/banned account, invalidation, or an unavailable database.
    guardUserCache.delete(session.userId);
    const lookup = await lookupGuardUser(session.userId);
    user = lookup.user;
    error = lookup.error;
  }

  if (error) {
    console.error("[auth-guard] user lookup error:", error);
    // A failed server-side lookup does not prove the signed session is
    // invalid. Fail closed, but allow retry without falsely logging users
    // out, even after the emergency-mode flag has been switched off.
    return temporarilyUnavailable();
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

  if (allowCached && !cacheHit && user.role !== "admin" && user.tier !== "admin") {
    const now = Date.now();
    for (const [id, entry] of guardUserCache) {
      if (entry.expiresAt <= now) guardUserCache.delete(id);
    }
    while (guardUserCache.size >= GUARD_CACHE_MAX_ENTRIES) {
      const oldestId = guardUserCache.keys().next().value;
      if (oldestId === undefined) break;
      guardUserCache.delete(oldestId);
    }
    guardUserCache.set(session.userId, { value: user, expiresAt: now + GUARD_CACHE_TTL_MS });
  }

  return {
    userId: user.id as string,
    role: (user.role || "user") as "user" | "admin",
    tier: (user.tier || "free") as "free" | "pro" | "admin",
    tierExpiresAt: (user.tier_expires_at as string | null) ?? null,
    profile: {
      emailStatus: user.email_status ?? null,
      languageCode: user.language_code ?? null,
      onboardingCompletedAt: user.onboarding_completed_at ?? null,
      referralsEnabled: user.referrals_enabled ?? false,
    },
  };
}

/**
 * Same as `requireUser`, but additionally requires `role === 'admin'`.
 * Use on every route under /api/admin/** and on the admin-intended
 * GET/PATCH methods of /api/feedback and /api/suggestions.
 */
export async function requireAdmin(req: NextRequest): Promise<GuardResult> {
  // Never accept an outage fallback or a role cache for privileged access.
  const result = await requireUser(req, { allowCached: false });
  if ("error" in result) return result;
  if (result.role !== "admin") return forbidden("Admin access required");

  try {
    const snapshot = await loadAdminPermissionSnapshot(result.userId);
    if (!canAuthorizeAdminRequest(result.role, snapshot, req.nextUrl.pathname, req.method)) {
      return forbidden("You do not have permission to perform this action");
    }
  } catch (error) {
    console.error("[auth-guard] admin permission lookup failed", error);
    return temporarilyUnavailable();
  }
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
