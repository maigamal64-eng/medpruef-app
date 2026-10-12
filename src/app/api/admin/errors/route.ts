import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { fetchSentryIssues } from "@/lib/admin/opsExternal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/errors — recent unresolved Sentry issues for the JS project
 * (org `medpruf`, project `javascript-nextjs`, region de.sentry.io).
 *
 * Guarded by adminRouteShell (requireAdmin + per-admin rate limit). Read-only.
 * Fetch + mapping + degraded-state handling live in @/lib/admin/opsExternal
 * (server-only). Three honest outcomes, all at HTTP 200 so the page can narrow:
 *   - { configured: false, missing: 'SENTRY_AUTH_TOKEN' }   → "configure" empty-state
 *   - { configured: true, ok: false, status, reason }       → degraded (e.g. token
 *                                                             lacks issue-read scope)
 *   - { configured: true, ok: true, issues: [...] }         → the table
 */
export const GET = adminRouteShell(
  async () => {
    const result = await fetchSentryIssues("14d", 25);
    return NextResponse.json(result);
  },
  {
    route: "/api/admin/errors",
    rateLimit: { limit: 60, windowMs: 60_000 },
  }
);
