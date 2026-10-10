import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { TIERS } from "@/lib/nowpayments";
import { getSubscriptionDisplayNames } from "@/lib/subscription-display";
import { loadRenewalOfferSuppression } from "@/lib/billing-cadence";
import { isPaidTier } from "@/lib/free-tier";

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
 *     renewal_offer_suppressed: boolean, // true when any active plan renews by
 *                                        // itself or its cadence is unknown;
 *                                        // read by RenewalPrompt (i-MP-TRUTH-19)
 *     subscription?: {
 *       id: string,
 *       tier: string,
 *       tier_human_name: string,
 *       tier_human_name_de: string,
 *       status: string,
 *       started_at: string,
 *       expires_at: string | null,    // REAL access end = users.tier_expires_at
 *                                     // (null if access has no expiry). Falls
 *                                     // back to the subscription row only when
 *                                     // the users read fails (W2-DB1, 2026-10-10)
 *       expires_at_source: "access" | "subscription",
 *       subscription_expires_at: string | null, // raw subscriptions.expires_at
 *       days_remaining: number | null,   // from expires_at; null if no expiry
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

    // Fail closed: if the cadence read fails, never offer a second plan.
    let renewalOfferSuppressed = true;
    try {
      renewalOfferSuppressed = (await loadRenewalOfferSuppression(sb, userId)).suppressed;
    } catch (cadenceError) {
      captureServerError(cadenceError, {
        route: "/api/user/subscription",
        userId,
        step: "renewal_cadence_lookup",
      });
    }

    if (!sub) {
      return NextResponse.json({ active: false, renewal_offer_suppressed: renewalOfferSuppressed });
    }

    // Report the date access really ends. users.tier_expires_at is what the
    // paywall checks (isPaidTier); a subscriptions row can lag it, e.g. after
    // a renewal or a manual grant extended access (seen live: row said
    // 17 Oct, access ran to 17 Nov). Fall back to the row only if the users
    // read fails, and say so in expires_at_source.
    let accessExpiresAt: string | null = sub.expires_at;
    let expiresAtSource: "access" | "subscription" = "subscription";
    let accessEnded = false;
    const { data: accessRow, error: accessError } = await sb
      .from("users")
      .select("tier, tier_expires_at")
      .eq("id", userId)
      .maybeSingle();
    if (accessError) {
      captureServerError(accessError, {
        route: "/api/user/subscription",
        userId,
        step: "access_expiry_lookup",
      });
    } else if (accessRow) {
      const access = accessRow as { tier: string | null; tier_expires_at: string | null };
      accessExpiresAt = access.tier_expires_at ?? null;
      expiresAtSource = "access";
      // R2-09: a stale "active" subscriptions row for a user the paywall already
      // treats as free (downgrade cleared tier_expires_at) must not read as
      // "no expiry". Report access as ended: expiry = the row's date, 0 days.
      if (!isPaidTier(access.tier, access.tier_expires_at)) {
        accessExpiresAt = access.tier_expires_at ?? sub.expires_at ?? new Date().toISOString();
        accessEnded = true;
      }
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
    if (accessExpiresAt) {
      const msRemaining = new Date(accessExpiresAt).getTime() - Date.now();
      daysRemaining = Number.isFinite(msRemaining)
        ? Math.max(0, Math.ceil(msRemaining / 86_400_000))
        : null;
    }
    if (accessEnded) daysRemaining = 0;

    return NextResponse.json({
      active: true,
      renewal_offer_suppressed: renewalOfferSuppressed,
      subscription: {
        id: sub.id,
        tier: tierKey,
        tier_human_name: displayNames.humanName,
        tier_human_name_de: displayNames.humanNameDe,
        status: sub.status,
        started_at: sub.started_at,
        expires_at: accessExpiresAt,
        expires_at_source: expiresAtSource,
        subscription_expires_at: sub.expires_at,
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
