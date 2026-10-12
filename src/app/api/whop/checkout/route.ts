import { isPaidTier } from "@/lib/free-tier";
import { pendingCheckout } from "@/lib/checkout-pending";
import { loadRenewalState } from "@/lib/renewal-state";
import { extensionAvailability } from "@/lib/whop-extension";
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

    const { data: account, error: accountError } = await sb.from('users').select('tier,tier_expires_at,role').eq('id', userId).maybeSingle();
    if (accountError || !account) return NextResponse.json({ code: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 503 });
    // Active Pro: a clear answer instead of a fake "pending". Admins and
    // open-ended access: ALREADY_PRO. ALREADY_RENEWING only when Whop confirms
    // the current plan renews by itself (renewal-state.ts); an unknown plan or
    // a failed check gets PLAN_UNVERIFIED (no second plan, no renewal claim);
    // a renewing plan cancelled at Whop gets EXTENSION_UNAVAILABLE.
    // Otherwise an extension from the current end date, only while
    // WHOP_EXTENSIONS_ENABLED is on and the access is Whop-owned
    // (whop-extension.ts); else EXTENSION_UNAVAILABLE.
    let extendsFrom: string | null = null;
    if (account.role === 'admin') return NextResponse.json({ code: 'ALREADY_PRO' }, { status: 409 });
    if (isPaidTier(account.tier, account.tier_expires_at)) {
      if (!account.tier_expires_at) return NextResponse.json({ code: 'ALREADY_PRO' }, { status: 409 });
      const renewal = await loadRenewalState(sb, userId);
      if (renewal === 'renews') return NextResponse.json({ code: 'ALREADY_RENEWING' }, { status: 409 });
      if (renewal === 'unknown') return NextResponse.json({ code: 'PLAN_UNVERIFIED' }, { status: 409 });
      // Cancelled at Whop: it will not renew, and it is never extendable.
      if (renewal === 'cancelled') return NextResponse.json({ code: 'EXTENSION_UNAVAILABLE' }, { status: 409 });
      // Extension is off by default and limited to Whop-owned access that
      // ends with the account (src/lib/whop-extension.ts explains why).
      const availability = await extensionAvailability(sb, userId, account.tier_expires_at);
      if (availability === 'error') return NextResponse.json({ code: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 503 });
      if (availability !== 'available') return NextResponse.json({ code: 'EXTENSION_UNAVAILABLE' }, { status: 409 });
      extendsFrom = account.tier_expires_at;
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

    const { data: recentEvents, error: recentError } = await sb.from('payment_events')
      .select('event,created_at,tier,reason').eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .in('event', ['checkout_redirected', 'grant_succeeded', 'checkout_failed']).order('created_at', { ascending: false }).limit(100);
    if (recentError) return NextResponse.json({ error: 'Payment status unavailable', code: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 503 });
    const pending = pendingCheckout(recentEvents ?? []);
    if (pending) return NextResponse.json({ code: 'CHECKOUT_PENDING', tier: pending.tier, error: 'Previous checkout is still being checked' }, { status: 409 });

    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
    const session = await createWhopCheckoutSession({
      planId,
      metadata: { medpruef_user_id: userId, tier },
      // An extension returns with the previous end date so the success page
      // can tell an applied extension from Pro that was already active.
      redirectUrl: `${site}/checkout/success?tier=${encodeURIComponent(tier)}${extendsFrom ? `&extends_from=${encodeURIComponent(extendsFrom)}` : ""}`,
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
      metadata: extendsFrom ? { extension: true } : undefined,
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
      // The pending strip passes this to verify so an extension is checked
      // against the moved end date, never against access that was already active.
      metadata: extendsFrom ? { extends_from: extendsFrom } : undefined,
    });

    return NextResponse.json({
      ok: true,
      purchaseUrl: session.purchaseUrl,
      sessionId: session.id,
      planId,
      email,
      extendsFrom,
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
