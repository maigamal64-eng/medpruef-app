import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * The arbitrary SQL console is retired. Its former SECURITY DEFINER
 * executor ran under service-role visibility on a shared Supabase project,
 * so a lexical SELECT-only filter was not an adequate data boundary.
 * Replace future operational needs with named, permission-scoped reports.
 */
const retired = () => NextResponse.json(
  { error: "The SQL console has been retired. Use a named admin report." },
  { status: 410 },
);

export const GET = adminRouteShell(async () => retired(), {
  route: "/api/admin/sql/list",
});

export const POST = adminRouteShell(async () => retired(), {
  route: "/api/admin/sql",
  rateLimit: { limit: 10, windowMs: 60_000 },
});
