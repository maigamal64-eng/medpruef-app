import { NextRequest, NextResponse } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit } from "@/lib/rate-limit";
import { momentsEnabled } from "@/lib/journey/moments";
import { stpDeadlineCardEnabled } from "@/lib/stp-deadline-card/flag";
import { stpCardLang } from "@/lib/stp-deadline-card/copy";
import { stpDeadlineCard, type StpCardFit } from "@/lib/stp-deadline-card";
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
 * GET /api/stp-deadline-card/line?lang= (a-c1-stp-card-1119, angle C1): the
 * Stichprobentest deadline card on Home. Answers only for the caller's own
 * account (exam_date and active_exam come from the guard's own-row read, no second read). Off (STP_DEADLINE_CARD_ENABLED unset): { state: "none" } before any
 * session check or database read. The plan sentence is filled from
 * sittingFit().recommended with the page's own readiness, and left out when
 * pricing v2 is off or the learner is paid.
 */
async function handleGET(req: NextRequest) {
  if (!stpDeadlineCardEnabled()) return NextResponse.json(NONE, { headers: HEADERS });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: `stp-card:${guard.userId}`, limit: 60, windowMs: 10 * 60_000 });
  if (!gate.allowed) return NextResponse.json(NONE, { headers: HEADERS });
  const lang = stpCardLang(req.nextUrl.searchParams.get("lang"));
  try {
    const now = new Date();
    const card = stpDeadlineCard({
      now,
      lang,
      examDate: guard.profile?.examDate ?? null,
      activeExam: guard.profile?.activeExam ?? null,
      isPaid: isPaidAccess(guard),
      momentsOn: momentsEnabled(),
      fit: (sitting): StpCardFit | null => {
        if (!pricingV2Enabled()) return null;
        const fit = sittingFit(sitting, now, { guard: halfYearGuardLive(), ready: v2Readiness() });
        return { plan: planName(fit.recommended, lang), total: billingAmount(fit.plans[fit.recommended].totalCents, lang) };
      },
    });
    return NextResponse.json(card, { headers: HEADERS });
  } catch (err) {
    captureServerError(err, { route: "/api/stp-deadline-card/line", phase: "build" });
    // Fail quiet: Home keeps today's cards.
    return NextResponse.json(NONE, { headers: HEADERS });
  }
}

export const GET = withDbUnavailable(handleGET);
