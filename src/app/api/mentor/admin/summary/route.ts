/**
 * GET /api/mentor/admin/summary (W3-COSTVIEW). Admin only, read-only.
 *
 * Guard: src/lib/mentor/admin/guard.ts (signed session, admin role, the
 * revenue.read grant from the admin permission map, 60 req/min). Response shape: MentorAdminSummary in
 * src/lib/mentor/contract.ts. Ids only, never emails. Money is micro-USD
 * (admin view, never shown to learners).
 */

import { NextRequest, NextResponse } from "next/server";
import { readMentorConfig } from "@/lib/mentor/config";
import { captureServerError } from "@/lib/sentry-capture";
import { getServiceClient } from "@/lib/supabase";
import { handleMentorAdminSummary } from "./handle";
import { requireMentorAdmin } from "@/lib/mentor/admin/guard";

const MENTOR_ADMIN_ROUTE = "/api/mentor/admin/summary";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireMentorAdmin(req);
  if (!guard.ok) return guard.response;

  try {
    const result = await handleMentorAdminSummary(getServiceClient(), readMentorConfig(), new Date(), req.nextUrl.searchParams.get("timezone") === "UTC" ? "UTC" : "Europe/Vienna");
    if (result.status === 503) {
      // "Not installed yet" is an expected state before release train R3, not an alert.
      if (result.body.error !== "ledger_not_applied") {
        captureServerError(result.cause ?? new Error(result.body.error), { route: MENTOR_ADMIN_ROUTE, error: result.body.error });
      }
      return NextResponse.json(result.body, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json(result.body, { status: 200, headers: NO_STORE });
  } catch (err) {
    // getServiceClient() throws on a missing env; never a 200, never a stack to the client.
    captureServerError(err, { route: MENTOR_ADMIN_ROUTE, stage: "client" });
    return NextResponse.json({ error: "db_error" }, { status: 503, headers: NO_STORE });
  }
}
