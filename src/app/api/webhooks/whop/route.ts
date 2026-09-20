import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { logWebhookAttempt } from "@/lib/webhook-logger";
import { logPaymentEvent } from "@/lib/paymentEvents";
import {
  referralPayoutCents,
  REFERRAL_ANNUAL_CAP_CENTS,
} from "@/lib/nowpayments";
import {
  qualifyReferralOnActivity,
  isReferralExamRewardEnabled,
} from "@/lib/referral-exam-reward";
import {
  verifyWhopSecretHeader,
  verifyWhopSignature,
  whopPlanToTier,
  tierDurationMonths,
  isKnownTier,
  computeExpiry,
  extractWhopPayment,
  classifyWhopRevoke,
  extractWhopRevoke,
  type WhopRevokeKind,
  TIERS,
} from "@/lib/whop";
import {
  extendOrInsertWhopSubscription,
  reconcileUserTierPro,
} from "@/lib/whop-grant";
import { sendZohoEmail } from "@/lib/email/zoho";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/whop
 *
 * Whop IPN (Standard Webhooks). Grants MedPrüf Pro access when a card
 * payment succeeds, AND revokes it when the money is taken back. Built to
 * mirror the HARDENED NOWPayments webhook so it carries today's lessons:
 *   - verify signature first (svix scheme, WHOP_WEBHOOK_SECRET)
 *   - grant ONLY on payment.succeeded (the reliable money signal); ack
 *     all other events 200 so Whop stops retrying them
 *   - REVOKE on refund.created / dispute.created / membership.deactivated
 *     (B-08 revenue-leak fix): flip the subscription to refunded/cancelled,
 *     drop the user to free if they have no OTHER active sub, and — ONLY on a
 *     refund-class revoke (refund/chargeback/dispute) — reverse the referrer's
 *     reward earned off this referee's purchase. A voluntary cancel / benign
 *     expiry (membership.deactivated) revokes access but the referrer KEEPS
 *     their credit ([name]'s rule 2026-06-23).
 *   - idempotency claim on processed_webhook_events(provider='whop',
 *     event_id=payment_id) at the GRANT step → a payment can't grant twice
 *     and Whop's at-least-once retries dedupe cleanly. The REVOKE path uses
 *     a NAMESPACED event_id (refund:/dispute:/cancel:<id>) so a refund of
 *     pay_X never collides with the grant claim keyed on pay_X.
 *   - map buyer→user via metadata.medpruef_user_id, else email
 *   - an unmapped payment (concierge link w/o metadata, email mismatch,
 *     or unrecognised plan) is recorded + Sentry-flagged for MANUAL grant,
 *     never silently dropped; an unmatched REVOKE is likewise loud, not a
 *     quiet 200
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

  // Service client (hoisted) — the funnel logger writes at every exit, incl.
  // the pre-verify rejections that are the silent-grant-failure smoking gun.
  const sbLog = getServiceClient();

  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    Sentry.captureMessage("WHOP_WEBHOOK_SECRET not set — all Whop webhooks reject", "error");
    // Record the delivery BEFORE returning: "received but secret unconfigured"
    // is exactly the state that silently 503s every real payment. Loud, not lost.
    await logWebhookAttempt({
      req,
      provider: "whop",
      path: "/api/webhooks/whop",
      signatureValid: null,
      body: rawBody,
      result: "other_error",
      error: "WHOP_WEBHOOK_SECRET not configured",
    });
    await logPaymentEvent(sbLog, {
      event: "webhook_received",
      signatureValid: null,
      reason: "signature_invalid",
      metadata: { ok: false, cause: "secret_not_configured", status: 503 },
    });
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  // A delivery that carries svix headers is a genuine Whop attempt; one that
  // fails verification anyway is almost certainly a secret/scheme mismatch
  // (not random noise). Flag THAT loudly so a real payment can never fail
  // auth silently — the only signature-scheme risk we can't pre-verify
  // without a live delivery. (advisor 2026-06-19)
  // Whop v2 dashboard webhooks authenticate by sending the configured secret in
  // a `webhook-secret` header (confirmed against a real delivery 2026-06-19 — no
  // svix headers were present). Verify that first; fall back to the HMAC scheme
  // if a delivery ever carries svix headers instead.
  // WAVE 2 (2026-09-20): the v1 Standard-Webhooks hook (hook on api_version v1,
  // svix-signed) sends NO webhook-secret header. Its deliveries verify against
  // WHOP_WEBHOOK_SECRET_V1 via the Standard Webhooks scheme. Both secrets are
  // tried during the migration window (both hooks live); after the legacy hook
  // is disabled, WHOP_WEBHOOK_SECRET is retired.
  const secretHeader = req.headers.get("webhook-secret");
  const looksLikeWhopDelivery = Boolean(secretHeader || req.headers.get("webhook-signature"));
  const v1Secret = process.env.WHOP_WEBHOOK_SECRET_V1;
  const valid =
    verifyWhopSecretHeader(secretHeader, secret) ||
    verifyWhopSignature(
      rawBody,
      {
        id: req.headers.get("webhook-id"),
        timestamp: req.headers.get("webhook-timestamp"),
        signature: req.headers.get("webhook-signature"),
      },
      secret
    ) ||
    (v1Secret
      ? verifyWhopSignature(
          rawBody,
          {
            id: req.headers.get("webhook-id"),
            timestamp: req.headers.get("webhook-timestamp"),
            signature: req.headers.get("webhook-signature"),
          },
          v1Secret
        )
      : false);
  if (!valid) {
    // A delivery that carries a webhook-secret (or svix) header but still fails
    // verification is almost certainly a WHOP_WEBHOOK_SECRET mismatch, not noise
    // — flag it loudly so a real payment can never fail auth silently.
    if (looksLikeWhopDelivery) {
      Sentry.captureMessage(
        "Whop webhook carried a webhook-secret/svix header but FAILED verification — likely WHOP_WEBHOOK_SECRET(_V1) mismatch; payments will not auto-grant",
        "error"
      );
    }
    // Record the rejected delivery in BOTH the delivery-truth table and the
    // funnel feed. "N received · N sig_invalid" with grants=0 is the exact
    // signature of a secret mismatch — the headline alarm on /admin/payments.
    // We have no parsed event name here (verify runs on the raw body pre-parse);
    // that's fine — "a delivery was signature-rejected" is the load-bearing fact.
    await logWebhookAttempt({
      req,
      provider: "whop",
      path: "/api/webhooks/whop",
      signatureValid: false,
      body: rawBody,
      result: "sig_invalid",
      error: looksLikeWhopDelivery
        ? "verification failed despite webhook-secret/svix header (likely WHOP_WEBHOOK_SECRET mismatch)"
        : "no recognized auth header",
    });
    await logPaymentEvent(sbLog, {
      event: "webhook_received",
      signatureValid: false,
      matched: false,
      reason: "signature_invalid",
      metadata: {
        ok: false,
        had_secret_header: Boolean(secretHeader),
        looks_like_whop_delivery: looksLikeWhopDelivery,
        status: 401,
      },
    });
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

  // FUNNEL: record EVERY signature-verified delivery once, here, before the
  // revoke/grant branches diverge. `matched` reflects whether the payload
  // carried a buyer reference (metadata user id / email) so the feed can flag
  // a delivery we received but couldn't tie to a user. The delivery-truth row
  // in webhook_attempts is written by the specific exit branch below (processed
  // / dup / user_not_found), mirroring the nowpayments per-exit discipline.
  await logPaymentEvent(sbLog, {
    event: "webhook_received",
    provider: "whop",
    userId: null, // not yet resolved; grant_succeeded/grant_failed carry the user
    email: f.email,
    tier: isKnownTier(f.metaTier) ? f.metaTier : null,
    planId: f.planId,
    paymentId: f.paymentId,
    amountCents: f.amountCents,
    currency: f.currency,
    signatureValid: true,
    matched: Boolean(f.metaUserId || f.email),
    metadata: { event: event || "(none)", whop_event: event },
  });

  // ── REVOKE PATH (B-08): refund / chargeback / cancellation ──
  // Handled BEFORE the grant gate. A refund/dispute reverses money →
  // 'refunded'; a membership deactivation → 'cancelled'. Self-contained in
  // handleRevoke (its own idempotency claim + Sentry-on-anomaly), so it can
  // never interfere with the grant path below.
  const revokeKind = classifyWhopRevoke(event);
  if (revokeKind) {
    return handleRevoke(event, revokeKind, data);
  }

  // ── DUNNING PATH (Wave 2, 2026-09-20): failed renewal / 3DS recovery ──
  // Whop emits payment.requires_action when the bank wants the buyer to
  // verify an off-session charge (3D Secure) and payment.failed when a
  // charge fails; BOTH may carry data.recovery_url — a Whop link where the
  // buyer signs in and completes verification, resuming the exact charge.
  // Action: record + email the buyer the link (best-effort). A recovered
  // payment re-fires payment.succeeded and the normal grant path runs.
  const RECOVERY_EVENTS = new Set([
    "payment.failed", "payment_failed",
    "payment.requires_action", "payment_requires_action",
  ]);
  if (RECOVERY_EVENTS.has(event)) {
    return handlePaymentRecovery(event, data, f);
  }

  // ── TRIAL-ENDING PATH (Wave 2): Whop's native reminder for the €0→€19
  // card trial. Fires on the trial plan membership before the first
  // renewal charge. Action: one honest reminder email (trial ending, the
  // 19 €/month auto-charge, how to cancel), deduped per membership.
  const TRIAL_ENDING_EVENTS = new Set([
    "membership.trial_ending_soon", "membership_trial_ending_soon",
  ]);
  if (TRIAL_ENDING_EVENTS.has(event)) {
    return handleTrialEndingSoon(event, data, f);
  }

  // The hook is subscribed only to payment.succeeded; these are the names we
  // recognise as the money signal.
  const SUCCESS_EVENTS = new Set(["payment.succeeded", "payment_succeeded"]);
  // Payment-related events we intentionally never grant on (defense-in-depth;
  // not currently subscribed). Quietly acked so Whop stops retrying. Refund /
  // dispute / membership-deactivation are NOT here — they are actively handled
  // by the revoke path above.
  const KNOWN_NONGRANT = new Set([
    "payment.failed", "payment_failed", "payment.pending", "payment_pending",
    "payment.created", "payment_created",
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
      // FUNNEL: a payment-bearing event we didn't grant on — a real buyer may
      // be unprocessed, so this is a grant_failed with a named reason.
      await logPaymentEvent(sbLog, {
        event: "grant_failed",
        email: f.email,
        planId: f.planId,
        paymentId: f.paymentId,
        reason: "unrecognized_event",
        metadata: { event, ok: false },
      });
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
      await logWebhookAttempt({
        req, provider: "whop", path: "/api/webhooks/whop",
        signatureValid: true, body: rawBody, result: "other_error",
        error: "payment.succeeded with no extractable payment id",
      });
      await logPaymentEvent(sbLog, {
        event: "grant_failed",
        email: f.email,
        reason: "no_payment_id",
        metadata: { event, ok: false },
      });
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
        await logWebhookAttempt({
          req, provider: "whop", path: "/api/webhooks/whop",
          signatureValid: true, body: rawBody, result: "dup", eventId: f.paymentId,
        });
        return NextResponse.json({ ok: true, duplicate: true });
      }
      Sentry.captureException(claimErr, { tags: { route: "webhooks/whop", step: "claim" } });
      await logWebhookAttempt({
        req, provider: "whop", path: "/api/webhooks/whop",
        signatureValid: true, body: rawBody, result: "other_error",
        error: `idempotency claim failed: ${claimErr.message?.slice(0, 150)}`,
        eventId: f.paymentId,
      });
      await logPaymentEvent(sbLog, {
        event: "grant_failed", email: f.email, paymentId: f.paymentId,
        reason: "db_error", metadata: { step: "claim", event, ok: false },
      });
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!claim) {
      await logWebhookAttempt({
        req, provider: "whop", path: "/api/webhooks/whop",
        signatureValid: true, body: rawBody, result: "dup", eventId: f.paymentId,
      });
      return NextResponse.json({ ok: true, duplicate: true });
    }

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
      const { data: u } = await sb
        .from("users")
        .select("id")
        .ilike("email", escapeLike(f.email))
        .maybeSingle();
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
      // FUNNEL + delivery truth: money signal received, but we could not tie it
      // to a user OR a tier → manual grant needed. The most expensive silent
      // failure; recorded loudly with the payment id as the grant key.
      await logWebhookAttempt({
        req, provider: "whop", path: "/api/webhooks/whop",
        signatureValid: true, body: rawBody, result: "user_not_found",
        eventId: f.paymentId,
        error: `unmapped: user=${userId ?? "none"} tier=${tier ?? "none"}`,
      });
      await logPaymentEvent(sbLog, {
        event: "grant_failed",
        userId,
        email: f.email,
        tier: tier ?? null,
        planId: f.planId,
        paymentId: f.paymentId,
        amountCents: f.amountCents,
        currency: f.currency,
        reason: "unmapped",
        matched: Boolean(userId),
        metadata: {
          event,
          ok: false,
          missing: !userId && !tier ? "user_and_tier" : !userId ? "user" : "tier",
        },
      });
      return NextResponse.json(
        { ok: false, error: "unmapped — needs manual grant", payment_id: f.paymentId },
        { status: 200 }
      );
    }

    // FB-03 (2026-07-01, money/access-leak fix): the €0 trial START must grant
    // only the ~8-day trial window, NOT a full month. The trial plan
    // (plan_redactedec56d4df) is a RENEWAL plan: trial_period_days=7, initial
    // charge €0, then €19/month. Whop fires `payment.succeeded` at trial start
    // with amount 0 (confirmed on the real delivery pay_redacted8cdd2725 —
    // amount_cents=0, tier=notes_pro_trial), and again on each €19 renewal with
    // a positive amount. Detect the start by tier + a €0/absent amount so a user
    // who cancels mid-trial loses Pro in ~a week, not a month; a real €19 renewal
    // carries a positive amount → falls through to the +1-month extension (today's
    // behavior, unchanged). 8 days == trial/verify's `trialDays + 1` floor, so the
    // two grant paths converge on the same window instead of racing (FB-03).
    // ONLY notes_pro_trial is gated here; the one-time paid tiers (first_month_19
    // / first_3mo_27 / premium_pass_guaranteed) always carry a positive amount and
    // are never this tier, so they keep their full computeExpiry duration. The
    // membership.went_invalid revoke path (already in handleRevoke) is the
    // suspenders for an instant cancel-revoke; this 8-day cap is the belt.
    const isTrialStart =
      tier === "notes_pro_trial" && (f.amountCents === 0 || f.amountCents == null);
    // For trial START the window is 8 days (trial + 1). For paid/renewal
    // grants the helper recomputes the expiry (extend-or-insert), so this
    // default is only consumed by the trial-start branch below.
    let expiresAt = isTrialStart
      ? new Date(Date.now() + 8 * 86400_000)
      : computeExpiry(tierDurationMonths(tier), new Date());
    let grantMode: "extended" | "inserted" | null = null;
    let grantPreviousExpires: string | null = null;

    // Dedupe the trial-START grant against /api/whop/trial/verify (P1). Both the
    // €0 payment.succeeded (here) and the /checkout/success verify grant the
    // trial, keyed on different ids (payment id vs membership id), so a
    // verify-first ordering would otherwise leave TWO active notes_pro_trial
    // rows. If an active trial sub already exists at trial start, verify already
    // granted: skip the duplicate insert, ensure tier=pro, and ack. Renewals
    // (isTrialStart=false) are unaffected and always insert/extend.
    if (isTrialStart) {
      const { data: existingTrial } = await sb
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("tier", "notes_pro_trial")
        .eq("status", "active")
        .limit(1);
      if (existingTrial && existingTrial.length > 0) {
        await sb
          .from("users")
          .update({ tier: "pro", updated_at: new Date().toISOString() })
          .eq("id", userId)
          .neq("tier", "admin");
        await recordEvent(sb, userId, "whop_trial_grant_deduped", {
          payment_id: f.paymentId,
          existing_subscription_id: (existingTrial[0] as { id: string }).id,
        });
        await logPaymentEvent(sbLog, {
          event: "grant_succeeded",
          userId,
          email: f.email,
          tier,
          planId: f.planId,
          paymentId: f.paymentId,
          amountCents: f.amountCents ?? 0,
          currency: (f.currency || "eur").toUpperCase(),
          matched: true,
          metadata: { event, dedup: "verify_already_granted", ok: true },
        });
        return NextResponse.json({ ok: true, activated: true, deduped: true, tier });
      }
    }

    // ── Grant: trial-START keeps its dedicated 8-day insert (FB-03 window,
    // deduped against /api/whop/trial/verify above). Everything else — paid
    // one-time tiers AND €19 trial renewals — goes through the shared
    // EXTEND-or-INSERT helper (2026-09-20 Wave 1): a repeat payment extends
    // the user's active whop window instead of stacking a row and resetting
    // the clock (the 805082ec double-payment expiry loss).
    if (isTrialStart) {
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
        await logWebhookAttempt({
          req, provider: "whop", path: "/api/webhooks/whop",
          signatureValid: true, body: rawBody, result: "other_error",
          eventId: f.paymentId,
          error: `subscriptions insert failed: ${subErr.message?.slice(0, 150)}`,
        });
        await logPaymentEvent(sbLog, {
          event: "grant_failed",
          userId,
          email: f.email,
          tier,
          planId: f.planId,
          paymentId: f.paymentId,
          amountCents: f.amountCents,
          currency: f.currency,
          reason: "db_error",
          matched: true,
          metadata: { step: "sub_insert", event, ok: false },
        });
        return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
      }
      // Trial-start user flip: the 8-day window never shortens a longer
      // window (the trial dedupe above means the user had no active trial).
      try {
        await reconcileUserTierPro(sb, userId, expiresAt.toISOString());
      } catch (userErr) {
        Sentry.captureException(userErr, {
          tags: { route: "webhooks/whop", step: "user_update" },
          extra: { userId },
        });
      }
      grantMode = "inserted";
      grantPreviousExpires = null;
    } else {
      const grant = await extendOrInsertWhopSubscription(sb, {
        userId,
        tier,
        paymentId: f.paymentId,
        amountCents: f.amountCents ?? TIERS[tier]?.priceCents ?? null,
        currency: (f.currency || "eur").toUpperCase(),
      });
      if (grant.mode === "failed") {
        Sentry.captureException(new Error(grant.error ?? "grant failed"), {
          tags: { route: "webhooks/whop", step: "sub_extend_or_insert" },
          extra: { userId, tier, paymentId: f.paymentId },
        });
        await logWebhookAttempt({
          req, provider: "whop", path: "/api/webhooks/whop",
          signatureValid: true, body: rawBody, result: "other_error",
          eventId: f.paymentId,
          error: `subscriptions grant failed: ${grant.error?.slice(0, 150)}`,
        });
        await logPaymentEvent(sbLog, {
          event: "grant_failed",
          userId,
          email: f.email,
          tier,
          planId: f.planId,
          paymentId: f.paymentId,
          amountCents: f.amountCents,
          currency: f.currency,
          reason: "db_error",
          matched: true,
          metadata: { step: "extend_or_insert", event, ok: false },
        });
        return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
      }
      grantMode = grant.mode;
      grantPreviousExpires = grant.previousExpiresAt;
      expiresAt = new Date(grant.expiresAt);
      try {
        await reconcileUserTierPro(sb, userId, grant.expiresAt);
      } catch (userErr) {
        // Subscription row is the source of truth; user.tier reconciles offline.
        Sentry.captureException(userErr, {
          tags: { route: "webhooks/whop", step: "user_update" },
          extra: { userId },
        });
      }
    }

    await recordEvent(sb, userId, "whop_subscription_activated", {
      payment_id: f.paymentId,
      tier,
      expires_at: expiresAt.toISOString(),
    });

    // Qualify any referral earned from this Whop payment. Best-effort —
    // the subscription is already granted; a qualification failure never
    // blocks or retries the webhook response. (Legacy CASH referral
    // program — the function itself now no-ops when the exam-reward
    // program is active, AND additionally scopes its lookup to
    // reward_type='cash' rows as defense-in-depth; see its own header
    // comment for the 2026-07-11 race this closes.)
    await qualifyReferralOnWhopPayment(sb, userId, f.paymentId, tier);

    // Referral exam-reward (2026-07-11): this webhook is the trial-start
    // BACKSTOP grant path (the primary path is /api/whop/trial/verify,
    // called from /checkout/success — see that route's header comment).
    // The subscriptions row just written above IS the card-trial signal
    // (payment_provider='whop', payment_method='card'), so a referee
    // whose activity already cleared the bar should qualify immediately
    // here too, not only via the verify route. Best-effort, never-throw,
    // matches qualifyReferralOnWhopPayment's swallow pattern just above.
    try {
      await qualifyReferralOnActivity(sb, userId);
    } catch (referralErr) {
      console.error("[webhooks/whop] referral exam-reward qualification:", referralErr);
    }

    // FUNNEL: the terminal success. Pro granted on a real card payment — the
    // event /admin/payments leads with when the funnel completes end-to-end.
    await logWebhookAttempt({
      req, provider: "whop", path: "/api/webhooks/whop",
      signatureValid: true, body: rawBody, result: "processed",
      eventId: f.paymentId, subscriptionId: null,
    });
    await logPaymentEvent(sbLog, {
      event: "grant_succeeded",
      userId,
      email: f.email,
      tier,
      planId: f.planId,
      paymentId: f.paymentId,
      amountCents: f.amountCents ?? TIERS[tier]?.priceCents ?? null,
      currency: (f.currency || "eur").toUpperCase(),
      matched: true,
      metadata: {
        event,
        expires_at: expiresAt.toISOString(),
        trial_start: isTrialStart,
        mode: grantMode,
        previous_expires_at: grantPreviousExpires,
        ok: true,
      },
    });

    return NextResponse.json({
      ok: true,
      activated: true,
      tier,
      expires_at: expiresAt.toISOString(),
      mode: grantMode,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "unexpected" } });
    // FUNNEL: an unexpected throw inside the grant try — record it so an
    // exception mid-grant can't vanish into a 500 with no funnel trace.
    await logPaymentEvent(sbLog, {
      event: "grant_failed",
      email: f.email,
      paymentId: f.paymentId,
      reason: "db_error",
      metadata: { step: "unexpected", message: (err as Error)?.message?.slice(0, 200), ok: false },
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * REVOKE handler (B-08 revenue-leak fix).
 *
 * Fired for refund.created / dispute.created / membership.deactivated (+
 * underscore/alias variants — see classifyWhopRevoke). Mirrors the grant
 * path's discipline:
 *   1. Namespaced idempotency claim (refund:/dispute:/cancel:<id>) so a
 *      refund of pay_X is independent of the grant's pay_X claim, but
 *      repeated deliveries of the SAME revoke dedupe.
 *   2. Match the affected whop subscription(s) by provider_payment_id (refund/
 *      dispute) or by the mapped user's active whop sub (membership event).
 *   3. Flip subscription.status → 'refunded' | 'cancelled', stamp cancelled_at.
 *   4. Revoke Pro ONLY if the user has no OTHER active, unexpired subscription.
 *      (Both kinds — refund AND voluntary cancel/expiry — end Pro access.)
 *   5. Reverse the referrer's reward earned off this referee's purchase ONLY on
 *      a refund-class revoke (kind='refunded': refund / chargeback / dispute).
 *      On a voluntary cancel / benign expiry (kind='cancelled') the referrer
 *      KEEPS their credit ([name]'s rule 2026-06-23).
 * An unmatched revoke is Sentry-flagged + recorded (never a silent 200) — a
 * dropped revoke is the exact leak we are closing.
 */
async function handleRevoke(
  event: string,
  kind: WhopRevokeKind,
  data: unknown
): Promise<NextResponse> {
  const r = extractWhopRevoke(data);
  console.info(
    `[whop webhook] REVOKE event=${event} kind=${kind} paymentId=${r.paymentId ?? "(none)"} membershipId=${r.membershipId ?? "(none)"}`
  );

  // A revoke event with NO usable identifier can't be matched to a sub at all.
  // That is loud, not a quiet 200 — the payload shape changed.
  if (!r.eventDedupeId) {
    Sentry.captureMessage(
      `Whop revoke '${event}' carried no usable id (payment/membership) — cannot revoke; payload shape changed`,
      "error"
    );
    return NextResponse.json({ ok: false, error: "no revoke id" }, { status: 200 });
  }

  // Namespace the idempotency key so it can't collide with the grant claim
  // (which is keyed on the bare payment id).
  const claimKey = `${kind === "refunded" ? "refund" : "cancel"}:${r.eventDedupeId}`;

  try {
    const sb = getServiceClient();

    // ── Find the affected whop subscription(s) ── (BEFORE the idempotency
    // claim, deliberately — see nowpayments webhook §intermediate-states.
    // If we can't match a sub yet, we must NOT consume the idempotency key,
    // or a Whop retry after the row exists would dedupe and never revoke.)
    // Refund/dispute: join on provider_payment_id (the grant stored the
    // payment id there). Try the event's payment id first, then the explicit
    // original/parent payment id.
    const paymentCandidates = Array.from(
      new Set([r.paymentId, r.originalPaymentId].filter((x): x is string => Boolean(x)))
    );

    let subs: Array<{ id: string; user_id: string; status: string }> = [];
    if (paymentCandidates.length > 0) {
      const { data: byPay, error: byPayErr } = await sb
        .from("subscriptions")
        .select("id, user_id, status")
        .eq("payment_provider", "whop")
        .in("provider_payment_id", paymentCandidates);
      if (byPayErr) {
        Sentry.captureException(byPayErr, { tags: { route: "webhooks/whop", step: "revoke_sub_lookup" } });
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      subs = (byPay ?? []) as typeof subs;
    }

    // Resolve the affected user. From the matched sub if we have one; else map
    // by metadata user id / email (membership.* events may carry no payment id).
    let userId: string | null = subs[0]?.user_id ?? null;
    if (!userId && r.metaUserId) {
      const { data: u } = await sb.from("users").select("id").eq("id", r.metaUserId).maybeSingle();
      userId = (u?.id as string | undefined) ?? null;
    }
    if (!userId && r.email) {
      const { data: u } = await sb
        .from("users")
        .select("id")
        .ilike("email", escapeLike(r.email))
        .maybeSingle();
      userId = (u?.id as string | undefined) ?? null;
    }

    // If we still matched no sub but DID resolve a user (membership event with
    // no payment id), target that user's active whop subscription(s).
    if (subs.length === 0 && userId) {
      const { data: byUser } = await sb
        .from("subscriptions")
        .select("id, user_id, status")
        .eq("payment_provider", "whop")
        .eq("user_id", userId)
        .eq("status", "active");
      subs = (byUser ?? []) as typeof subs;
    }

    if (subs.length === 0 || !userId) {
      // Nothing to revoke that we can identify. Loud, not silent — record +
      // Sentry so a real refund that we failed to match gets manual attention.
      Sentry.captureMessage(
        `Whop revoke '${event}' matched no whop subscription (paymentCandidates=${paymentCandidates.join(",") || "none"} membership=${r.membershipId ?? "none"} user=${userId ?? "unmapped"}) — manual revoke may be needed`,
        "warning"
      );
      await recordEvent(getServiceClient(), userId, "whop_revoke_unmatched", {
        event,
        kind,
        payment_id: r.paymentId,
        original_payment_id: r.originalPaymentId,
        membership_id: r.membershipId,
        email: r.email,
      });
      return NextResponse.json(
        { ok: false, error: "revoke matched no subscription", event },
        { status: 200 }
      );
    }

    // ── Idempotency claim (only now that there IS a sub to revoke; same
    // pattern as the grant path). First delivery wins; Whop retries dedupe. ──
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "whop",
        event_id: claimKey,
        payload: { claimed_at: new Date().toISOString(), event, kind },
      })
      .select("event_id")
      .maybeSingle();

    if (claimErr) {
      if ((claimErr as { code?: string }).code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      Sentry.captureException(claimErr, { tags: { route: "webhooks/whop", step: "revoke_claim" } });
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (!claim) return NextResponse.json({ ok: true, duplicate: true });

    const nowIso = new Date().toISOString();
    const affectedSubIds = subs.map((s) => s.id);

    // ── 1. Flip the matched subscription(s) → refunded / cancelled ──
    const { error: subUpdErr } = await sb
      .from("subscriptions")
      .update({ status: kind, cancelled_at: nowIso, updated_at: nowIso })
      .in("id", affectedSubIds);
    if (subUpdErr) {
      Sentry.captureException(subUpdErr, {
        tags: { route: "webhooks/whop", step: "revoke_sub_update" },
        extra: { affectedSubIds, kind },
      });
      return NextResponse.json({ error: "DB update failed" }, { status: 500 });
    }

    // ── 2. Revoke Pro ONLY if no OTHER active, unexpired subscription ──
    // (Any provider — a user with a separate still-valid sub keeps access.)
    // Read all of the user's active subs and exclude the just-revoked ones in
    // JS (avoids a brittle interpolated PostgREST `not.in` filter).
    const affectedSet = new Set(affectedSubIds);
    const { data: activeRows, error: otherErr } = await sb
      .from("subscriptions")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("status", "active");
    if (otherErr) {
      // Fail safe toward keeping access (don't wrongly downgrade a paying user
      // on a transient read error); flag for reconciliation.
      Sentry.captureException(otherErr, {
        tags: { route: "webhooks/whop", step: "revoke_other_active_lookup" },
        extra: { userId },
      });
    }
    const nowMs = Date.now();
    const hasOtherActive = (activeRows ?? []).some((s) => {
      const row = s as { id: string; expires_at?: string | null };
      if (affectedSet.has(row.id)) return false; // the sub we just revoked
      return !row.expires_at || new Date(row.expires_at).getTime() > nowMs;
    });

    let proRevoked = false;
    if (!otherErr && !hasOtherActive) {
      const { error: userErr } = await sb
        .from("users")
        .update({ tier: "free", tier_expires_at: null, updated_at: nowIso })
        .eq("id", userId);
      if (userErr) {
        Sentry.captureException(userErr, {
          tags: { route: "webhooks/whop", step: "revoke_user_downgrade" },
          extra: { userId },
        });
      } else {
        proRevoked = true;
      }
    }

    // ── 3. Reverse any referral reward earned off this referee's purchase ──
    // [name]'s rule (2026-06-23): reverse the referrer's cut ONLY on a refund-
    // class revoke (refund / chargeback / dispute → kind='refunded'), where the
    // money was actually taken back. On a VOLUNTARY cancel or benign expiry
    // (membership.deactivated → kind='cancelled') the referrer KEEPS their
    // credit — they delivered a genuine paying signup; a later cancel is not
    // their fault. Pro access is still revoked on BOTH kinds above (the sub
    // ends); only the referral reversal is gated here.
    const referralReversed =
      kind === "refunded"
        ? await reverseRefereeReferral(sb, userId, event)
        : false;

    await recordEvent(sb, userId, "whop_subscription_revoked", {
      event,
      kind,
      affected_subscription_ids: affectedSubIds,
      pro_revoked: proRevoked,
      had_other_active: hasOtherActive,
      referral_reversed: referralReversed,
      payment_id: r.paymentId,
      membership_id: r.membershipId,
    });

    return NextResponse.json({
      ok: true,
      revoked: true,
      kind,
      subscriptions: affectedSubIds.length,
      pro_revoked: proRevoked,
      referral_reversed: referralReversed,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "revoke_unexpected" } });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * DUNNING handler (Wave 2, 2026-09-20): payment.failed / payment.requires_action.
 *
 * Why this exists: a failed renewal was previously invisible to us (the legacy
 * hook subscribed only payment.succeeded), so a card that declined on the
 * €19/month trial renewal churned silently. Whop's current spec hands us the
 * buyer's recovery link on both events when recovery is possible:
 *   data.recovery_url — the buyer signs in to Whop, completes 3D Secure /
 *   updates the card, and the SAME charge resumes (then fires
 *   payment.succeeded → the normal grant path).
 *
 * Discipline (mirrors handleRevoke):
 *   1. Idempotency claim `recover:<paymentId>` so Whop's retries don't spam
 *      the buyer with repeated dunning emails.
 *   2. Record the delivery truth (webhook_attempts) + funnel telemetry
 *      (payment_events webhook_received with the decline reason metadata).
 *   3. Resolve the buyer (metadata user id → users.email) and email them the
 *      recovery link, DE copy honest about what happened. Best-effort: an
 *      email failure never 5xxs (Whop would retry for 3 days).
 *   4. An UNMAPPED failed payment (no user) is recorded + Sentry-flagged for
 *      manual follow-up — never silently dropped.
 */
async function handlePaymentRecovery(
  event: string,
  data: unknown,
  f: ReturnType<typeof extractWhopPayment>
): Promise<NextResponse> {
  const d = rec(data);
  const declineCode = str(d.decline_code) ?? str(d.declineCode);
  const failureMessage = str(d.failure_message) ?? str(d.failureMessage);
  const recoveryUrl = str(d.recovery_url) ?? str(d.recoveryUrl);
  const status = str(d.status);

  console.info(
    `[whop webhook] RECOVERY event=${event} paymentId=${f.paymentId ?? "(none)"} status=${status ?? "(none)"} hasRecoveryUrl=${Boolean(recoveryUrl)}`
  );

  // Dedupe the dunning email on the payment id (retries carry the same id).
  if (f.paymentId) {
    try {
      const sb0 = getServiceClient();
      const claim = await sb0
        .from("processed_webhook_events")
        .insert({
          provider: "whop",
          event_id: `recover:${f.paymentId}`,
          payload: { claimed_at: new Date().toISOString(), event },
        })
        .select("event_id")
        .maybeSingle();
      if (!claim) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
    } catch (err) {
      // A 23505 (duplicate) surfaces here as an error on some clients — if the
      // row already exists we must still not re-email; treat insert errors as
      // "already claimed" for safety of the mailbox, but keep the telemetry.
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "recovery_claim" } });
    }
  }

  const sb = getServiceClient();

  await logPaymentEvent(sb, {
    event: "webhook_received",
    provider: "whop",
    userId: null,
    email: f.email,
    planId: f.planId,
    paymentId: f.paymentId,
    amountCents: f.amountCents,
    currency: f.currency,
    signatureValid: true,
    matched: Boolean(f.metaUserId || f.email),
    metadata: {
      event,
      whop_event: event,
      status: status ?? null,
      decline_code: declineCode ?? null,
      failure_message: failureMessage ?? null,
      has_recovery_url: Boolean(recoveryUrl),
    },
  });

  // Resolve the user for the dunning email. Metadata id first, email fallback.
  let userId: string | null = null;
  let email: string | null = null;
  let firstName: string | null = null;
  let languageCode: string | null = null;
  if (f.metaUserId) {
    const { data: u } = await sb
      .from("users")
      .select("id, email, first_name, language_code")
      .eq("id", f.metaUserId)
      .maybeSingle();
    if (u) {
      userId = u.id as string;
      email = (u.email as string | null) ?? null;
      firstName = (u.first_name as string | null) ?? null;
      languageCode = (u.language_code as string | null) ?? null;
    }
  }
  if (!userId && f.email) {
    const { data: u } = await sb
      .from("users")
      .select("id, email, first_name, language_code")
      .ilike("email", escapeLike(f.email))
      .maybeSingle();
    if (u) {
      userId = u.id as string;
      email = (u.email as string | null) ?? null;
      firstName = (u.first_name as string | null) ?? null;
      languageCode = (u.language_code as string | null) ?? null;
    }
  }

  // Record the actionable signal regardless (ops can drain manually).
  try {
    await sb.from("user_events").insert({
      user_id: userId ?? "whop-webhook",
      event_type: "whop_payment_recovery_needed",
      event_data: {
        event,
        payment_id: f.paymentId,
        plan_id: f.planId,
        status,
        decline_code: declineCode,
        failure_message: failureMessage,
        recovery_url: recoveryUrl,
        mapped_user_id: userId,
      },
    });
  } catch (err) {
    console.error("[webhooks/whop] recovery telemetry", err);
  }

  if (!userId || !email) {
    Sentry.captureMessage(
      `Whop ${event} unmapped (payment=${f.paymentId ?? "none"} email=${f.email ?? "none"}) — buyer may churn without dunning`,
      "warning"
    );
    return NextResponse.json({ ok: true, ignored: "unmapped_recovery_event" });
  }

  // Email the buyer the recovery link (best-effort; never 5xx).
  if (recoveryUrl) {
    const isDe = !(languageCode ?? "").toLowerCase().startsWith("en");
    const subject = isDe
      ? "Aktion erforderlich: Ihre MedPrüf-Zahlung"
      : "Action required: your MedPrüf payment";
    const html = isDe
      ? `<p>Hallo${firstName ? ` ${firstName}` : ""},</p>` +
        `<p>die letzte Zahlung Ihrer MedPrüf-Mitgliedschaft konnte von Ihrer Bank nicht abgeschlossen werden${declineCode ? ` (Grund: ${declineCode})` : ""}. Ihr Pro-Zugang läuft sonst zum Ende der bezahlten Laufzeit aus.</p>` +
        `<p>Sie können das in einer Minute beheben: öffnen Sie den untenstehenden Whop-Link, bestätigen Sie die Zahlung oder aktualisieren Sie Ihre Karte, und alles läuft automatisch weiter.</p>` +
        `<p><a href="${recoveryUrl}">Zahlung jetzt abschließen</a></p>` +
        `<p>Falls Sie das Abo stattdessen beenden möchten, ist dafür kein weiterer Schritt nötig.</p>` +
        `<p>Mit freundlichen Grüßen<br>Das MedPrüf-Team</p>`
      : `<p>Hi${firstName ? ` ${firstName}` : ""},</p>` +
        `<p>The latest payment on your MedPrüf membership could not be completed${declineCode ? ` (reason: ${declineCode})` : ""}. Your Pro access runs until the end of the period you already paid for.</p>` +
        `<p>You can fix this in one minute: open the Whop link below and confirm the payment or update your card.</p>` +
        `<p><a href="${recoveryUrl}">Complete the payment now</a></p>` +
        `<p>If you would rather end the membership, no action is needed.</p>` +
        `<p>Best,<br>The MedPrüf Team</p>`;
    try {
      const res = await sendZohoEmail({ to: email, subject, htmlBody: html });
      await recordEvent(sb, userId, "whop_dunning_email", {
        event,
        payment_id: f.paymentId,
        to: email,
        ok: res.ok,
        reason: res.ok ? null : (res as { reason?: string }).reason ?? null,
        has_recovery_url: Boolean(recoveryUrl),
      });
    } catch (err) {
      console.error("[webhooks/whop] dunning email failed", err);
      await recordEvent(sb, userId, "whop_dunning_email_failed", {
        event, payment_id: f.paymentId, to: email,
      });
    }
  }

  return NextResponse.json({ ok: true, handled: event });
}

/**
 * TRIAL-ENDING handler (Wave 2): membership.trial_ending_soon.
 * Whop's native signal that the €0→€19 card trial is about to convert.
 * One honest reminder email per membership: trial ending, the 19 €/month
 * auto-charge that follows, and how to cancel. SoT trial-promo rule binds:
 * the terms are stated, never hidden.
 */
async function handleTrialEndingSoon(
  event: string,
  data: unknown,
  f: ReturnType<typeof extractWhopPayment>
): Promise<NextResponse> {
  const d = rec(data);
  const member = rec(d.member) || rec(d.membership);
  const membershipId =
    str(d.membership_id) ?? str(member.id) ?? (str(d.id)?.startsWith("mem_") ? str(d.id) : null);
  const metadata = rec(d.metadata);
  const metaUserId = str(d.medpruef_user_id) ?? str(metadata.medpruef_user_id) ?? f.metaUserId;
  const trialEndRaw = d.trial_end_date ?? d.trial_end ?? d.renewal_period_start ?? null;
  const trialEnd =
    typeof trialEndRaw === "number"
      ? new Date(trialEndRaw > 1e12 ? trialEndRaw : trialEndRaw * 1000)
      : typeof trialEndRaw === "string" && Number.isFinite(Date.parse(trialEndRaw))
        ? new Date(trialEndRaw)
        : null;

  console.info(
    `[whop webhook] TRIAL_ENDING event=${event} membership=${membershipId ?? "(none)"} user=${metaUserId ?? "(none)"}`
  );

  const sb = getServiceClient();

  // One reminder per membership, ever.
  if (membershipId) {
    const claimKey = `trialssoon:${membershipId}`;
    try {
      const { data: claim } = await sb
        .from("processed_webhook_events")
        .insert({
          provider: "whop",
          event_id: claimKey,
          payload: { claimed_at: new Date().toISOString(), event },
        })
        .select("event_id")
        .maybeSingle();
      if (!claim) return NextResponse.json({ ok: true, duplicate: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return NextResponse.json({ ok: true, duplicate: true });
      Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "trial_ending_claim" } });
    }
  }

  // Resolve the user (metadata id, then the payment-level email fallback).
  let userId = metaUserId;
  let email: string | null = null;
  let firstName: string | null = null;
  let languageCode: string | null = null;
  if (userId) {
    const { data: u } = await sb
      .from("users")
      .select("id, email, first_name, language_code")
      .eq("id", userId)
      .maybeSingle();
    if (u) {
      email = (u.email as string | null) ?? null;
      firstName = (u.first_name as string | null) ?? null;
      languageCode = (u.language_code as string | null) ?? null;
    }
  }
  if (!email && f.email) {
    const { data: u } = await sb
      .from("users")
      .select("id, email, first_name, language_code")
      .ilike("email", escapeLike(f.email))
      .maybeSingle();
    if (u) {
      userId = u.id as string;
      email = (u.email as string | null) ?? null;
      firstName = (u.first_name as string | null) ?? null;
      languageCode = (u.language_code as string | null) ?? null;
    }
  }

  if (!userId || !email) {
    Sentry.captureMessage(
      `Whop ${event} unmapped (membership=${membershipId ?? "none"}) — trial-end reminder not sent`,
      "warning"
    );
    return NextResponse.json({ ok: true, ignored: "unmapped_trial_ending" });
  }

  // Only remind when the card trial is the live access (don't nudge a paying
  // Cohort buyer whose trial converted months ago).
  const { data: activeTrial } = await sb
    .from("subscriptions")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("tier", "notes_pro_trial")
    .eq("status", "active")
    .limit(1);
  if (!activeTrial || activeTrial.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no_active_trial" });
  }

  await logPaymentEvent(sb, {
    event: "webhook_received",
    provider: "whop",
    userId,
    email,
    tier: "notes_pro_trial",
    paymentId: f.paymentId,
    signatureValid: true,
    matched: true,
    metadata: { event, whop_event: event, membership_id: membershipId },
  });

  const isDe = !(languageCode ?? "").toLowerCase().startsWith("en");
  const subject = isDe
    ? "Dein MedPrüf Pro-Test endet bald"
    : "Your MedPrüf Pro trial is ending soon";
  const html = isDe
    ? `<p>Hallo${firstName ? ` ${firstName}` : ""},</p>` +
      `<p>dein 7-tägiger MedPrüf Pro-Test endet in Kürze. Wenn du nichts unternimmst, wird deine hinterlegte Karte automatisch mit <strong>19 € pro Monat</strong> belastet und dein Pro-Zugang läuft weiter.</p>` +
      `<p>Möchtest du weitermachen, musst du nichts tun. Wenn nicht, kündige einfach in deinen Whop-Abrechnungseinstellungen, bevor der Test endet — dann wird nichts belastet.</p>` +
      `<p><a href="https://whop.com/medpruf">Mitgliedschaft verwalten</a></p>` +
      `<p>Mit freundlichen Grüßen<br>Das MedPrüf-Team</p>`
    : `<p>Hi${firstName ? ` ${firstName}` : ""},</p>` +
      `<p>Your 7-day MedPrüf Pro trial is ending soon. If you do nothing, the card on file is automatically charged <strong>19 € per month</strong> and your Pro access continues.</p>` +
      `<p>Want to continue? Do nothing. If not, cancel in your Whop billing settings before the trial ends and you will not be charged.</p>` +
      `<p><a href="https://whop.com/medpruf">Manage your membership</a></p>` +
      `<p>Best,<br>The MedPrüf Team</p>`;

  try {
    const res = await sendZohoEmail({ to: email, subject, htmlBody: html });
    await recordEvent(sb, userId, "whop_trial_ending_email", {
      event,
      membership_id: membershipId,
      to: email,
      ok: res.ok,
      reason: res.ok ? null : (res as { reason?: string }).reason,
    });
  } catch (err) {
    console.error("[webhooks/whop] trial-ending email failed", err);
    await recordEvent(sb, userId, "whop_trial_ending_email_failed", {
      event, membership_id: membershipId, to: email,
    });
  }

  return NextResponse.json({ ok: true, handled: event });
}

/**
 * Reverse a referral reward that was credited off THIS referee's purchase.
 * The reward is paid out manually/by cron only once status='rewarded' AND the
 * 30-day hold passes, so a 'qualified' row reversed here was never paid — we
 * flip it to 'reversed', zero the credit, clear qualified_at, and stamp the
 * reason. A row already 'rewarded' MAY have paid cash → flip + Sentry-warn for
 * a manual clawback decision. Returns true if a row was reversed.
 *
 * NOTE: the whop GRANT path does not (yet) qualify referrals, so today this is
 * usually a no-op for whop-paid users. It is keyed on referee_user_id (not
 * provider) so it is correct + future-proof if whop-side qualify is added.
 */
async function reverseRefereeReferral(
  sb: ReturnType<typeof getServiceClient>,
  refereeUserId: string,
  event: string
): Promise<boolean> {
  try {
    const { data: rows, error } = await sb
      .from("referrals")
      .select("id, status")
      .eq("referee_user_id", refereeUserId)
      .in("status", ["qualified", "rewarded"]);
    if (error) {
      Sentry.captureException(error, { tags: { route: "webhooks/whop", step: "referral_reverse_lookup" } });
      return false;
    }
    if (!rows || rows.length === 0) return false;

    const nowIso = new Date().toISOString();
    let reversedAny = false;
    for (const row of rows as Array<{ id: string; status: string }>) {
      const { error: updErr } = await sb
        .from("referrals")
        .update({
          status: "reversed",
          reward_credit_cents: 0,
          qualified_at: null,
          hold_reason: "payment_refunded",
        })
        .eq("id", row.id);
      if (updErr) {
        Sentry.captureException(updErr, {
          tags: { route: "webhooks/whop", step: "referral_reverse_update" },
          extra: { referralId: row.id },
        });
        continue;
      }
      reversedAny = true;
      if (row.status === "rewarded") {
        // Money may already have been paid out — needs a human clawback call.
        Sentry.captureMessage(
          `Whop revoke '${event}' reversed an ALREADY-REWARDED referral (${row.id}) for referee ${refereeUserId} — verify whether the €reward was paid and claw back if so`,
          "warning"
        );
      }
    }
    return reversedAny;
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "webhooks/whop", step: "referral_reverse_unexpected" },
      extra: { refereeUserId },
    });
    return false;
  }
}

/**
 * Qualify a referral row when a Whop card payment activates a Pro sub.
 * Mirrors qualifyReferralIfApplicable in the NOWPayments webhook exactly —
 * same tiered payouts, same 30-day hold, same €600/year annual cap — with
 * one extra gate: the invite-only program check on referrals_enabled.
 *
 * LEGACY CASH PROGRAM ONLY (paused per MEDPRUF-SOT.md §2.x for new/
 * enrolled users as of 2026-07-11, code retained for legacy rows still
 * in flight). Lives in this route file, not src/lib/referrals.ts.
 *
 * Race fix (2026-07-11): this function used to run unconditionally
 * ahead of the exam-reward qualifier (qualifyReferralOnActivity, called
 * later in the same webhook handler) and would flip ANY pending row —
 * including one created under the ACTIVE exam-reward program — to a
 * cash-qualified state on first payment, bypassing the card+activity
 * gate entirely (the row lookup below had no reward_type filter, and
 * every pending row defaults to reward_type='cash' at the DB column
 * level unless the claim route explicitly stamps otherwise). Two belt-
 * and-braces fixes: (1) this function now no-ops immediately when the
 * exam-reward program is active — the cash program is paused, it has
 * no business qualifying anything while the new mechanic owns
 * qualification; (2) its row lookup is additionally scoped to
 * reward_type='cash' as defense-in-depth, so even if this function
 * were ever called with the flag on, it could not touch a program row.
 * See src/app/api/referrals/claim/route.ts for the matching fix (rows
 * created under the active program are stamped reward_type=
 * 'pro_until_exam' on insert, not left at the 'cash' default).
 *
 * Invite-only guard (2026-06-25): the referral program is OFF by default.
 * An admin must flip users.referrals_enabled=true for a referrer's code to
 * earn rewards. If the referrer is not enabled we skip the reward and log at
 * warning level (visible in Sentry, not a silent discard).
 *
 * Payout amounts (Lock #3, 2026-04-23):
 *   monthly / 3-month    → €25
 *   6-month / 12-month   → €50
 *   premium_pass_g       → €75
 *
 * 30-day hold: qualified rows have hold_expires_at = now + 30d. The admin /
 * payout cron picks up rows where hold_expires_at <= now.
 *
 * Annual cap: €600 per referrer per calendar year. Rows earned after the cap
 * still flip to 'qualified' (they count in stats) but reward_credit_cents is 0
 * and hold_reason='annual_cap'.
 *
 * This is best-effort — any DB error returns false without throwing so the
 * caller's try/catch never catches it and the webhook always acks the payment.
 */
async function qualifyReferralOnWhopPayment(
  sb: ReturnType<typeof getServiceClient>,
  refereeUserId: string,
  paymentId: string,
  refereeTier: string | null | undefined
): Promise<boolean> {
  // The cash program is paused while the exam-reward program is active
  // (MEDPRUF-SOT.md §2.x) — this function has no business qualifying
  // anything in that state. No-op immediately, before any DB call.
  if (isReferralExamRewardEnabled()) return false;

  try {
    // 1. Does this referee have a referred_by_code?
    const { data: referee } = await sb
      .from("users")
      .select("id, referred_by_code")
      .eq("id", refereeUserId)
      .maybeSingle();

    const code = referee?.referred_by_code as string | null | undefined;
    if (!code) return false;

    // 2. Find the referrer by their referral_code. Include referrals_enabled
    //    so we can enforce the invite-only gate in the same query.
    const { data: referrer } = await sb
      .from("users")
      .select("id, referrals_enabled")
      .eq("referral_code", code)
      .maybeSingle();

    if (!referrer) {
      console.warn(
        "[webhooks/whop] referred_by_code matches no user",
        { code, refereeUserId, paymentId }
      );
      return false;
    }

    // 3. Self-referral guard: a user cannot earn a reward off their own sign-up.
    if (referrer.id === refereeUserId) {
      console.warn(
        "[webhooks/whop] self-referral blocked (referrer == referee)",
        { refereeUserId, code, paymentId }
      );
      return false;
    }

    // 4. Invite-only gate: referrals_enabled must be true for the referrer
    //    to earn a reward. If false, log at warning (not error — this is
    //    expected for non-enrolled accounts) so it shows in Sentry without noise.
    if (!referrer.referrals_enabled) {
      Sentry.captureMessage(
        `Whop referral skipped: referrer ${referrer.id} has referrals_enabled=false ` +
          `for referee ${refereeUserId} (payment=${paymentId}) — invite-only program`,
        "warning"
      );
      return false;
    }

    // 5. Is there already a referrals row for this (referrer, referee) pair?
    const { data: existing } = await sb
      .from("referrals")
      .select("id, status, reward_type")
      .eq("referrer_user_id", referrer.id)
      .eq("referee_user_id", refereeUserId)
      .maybeSingle();

    // Already qualified or paid out — idempotent, nothing to do.
    if (existing && existing.status !== "pending") return false;

    // Defense-in-depth (2026-07-11): a pending row NOT stamped
    // reward_type='cash' belongs to the exam-reward program (see the
    // claim route) — this legacy function must never touch it. Skip
    // rather than fall through to the "no existing row" insert branch
    // below, which would otherwise create a SECOND, contradictory row
    // for the same (referrer, referee) pair instead of correctly
    // recognizing one already exists.
    if (existing && existing.reward_type && existing.reward_type !== "cash") {
      return false;
    }

    // 6. Compute tiered payout + enforce the €600/year annual cap.
    const nowIso = new Date().toISOString();
    const now = new Date();
    const tieredPayout = referralPayoutCents(refereeTier);

    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const { data: yearRows, error: yearErr } = await sb
      .from("referrals")
      .select("reward_credit_cents, qualified_at, status")
      .eq("referrer_user_id", referrer.id)
      .in("status", ["qualified", "rewarded"])
      .gte("qualified_at", yearStart.toISOString());

    if (yearErr) {
      console.error("[webhooks/whop] annual cap lookup failed", yearErr);
      // Proceed with full payout rather than blocking activation on a
      // flaky cap-sum query — a slight over-pay is better than a lost row.
    }

    const yearSumCents = (yearRows || []).reduce(
      (acc, r) =>
        acc + ((r as { reward_credit_cents?: number | null }).reward_credit_cents ?? 0),
      0
    );
    const headroomCents = Math.max(0, REFERRAL_ANNUAL_CAP_CENTS - yearSumCents);
    const cappedPayout = Math.min(tieredPayout, headroomCents);
    const capped = cappedPayout < tieredPayout;

    const holdExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const qualifyPayload: Record<string, unknown> = {
      status: "qualified",
      qualified_at: nowIso,
      reward_credit_cents: cappedPayout,
      hold_expires_at: holdExpiresAt.toISOString(),
      hold_reason: capped ? "annual_cap" : null,
    };

    // 7. Upsert: flip a pending row to qualified, or create the row if it
    //    never existed (some users pay without ever visiting /referrals first).
    if (!existing) {
      const { error } = await sb.from("referrals").insert({
        referrer_user_id: referrer.id,
        referee_user_id: refereeUserId,
        referral_code: code,
        ...qualifyPayload,
      });
      if (error) {
        console.error("[webhooks/whop] referrals insert failed", error);
        Sentry.captureException(error, {
          tags: { route: "webhooks/whop", step: "referral_qualify_insert" },
          extra: { refereeUserId, paymentId },
        });
        return false;
      }
    } else {
      // existing.status === 'pending' — flip to qualified.
      const { error } = await sb
        .from("referrals")
        .update(qualifyPayload)
        .eq("id", (existing as { id: string }).id);
      if (error) {
        console.error("[webhooks/whop] referrals update failed", error);
        Sentry.captureException(error, {
          tags: { route: "webhooks/whop", step: "referral_qualify_update" },
          extra: { referralId: (existing as { id: string }).id, refereeUserId, paymentId },
        });
        return false;
      }
    }

    if (capped) {
      console.warn("[webhooks/whop] referral capped at €600/yr", {
        referrer_user_id: referrer.id,
        referee_user_id: refereeUserId,
        refereeTier,
        tieredPayoutCents: tieredPayout,
        cappedPayoutCents: cappedPayout,
        yearSumCents,
      });
    }

    await recordEvent(sb, refereeUserId, "whop_referral_qualified", {
      referrer_user_id: referrer.id,
      referee_user_id: refereeUserId,
      payment_id: paymentId,
      referral_code: code,
      referee_tier: refereeTier ?? null,
      reward_credit_cents: cappedPayout,
      hold_expires_at: holdExpiresAt.toISOString(),
      hold_reason: capped ? "annual_cap" : null,
    });

    return true;
  } catch (err) {
    // Referral qualification must never block activation.
    console.error("[webhooks/whop] qualifyReferralOnWhopPayment failed", err);
    Sentry.captureException(err, {
      tags: { route: "webhooks/whop", step: "referral_qualify_unexpected" },
      extra: { refereeUserId, paymentId },
    });
    return false;
  }
}

/**
 * Escape PostgREST/SQL LIKE wildcards so an email is matched LITERALLY (case-
 * insensitively) by `.ilike`, not as a pattern. Without this, a stored email
 * containing `_` or `%` (both legal in the local-part) would be a wildcard and
 * could match the wrong user row. Backslash first so we don't double-escape.
 */
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
}

// Defensive payload readers for the dunning/trial paths (mirror whop.ts).
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
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
