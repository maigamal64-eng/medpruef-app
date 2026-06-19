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

  // A delivery that carries svix headers is a genuine Whop attempt; one that
  // fails verification anyway is almost certainly a secret/scheme mismatch
  // (not random noise). Flag THAT loudly so a real payment can never fail
  // auth silently — the only signature-scheme risk we can't pre-verify
  // without a live delivery. (advisor 2026-06-19)
  const looksLikeWhopDelivery = Boolean(
    req.headers.get("webhook-id") && req.headers.get("webhook-signature")
  );
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
    if (looksLikeWhopDelivery) {
      Sentry.captureMessage(
        "Whop webhook carried svix headers but FAILED signature verification — likely WHOP_WEBHOOK_SECRET / scheme mismatch; payments will not auto-grant",
        "error"
      );
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whop v2 webhooks (api_version v2, confirmed on hook_zTfkVa4aTR7mJ) carry
  // the event name in `action`; `type` is the older fallback.
  const event =
    (typeof payload.action === "string" && payload.action) ||
    (typeof payload.type === "string" && payload.type) ||
    "";
  const data = payload.data ?? payload;
  const f = extractWhopPayment(data);

  // Log EVERY accepted delivery so the first real one self-documents Whop's
  // envelope in the runtime logs without leaking the body. (advisor 2026-06-19)
  console.info(`[whop webhook] event=${event || "(none)"} paymentId=${f.paymentId ?? "(none)"}`);

  // The hook is subscribed only to payment.succeeded; these are the names we
  // recognise as the money signal.
  const SUCCESS_EVENTS = new Set(["payment.succeeded", "payment_succeeded"]);
  // Payment-related events we intentionally never grant on (defense-in-depth;
  // not currently subscribed). Quietly acked so Whop stops retrying.
  const KNOWN_NONGRANT = new Set([
    "payment.failed", "payment_failed", "payment.pending", "payment_pending",
    "payment.created", "payment_created", "refund.created", "refund.updated",
    "dispute.created", "dispute.updated", "dispute_alert.created",
  ]);

  if (!SUCCESS_EVENTS.has(event)) {
    // A non-success event that STILL carries a payment id and isn't a known
    // non-grant type means our envelope/name assumption may be wrong. Never
    // silently ack that — record + Sentry-flag so a mis-shaped success can't
    // cost a buyer without an alert. (advisor 2026-06-19)
    if (f.paymentId && !KNOWN_NONGRANT.has(event)) {
      Sentry.captureMessage(
        `Whop sent an unrecognized payment-bearing event '${event}' (payment=${f.paymentId}) — verify the grant logic; a real buyer may be unprocessed`,
        "warning"
      );
      try {
        await recordEvent(getServiceClient(), null, "whop_unrecognized_payment_event", {
          event, payment_id: f.paymentId, plan_id: f.planId, email: f.email,
        });
      } catch {
        /* best effort */
      }
    }
    return NextResponse.json({ ok: true, ignored: event || "unknown" });
  }

  try {
    if (!f.paymentId) {
      // A success event with no extractable payment id = we got the money
      // signal but can't process it. That is loud, not a quiet 200.
      Sentry.captureMessage(
        "Whop payment.succeeded with no extractable payment id — payload shape changed",
        "error"
      );
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

    // Resolve tier: metadata.tier is PRIMARY (the v1 payment payload often
    // omits plan_id); plan-id → tier is only a fallback.
    const tier = (isKnownTier(f.metaTier) ? f.metaTier : null) ?? whopPlanToTier(f.planId);

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
