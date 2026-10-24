import { pendingCheckout } from "@/lib/checkout-pending";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { contextMetadata, withReturnHint } from "@/lib/checkout-context";
import { getServiceClient } from "@/lib/supabase";
import { createWhopCheckoutSession, tierToWhopPlan, TIERS } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { activeCardTrialTier, cardTrialDays, cardTrialRefusal, type CardTrialRefusal, type CardTrialTier } from "@/lib/card-trial";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/whop/trial — the Whop card-on-file Pro trial.
 *
 * The learner adds a working card on Whop's hosted checkout (0 EUR today),
 * gets the trial's days of full Pro, and Whop charges the renewal price
 * afterwards unless they cancel in the trial. Two card trials share this
 * route (src/lib/card-trial.ts, activeCardTrialTier):
 *   - flex_month_trial (a-card-trial-build-1024, decision whop-card-trial-1024):
 *     3 days, then 24 EUR every 30 days, plan WHOP_PLAN_FLEX_TRIAL, switch
 *     CARD_TRIAL_ENABLED (with its build copy NEXT_PUBLIC_CARD_TRIAL).
 *   - notes_pro_trial (2026-07-01, dormant): 7 days, then 19 EUR every 30
 *     days, plan WHOP_PLAN_NOTES_TRIAL, switch NOTES_TRIAL_ENABLED.
 * Neither runs while the no-card reverse trial is on.
 *
 * GET  → eligibility/state for the activation UI.
 * POST → create a per-user Whop checkout session on the trial plan and return
 *        its hosted purchase_url; the client redirects there. Access is granted
 *        when the user returns to /checkout/success (which calls
 *        /api/whop/trial/verify) and, as a backstop, by the whop webhook.
 *
 * Anti-abuse (PLAN 3e, no migration; cardTrialRefusal): one card trial per
 * account (either tier, any status), none after the reverse trial, none for a
 * learner who has paid before (they get the paid checkout), none when the
 * account's email already started a reverse trial. Whop refuses a second free
 * trial to the same payer on the same plan; the card is the seriousness gate.
 */

const DAY_MS = 86_400_000;

interface Eligibility {
  eligible: boolean;
  trial_enabled: boolean;
  is_pro: boolean;
  already_trialed: boolean;
  /** Why the trial is refused (null while eligible or switched off). */
  refusal: CardTrialRefusal | null;
  /** The card trial a checkout would start (null while switched off). */
  tier: CardTrialTier | null;
  trial_days: number;
  price_after_cents: number;
  currency: string;
  /** First charge if the trial started now (start + trial days). Server-side so every surface states the same date. */
  charge_at: string;
}

async function computeEligibility(userId: string): Promise<Eligibility | null> {
  const sb = getServiceClient({ fastFail: false });
  const tier = activeCardTrialTier();
  const shownTier: CardTrialTier = tier ?? "notes_pro_trial";
  const { data: user, error } = await sb
    .from("users")
    .select("id, tier, email")
    .eq("id", userId)
    .maybeSingle();
  if (error || !user) return null;

  const isPro = user.tier === "pro" || user.tier === "admin";

  // Every subscription row of this account (any tier, any status): a card
  // trial row means the free window was already used; reverse_trial means the
  // no-card trial was; a paid Whop row means a returning payer.
  const { data: subs, error: subsError } = await sb
    .from("subscriptions")
    .select("tier, status, payment_provider, amount_cents, granted_payment_ids")
    .eq("user_id", userId)
    .limit(200);
  if (subsError) return null;

  // Reverse-trial rows (read only): this account, or the same normalised
  // email on another account (the once-per-person wall of the reverse trial).
  const { data: ownTrial, error: ownTrialError } = await sb
    .from("trials").select("id").eq("user_id", userId).limit(1);
  if (ownTrialError) return null;
  const emailKey = trialEmailKey(user.email as string | null);
  let emailTrial = false;
  if (emailKey) {
    const { data: byEmail, error: emailError } = await sb
      .from("trials").select("id").eq("email_key", emailKey).limit(1);
    if (emailError) return null;
    emailTrial = Boolean(byEmail && byEmail.length > 0);
  }

  const refusal = cardTrialRefusal({
    isPro,
    subscriptions: (subs ?? []) as Parameters<typeof cardTrialRefusal>[0]["subscriptions"],
    trialRowForUser: Boolean(ownTrial && ownTrial.length > 0),
    trialRowForEmail: emailTrial,
  });
  const days = cardTrialDays(shownTier);

  return {
    eligible: tier !== null && refusal === null,
    trial_enabled: tier !== null,
    is_pro: isPro,
    already_trialed: refusal !== null && refusal !== "pro",
    refusal: tier !== null ? refusal : null,
    tier,
    trial_days: days,
    price_after_cents: TIERS[shownTier]?.priceCents ?? 1900,
    currency: "EUR",
    charge_at: new Date(Date.now() + days * DAY_MS).toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  try {
    const elig = await computeEligibility(guard.userId);
    if (!elig) return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    return NextResponse.json(elig);
  } catch (err) {
    console.error("[whop/trial GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;
  const sb = getServiceClient({ fastFail: false });

  const trialTier = activeCardTrialTier();
  if (!trialTier) {
    return NextResponse.json(
      { error: "The trial is not available right now.", code: "TRIAL_DISABLED" },
      { status: 503 },
    );
  }

  // a-tg-checkout-context: counts-only opener context; an empty or non-JSON body (older clients) is fine.
  const opener = contextMetadata((await req.json().catch(() => null) as { context?: unknown } | null)?.context);

  const gate = checkRateLimit({ key: rateKey("whop-trial", userId), limit: 5, windowMs: 60_000 });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please wait a moment." },
      { status: 429, headers: rateLimitHeaders(gate, { limit: 5 }) },
    );
  }

  try {
    const elig = await computeEligibility(userId);
    if (!elig) return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    if (elig.is_pro) {
      return NextResponse.json(
        { error: "You already have Pro access.", code: "ALREADY_PRO" },
        { status: 409 },
      );
    }
    if (elig.already_trialed) {
      return NextResponse.json(
        { error: "This account has already used its trial.", code: "ALREADY_TRIALED", refusal: elig.refusal },
        { status: 409 },
      );
    }

    const planId = tierToWhopPlan(trialTier);
    if (!planId) {
      console.error(`[whop/trial] plan for ${trialTier} not configured`);
      Sentry.captureMessage(`Whop plan for ${trialTier} not set: trial checkout unavailable`, "error");
      await logPaymentEvent(sb, {
        event: "checkout_failed",
        userId,
        tier: trialTier,
        reason: "plan_not_configured",
        metadata: { status: 503 },
      });
      return NextResponse.json({ error: "Trial temporarily unavailable" }, { status: 503 });
    }

    let email: string | null = null;
    try {
      const { data } = await sb.from("users").select("email").eq("id", userId).maybeSingle();
      email = (data?.email as string | undefined) ?? null;
    } catch {
      /* prefill optional */
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
      metadata: { medpruef_user_id: userId, tier: trialTier },
      // The success page reads ?trial=1 and calls /api/whop/trial/verify to grant.
      redirectUrl: withReturnHint(`${site}/checkout/success?tier=${encodeURIComponent(trialTier)}&trial=1`, opener.context),
    });

    await logPaymentEvent(sb, {
      event: "checkout_session_created",
      userId,
      email,
      tier: trialTier,
      planId,
      checkoutSessionId: session.id,
      amountCents: 0, // €0 at trial start
      currency: "EUR",
      metadata: { flow: trialTier, ...opener },
    });
    await logPaymentEvent(sb, {
      event: "checkout_redirected",
      userId,
      tier: trialTier,
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
    console.error("[whop/trial POST] failed", err);
    Sentry.captureException(err, { tags: { route: "whop/trial" } });
    await logPaymentEvent(sb, {
      event: "checkout_failed",
      userId,
      tier: trialTier,
      reason: "provider_error",
      metadata: { status: 502, message: (err as Error)?.message?.slice(0, 200) },
    });
    return NextResponse.json({ error: "Payment provider unavailable, please try again" }, { status: 502 });
  }
}
