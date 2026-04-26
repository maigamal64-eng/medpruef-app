import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * Server-side authorization guards for API routes.
 *
 * Context from the 2026-04-15 audit (reports/review-2026-04-15/
 * 01-security.md, 03-backend-api.md): the app had *no* server-side
 * session layer. Every API route trusted `userId` from the request
 * body/query, and the seven admin routes under /api/stats/admin/*
 * plus /api/feedback + /api/suggestions GET/PATCH had no auth check
 * at all. A plain `curl https://medpruf.com/api/stats/admin/users`
 * returned the full user table with PII.
 *
 * This module is the stopgap session layer: it reads an `x-user-id`
 * header (which the client adds via `src/lib/authFetch.ts`), verifies
 * that the row exists in `users`, and for admin routes also checks
 * `users.role === 'admin'`. It is NOT a real cookie-based session —
 * the header is client-controlled, so an attacker who already knows
 * a valid admin UUID (a 128-bit unguessable value) can still forge
 * the header. But the attack surface shrinks from "anyone with an
 * HTTP client" to "someone who has seen an admin UUID", which is a
 * dramatic improvement while a proper session layer is designed.
 *
 * When migrating to a real session (next-auth, @supabase/ssr, custom
 * token table), keep the `requireUser` / `requireAdmin` signatures so
 * call sites don't need to change — just swap the implementation.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GuardSuccess {
  userId: string;
  role: "user" | "admin";
  tier: "free" | "pro" | "admin";
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
 * Resolve the caller's user_id from the `x-user-id` header (or the
 * legacy `userId` query/body fallback for routes that haven't been
 * migrated yet). Verifies the row exists and returns role + tier so
 * downstream handlers can make per-tier decisions.
 *
 * On failure, returns a `{error: NextResponse}` envelope so callers
 * can early-return with a single line:
 *
 *     const guard = await requireUser(req);
 *     if ("error" in guard) return guard.error;
 *     const { userId, role, tier } = guard;
 */
export async function requireUser(req: NextRequest): Promise<GuardResult> {
  const headerId = req.headers.get("x-user-id");
  if (!headerId) return unauthorized("Missing x-user-id header");
  if (!UUID_RE.test(headerId))
    return unauthorized("Malformed x-user-id header");

  const sb = getServiceClient();
  const { data: user, error } = await sb
    .from("users")
    .select("id, role, tier, is_banned, session_invalidated_at")
    .eq("id", headerId)
    .maybeSingle();

  if (error) {
    console.error("[auth-guard] user lookup error:", error);
    return unauthorized("Authentication lookup failed");
  }
  if (!user) return unauthorized("Unknown user");
  if (user.is_banned) return forbidden("Account suspended");

  // Force-refresh-session check (review-2026-04-26-B1): if an admin
  // stamped session_invalidated_at AFTER the client's session was
  // issued, the client must clear caches + re-auth. We use the
  // `x-session-issued-at` header (set by /api/auth on login) for the
  // comparison; if missing (legacy clients before this commit), we
  // treat any non-null invalidation as REFRESH_REQUIRED so they get
  // bumped exactly once after a deploy.
  if (user.session_invalidated_at) {
    const invalidatedAt = new Date(user.session_invalidated_at as string).getTime();
    const issuedAtHeader = req.headers.get("x-session-issued-at");
    const issuedAt = issuedAtHeader ? new Date(issuedAtHeader).getTime() : 0;
    if (!issuedAtHeader || (Number.isFinite(issuedAt) && issuedAt < invalidatedAt)) {
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
  };
}

/**
 * Same as `requireUser`, but additionally requires `role === 'admin'`.
 * Use on every route under /api/stats/admin/** and on the
 * admin-intended GET/PATCH methods of /api/feedback and /api/suggestions.
 */
export async function requireAdmin(req: NextRequest): Promise<GuardResult> {
  const result = await requireUser(req);
  if ("error" in result) return result;
  if (result.role !== "admin") return forbidden("Admin access required");
  return result;
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
 *   - `tier === 'pro'` or `tier === 'admin'` — a paid subscriber or a
 *     tier-flagged admin.
 *
 * Returns `false` for free + any non-admin/non-paid combination.
 *
 * Added 2026-04-24 after [name] reported admin getting redirected from
 * /exam to /pricing. The server-side half ensures /api/ai-chat,
 * /api/translate, and the questions free-slice gate also honour role.
 */
export function isPaidAccess(g: GuardSuccess): boolean {
  if (g.role === "admin") return true;
  return g.tier === "pro" || g.tier === "admin";
}

/** Convenience negation of {@link isPaidAccess}. */
export function isFreeAccess(g: GuardSuccess): boolean {
  return !isPaidAccess(g);
}
