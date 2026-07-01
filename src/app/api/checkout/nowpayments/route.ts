import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import {
  TIERS,
  createNowpaymentsInvoice,
  type TierDefinition,
} from "@/lib/nowpayments";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 5 checkout attempts per 10 minutes per user. Above this you're either
// burning through real money (NOWPayments creates real invoices for
// each call) or probing our endpoint. Either way, block.
const CHECKOUT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

/**
 * POST /api/checkout/nowpayments
 *
 * Creates a NOWPayments hosted-invoice for the authenticated user
 * and returns the invoice_url so the client can redirect.
 *
 * Body:
 *   { tier: 'premium_pass_guaranteed' }  // June 26 Cohort, €114/6mo
 *
 * "founders" is NOT a valid tier id anymore (retired April 23, 2026 —
 * see April 23 strategy locks in context/LAUNCH-BRIEF.md).
 *
 * Response (200):
 *   { ok: true, invoice_url: 'https://nowpayments.io/payment/?iid=…', subscriptionId }
 *
 * Errors:
 *   400 — unknown or unavailable tier
 *   401 — no x-user-id header
 *   500 — NOWPayments upstream failure (logged to Sentry)
 *
 * The request creates a `subscriptions` row with status='pending'
 * BEFORE hitting NOWPayments — that way, if NOWPayments is slow, we
 * still have a reservation in our DB. On NOWPayments failure we
 * mark the row 'failed' and return 502.
 *
 * The order_id we hand to NOWPayments IS our subscriptions.id uuid.
 * That uniquely ties the eventual IPN callback back to the exact
 * subscription row.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  const gate = checkRateLimit({
    key: rateKey("checkout", userId),
    ...CHECKOUT_RATE_LIMIT,
  });
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: "Too many checkout attempts, please wait before trying again",
        retryAfter: gate.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(gate, CHECKOUT_RATE_LIMIT) }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const tierKey = String(body?.tier || "").toLowerCase();

    const tier: TierDefinition | undefined = TIERS[tierKey];
    if (!tier) {
      return NextResponse.json(
        { error: "Unknown tier" },
        { status: 400 }
      );
    }
    if (!tier.available) {
      return NextResponse.json(
        {
          error: "Tier not available for checkout yet",
          hint: "Only the Exam Cohort (premium_pass_guaranteed), the 3-month starter (first_3mo_27), and the single-month fallback (first_month_19) are live on crypto rails right now. The four always-on tiers light up when Stripe Atlas clears.",
        },
        { status: 400 }
      );
    }

    // Anti-cannibalization cap on the €27 / 3-month entry tier
    // (Integrator decision 2026-04-28 + manager 2026-04-28).
    //
    // Each user can buy `first_3mo_27` ONCE. We block when the user
    // already has a confirmed (started_at IS NOT NULL) row on this
    // tier — pending/failed rows are fine, the user should be able to
    // retry a NOWPayments timeout. Without this cap, a user could
    // park indefinitely at €9-effective/month and erode Cohort sales.
    //
    // Done BEFORE the pending-subscription insert so we don't pollute
    // the table with rows that will never be paid.
    const sb = getServiceClient();
    if (tier.id === "first_3mo_27") {
      const { data: priorEntries, error: priorErr } = await sb
        .from("subscriptions")
        .select("id, status, started_at, expires_at")
        .eq("user_id", userId)
        .eq("tier", "first_3mo_27")
        .not("started_at", "is", null)
        .limit(1);

      if (priorErr) {
        console.error(
          "[checkout/nowpayments] eligibility lookup failed",
          priorErr
        );
        Sentry.captureException(priorErr, {
          tags: {
            route: "checkout/nowpayments",
            step: "first_3mo_27_eligibility",
          },
        });
        return NextResponse.json(
          { error: "Could not verify entry-tier eligibility" },
          { status: 500 }
        );
      }
      if (priorEntries && priorEntries.length > 0) {
        return NextResponse.json(
          {
            error: "ENTRY_TIER_ALREADY_USED",
            message_de:
              "Du hast den 3-Monats-Einstieg bereits genutzt. Wähle die Prüfungs-Kohorte (114 €, 6 Monate) oder den Einzelmonat (19 €).",
            message_en:
              "You've already used the 3-month starter. Pick the Exam Cohort (114 €, 6 months) or the single-month fallback (19 €).",
            next_options: ["premium_pass_guaranteed", "first_month_19"],
          },
          { status: 400 }
        );
      }
    }

    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey) {
      // Fail loudly in logs but return a generic message to the
      // client — the user doesn't need to know our env config.
      console.error(
        "[checkout/nowpayments] NOWPAYMENTS_API_KEY missing"
      );
      Sentry.captureMessage(
        "NOWPAYMENTS_API_KEY not configured — checkout unavailable",
        "error"
      );
      return NextResponse.json(
        { error: "Checkout temporarily unavailable" },
        { status: 503 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
    const ipnCallbackUrl = `${siteUrl}/api/webhooks/nowpayments`;
    // Lands on the authenticated home page with a cohort welcome flag.
    // `src/app/page.tsx` still accepts `welcome=founder` as a legacy
    // alias so older NOWPayments invoices keep working.
    const successUrl = `${siteUrl}/?welcome=cohort`;
    const cancelUrl = `${siteUrl}/pricing?cancelled=true`;

    // 1. Insert the pending subscription row FIRST — so that even if
    //    NOWPayments latency stretches, the IPN webhook will have
    //    a row to match against by `order_id = subscription.id`.
    //    (`sb` already initialised above for the eligibility check.)
    const { data: sub, error: insertErr } = await sb
      .from("subscriptions")
      .insert({
        user_id: userId,
        tier: tier.id,
        status: "pending",
        payment_provider: "nowpayments",
        payment_method: "crypto",
        amount_cents: tier.priceCents,
        currency: tier.currency,
      })
      .select("id")
      .single();

    if (insertErr || !sub) {
      console.error("[checkout/nowpayments] DB insert failed", insertErr);
      Sentry.captureException(insertErr, {
        tags: { route: "checkout/nowpayments", step: "insert" },
      });
      return NextResponse.json(
        { error: "Failed to create subscription" },
        { status: 500 }
      );
    }

    // 2. Call NOWPayments to create the hosted invoice.
    //
    // We force `pay_currency='usdttrc20'` (Tether on Tron — fastest,
    // cheapest network) and `is_fixed_rate=true` so the trust dialog
    // can quote the exact USDT amount the user will see on NOWPayments
    // without any "rate may change" disclaimer. The order_description
    // includes "([name])" so the user sees our parent legal entity
    // in the NOWPayments invoice header.
    let invoice;
    try {
      invoice = await createNowpaymentsInvoice(
        {
          priceAmount: tier.priceCents / 100,
          priceCurrency: tier.currency,
          orderId: sub.id,
          orderDescription: `MedPrüf ([name]): ${tier.humanName}, paid access`,
          ipnCallbackUrl,
          successUrl,
          cancelUrl,
          payCurrency: "usdttrc20",
          isFixedRate: true,
        },
        apiKey
      );
    } catch (err) {
      // Mark the subscription as failed so we don't have dangling
      // "pending" rows cluttering the admin dashboard.
      await sb
        .from("subscriptions")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", sub.id);

      console.error("[checkout/nowpayments] NOWPayments invoice failed", err);
      Sentry.captureException(err, {
        tags: { route: "checkout/nowpayments", step: "nowpayments_invoice" },
        extra: { subscriptionId: sub.id, userId, tier: tier.id },
      });
      return NextResponse.json(
        { error: "Payment provider unavailable, please try again" },
        { status: 502 }
      );
    }

    // 3. Stamp provider_invoice_id on the subscription row.
    const { error: updateErr } = await sb
      .from("subscriptions")
      .update({
        provider_invoice_id: String(invoice.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    if (updateErr) {
      // Not fatal — the IPN webhook can still match by order_id,
      // but log it so we notice provider_invoice_id going stale.
      console.error(
        "[checkout/nowpayments] failed to stamp provider_invoice_id",
        updateErr
      );
      Sentry.captureException(updateErr, {
        tags: { route: "checkout/nowpayments", step: "stamp_invoice_id" },
        extra: {
          subscriptionId: sub.id,
          invoiceId: String(invoice.id),
        },
      });
    }

    // 4. Telemetry.
    await recordEvent(userId, "nowpayments_invoice_created", {
      tier: tier.id,
      amount_cents: tier.priceCents,
      subscription_id: sub.id,
      invoice_id: String(invoice.id),
    });

    return NextResponse.json({
      ok: true,
      invoice_url: invoice.invoice_url,
      subscriptionId: sub.id,
    });
  } catch (err) {
    console.error("[checkout/nowpayments] unexpected", err);
    Sentry.captureException(err, {
      tags: { route: "checkout/nowpayments", step: "unexpected" },
    });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Server-side telemetry helper. We write directly to `user_events`
 * because the client-side `trackEvent` helper in src/lib/tracker.ts
 * only runs in the browser. Silently swallow failures — telemetry
 * must never block a checkout.
 */
async function recordEvent(
  userId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const sb = getServiceClient();
    await sb.from("user_events").insert({
      user_id: userId,
      event_type: eventType,
      event_data: data,
    });
  } catch (err) {
    console.error(`[recordEvent:${eventType}]`, err);
  }
}
