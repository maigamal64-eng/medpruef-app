import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import {
  verifyWhopSignature,
  whopPlanToTier,
  tierDurationMonths,
  isKnownTier,
  computeExpiry,
  extractWhopPayment,
  TIERS,
} from "@/lib/whop";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/whop
 *
 * Whop IPN (Standard Webhooks). Grants MedPrüf Pro access when a card
 * payment succeeds. Built to mirror the HARDENED NOWPayments webhook so
 * it carries today's lessons:
 *   - verify signature first (svix scheme, WHOP_WEBHOOK_SECRET)
 *   - grant ONLY on payment.succeeded (the reliable money signal); ack
 *     all other events 200 so Whop stops retrying them
 *   - idempotency claim on processed_webhook_events(provider='whop',
 *     event_id=payment_id) at the GRANT step → a payment can't grant twice
 *     and Whop's at-least-once retries dedupe cleanly
 *   - map buyer→user via metadata.medpruef_user_id, else email
 *   - an unmapped payment (concierge link w/o metadata, email mismatch,
 *     or unrecognised plan) is recorded + Sentry-flagged for MANUAL grant,
 *     never silently dropped
 *
 * NOTE (go-live): confirm the exact event name + payload field names from
 * a real delivery (Whop dashboard "resend" or the first €1 test) and the
 * authoritative event enum returned by the webhook-create call.
 */
export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "read_body" } });
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    Sentry.captureMessage("WHOP_WEBHOOK_SECRET not set — all Whop webhooks reject", "error");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const valid = verifyWhopSignature(
    rawBody,
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    secret
  );
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whop carries the event name in `action` (current) or `type` (older).
  const event =
    (typeof payload.action === "string" && payload.action) ||
    (typeof payload.type === "string" && payload.type) ||
    "";
  const data = payload.data ?? payload;

  // Grant ONLY on the money signal; acknowledge everything else.
  if (event !== "payment.succeeded" && event !== "payment_succeeded") {
    return NextResponse.json({ ok: true, ignored: event || "unknown" });
  }

  try {
    const f = extractWhopPayment(data);
    if (!f.paymentId) {
      return NextResponse.json({ ok: false, error: "no payment id" }, { status: 200 });
    }

    const sb = getServiceClient();

    // Idempotency claim — first delivery wins; retries / multi-event dup.
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "whop",
        event_id: f.paymentId,
        payload: { claimed_at: new Date().toISOString(), event },
      })
      .select("event_id")
      .maybeSingle();

    if (claimErr) {
      if ((claimErr as { code?: string }).code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      Sentry.captureException(claimErr, { tags: { route: "webhooks/whop", step: "claim" } });
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!claim) return NextResponse.json({ ok: true, duplicate: true });

    // Resolve tier: plan id → tier, else metadata.tier if recognised.
    const tier = whopPlanToTier(f.planId) ?? (isKnownTier(f.metaTier) ? f.metaTier : null);

    // Resolve user: metadata user id first, then email (case-insensitive).
    let userId: string | null = null;
    if (f.metaUserId) {
      const { data: u } = await sb.from("users").select("id").eq("id", f.metaUserId).maybeSingle();
      userId = (u?.id as string | undefined) ?? null;
    }
    if (!userId && f.email) {
      const { data: u } = await sb.from("users").select("id").ilike("email", f.email).maybeSingle();
      userId = (u?.id as string | undefined) ?? null;
    }

    if (!userId || !tier) {
      // Don't drop it — flag for manual grant + record telemetry.
      Sentry.captureMessage(
        `Whop payment unmapped, manual grant needed: payment=${f.paymentId} plan=${f.planId} email=${f.email} tier=${tier}`,
        "warning"
      );
      await recordEvent(sb, userId, "whop_payment_unmapped", {
        payment_id: f.paymentId,
        plan_id: f.planId,
        email: f.email,
        tier,
        event,
      });
      return NextResponse.json(
        { ok: false, error: "unmapped — needs manual grant", payment_id: f.paymentId },
        { status: 200 }
      );
    }

    const expiresAt = computeExpiry(tierDurationMonths(tier), new Date());

    const { error: subErr } = await sb.from("subscriptions").insert({
      user_id: userId,
      tier,
      status: "active",
      payment_provider: "whop",
      payment_method: "card",
      amount_cents: f.amountCents ?? TIERS[tier]?.priceCents ?? null,
      currency: (f.currency || "eur").toUpperCase(),
      provider_payment_id: f.paymentId,
      started_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    });
    if (subErr) {
      Sentry.captureException(subErr, {
        tags: { route: "webhooks/whop", step: "sub_insert" },
        extra: { userId, tier },
      });
      return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
    }

    const { error: userErr } = await sb
      .from("users")
      .update({
        tier: "pro",
        tier_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (userErr) {
      // Subscription row is the source of truth; user.tier reconciles offline.
      Sentry.captureException(userErr, {
        tags: { route: "webhooks/whop", step: "user_update" },
        extra: { userId },
      });
    }

    await recordEvent(sb, userId, "whop_subscription_activated", {
      payment_id: f.paymentId,
      tier,
      expires_at: expiresAt.toISOString(),
    });

    return NextResponse.json({ ok: true, activated: true, tier, expires_at: expiresAt.toISOString() });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "unexpected" } });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function recordEvent(
  sb: ReturnType<typeof getServiceClient>,
  userId: string | null,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await sb.from("user_events").insert({ user_id: userId, event_type: eventType, event_data: data });
  } catch (err) {
    console.error(`[recordEvent:${eventType}]`, err);
  }
}
