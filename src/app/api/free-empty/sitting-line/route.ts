import { NextRequest, NextResponse } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { captureServerError } from "@/lib/sentry-capture";
import { freeEmptyLang } from "@/lib/free-empty-sitting/copy";
import { freeEmptySittingEnabled } from "@/lib/free-empty-sitting/flag";
import { freeEmptySitting, type FreeEmptyFit } from "@/lib/free-empty-sitting";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { sittingFit } from "@/lib/pricing-v2/fit";
import { halfYearGuardLive, v2Readiness } from "@/lib/pricing-v2/readiness";
import { planName } from "@/lib/pricing-v2/price-facts";
import { billingAmount } from "@/lib/billing-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "private, no-store" };
const NONE = { state: "none" } as const;

/**
 * GET /api/free-empty/sitting-line?bank=&lang= (a-growth-lines-1102, A1): the
 * sitting line under the free empty state of the Vienna bank. Answers only
 * for the caller's own account and only for a free learner. Off
 * (FREE_EMPTY_SITTING_ENABLED unset): { state: "none" } with no database
 * read. The plan sentence is filled from sittingFit().recommended with the
 * page's own readiness, and left out when pricing v2 is off.
 */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!freeEmptySittingEnabled()) return NextResponse.json(NONE, { headers: HEADERS });
  if (isPaidAccess(guard)) return NextResponse.json(NONE, { headers: HEADERS });
  const params = req.nextUrl.searchParams;
  const lang = freeEmptyLang(params.get("lang"));
  const bank = params.get("bank");
  try {
    const { data, error } = await getServiceClient().from("users").select("exam_date").eq("id", guard.userId).maybeSingle();
    if (error) throw error;
    const examDate = typeof data?.exam_date === "string" ? data.exam_date : null;
    const now = new Date();
    const result = freeEmptySitting({
      now,
      lang,
      bank,
      examDate,
      fit: (sitting): FreeEmptyFit | null => {
        if (!pricingV2Enabled()) return null;
        const fit = sittingFit(sitting, now, { guard: halfYearGuardLive(), ready: v2Readiness() });
        return { plan: planName(fit.recommended, lang), total: billingAmount(fit.plans[fit.recommended].totalCents, lang) };
      },
    });
    return NextResponse.json(result, { headers: HEADERS });
  } catch (err) {
    captureServerError(err, { route: "/api/free-empty/sitting-line", phase: "read" });
    // Fail quiet: the empty state keeps today's lines.
    return NextResponse.json(NONE, { headers: HEADERS });
  }
}

export const GET = withDbUnavailable(handleGET);
