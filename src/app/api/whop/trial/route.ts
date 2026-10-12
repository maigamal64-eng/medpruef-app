import { pendingCheckout } from "@/lib/checkout-pending";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { createWhopCheckoutSession, tierToWhopPlan, TIERS } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/whop/trial — the Whop card-on-file Pro trial (2026-07-01 pivot).
 *
 * Replaces the free Telegram-gated trial (/api/trial/activate) with a
 * card-linked one: the user adds a working card at signup (€0 charged now),
 * gets `TRIAL_DAYS` of full Pro, and Whop auto-charges €19/month afterwards
 * unless they cancel in-trial. Confirmed with [name] 2026-07-01: "Card on file,
 * €0 now" + "€19/month recurring". Plan: WHOP_PLAN_NOTES_TRIAL
 * (plan_redactedec56d4df, plan_type=renewal, trial_period_days=7).
 *
 * GET  → eligibility/state for the activation UI.
 * POST → create a per-user Whop checkout session on the trial plan and return
 *        its hosted purchase_url; the client redirects there. Access is granted
 *        when the user returns to /checkout/success (which calls
 *        /api/whop/trial/verify) and, as a backstop, by the whop webhook.
 *
 * Anti-abuse: Whop enforces trial-once-per-card at the payment rail; we add a
 * per-ACCOUNT guard here — a user who already has (or had) a `notes_pro_trial`
 * subscription row is not offered the trial again. Gated OFF by default
 * (NOTES_TRIAL_ENABLED) so it can be reviewed + tested before going live.
 */

const TRIAL_TIER = "notes_pro_trial";
const TRIAL_DAYS = 7;

const TRIAL_ENABLED =
  (process.env.NOTES_TRIAL_ENABLED ?? "false").toLowerCase() === "true";

interface Eligibility {
  eligible: boolean;
  trial_enabled: boolean;
  is_pro: boolean;
  already_trialed: boolean;
  trial_days: number;
  price_after_cents: number;
  currency: string;
  /** First charge if the trial started now (start + trial days). Server-side so every surface states the same date. */
  charge_at: string;
}

async function computeEligibility(userId: string): Promise<Eligibility | null> {
  const sb = getServiceClient();
  const { data: user, error } = await sb
    .from("users")
    .select("id, tier")
    .eq("id", userId)
    .maybeSingle();
  if (error || !user) return null;

  const isPro = user.tier === "pro" || user.tier === "admin";

  // Already trialed on THIS account? Any notes_pro_trial subscription row (any
  // status — active, cancelled, expired) means the free window was already used.
  const { data: prior, error: priorError } = await sb
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("tier", TRIAL_TIER)
    .limit(1);
  if (priorError) return null;
  const alreadyTrialed = Boolean(prior && prior.length > 0);

  return {
    eligible: TRIAL_ENABLED && !isPro && !alreadyTrialed,
    trial_enabled: TRIAL_ENABLED,
    is_pro: isPro,
    already_trialed: alreadyTrialed,
    trial_days: TRIAL_DAYS,
    price_after_cents: TIERS[TRIAL_TIER]?.priceCents ?? 1900,
    currency: "EUR",
    charge_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
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
  const sb = getServiceClient();

  if (!TRIAL_ENABLED) {
    return NextResponse.json(
      { error: "The trial is not available right now.", code: "TRIAL_DISABLED" },
      { status: 503 },
    );
  }

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
        { error: "This account has already used its trial.", code: "ALREADY_TRIALED" },
        { status: 409 },
      );
    }

    const planId = tierToWhopPlan(TRIAL_TIER);
    if (!planId) {
      console.error("[whop/trial] WHOP_PLAN_NOTES_TRIAL not configured");
      Sentry.captureMessage("WHOP_PLAN_NOTES_TRIAL not set — trial checkout unavailable", "error");
      await logPaymentEvent(sb, {
        event: "checkout_failed",
        userId,
        tier: TRIAL_TIER,
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
      metadata: { medpruef_user_id: userId, tier: TRIAL_TIER },
      // The success page reads ?trial=1 and calls /api/whop/trial/verify to grant.
      redirectUrl: `${site}/checkout/success?tier=${encodeURIComponent(TRIAL_TIER)}&trial=1`,
    });

    await logPaymentEvent(sb, {
      event: "checkout_session_created",
      userId,
      email,
      tier: TRIAL_TIER,
      planId,
      checkoutSessionId: session.id,
      amountCents: 0, // €0 at trial start
      currency: "EUR",
      metadata: { flow: "notes_pro_trial" },
    });
    await logPaymentEvent(sb, {
      event: "checkout_redirected",
      userId,
      tier: TRIAL_TIER,
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
      tier: TRIAL_TIER,
      reason: "provider_error",
      metadata: { status: 502, message: (err as Error)?.message?.slice(0, 200) },
    });
    return NextResponse.json({ error: "Payment provider unavailable, please try again" }, { status: 502 });
  }
}
