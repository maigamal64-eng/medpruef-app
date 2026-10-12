/**
 * Admin guard for /api/mentor/admin/* (a40, OW-66).
 *
 * The permission for each mentor admin path and method comes from the one
 * admin map, permissionForAdminRequest in src/lib/admin/permissions.ts, the
 * same decision requireAdmin and adminRouteShell make. An unmapped path or
 * method is denied for everyone. A route that needs a second grant (learner
 * panel, beta search, beta cohort) names it in `also`; both come from ONE live
 * permission snapshot.
 *
 * Why not adminRouteShell: three routes need that second grant, which the
 * single-value map cannot express, and the mentor handlers return their own
 * no-store 503 bodies. The checks are the same and fail closed the same way:
 *   1. requireUser(req, { allowCached: false }): signed session, fresh DB read
 *      of role, ban and invalidation.
 *   2. canAuthorizeAdminRequest(role, snapshot, path, method): admin role plus
 *      the mapped live grant (a lookup failure is 503).
 *   3. every permission in `also`.
 *   4. 60 requests per minute per admin and path, as adminRouteShell.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import {
  canAccessAdminPermission,
  canAuthorizeAdminRequest,
  loadAdminPermissionSnapshot,
  type AdminPermission,
} from "@/lib/admin/permissions";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";

const LIMIT = { limit: 60, windowMs: 60_000 };

export type MentorAdminGuard = { ok: true; userId: string } | { ok: false; response: NextResponse };

const forbidden = () =>
  NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });

export async function requireMentorAdmin(
  req: NextRequest,
  also: readonly AdminPermission[] = [],
): Promise<MentorAdminGuard> {
  const path = req.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const base = await requireUser(req, { allowCached: false });
  if ("error" in base) return { ok: false, response: base.error };
  if (base.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  try {
    const snapshot = await loadAdminPermissionSnapshot(base.userId);
    if (!canAuthorizeAdminRequest(base.role, snapshot, path, req.method)) return { ok: false, response: forbidden() };
    if (!also.every((permission) => canAccessAdminPermission(snapshot, permission))) return { ok: false, response: forbidden() };
  } catch (err) {
    captureServerError(err, { route: path, stage: "permission-lookup" });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service is temporarily unavailable. Please retry shortly.", code: "SUPABASE_DEGRADED" },
        { status: 503, headers: { "Retry-After": "30" } },
      ),
    };
  }

  const gate = checkRateLimit({ key: `${path}:${base.userId}`, limit: LIMIT.limit, windowMs: LIMIT.windowMs });
  if (!gate.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many admin requests", retryAfter: gate.retryAfterSec },
        { status: 429, headers: rateLimitHeaders(gate, { limit: LIMIT.limit }) },
      ),
    };
  }
  return { ok: true, userId: base.userId };
}
