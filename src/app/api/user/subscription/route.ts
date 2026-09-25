import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { TIERS } from "@/lib/nowpayments";
import { getSubscriptionDisplayNames } from "@/lib/subscription-display";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/subscription
 *
 * Returns the caller's most-recent active subscription (if any) plus
 * tier metadata the UI needs to render the /settings subscription
 * card. Trial reminders and billing cadence are only communicated when
 * they can be identified from trustworthy provider-plan data. Legacy
 * tier keys shared by one-time and recurring plans use neutral labels.
 *
 * Response shape (200):
 *   {
 *     active: boolean,
 *     subscription?: {
 *       id: string,
 *       tier: string,
 *       tier_human_name: string,
 *       tier_human_name_de: string,
 *       status: string,
 *       started_at: string,
 *       expires_at: string,
 *       days_remaining: number | null,   // null if no expiry
 *       is_first_month_trial: boolean,   // true only when provider data verifies a trial
 *       is_starter_3mo_trial: boolean,   // true only when provider data verifies this tier
 *       is_puyp_eligible_tier: boolean,
 *       billing_cadence_unknown: boolean, // true when key alone cannot identify renewal cadence
 *       payment_provider: string | null,
 *       amount_cents: number | null,
 *       currency: string | null,
 *       trial_reminder_sent_at: string | null,
 *     }
 *   }
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  try {
    const sb = getServiceClient();

    const { data: sub, error } = await sb
      .from("subscriptions")
      .select(
        "id, tier, status, started_at, expires_at, payment_provider, amount_cents, currency, trial_reminder_sent_at",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      captureServerError(error, {
        route: "/api/user/subscription",
        userId,
        step: "subscription_lookup",
      });
      return NextResponse.json(
        { error: "Subscription lookup failed" },
        { status: 500 },
      );
    }

    if (!sub) {
      return NextResponse.json({ active: false });
    }

    const tierKey = String(sub.tier);
    const tierDef = TIERS[tierKey];
    const displayNames = getSubscriptionDisplayNames(
      tierKey,
      tierDef?.humanName ?? tierKey,
      tierDef?.humanNameDe ?? tierKey,
    );

    // Compute days_remaining as ceil((expires_at - now) / 86_400_000).
    // We ceil so that "fewer than 24 hours left" still reads as "1 day"
    // in the UI — friendlier than prematurely flipping to 0. Clamped at
    // 0 minimum so expired-but-not-yet-cronned rows don't show negative
    // days (would look like a UI bug to users).
    let daysRemaining: number | null = null;
    if (sub.expires_at) {
      const msRemaining = new Date(sub.expires_at).getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(msRemaining / 86_400_000));
    }

    return NextResponse.json({
      active: true,
      subscription: {
        id: sub.id,
        tier: tierKey,
        tier_human_name: displayNames.humanName,
        tier_human_name_de: displayNames.humanNameDe,
        status: sub.status,
        started_at: sub.started_at,
        expires_at: sub.expires_at,
        days_remaining: daysRemaining,
        is_first_month_trial: false, // Legacy tier key is shared by recurring and one-time plans.
        // Legacy response field retained for UI compatibility. Do not
        // infer trial status or countdown behavior from the tier key.
        is_starter_3mo_trial: false, // Legacy tier key does not identify billing cadence.
        is_puyp_eligible_tier: Boolean(tierDef?.puypEligible),
        billing_cadence_unknown: tierKey === "first_month_19" || tierKey === "first_3mo_27",
        payment_provider: sub.payment_provider,
        amount_cents: sub.amount_cents,
        currency: sub.currency,
        trial_reminder_sent_at: sub.trial_reminder_sent_at,
      },
    });
  } catch (err) {
    captureServerError(err, {
      route: "/api/user/subscription",
      userId,
      step: "unexpected",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
