import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { createWhopCheckoutSession } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { mentorWhopPlanId, readMentorConfig } from "@/lib/mentor/config";
import {
  MENTOR_CHECKOUT_METADATA_KIND,
  type MentorCheckoutMetadata,
  type MentorCheckoutResponse,
  type MentorErrorBody,
} from "@/lib/mentor/contract";
import { canBuyMentorPackages } from "@/lib/mentor/credits/gate";
import { isBuyable, isSoldPackageId, loadPackageCatalogue } from "@/lib/mentor/credits/packages";

export const dynamic = "force-dynamic";

const LIMIT = 5;

function err(error: MentorErrorBody["error"], status: number, headers?: Record<string, string>) {
  const body: MentorErrorBody = { error };
  return NextResponse.json(body, { status, headers });
}

/**
 * POST /api/mentor/checkout { package_id } -> { purchase_url } (contract C4, W2-CREDITS).
 *
 * Creates a Whop checkout-configuration session for a mentor credit package.
 * Metadata is {kind:"mentor_credits", package, medpruef_user_id}, NEVER a
 * `tier` key, so the Pro grant path cannot mistake it for Pro. The return
 * page is /mentor/checkout/success (never /checkout/success, which verifies
 * Pro). Credits are granted by the webhook branch or the verify route,
 * idempotent on the Whop payment id. Plan ids come from env
 * (WHOP_PLAN_MENTOR_*); an unset plan means the package is not buyable.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  const gate = checkRateLimit({ key: rateKey("mentor-checkout", userId), limit: LIMIT, windowMs: 60_000 });
  if (!gate.allowed) return err("rate_limited", 429, rateLimitHeaders(gate, { limit: LIMIT }));

  const config = readMentorConfig();
  if (!(await canBuyMentorPackages(userId, config))) return err("mentor_disabled", 403);

  const body = (await req.json().catch(() => null)) as { package_id?: unknown } | null;
  const packageId = body?.package_id;
  if (!isSoldPackageId(packageId)) return err("invalid_input", 400);

  const sb = getServiceClient();
  try {
    const catalogue = await loadPackageCatalogue(sb);
    const row = catalogue.get(packageId);
    if (!isBuyable(packageId, row, config)) return err("mentor_disabled", 403);
    const planId = mentorWhopPlanId(packageId) as string;

    const metadata: MentorCheckoutMetadata = {
      kind: MENTOR_CHECKOUT_METADATA_KIND,
      package: packageId,
      medpruef_user_id: userId,
    };
    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
    const session = await createWhopCheckoutSession({
      planId,
      metadata: { ...metadata },
      redirectUrl: `${site}/mentor/checkout/success?package=${encodeURIComponent(packageId)}`,
    });

    const tag = { kind: MENTOR_CHECKOUT_METADATA_KIND, package: packageId };
    await logPaymentEvent(sb, {
      event: "checkout_session_created",
      userId,
      planId,
      checkoutSessionId: session.id,
      amountCents: row.price_eur_cents,
      currency: "EUR",
      metadata: tag,
    });
    await logPaymentEvent(sb, { event: "checkout_redirected", userId, planId, checkoutSessionId: session.id, metadata: tag });

    const res: MentorCheckoutResponse = { purchase_url: session.purchaseUrl };
    return NextResponse.json(res);
  } catch (e) {
    Sentry.captureException(e, { tags: { route: "mentor/checkout" } });
    await logPaymentEvent(sb, {
      event: "checkout_failed",
      userId,
      reason: "provider_error",
      metadata: { kind: MENTOR_CHECKOUT_METADATA_KIND, package: packageId, status: 503 },
    });
    return err("upstream_error", 503);
  }
}
