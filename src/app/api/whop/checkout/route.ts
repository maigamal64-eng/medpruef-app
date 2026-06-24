import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { tierToWhopPlan, createWhopCheckoutSession, TIERS } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";

export const dynamic = "force-dynamic";

/**
 * POST /api/whop/checkout  { tier }
 *
 * Creates a per-user Whop checkout-configuration session (carrying
 * metadata.medpruef_user_id + tier) and returns its hosted `purchaseUrl`
 * (= whop.com/checkout/<plan>/?session=ch_...). The client redirects there.
 * The metadata is what the webhook maps the payment back to a user on — the
 * v1 payment payload has no user_id/plan_id, only data.metadata. Card +
 * Apple Pay both work on the hosted page with no domain verification.
 */
const LIVE_TIERS = new Set([
  "first_month_19",
  "first_3mo_27",
  "premium_pass_guaranteed",
]);

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  // Service client is hoisted so the funnel logger (best-effort, never throws)
  // can write at every branch — including the failure exits that the buyer
  // never sees, so a checkout that died before reaching Whop is still PROVEN.
  const sb = getServiceClient();

  let tier = "";
  try {
    const body = await req.json().catch(() => ({}));
    tier = String(body?.tier || "");
    if (!LIVE_TIERS.has(tier) || !TIERS[tier]) {
      await logPaymentEvent(sb, {
        event: "checkout_failed",
        userId,
        tier: tier || null,
        reason: "unknown_tier",
        metadata: { status: 400 },
      });
      return NextResponse.json({ error: "Unknown or unavailable tier" }, { status: 400 });
    }

    const planId = tierToWhopPlan(tier);
    if (!planId) {
      console.error("[whop/checkout] no WHOP_PLAN_* env for tier", tier);
      Sentry.captureMessage(`Whop plan id not configured for tier ${tier}`, "error");
      await logPaymentEvent(sb, {
        event: "checkout_failed",
        userId,
        tier,
        reason: "plan_not_configured",
        metadata: { status: 503 },
      });
      return NextResponse.json({ error: "Checkout temporarily unavailable" }, { status: 503 });
    }

    // Best-effort email prefill (never blocks checkout).
    let email: string | null = null;
    try {
      const { data } = await sb.from("users").select("email").eq("id", userId).maybeSingle();
      email = (data?.email as string | undefined) ?? null;
    } catch {
      /* prefill is optional */
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
    const session = await createWhopCheckoutSession({
      planId,
      metadata: { medpruef_user_id: userId, tier },
      redirectUrl: `${site}/checkout/success?tier=${encodeURIComponent(tier)}`,
    });

    // FUNNEL: a Whop checkout session (ch_…) now exists for this user+tier.
    await logPaymentEvent(sb, {
      event: "checkout_session_created",
      userId,
      email,
      tier,
      planId,
      checkoutSessionId: session.id,
      amountCents: TIERS[tier]?.priceCents ?? null,
      currency: "EUR",
    });
    // FUNNEL: we are about to hand the hosted purchase_url back to the client
    // (the server-visible proxy for "redirected to pay" — the browser redirect
    // itself isn't server-observable, so we record the handoff, not a fiction).
    await logPaymentEvent(sb, {
      event: "checkout_redirected",
      userId,
      tier,
      planId,
      checkoutSessionId: session.id,
    });

    return NextResponse.json({
      ok: true,
      purchaseUrl: session.purchaseUrl,
      sessionId: session.id,
      planId,
      email,
    });
  } catch (err) {
    console.error("[whop/checkout] failed", err);
    Sentry.captureException(err, { tags: { route: "whop/checkout" } });
    await logPaymentEvent(sb, {
      event: "checkout_failed",
      userId,
      tier: tier || null,
      reason: "provider_error",
      metadata: { status: 502, message: (err as Error)?.message?.slice(0, 200) },
    });
    return NextResponse.json({ error: "Payment provider unavailable, please try again" }, { status: 502 });
  }
}
