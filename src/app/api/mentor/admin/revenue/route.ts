/**
 * GET /api/mentor/admin/revenue (a40, MUX-98). revenue.read, read-only.
 * Mentor money in for the last 30 Vienna days next to the measured cost.
 * Margin stays unavailable until the Whop fee and the USD to EUR rate are
 * verified in src/lib/mentor/finance.ts. Counts and amounts only, no learner ids.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireMentorAdmin } from "@/lib/mentor/admin/guard";
import { loadMentorRevenue } from "@/lib/mentor/admin/revenue-load";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" } as const;

// Before the mentor ledger is installed its tables do not exist: expected, not an alert.
function isMissingRelation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMentorAdmin(req);
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await loadMentorRevenue(getServiceClient(), new Date()), { headers: NO_STORE });
  } catch (err) {
    if (isMissingRelation(err)) return NextResponse.json({ error: "ledger_not_applied" }, { status: 503, headers: NO_STORE });
    captureServerError(err, { route: "/api/mentor/admin/revenue" });
    return NextResponse.json({ error: "revenue_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
