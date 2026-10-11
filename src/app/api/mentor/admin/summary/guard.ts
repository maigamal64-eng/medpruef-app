/**
 * Admin guard for the mentor cost view (W3-COSTVIEW).
 *
 * Why this is not adminRouteShell: requireAdmin authorises a request by the
 * path map in src/lib/admin/permissions.ts, and a path with no entry there is
 * DENIED for everyone ("denied until an owner classifies them"). That file is
 * a shared security boundary this lane does not own, so /api/mentor/admin/*
 * would answer 403 even to the owner. This guard runs the same three checks
 * with the same primitives and fails closed the same way:
 *   1. requireUser(req, { allowCached: false }): signed session, fresh DB read
 *      of role, ban and invalidation (401/403/503 exactly as requireAdmin).
 *   2. role === "admin".
 *   3. a LIVE grant of revenue.read through loadAdminPermissionSnapshot
 *      (revocations take effect immediately; a lookup failure is 503).
 * Plus the same 60 requests/minute admin rate limit as adminRouteShell.
 *
 * Integrator option: add `/api/mentor/admin/summary` -> revenue.read (GET) to
 * permissionForAdminRequest and this guard can be replaced by adminRouteShell.
 * Both reach the same decision.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { canAccessAdminPermission, loadAdminPermissionSnapshot, type AdminPermission } from "@/lib/admin/permissions";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";

export const MENTOR_ADMIN_PERMISSION = "revenue.read" as const;
export const MENTOR_ADMIN_ROUTE = "/api/mentor/admin/summary";
const LIMIT = { limit: 60, windowMs: 60_000 };

export type MentorAdminGuard = { ok: true; userId: string } | { ok: false; response: NextResponse };

export async function requireMentorAdmin(req: NextRequest, permission: AdminPermission = MENTOR_ADMIN_PERMISSION): Promise<MentorAdminGuard> {
  const base = await requireUser(req, { allowCached: false });
  if ("error" in base) return { ok: false, response: base.error };
  if (base.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  try {
    const snapshot = await loadAdminPermissionSnapshot(base.userId);
    if (!canAccessAdminPermission(snapshot, permission)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 }),
      };
    }
  } catch (err) {
    captureServerError(err, { route: MENTOR_ADMIN_ROUTE, stage: "permission-lookup" });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Service is temporarily unavailable. Please retry shortly.", code: "SUPABASE_DEGRADED" },
        { status: 503, headers: { "Retry-After": "30" } },
      ),
    };
  }

  const gate = checkRateLimit({ key: `${MENTOR_ADMIN_ROUTE}:${base.userId}`, limit: LIMIT.limit, windowMs: LIMIT.windowMs });
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
