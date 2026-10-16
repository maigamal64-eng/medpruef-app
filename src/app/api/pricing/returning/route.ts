import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { captureServerError } from "@/lib/sentry-capture";
import { isReturningPayer, returningPricesEnabled } from "@/lib/pricing-v2/returning-payer";
import { RETURNING_TIERS } from "@/lib/pricing-v2/price-facts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/pricing/returning (a-pricing-v2-fit, decision
 * returning-payer-price): may the signed-in learner also book the old
 * recurring plans? Answers only for the caller's own account, never for
 * another one; nothing but a boolean and the tier keys leaves the server.
 * Off (RETURNING_PAYER_PRICES_ENABLED unset or the v2 offer off): always
 * false, no database read. Checkout repeats the check before it sells.
 */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const headers = { "Cache-Control": "private, no-store" };
  if (!returningPricesEnabled()) return NextResponse.json({ eligible: false, tiers: [] }, { headers });
  try {
    const eligible = await isReturningPayer(getServiceClient(), guard.userId);
    return NextResponse.json({ eligible, tiers: eligible ? RETURNING_TIERS : [] }, { headers });
  } catch (err) {
    captureServerError(err, { route: "/api/pricing/returning", phase: "eligibility" });
    // Fail closed: no old price. withDbUnavailable turns an outage into a 503.
    return NextResponse.json({ error: "Eligibility unavailable" }, { status: 500, headers });
  }
}

export const GET = withDbUnavailable(handleGET);
