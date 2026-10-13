/**
 * adminRouteShell — uniform wrapper for /api/admin/* route handlers.
 *
 * Bundles:
 *  1. requireAdmin() guard — 401 on missing/bad session, 403 on non-admin.
 *  2. Per-admin rate limit of 60 req/min (§2.10).
 *  3. A pre-resolved actor context (userId + email) handed to the handler.
 *  4. Helpful error envelope when the handler throws. An unavailable
 *     database (timeout, connection failure, statement timeout) is an
 *     expected stall: 503 + Retry-After, no Sentry event (a-sw-rsc, the
 *     shared a-db-timeouts contract), one log line. A write may still have
 *     committed after its deadline, so money and access writes keep their
 *     idempotency keys and compare-and-set guards.
 *
 * Usage:
 *   export const POST = adminRouteShell(async ({ req, actor }) => {
 *     // actor.userId, actor.email, actor.tier available here
 *     return NextResponse.json({ ok: true });
 *   }, { route: '/api/admin/users/grant', rateLimit: { limit: 30, windowMs: 60_000 } });
 *
 * For mutations, call logAdminAction() inside the handler with the details
 * the audit log should capture. The shell does NOT audit-log automatically
 * because mutation bodies often haven't been validated by the time we'd
 * want to persist them.
 */

import { adminErrorResponse } from "./error-response";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { resolveActorEmail } from "@/lib/admin/audit";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dbUnavailableResponse } from "@/lib/db-unavailable-route";

/** Expected stall: a log line for Vercel, no Sentry event, the shared 503. */
function stalled(route: string, stage: string, err: unknown) {
  const code = (err as { code?: unknown } | null)?.code;
  console.warn(`[${route}] database unavailable (${stage}${typeof code === "string" && code ? `, ${code}` : ""}): answered 503`);
  return dbUnavailableResponse();
}

export interface AdminActor {
  userId: string;
  email: string;
  role: "user" | "admin";
  tier: "free" | "pro" | "admin";
}

export interface AdminShellContext {
  req: NextRequest;
  actor: AdminActor;
}

export interface AdminShellOptions {
  /** Route tag used for rate-limit buckets + Sentry context. e.g. '/api/admin/users'. */
  route: string;
  /** Per-admin limit. Defaults to 60 req/min. */
  rateLimit?: { limit: number; windowMs: number };
}

const DEFAULT_LIMIT = { limit: 60, windowMs: 60_000 };

export function adminRouteShell(
  handler: (ctx: AdminShellContext) => Promise<NextResponse>,
  options: AdminShellOptions
) {
  return async function adminRoute(req: NextRequest): Promise<NextResponse> {
    const guard = await requireAdmin(req);
    if ("error" in guard) return guard.error;

    const { limit, windowMs } = options.rateLimit ?? DEFAULT_LIMIT;
    const gate = checkRateLimit({
      key: `${options.route}:${guard.userId}`,
      limit,
      windowMs,
    });
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many admin requests", retryAfter: gate.retryAfterSec },
        {
          status: 429,
          headers: rateLimitHeaders(gate, { limit }),
        }
      );
    }

    let actor: AdminActor;
    try {
      const email = await resolveActorEmail(guard.userId);
      actor = {
        userId: guard.userId,
        email,
        role: guard.role,
        tier: guard.tier,
      };
    } catch (err) {
      if (isDbUnavailable(err)) return stalled(options.route, "resolve-email", err);
      captureServerError(err, { route: options.route, stage: "resolve-email" });
      return adminErrorResponse(err, options.route);
    }

    try {
      return await handler({ req, actor });
    } catch (err) {
      if (isDbUnavailable(err)) return stalled(options.route, "handler", err);
      captureServerError(err, {
        route: options.route,
        actor: actor.userId,
      });
      return adminErrorResponse(err, options.route);
    }
  };
}
