import { isPaidTier } from "@/lib/free-tier";
import { pendingCheckout } from "@/lib/checkout-pending";
import { loadRenewalDetail } from "@/lib/renewal-state";
import { extensionAvailability, switchTiersFor, whopSwitchCancelEnabled } from "@/lib/whop-extension";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { tierToWhopPlan, createWhopCheckoutSession, TIERS } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { checkoutTiers, isV2Tier } from "@/lib/pricing-v2/offer";
import { v2PlanReady } from "@/lib/pricing-v2/readiness";
import { resolveSittingChoice, type SittingChoice } from "@/lib/pricing-v2/sitting-pass";
import { accessIsReverseTrialOnly } from "@/lib/pricing-v2/reverse-trial-server";
import { returningCheckoutAllowed } from "@/lib/pricing-v2/returning-payer";
import { isReturningTier } from "@/lib/pricing-v2/price-facts";
import { contextMetadata, withReturnHint } from "@/lib/checkout-context";
import { loadPrefillAccount, prefillCheckoutUrl } from "@/lib/whop-prefill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
// Which tiers a NEW checkout may buy: today's three while PRICING_V2_ENABLED
// is off, the four v2 plans while it is on (src/lib/pricing-v2/offer.ts).
// checkout/verify keeps the union, so a buyer who opened Whop before a flip
// is still granted after it.

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
    // a-tg-checkout-context: counts-only opener context, enum-checked, unknown values dropped.
    const opener = contextMetadata(body?.context);
    // a-pricing-v2-fit (decision returning-payer-price, D-A): with the v2
    // offer on, the old 19 and 49 recurring plans sell only to a learner the
    // server finds with a succeeded Whop payment, behind
    // RETURNING_PAYER_PRICES_ENABLED. Never the retired one-time Cohort.
    let returning = false;
    if (!checkoutTiers().has(tier) && isReturningTier(tier)) {
      try {
        returning = await returningCheckoutAllowed(sb, userId, tier);
      } catch (err) {
        Sentry.captureException(err, { tags: { route: "whop/checkout", step: "returning_payer" } });
        await logPaymentEvent(sb, { event: "checkout_failed", userId, tier, reason: "db_error", metadata: { status: 503, step: "returning_payer" } });
        return NextResponse.json({ error: "Could not check your earlier plans; please try again" }, { status: 503, headers: { "Retry-After": "15" } });
      }
    }
    if ((!checkoutTiers().has(tier) && !returning) || !TIERS[tier]) {
      await logPaymentEvent(sb, {
        event: "checkout_failed",
        userId,
        tier: tier || null,
        reason: isReturningTier(tier) ? "not_returning_payer" : "unknown_tier",
        metadata: { status: 400 },
      });
      return NextResponse.json({ error: "Unknown or unavailable tier" }, { status: 400 });
    }
    // a-pricing-v2: a plan whose promise is not running yet is not sold
    // (the 6-month renewal stop and reminder, the ticket's renewal flow and
    // Mentor credits; src/lib/pricing-v2/readiness.ts).
    if (isV2Tier(tier) && !v2PlanReady(tier)) {
      await logPaymentEvent(sb, { event: "checkout_failed", userId, tier, reason: "plan_not_ready", metadata: { status: 409 } });
      return NextResponse.json({ code: "PLAN_NOT_READY", error: "This plan is not available yet" }, { status: 409 });
    }
    // a-pricing-v2: the Sitting Pass runs until the day after the chosen
    // official sitting and the 6-month plan stops renewing after it, so both
    // need one (Lektor: never promise a stop without a date). Validated
    // against OFFICIAL_SITTINGS, never trusted as a raw date.
    let sitting: SittingChoice | null = null;
    if (tier === "sitting_pass" || tier === "half_year") {
      const raw = body?.sitting && typeof body.sitting === "object" ? body.sitting as Record<string, unknown> : null;
      sitting = raw ? resolveSittingChoice(raw.bank, raw.date) : null;
      if (!sitting) {
        await logPaymentEvent(sb, { event: "checkout_failed", userId, tier, reason: "sitting_required", metadata: { status: 400 } });
        return NextResponse.json({ code: "SITTING_REQUIRED", error: "Choose your exam sitting first" }, { status: 400 });
      }
    }

    const { data: account, error: accountError } = await sb.from('users').select('tier,tier_expires_at,role').eq('id', userId).maybeSingle();
    if (accountError || !account) return NextResponse.json({ code: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 503 });
    // Active Pro: a clear answer instead of a fake "pending". Admins and
    // open-ended access: ALREADY_PRO. An unknown plan or a failed check gets
    // PLAN_UNVERIFIED (no second plan, no renewal claim). a-renew-early
    // (whop-extension.ts): access that will not charge again (one-time, or a
    // renewing plan cancelled at Whop) may add a plan from its current end
    // while WHOP_EXTENSIONS_ENABLED is on; a plan that still renews gets
    // ALREADY_RENEWING unless WHOP_SWITCH_CANCEL_ENABLED is on and the plan
    // bought is strictly longer (then the old renewal is stopped after the
    // grant, whop-switch.ts). The Sitting Pass is never added onto running
    // access (its end is tied to a sitting date). Comp and manual access stay
    // non-extendable: the newest live Whop row must end with the account.
    let extendsFrom: string | null = null;
    let switchFrom: string | null = null;
    if (account.role === 'admin') return NextResponse.json({ code: 'ALREADY_PRO' }, { status: 409 });
    // A learner whose only access is the no-card reverse trial is a buyer, not
    // a payer: the paid window starts now (a-pricing-v2).
    // An unreadable answer counts as paid access (fail closed: the checks
    // below then refuse a second plan, as before).
    const trialOnly = isPaidTier(account.tier, account.tier_expires_at)
      && (await accessIsReverseTrialOnly(sb, userId, new Date(), account.tier_expires_at ?? null)) === true;
    if (isPaidTier(account.tier, account.tier_expires_at) && !trialOnly) {
      if (!account.tier_expires_at) return NextResponse.json({ code: 'ALREADY_PRO' }, { status: 409 });
      const renewal = await loadRenewalDetail(sb, userId);
      if (renewal.state === 'unknown') return NextResponse.json({ code: 'PLAN_UNVERIFIED' }, { status: 409 });
      if (renewal.state === 'renews') {
        // One renewing membership, no unreadable row, a strictly longer plan.
        const only = whopSwitchCancelEnabled() && renewal.renewing.length === 1 && !renewal.unknownRows ? renewal.renewing[0] : null;
        if (!only || !switchTiersFor(only.tier, [tier]).includes(tier)) return NextResponse.json({ code: 'ALREADY_RENEWING' }, { status: 409 });
        switchFrom = only.pin;
      }
      if (tier === 'sitting_pass') return NextResponse.json({ code: 'EXTENSION_UNAVAILABLE' }, { status: 409 });
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
      metadata: {
        medpruef_user_id: userId,
        tier,
        // Round-trips into the webhook; the grant re-validates and clamps it.
        ...(sitting ? { sitting_bank: sitting.bank, sitting_date: sitting.date, sitting_last_day: sitting.lastDay } : {}),
        // a-renew-early: the renewing membership this payment replaces; the
        // webhook stops it only after the new payment is granted.
        ...(switchFrom ? { switch_from_membership: switchFrom } : {}),
      },
      // An extension returns with the previous end date so the success page
      // can tell an applied extension from Pro that was already active.
      redirectUrl: withReturnHint(`${site}/checkout/success?tier=${encodeURIComponent(tier)}${extendsFrom ? `&extends_from=${encodeURIComponent(extendsFrom)}` : ""}`, opener.context),
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
      metadata: extendsFrom || sitting || opener.context ? {
        ...(extendsFrom ? { extension: true } : {}),
        ...(switchFrom ? { switch_from_membership: switchFrom } : {}),
        ...(sitting ? { sitting_bank: sitting.bank, sitting_date: sitting.date, sitting_last_day: sitting.lastDay } : {}),
        ...opener,
      } : undefined,
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

    // a-whop-email-prefill: only the URL handed to the client carries the
    // confirmed address (flag off: no read, the bare URL). Nothing stores or
    // logs it; both events above hold the session id, never the URL.
    const purchaseUrl = prefillCheckoutUrl(session.purchaseUrl, await loadPrefillAccount(sb, userId));

    return NextResponse.json({
      ok: true,
      purchaseUrl,
      sessionId: session.id,
      planId,
      email,
      extendsFrom,
      switchFrom: Boolean(switchFrom),
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
