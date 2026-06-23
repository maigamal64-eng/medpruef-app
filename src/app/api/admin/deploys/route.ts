import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { fetchVercelDeployments } from "@/lib/admin/opsExternal";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/deploys — recent Vercel deployments for the MedPrüf project.
 *
 * Guarded by adminRouteShell (requireAdmin + per-admin rate limit). Read-only.
 * The actual fetch + field mapping + graceful token-absent handling live in
 * @/lib/admin/opsExternal (server-only). When VERCEL_TOKEN is unset the body
 * is `{ configured: false, missing: 'VERCEL_TOKEN' }` at HTTP 200, so the tab
 * renders a tidy "configure VERCEL_TOKEN" empty-state, never an error.
 */
export const GET = adminRouteShell(
  async () => {
    const result = await fetchVercelDeployments(15);
    return NextResponse.json(result);
  },
  {
    route: "/api/admin/deploys",
    rateLimit: { limit: 60, windowMs: 60_000 },
  }
);
