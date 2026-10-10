import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { creditsFromMicro } from "@/lib/mentor/config";
import type { MentorCheckoutVerifyResponse, MentorErrorBody } from "@/lib/mentor/contract";
import { rpcBalance } from "@/lib/mentor/credits/db";
import { isSoldPackageId } from "@/lib/mentor/credits/packages";
import { verifyMentorCheckout } from "@/lib/mentor/credits/verify";

export const dynamic = "force-dynamic";

const LIMIT = 10;

/**
 * GET /api/mentor/checkout/verify[?package=mentor_basis] -> MentorCheckoutVerifyResponse
 * (contract C4, W2-CREDITS). Polled by /mentor/checkout/success. Grants the
 * buyer's credits as soon as Whop shows a paid payment, through the same
 * idempotent grant as the webhook. Not flag-gated: a buyer must get what
 * they paid for even if a flag was switched off mid-checkout.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  const gate = checkRateLimit({ key: rateKey("mentor-verify", userId), limit: LIMIT, windowMs: 60_000 });
  if (!gate.allowed) {
    const body: MentorErrorBody = { error: "rate_limited", retry_after_seconds: gate.retryAfterSec };
    return NextResponse.json(body, { status: 429, headers: rateLimitHeaders(gate, { limit: LIMIT }) });
  }

  const pkgParam = req.nextUrl.searchParams.get("package");
  const onlyPackage = isSoldPackageId(pkgParam) ? pkgParam : null;

  const sb = getServiceClient();
  let status: MentorCheckoutVerifyResponse["status"] = "pending";
  try {
    status = await verifyMentorCheckout(
      {
        db: sb,
        apiKey: process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY || null,
        companyId: process.env.WHOP_COMPANY_ID ?? null,
      },
      userId,
      onlyPackage,
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout/verify" } });
    status = "pending";
  }

  let credits = 0;
  try {
    credits = creditsFromMicro((await rpcBalance(sb, userId)).available_micro);
  } catch {
    credits = 0;
  }
  const body: MentorCheckoutVerifyResponse = { status, credits_left: credits };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
