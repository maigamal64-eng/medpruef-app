import { NextRequest, NextResponse } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { captureServerError } from "@/lib/sentry-capture";
import { mockGateLang } from "@/lib/mock-gate-sitting/copy";
import { mockGateSittingEnabled } from "@/lib/mock-gate-sitting/flag";
import { mockGateLine, type MockGateFit } from "@/lib/mock-gate-sitting";
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
 * GET /api/mock-gate/sitting-line?bank=&lang= (a-b2-mock-gate-1110, B2): the
 * sitting line under gate_body on the mock-exam wall. Answers only for the
 * caller's own account and only for a free learner. Off
 * (MOCK_GATE_SITTING_ENABLED unset) or after the window: { state: "none" }
 * before any session check or database read. The plan sentence is filled from
 * sittingFit().recommended with the page's own readiness (the 6-month plan is
 * out while its flag is off) and left out when pricing v2 is off.
 */
async function handleGET(req: NextRequest) {
  if (!mockGateSittingEnabled()) return NextResponse.json(NONE, { headers: HEADERS });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (isPaidAccess(guard)) return NextResponse.json(NONE, { headers: HEADERS });
  const params = req.nextUrl.searchParams;
  const lang = mockGateLang(params.get("lang"));
  const bank = params.get("bank");
  try {
    const { data, error } = await getServiceClient().from("users").select("exam_date").eq("id", guard.userId).maybeSingle();
    if (error) throw error;
    const examDate = typeof data?.exam_date === "string" ? data.exam_date : null;
    const now = new Date();
    const result = mockGateLine({
      now,
      lang,
      bank,
      examDate,
      fit: (sitting): MockGateFit | null => {
        if (!pricingV2Enabled()) return null;
        const fit = sittingFit(sitting, now, { guard: halfYearGuardLive(), ready: v2Readiness() });
        return { plan: planName(fit.recommended, lang), total: billingAmount(fit.plans[fit.recommended].totalCents, lang) };
      },
    });
    return NextResponse.json(result, { headers: HEADERS });
  } catch (err) {
    captureServerError(err, { route: "/api/mock-gate/sitting-line", phase: "read" });
    // Fail quiet: the gate keeps today's lines.
    return NextResponse.json(NONE, { headers: HEADERS });
  }
}

export const GET = withDbUnavailable(handleGET);
