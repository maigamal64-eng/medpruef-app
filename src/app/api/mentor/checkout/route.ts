import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
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
import { mentorScopeReads } from "@/lib/mentor/access";
import { checkMentorPlan } from "@/lib/mentor/credits/plan-check";
import { isBuyable, isSoldPackageId, loadPackageCatalogue } from "@/lib/mentor/credits/packages";
import { mentorResting } from "@/lib/mentor/guard";
import { attachWhopCheckout, beginMentorPurchase, clearPendingPurchase, getMentorPurchase } from "@/lib/mentor/credits/purchases";
import { rpcBalance } from "@/lib/mentor/credits/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const sb = getServiceClient();
  if (!(await canBuyMentorPackages(userId, config, undefined, undefined, mentorScopeReads(sb, { paidAccess: isPaidAccess(guard) })))) {
    // Match /usage: an existing credit holder sees a resting mentor when
    // access is paused. This read never creates an included grant.
    try { if ((await rpcBalance(sb, userId)).ever_granted) return err("mentor_resting", 403); }
    catch { /* Access remains denied when the balance cannot be read. */ }
    return err("mentor_disabled", 403);
  }

  const body = (await req.json().catch(() => null)) as { package_id?: unknown; retry_pending?: unknown; idempotency_key?: unknown } | null;
  const packageId = body?.package_id;
  if (!isSoldPackageId(packageId)) return err("invalid_input", 400);
  if (body?.retry_pending !== undefined && typeof body.retry_pending !== "boolean") return err("invalid_input", 400);

  if (body?.idempotency_key !== undefined && (typeof body.idempotency_key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.idempotency_key))) return err("invalid_input", 400);

  let checkoutSessionId: string | null = null;
  let providerCreated = false;
  try {
    const resting = await mentorResting(sb, config, new Date());
    if (resting === true) return err("mentor_resting", 403);
    if (resting === null) return err("upstream_error", 503);
    const catalogue = await loadPackageCatalogue(sb);
    const row = catalogue.get(packageId);
    if (!isBuyable(packageId, row, config)) return err("mentor_disabled", 403);
    const planId = mentorWhopPlanId(packageId) as string;

    // M3: the price shown must be the price Whop charges. Refuse on any drift.
    const plan = await checkMentorPlan({
      planId,
      priceCents: row.price_eur_cents as number,
      kind: packageId === "mentor_topup" ? "topup" : "subscription",
      apiKey: process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY || null,
    });
    if (!plan.ok) {
      await logPaymentEvent(sb, {
        event: "checkout_failed",
        userId,
        planId,
        reason: "provider_error",
        metadata: { kind: MENTOR_CHECKOUT_METADATA_KIND, package: packageId, cause: `plan_${plan.reason}`, status: 503 },
      });
      return err("upstream_error", 503);
    }

    // Reserve before calling the provider. The SQL guard serializes concurrent taps.
    const correlationId = typeof body?.idempotency_key === "string" ? body.idempotency_key.toLowerCase() : randomUUID();
    const pending = await beginMentorPurchase(sb, {
      userId, packageId, checkoutSessionId: correlationId, retryPending: body?.retry_pending === true,
    });
    if (!pending.ok) {
      if (body?.idempotency_key && pending.reason === "pending_purchase" && pending.checkoutSessionId) {
        // The wallet lock chose one durable intent across tabs. Wait briefly for its
        // provider URL to be persisted; a follower can never create another session.
        for (let attempt = 0; attempt < 20; attempt++) {
          const existing = await getMentorPurchase(sb, userId, pending.checkoutSessionId);
          if (existing?.status !== "pending" || existing.package_id !== packageId) break;
          if (existing.purchase_url && /^https:\/\//.test(existing.purchase_url)) return NextResponse.json({ purchase_url: existing.purchase_url, checkout_session_id: existing.checkout_session_id } satisfies MentorCheckoutResponse);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      return err(pending.reason, 409);
    }
    checkoutSessionId = correlationId;

    const metadata: MentorCheckoutMetadata = {
      kind: MENTOR_CHECKOUT_METADATA_KIND,
      package: packageId,
      medpruef_user_id: userId,
    };
    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
    const session = await createWhopCheckoutSession({
      planId,
      metadata: { ...metadata, checkout_session_id: correlationId },
      redirectUrl: `${site}/mentor/checkout/success?package=${encodeURIComponent(packageId)}&checkout_session_id=${encodeURIComponent(correlationId)}`,
    });
    providerCreated = true;
    await attachWhopCheckout(sb, userId, correlationId, session.id, session.purchaseUrl);

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

    const res: MentorCheckoutResponse = { purchase_url: session.purchaseUrl, checkout_session_id: correlationId };
    return NextResponse.json(res);
  } catch (e) {
    Sentry.captureException(e, { tags: { route: "mentor/checkout" } });
    // Once a provider session exists, keep the guard on a persistence failure:
    // the provider may still take the payment. An explicit retry opens at 30 minutes.
    if (checkoutSessionId && !providerCreated) {
      try { await clearPendingPurchase(sb, { status: "failed", checkoutSessionId }); }
      catch (releaseError) { Sentry.captureException(releaseError, { tags: { route: "mentor/checkout", step: "release" } }); }
    }
    await logPaymentEvent(sb, {
      event: "checkout_failed",
      userId,
      reason: "provider_error",
      metadata: { kind: MENTOR_CHECKOUT_METADATA_KIND, package: packageId, status: 503 },
    });
    return err("upstream_error", 503);
  }
}
