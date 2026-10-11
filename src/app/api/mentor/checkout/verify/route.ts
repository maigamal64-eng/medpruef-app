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
import { readPurchaseReceipt, recordPurchaseCompleted } from "@/lib/mentor/credits/receipt";
import { getMentorPurchase } from "@/lib/mentor/credits/purchases";
import { isUuid } from "@/lib/mentor/credits/db";

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
  const sessionParam = req.nextUrl.searchParams.get("checkout_session_id");
  if (!sessionParam || !isUuid(sessionParam)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const sb = getServiceClient();
  let status: MentorCheckoutVerifyResponse["status"] = "pending";
  let creditsAdded = 0;
  let receipt: MentorCheckoutVerifyResponse["receipt"];
  try {
    status = await verifyMentorCheckout(
      {
        db: sb,
        apiKey: process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY || null,
        companyId: process.env.WHOP_COMPANY_ID ?? null,
      },
      userId,
      onlyPackage,
      sessionParam,
    );
    if (status === "granted") {
      const purchase = await getMentorPurchase(sb, userId, sessionParam);
      creditsAdded = creditsFromMicro(purchase?.granted_micro ?? 0);
      receipt = (await readPurchaseReceipt(sb, userId, sessionParam)) ?? undefined;
      if (!receipt) { status = "pending"; creditsAdded = 0; }
      else {
        creditsAdded = receipt.credits;
        // Only the success screen poll writes this payment-keyed event.
        try { await recordPurchaseCompleted(sb, userId, sessionParam); }
        catch (error) { Sentry.captureException(error, { tags: { route: "mentor/checkout/verify", step: "completion_event" } }); }
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout/verify" } });
    status = "pending";
    creditsAdded = 0;
  }

  let credits = 0;
  try {
    credits = creditsFromMicro((await rpcBalance(sb, userId)).available_micro);
  } catch {
    credits = 0;
  }
  const body: MentorCheckoutVerifyResponse = { status, credits_left: credits, credits_added: creditsAdded, ...(receipt && status === "granted" ? { receipt } : {}) };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
