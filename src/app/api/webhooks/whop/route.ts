import { prechargeRemindersEnabled, sendPrechargeTrialReminder } from "@/lib/precharge-trial-reminder";
import { repairWhopPaymentAccess } from "@/lib/whop-entitlement";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { stopSwitchedRenewal } from "@/lib/whop-switch";
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
import { resolveWhopBuyer } from "@/lib/whop-buyer";
import { trialEndingMembershipId, whopMembershipIdOrNull } from "@/lib/whop-ids";
import {
  extendOrInsertWhopSubscription,
  reconcileUserTierPro,
  releaseWhopClaim,
} from "@/lib/whop-grant";
import { sendZohoEmail } from "@/lib/email/zoho";
import { classifyDunningSend, dunningClaimKey, markDunningClaim, retakeDunningClaim } from "@/lib/whop-dunning-claim";
import { sendRedditConversion } from "@/lib/reddit-capi";
import { routeMentorWhopEvent } from "@/lib/mentor/credits/whop-branch";
import { clawbackReferralMentorCredit, rewardReferrerOnFirstCharge, rewardReferrerOnTrialStart } from "@/lib/referral-mentor-credits";
import { mentorOpenForAccount } from "@/lib/mentor/access-account";
import { afterResponse } from "@/lib/after-response";
import {
  appliedLateData,
  completeGrantLedger,
  decideGrant,
  findPendingRevokes,
  isPendingRevokeCandidate,
  paymentOwners,
  pendingAlreadyStored,
  pendingRevokeData,
  pendingRevokeEnabled,
  recordLedgerEvent,
  PENDING_REVOKE_USER,
  REVOKE_APPLIED_LATE_EVENT,
  REVOKE_UNMATCHED_EVENT,
  SUBSCRIPTION_ACTIVATED_EVENT,
} from "@/lib/whop-pending-revoke";

/**
 * a-mentor-open: referral mentor credits on a referee's first PAID charge,
 * run after the response (never delays or fails the Pro grant; the route's
 * maxDuration bounds it). The amount is what Whop reported: an unreadable or
 * EUR 0 amount never rewards. Idempotent per referral.
 */
function deferReferralMentorReward(sb: ReturnType<typeof getServiceClient>, refereeId: string | null, paymentId: string | null, amountCents: number | null, via: "webhook" | "webhook_duplicate"): Promise<void> {
  return afterResponse("referral-mentor-credits", async () => {
    await rewardReferrerOnFirstCharge(sb, { refereeId, paymentId, amountCents, via, referrerAdmitted: (id) => mentorOpenForAccount(sb, id) });
  });
}

/** a-free-credit-hooks L4: the referee started the card trial (flag-gated inside, after the response). */
function deferReferralTrialReward(sb: ReturnType<typeof getServiceClient>, refereeId: string): Promise<void> {
  return afterResponse("referral-trial-credits", async () => {
    await rewardReferrerOnTrialStart(sb, { refereeId, via: "webhook_trial", referrerAdmitted: (id) => mentorOpenForAccount(sb, id) });
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const sbLog = getServiceClient({ fastFail: false });

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

  // ── MENTOR CREDITS (W2-CREDITS): mentor package events never reach the
  // Pro revoke, dunning or grant paths below (src/lib/mentor/credits/whop-branch.ts).
  const mentor = await routeMentorWhopEvent(event, data);
  if (mentor.handled) return NextResponse.json(mentor.body, { status: mentor.status });

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
        await recordEvent(getServiceClient({ fastFail: false }), null, "whop_unrecognized_payment_event", {
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

  // Review fix (2026-10-02): if anything throws after the claim is taken but
  // before the grant lands, release the claim so Whop's retry can grant.
  let claimSb: ReturnType<typeof getServiceClient> | null = null;
  let claimSettled = false;
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

    const sb = getServiceClient({ fastFail: false });

    // Idempotency claim — first delivery wins; retries / multi-event dup.
    claimSb = sb;
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
        try {
          await repairWhopPaymentAccess(sb, f.paymentId);
        } catch (repairError) {
          Sentry.captureException(repairError, { tags: { route: "webhooks/whop", step: "duplicate_entitlement_repair" } });
          return NextResponse.json({ error: "Entitlement reconciliation pending" }, { status: 503 });
        }
        // a-fo-09: a redelivery completes a ledger row the first attempt
        // could not write (never a second grant).
        if (pendingRevokeEnabled()) {
          try {
            await completeGrantLedger(sb, { paymentId: f.paymentId, event });
          } catch (ledgerError) {
            Sentry.captureException(ledgerError, { tags: { route: "webhooks/whop", step: "duplicate_ledger_retry" } });
            return NextResponse.json({ error: "Ledger write pending; retry" }, { status: 503 });
          }
        }
        // The verify route may have granted first with no readable amount;
        // this delivery carries Whop's amount. The referee comes from the
        // payment's grant_succeeded row. A EUR 0 trial start never rewards.
        await deferReferralMentorReward(sb, null, f.paymentId, f.amountCents, "webhook_duplicate");
        // a-renew-early: a redelivery finishes a switch stop the first
        // attempt could not reach at Whop (idempotent per payment).
        if (await stopSwitchedRenewal(sb, { paymentId: f.paymentId, newMembershipId: f.membershipId, metaSwitchFrom: f.metaSwitchFrom, checkoutConfigId: f.checkoutConfigId }) === "retry") {
          return NextResponse.json({ error: "Renewal stop pending; retry" }, { status: 503 });
        }
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

    // Resolve user (2026-10-02 fix A): membership-bound evidence first
    // (DB pin, metadata, checkout session, Whop membership API), email LAST.
    // Renewal charges carry metadata=null; the old metadata-then-email order
    // credited the Whop payer's email account instead of the subscriber.
    const buyer = await resolveWhopBuyer(sb, {
      membershipId: f.membershipId,
      metaUserId: f.metaUserId,
      membershipMetaUserId: f.membershipMetaUserId,
      checkoutConfigId: f.checkoutConfigId,
      email: f.email,
    });
    if (buyer.kind === "provider_unavailable") {
      // Never guess by email while the membership lookup is down: release
      // the claim and 503 so Whop redelivers.
      Sentry.captureMessage(
        `Whop grant deferred: buyer lookup unavailable (status ${buyer.status}) payment=${f.paymentId}; Whop will retry`,
        "warning"
      );
      claimSettled = true;
      await releaseWhopClaim(sb, f.paymentId);
      await logWebhookAttempt({
        req, provider: "whop", path: "/api/webhooks/whop",
        signatureValid: true, body: rawBody, result: "other_error",
        eventId: f.paymentId,
        error: `membership lookup unavailable (HTTP ${buyer.status}); retry`,
      });
      return NextResponse.json({ error: "membership lookup unavailable, retry" }, { status: 503 });
    }
    const userId: string | null = buyer.kind === "resolved" ? buyer.userId : null;
    const resolvedVia = buyer.kind === "resolved" ? buyer.source : null;

    // a-fo-09: a refund or dispute of this payment arrived first. Withhold the
    // grant (nothing is written, so no grant-then-revoke race) and record it.
    if (pendingRevokeEnabled()) {
      const pending = await findPendingRevokes(sb, f.paymentId);
      if (pending.error !== null) {
        claimSettled = true;
        await releaseWhopClaim(sb, f.paymentId);
        await logWebhookAttempt({
          req, provider: "whop", path: "/api/webhooks/whop",
          signatureValid: true, body: rawBody, result: "other_error",
          eventId: f.paymentId, error: "pending revoke lookup failed; retry",
        });
        return NextResponse.json({ error: "Could not verify refunds for this payment, retry" }, { status: 503 });
      }
      const decision = decideGrant({ paymentId: f.paymentId, pendingRows: pending.rows });
      if (decision.action === "withhold") {
        // A first attempt whose write committed after its deadline may already
        // hold this payment: then Pro is on and the row says revoke by hand.
        let alreadyGranted = false;
        try {
          alreadyGranted = (await paymentOwners(sb, f.paymentId)).length > 0;
        } catch {
          claimSettled = true;
          await releaseWhopClaim(sb, f.paymentId);
          return NextResponse.json({ error: "Could not verify refunds for this payment, retry" }, { status: 503 });
        }
        const ledger = await recordLedgerEvent(sb, PENDING_REVOKE_USER, REVOKE_APPLIED_LATE_EVENT, appliedLateData({
          paymentId: f.paymentId, event, pending: decision.pending, userId,
          membershipId: f.membershipId, planId: f.planId, amountCents: f.amountCents, alreadyGranted,
        }));
        claimSettled = true;
        if (!ledger.ok) {
          // Nothing was granted, so freeing the claim is safe: the retry
          // withholds again and writes the row.
          await releaseWhopClaim(sb, f.paymentId);
          return NextResponse.json({ error: "Ledger write pending; retry" }, { status: 503 });
        }
        Sentry.captureMessage(
          alreadyGranted
            ? `Whop payment ${f.paymentId} was already granted when its refund/dispute was seen: revoke by hand (user=${userId ?? "unmapped"})`
            : `Whop payment ${f.paymentId} arrived after its refund/dispute: grant withheld (user=${userId ?? "unmapped"})`,
          alreadyGranted ? "error" : "warning"
        );
        await logWebhookAttempt({
          req, provider: "whop", path: "/api/webhooks/whop",
          signatureValid: true, body: rawBody, result: "processed",
          eventId: f.paymentId, error: "refunded_before_grant",
        });
        await logPaymentEvent(sbLog, {
          event: "grant_failed", userId, email: f.email, tier: tier ?? null, planId: f.planId,
          paymentId: f.paymentId, amountCents: f.amountCents, currency: f.currency,
          reason: "refunded_before_grant", matched: Boolean(userId),
          metadata: { event, ok: false, revoke_event: decision.pending.event_data?.event ?? null, already_granted: alreadyGranted },
        });
        return NextResponse.json({ ok: true, activated: false, reason: "refunded_before_grant", payment_id: f.paymentId });
      }
    }

    if (!userId || !tier) {
      // Don't drop it — flag for manual grant + record telemetry.
      Sentry.captureMessage(
        `Whop payment unmapped, manual grant needed: payment=${f.paymentId} plan=${f.planId} tier=${tier}`,
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
    // who cancels mid-trial keeps Pro through the trial plus its one-day grace,
    // not a month; a real €19 renewal
    // carries a positive amount → falls through to the +1-month extension (today's
    // behavior, unchanged). 8 days == trial/verify's `trialDays + 1` floor, so the
    // two grant paths converge on the same window instead of racing (FB-03).
    // ONLY notes_pro_trial is gated here; paid tiers (first_month_19
    // / first_3mo_27 / premium_pass_guaranteed) always carry a positive amount and
    // are never this tier, so they keep their full computeExpiry duration. The
    // membership.went_invalid revoke path preserves this stored window for
    // unpaid trials; this 8-day cap is the fallback when period end is unknown.
    // Review fix (2026-10-02): ONLY an explicit EUR 0 is a trial start. A
    // notes_pro_trial payment with NO readable amount is ambiguous (trial
    // start vs EUR 19 renewal): flag it for a manual grant instead of guessing
    // either way (the new reuse guard would otherwise refuse a paid renewal).
    if (tier === "notes_pro_trial" && f.amountCents == null) {
      Sentry.captureMessage(
        `Whop notes_pro_trial payment with no readable amount (payment=${f.paymentId} user=${userId}): manual review needed`,
        "warning"
      );
      await recordEvent(sb, userId, "whop_payment_unmapped", {
        payment_id: f.paymentId, plan_id: f.planId, tier, event, missing: "amount",
      });
      await logPaymentEvent(sbLog, {
        event: "grant_failed", userId, email: f.email, tier, planId: f.planId,
        paymentId: f.paymentId, reason: "unmapped", matched: true,
        metadata: { event, ok: false, missing: "amount" },
      });
      return NextResponse.json({ ok: false, error: "amount unreadable, manual review", payment_id: f.paymentId }, { status: 200 });
    }
    const isTrialStart = tier === "notes_pro_trial" && f.amountCents === 0;
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
        .select("id, started_at, expires_at, granted_payment_ids")
        .eq("user_id", userId)
        .eq("tier", "notes_pro_trial")
        .eq("status", "active")
        .limit(1);
      if (existingTrial && existingTrial.length > 0) {
        // A verify-first row written before trial provenance has no zero-month
        // entry. Attach this EUR 0 payment as the original trial, so a later
        // renewal refund keeps the trial window instead of revoking it.
        const trialRow = existingTrial[0] as {
          id: string; started_at: string | null; expires_at: string | null;
          granted_payment_ids: Array<{ added_months?: number }> | null;
        };
        const history = Array.isArray(trialRow.granted_payment_ids) ? trialRow.granted_payment_ids : [];
        if (!history.some((entry) => entry?.added_months === 0)) {
          const startedIso = trialRow.started_at && Number.isFinite(Date.parse(trialRow.started_at))
            ? new Date(trialRow.started_at).toISOString() : new Date().toISOString();
          const trialEntry = {
            payment_id: f.paymentId, amount_cents: 0, added_months: 0, granted_at: startedIso,
            ...(history.length === 0 && trialRow.expires_at ? { trial_ends_at: new Date(trialRow.expires_at).toISOString() } : {}),
          };
          let attach = sb.from("subscriptions")
            .update({ granted_payment_ids: [trialEntry, ...history], updated_at: new Date().toISOString() })
            .eq("id", trialRow.id);
          attach = trialRow.granted_payment_ids == null ? attach.is("granted_payment_ids", null)
            : attach.filter("granted_payment_ids", "eq", JSON.stringify(trialRow.granted_payment_ids));
          const { error: attachError } = await attach;
          if (attachError) {
            // Non-fatal: the revoke path reconstructs a verify-first trial
            // from started_at when this provenance is missing.
            Sentry.captureException(attachError, { tags: { route: "webhooks/whop", step: "trial_provenance_attach" }, extra: { userId } });
          }
        }
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

    // Trial-reuse guard (2026-10-02): an account that already used its
    // trial (any prior notes_pro_trial row, any status) gets NO second free
    // window from a EUR 0 trial start. Whop itself charges a repeat payer
    // immediately (verified: pay_ptzCH… was a EUR 19 subscription_create);
    // this closes the account side. Recorded + Sentry, never silent.
    if (isTrialStart) {
      const { data: priorTrials } = await sb
        .from("subscriptions")
        .select("id, status")
        .eq("user_id", userId)
        .eq("tier", "notes_pro_trial")
        .limit(1);
      if (priorTrials && priorTrials.length > 0) {
        Sentry.captureMessage(
          `Whop EUR 0 trial start for an account that already trialed (user=${userId} payment=${f.paymentId} membership=${f.membershipId ?? "none"}): no second free window granted`,
          "warning"
        );
        await recordEvent(sb, userId, "whop_trial_reuse_refused", {
          payment_id: f.paymentId,
          membership_id: f.membershipId,
          prior_subscription_id: (priorTrials[0] as { id: string }).id,
        });
        await logWebhookAttempt({
          req, provider: "whop", path: "/api/webhooks/whop",
          signatureValid: true, body: rawBody, result: "processed",
          eventId: f.paymentId, error: "trial_reuse_refused",
        });
        await logPaymentEvent(sbLog, {
          event: "grant_failed",
          userId,
          email: f.email,
          tier,
          planId: f.planId,
          paymentId: f.paymentId,
          amountCents: 0,
          reason: "trial_reuse",
          matched: true,
          metadata: { event, ok: false },
        });
        return NextResponse.json({ ok: true, activated: false, reason: "trial_already_used" });
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
        whop_membership_id: whopMembershipIdOrNull(f.membershipId),
        granted_payment_ids: [
          {
            payment_id: f.paymentId,
            amount_cents: f.amountCents ?? 0,
            added_months: 0,
            granted_at: new Date().toISOString(),
          },
        ],
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
        // Fix 2: the write failed after the claim was taken — release it so
        // Whop's retry can reprocess instead of deduping against a stale claim.
        await releaseWhopClaim(sb, f.paymentId);
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
        // Keep the settled payment claim: retry repairs access, never duration.
        claimSettled = true;
        return NextResponse.json({ error: "Entitlement reconciliation pending" }, { status: 503 });
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
        membershipId: f.membershipId,
        sittingLastDay: f.metaSittingLastDay,
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
        // Fix 2: write failed after the claim — release it so the retry path
        // (webhook redelivery or /api/whop/checkout/verify) can re-grant.
        await releaseWhopClaim(sb, f.paymentId);
        return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
      }
      grantMode = grant.mode;
      grantPreviousExpires = grant.previousExpiresAt;
      if (grant.replayed) {
        claimSettled = true;
        // a-db-timeouts: a fallback-path replay (the first write committed
        // after its deadline) may still owe the user's access.
        if (!grant.entitlementReconciled && grant.expiresAt) {
          try {
            await reconcileUserTierPro(sb, userId, grant.expiresAt);
          } catch (userErr) {
            Sentry.captureException(userErr, { tags: { route: "webhooks/whop", step: "user_update_replay" }, extra: { userId } });
            return NextResponse.json({ error: "Entitlement reconciliation pending" }, { status: 503 });
          }
          // The first attempt logged grant_failed; record the success once so
          // the payment does not stay in Unresolved payments.
          const { data: logged, error: loggedErr } = await sbLog
            .from("payment_events")
            .select("id")
            .eq("payment_id", f.paymentId)
            .eq("event", "grant_succeeded")
            .limit(1);
          if (!loggedErr && (!logged || logged.length === 0)) {
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
              metadata: { event, expires_at: grant.expiresAt, mode: "replayed", membership_id: f.membershipId, ok: true },
            });
          }
        }
        // a-fo-09: the first attempt may not have written its ledger row.
        if (pendingRevokeEnabled()) {
          try {
            await completeGrantLedger(sb, { paymentId: f.paymentId, event, ownerUserId: userId });
          } catch (ledgerError) {
            Sentry.captureException(ledgerError, { tags: { route: "webhooks/whop", step: "replay_ledger_retry" } });
            return NextResponse.json({ error: "Ledger write pending; retry" }, { status: 503 });
          }
        }
        // The first attempt committed the grant after its deadline and may
        // have stopped before the referral reward (idempotent per referral).
        if (!isTrialStart) await deferReferralMentorReward(sb, userId, f.paymentId, f.amountCents, "webhook");
        else await deferReferralTrialReward(sb, userId);
        if (!isTrialStart && await stopSwitchedRenewal(sb, { paymentId: f.paymentId, userId, newMembershipId: f.membershipId, metaSwitchFrom: f.metaSwitchFrom, checkoutConfigId: f.checkoutConfigId }) === "retry") {
          return NextResponse.json({ error: "Renewal stop pending; retry" }, { status: 503 });
        }
        return NextResponse.json({ ok: true, duplicate: true });
      }
      expiresAt = new Date(grant.expiresAt);
      try {
        if (!grant.entitlementReconciled) await reconcileUserTierPro(sb, userId, grant.expiresAt);
      } catch (userErr) {
        // Subscription row is the source of truth; user.tier reconciles offline.
        Sentry.captureException(userErr, {
          tags: { route: "webhooks/whop", step: "user_update" },
          extra: { userId },
        });
        // Keep the settled payment claim: retry repairs access, never duration.
        claimSettled = true;
        return NextResponse.json({ error: "Entitlement reconciliation pending" }, { status: 503 });
      }
    }

    claimSettled = true; // the grant is written; never release past this point
    const activated = {
      payment_id: f.paymentId,
      membership_id: f.membershipId,
      resolved_via: resolvedVia,
      tier,
      expires_at: expiresAt.toISOString(),
    };
    // a-fo-09: with the flag on the ledger row's error is read. A failed write
    // keeps the claim (the grant landed), finishes the request and answers
    // 503 at the end; the duplicate path then writes the row, never a grant.
    let ledgerPending = false;
    if (pendingRevokeEnabled()) {
      const ledger = await recordLedgerEvent(sb, userId, SUBSCRIPTION_ACTIVATED_EVENT, activated);
      if (!ledger.ok) {
        ledgerPending = true;
        Sentry.captureMessage(`Whop activation ledger write failed (payment=${f.paymentId}): ${ledger.error}; Whop will retry`, "warning");
      }
    } else {
      await recordEvent(sb, userId, "whop_subscription_activated", activated);
    }

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
        resolved_via: resolvedVia,
        membership_id: f.membershipId,
        previous_expires_at: grantPreviousExpires,
        ok: true,
      },
    });

    // Referral mentor credits, after grant_succeeded is recorded (the clawback
    // finds the referee through that row).
    if (!isTrialStart) await deferReferralMentorReward(sb, userId, f.paymentId, f.amountCents, "webhook");
    else await deferReferralTrialReward(sb, userId);

    // a-renew-early: a switch to a longer pass stops the old renewal only now,
    // after this payment is granted and recorded (whop-switch.ts). A transient
    // Whop failure answers 503 below so the redelivery retries the stop.
    const switchStop = isTrialStart ? "not_switch" : await stopSwitchedRenewal(sb, {
      paymentId: f.paymentId, userId, newMembershipId: f.membershipId, metaSwitchFrom: f.metaSwitchFrom, checkoutConfigId: f.checkoutConfigId,
    });

    if (f.amountCents != null && f.amountCents > 0) {
      void sendRedditConversion({
        trackingType: "Purchase",
        conversionId: f.paymentId,
        email: f.email,
        valueDecimal: f.amountCents / 100,
        currency: (f.currency || "eur").toUpperCase(),
        externalId: userId,
      });
    }

    if (ledgerPending) {
      return NextResponse.json({ error: "Ledger write pending; retry", activated: true }, { status: 503 });
    }
    if (switchStop === "retry") {
      return NextResponse.json({ error: "Renewal stop pending; retry", activated: true }, { status: 503 });
    }
    return NextResponse.json({
      ok: true,
      activated: true,
      tier,
      expires_at: expiresAt.toISOString(),
      mode: grantMode,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "webhooks/whop", step: "unexpected" } });
    if (claimSb && !claimSettled && f.paymentId) {
      await releaseWhopClaim(claimSb, f.paymentId);
    }
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
 * Fix 6: recompute a subscription's remaining expiry from its SURVIVING
 * granted_payment_ids entries. Walks the entries chronologically with the
 * same extension math the grant used: each payment's window starts at
 * max(current end, that payment's granted_at) and adds its added_months.
 * An empty survivor list collapses to `start` (the epoch unless the row was
 * queued behind an earlier surviving row).
 */
function recomputeExpiryFromEntries(surviving: RevokeEntry[], start: Date = new Date(0)): Date {
  // A stacked row start can include the refunded window. Only the surviving
  // payments, queued after any surviving earlier row, establish the window.
  let end = start;
  const sorted = [...surviving].sort(
    (a, b) => Date.parse(a.granted_at) - Date.parse(b.granted_at)
  );
  for (const e of sorted) {
    const grantedMs = Date.parse(e.granted_at);
    if (!Number.isFinite(grantedMs)) throw new Error("Invalid surviving payment grant date");
    const base = grantedMs > end.getTime() ? new Date(grantedMs) : end;
    if (!Number.isInteger(e.added_months) || e.added_months < 0) {
      throw new Error("Invalid surviving payment duration");
    }
    // A zero-month entry is the original trial: its recorded end, else the
    // 7-day trial plus its 1-day floor. It never extends a later paid window.
    end = e.added_months === 0
      ? new Date(Math.max(end.getTime(), trialEndMs(e, grantedMs)))
      : computeExpiry(e.added_months, base);
  }
  return end;
}

const TRIAL_FLOOR_MS = 8 * 86400_000;
const STACK_TOLERANCE_MS = 60_000;
// trial/verify records the membership's real trial end. Anything missing or
// outside one month of the grant falls back to the standard 8-day window.
function trialEndMs(e: RevokeEntry, grantedMs: number): number {
  const recorded = Date.parse(e.trial_ends_at ?? "");
  return Number.isFinite(recorded) && recorded >= grantedMs && recorded <= grantedMs + 31 * 86400_000
    ? recorded : grantedMs + TRIAL_FLOOR_MS;
}

interface RevokeEntry {
  payment_id: string;
  amount_cents: number | null;
  added_months: number;
  granted_at: string;
  trial_ends_at?: string;
}

interface RevokeSub {
  id: string;
  user_id: string;
  tier: string;
  status: string;
  expires_at: string | null;
  amount_cents: number | null;
  started_at: string | null;
  provider_payment_id: string | null;
  updated_at: string | null;
  whop_membership_id: string | null;
  granted_payment_ids: RevokeEntry[] | null;
}

// Verify-first trial rows written before trial provenance carry no zero-month
// entry: verify stamped started_at at trial start and only later paid
// renewals were recorded. Reconstruct that original trial from started_at.
// A row first created by a paid grant has started_at == its first grant.
function revokeEntries(sub: RevokeSub): RevokeEntry[] {
  const entries = (sub.granted_payment_ids ?? []).filter(entry => entry?.payment_id);
  if (sub.tier !== "notes_pro_trial" || entries.some(entry => entry.added_months === 0)) return entries;
  const startedMs = Date.parse(sub.started_at ?? "");
  if (!Number.isFinite(startedMs) ||
      entries.some(entry => !(Date.parse(entry.granted_at) > startedMs + STACK_TOLERANCE_MS))) return entries;
  return [{ payment_id: `trial:${sub.id}`, amount_cents: 0, added_months: 0,
    granted_at: new Date(startedMs).toISOString() }, ...entries];
}

// A legacy stacked row was queued behind other time: its window starts after
// its own first payment. Only such rows inherit a queue position.
function isStackedRow(sub: RevokeSub, entries: RevokeEntry[]): boolean {
  const startedMs = Date.parse(sub.started_at ?? "");
  const grants = entries.map(entry => Date.parse(entry.granted_at));
  return Number.isFinite(startedMs) && grants.length > 0 && grants.every(Number.isFinite) &&
    startedMs > Math.min(...grants) + STACK_TOLERANCE_MS;
}

// The grant writes provider_payment_id, so it proves that payment granted the
// row even on a pre-history (before Fix 6) row with no granted_payment_ids
// entry. A membership pin alone never does. With `kind`, a row already in
// that revoked state is not re-processed on a retry.
function grantsCandidate(sub: RevokeSub, candidates: string[], kind?: WhopRevokeKind): boolean {
  return (sub.granted_payment_ids ?? []).some(entry => !!entry?.payment_id && candidates.includes(entry.payment_id)) ||
    (!!sub.provider_payment_id && candidates.includes(sub.provider_payment_id) && sub.status !== kind);
}

const REVOKE_COLUMNS = "id, user_id, tier, status, expires_at, amount_cents, started_at, provider_payment_id, granted_payment_ids, whop_membership_id, updated_at";
interface RevokeOwner {
  tier: string; role: string; tier_expires_at: string | null; updated_at: string | null;
}
interface PendingWhopRevoke {
  state: "pending" | "complete";
  user_id: string;
  event: string;
  kind: WhopRevokeKind;
  independent_coverage: boolean;
  owner_snapshot: RevokeOwner;
  entitlement_update?: RevokeOwner;
  subscription_owner_snapshot?: RevokeOwner;
  payment_candidates: string[];
  original_subscriptions: RevokeSub[];
  ledger_applied?: boolean;
  updates: Array<{ id: string; snapshot: RevokeSub; values: {
    status?: string; cancelled_at?: string; expires_at?: string; amount_cents?: number | null;
    provider_payment_id?: string; granted_payment_ids?: unknown[]; updated_at: string;
  } }>;
  flipped_ids: string[];
  kept_active_ids: string[];
}

function planWhopRevoke(pending: PendingWhopRevoke, rows: RevokeSub[]): PendingWhopRevoke {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const candidates = pending.payment_candidates;
  const byStart = (a: RevokeSub, b: RevokeSub) =>
    (Date.parse(a.started_at ?? "") || 0) - (Date.parse(b.started_at ?? "") || 0) || a.id.localeCompare(b.id);
  const active = rows.filter(row => row.status === "active");
  const affected = rows.filter(row => pending.original_subscriptions.some(original => original.id === row.id) ||
    (row.status === "active" && grantsCandidate(row, candidates)));
  const affectedIds = new Set(affected.map(row => row.id));
  // A retry may resume after this refund already left a row: the original
  // snapshot still proves that later stacked rows lost their queue position.
  const originallyMatched = new Set(pending.original_subscriptions
    .filter(row => grantsCandidate(row, candidates)).map(row => row.id));
  const owners = new Map<string, string>();
  const ordered = [...active].sort(byStart);
  for (const row of ordered) {
    if (row.provider_payment_id && !owners.has(row.provider_payment_id)) owners.set(row.provider_payment_id, row.id);
  }
  const canonical = new Map<string, string>();
  for (const row of [...ordered, ...affected.filter(row => row.status !== "active")]) {
    for (const entry of row.granted_payment_ids ?? []) {
      if (!entry?.payment_id || candidates.includes(entry.payment_id)) continue;
      const metadata = JSON.stringify(entry, Object.keys(entry).sort());
      if (canonical.has(entry.payment_id) && canonical.get(entry.payment_id) !== metadata) {
        throw new Error("Conflicting surviving payment metadata");
      }
      canonical.set(entry.payment_id, metadata);
      if (row.status === "active" && !owners.has(entry.payment_id)) owners.set(entry.payment_id, row.id);
    }
  }
  const survivorsOf = (sub: RevokeSub, entries: RevokeEntry[]) =>
    [...new Map(entries.filter(entry => !candidates.includes(entry.payment_id) &&
      (!owners.has(entry.payment_id) || owners.get(entry.payment_id) === sub.id))
      .map(entry => [entry.payment_id, entry])).values()]
      .sort((a, b) => Date.parse(a.granted_at) - Date.parse(b.granted_at) || a.payment_id.localeCompare(b.payment_id));
  const plan: PendingWhopRevoke = { ...pending, updates: [], flipped_ids: [], kept_active_ids: [] };
  // Walk affected and active rows in queue order. A stacked row's surviving
  // window starts after the latest surviving earlier row, never after time
  // that this refund removed.
  let queueEnd = 0;
  let queueUnbounded = false;
  let changedBefore = false;
  const sequence = [...new Map([...affected, ...active].map(row => [row.id, row])).values()].sort(byStart);
  for (const sub of sequence) {
    const entries = revokeEntries(sub);
    const matched = candidates.length > 0 && grantsCandidate(sub, candidates, pending.kind);
    const storedMs = sub.expires_at == null ? null : Date.parse(sub.expires_at);
    const stacked = isStackedRow(sub, entries);
    // undefined: this row no longer covers anything after the plan.
    let endMs: number | null | undefined = sub.status === "active" ? storedMs : undefined;
    const windowFor = (surviving: RevokeEntry[]) => {
      const rebuilt = recomputeExpiryFromEntries(surviving, new Date(stacked ? queueEnd : 0)).getTime();
      return storedMs != null && Number.isFinite(storedMs) ? Math.min(rebuilt, storedMs) : rebuilt;
    };
    if (!affectedIds.has(sub.id) || (candidates.length > 0 && !matched)) {
      // Untouched by this payment: never replay saved survivor values over
      // the current ledger, but a stacked row still loses removed queue time.
      if (sub.status === "active" && candidates.length > 0 && changedBefore && stacked && !queueUnbounded &&
          storedMs != null && Number.isFinite(storedMs)) {
        const rebuilt = windowFor(survivorsOf(sub, entries));
        if (rebuilt < storedMs) {
          plan.updates.push({ id: sub.id, snapshot: sub, values: { expires_at: new Date(rebuilt).toISOString(), updated_at: nowIso } });
          endMs = rebuilt;
        }
      }
      if (affectedIds.has(sub.id)) {
        // A prior attempt (or another refund) already removed these payments.
        if (sub.status === "active") plan.kept_active_ids.push(sub.id);
        else if (sub.status === pending.kind) plan.flipped_ids.push(sub.id);
        if (originallyMatched.has(sub.id)) changedBefore = true;
      } else if (endMs !== storedMs && endMs != null && endMs > nowMs) {
        plan.kept_active_ids.push(sub.id);
      }
    } else if (pending.kind === "cancelled" && sub.status === "active" && sub.tier === "notes_pro_trial" &&
        Number(sub.amount_cents ?? 0) === 0 && entries.every(entry => entry.added_months === 0) &&
        sub.expires_at && Date.parse(sub.expires_at) > nowMs) {
      plan.kept_active_ids.push(sub.id);
    } else if (!matched && pending.kind === "cancelled" && candidates.length === 0 && sub.status === "active" &&
        stacked && storedMs != null && Number.isFinite(storedMs) && storedMs > nowMs) {
      // a-renew-early (same branch as commit_whop_revoke in 20270104090000):
      // a membership-only cancellation of a row queued behind earlier time
      // keeps its paid window to expires_at (Whop bills that membership from
      // its purchase, the row runs from the old end).
      plan.kept_active_ids.push(sub.id);
    } else if (!matched) {
      endMs = undefined;
      if (sub.status === pending.kind) { plan.flipped_ids.push(sub.id); continue; }
      // A membership-only cancellation has no removable payment identity.
      // A changed row requires the transactional RPC, never a stale overwrite.
      const original = pending.original_subscriptions.find(row => row.id === sub.id);
      if (!original || JSON.stringify(sub) !== JSON.stringify(original)) throw new Error("Membership ledger changed; retry atomically");
      plan.updates.push({ id: sub.id, snapshot: sub, values: { status: pending.kind, cancelled_at: nowIso,
        granted_payment_ids: (sub.granted_payment_ids ?? []).filter(entry => entry?.payment_id), updated_at: nowIso } });
      plan.flipped_ids.push(sub.id);
    } else {
      changedBefore = true;
      const surviving = survivorsOf(sub, entries);
      const expiresMs = windowFor(surviving);
      // The grant path can leave the paid renewal amount on a trial-tier row.
      // Restore zero-only trial provenance; paid survivors retain their amount.
      const amountCents = surviving.length > 0 && surviving.every(entry => entry.added_months === 0) ? 0 : sub.amount_cents;
      if (sub.status === "active" && surviving.length > 0 && expiresMs > nowMs) {
        plan.updates.push({ id: sub.id, snapshot: sub, values: { expires_at: new Date(expiresMs).toISOString(), amount_cents: amountCents,
          provider_payment_id: surviving[surviving.length - 1].payment_id, granted_payment_ids: surviving, updated_at: nowIso } });
        plan.kept_active_ids.push(sub.id);
        endMs = expiresMs;
      } else {
        plan.updates.push({ id: sub.id, snapshot: sub, values: { status: pending.kind, cancelled_at: nowIso,
          amount_cents: amountCents, granted_payment_ids: surviving, updated_at: nowIso } });
        plan.flipped_ids.push(sub.id);
        // Surviving paid time that already elapsed still precedes later
        // queued rows; only a row with no surviving payment leaves the queue.
        endMs = sub.status === "active" && surviving.length > 0 ? expiresMs : undefined;
      }
    }
    if (endMs === null) queueUnbounded = true;
    else if (endMs !== undefined && Number.isFinite(endMs)) queueEnd = Math.max(queueEnd, endMs);
  }
  return plan;
}

// PostgREST timestamps may use +00:00 and six fractional digits, while
// planned writes use JavaScript ISO Z strings. Compare instants, retaining
// PostgreSQL's sub-millisecond version precision for updated_at snapshots.
function sameTimestamp(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null || !Number.isFinite(Date.parse(a)) || Date.parse(a) !== Date.parse(b)) return false;
  const micros = (value: string) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i)?.[1] ?? "")
    .padEnd(6, "0").slice(3, 6);
  return micros(a) === micros(b);
}

// Provenance compares the entitlement only. users.updated_at also moves on
// profile edits, so it is a CAS version for the write, never proof of a
// grant. Every audited grant (admin_grant_entitlement) moves the expiry.
function sameOwner(a: RevokeOwner, b: RevokeOwner | undefined): boolean {
  return !!b && a.tier === b.tier && a.role === b.role && sameTimestamp(a.tier_expires_at, b.tier_expires_at);
}

// Durable intent plus fresh-ledger compare-and-swap writes makes removal
// idempotent even when a write succeeds but the following receipt write fails.
async function finishPendingWhopRevoke(
  sb: ReturnType<typeof getServiceClient>, claimKey: string, pending: PendingWhopRevoke
): Promise<NextResponse> {
  const userId = pending.user_id;
  try {
    if (!pending.owner_snapshot || !pending.original_subscriptions || !pending.payment_candidates) {
      throw new Error("Legacy pending revoke requires atomic reconciliation");
    }
    const { data: freshRows, error: ledgerReadError } = await sb.from("subscriptions")
      .select(REVOKE_COLUMNS).eq("user_id", userId).eq("payment_provider", "whop");
    if (ledgerReadError) throw ledgerReadError;
    const { data: beforeOwner, error: beforeOwnerError } = await sb.from("users")
      .select("tier, role, tier_expires_at, updated_at").eq("id", userId).maybeSingle();
    if (beforeOwnerError || !beforeOwner) throw beforeOwnerError ?? new Error("Account coverage unavailable");
    const coveringBefore = (freshRows ?? []).filter(row => row.status === "active" &&
      (row.expires_at == null || Date.parse(row.expires_at) > Date.now()));
    const expiryBefore = coveringBefore.length === 0 ? undefined : coveringBefore.some(row => row.expires_at == null) ? null
      : new Date(Math.max(...coveringBefore.map(row => Date.parse(row.expires_at!)))).toISOString();
    const representedOriginal = pending.independent_coverage && sameOwner(beforeOwner as RevokeOwner, pending.owner_snapshot);
    if (sameTimestamp(beforeOwner.tier_expires_at, expiryBefore) && (representedOriginal ||
        (!sameOwner(beforeOwner as RevokeOwner, pending.owner_snapshot) &&
         !sameOwner(beforeOwner as RevokeOwner, pending.subscription_owner_snapshot)))) {
      // Another grant/revoke may already have reconciled this user's current
      // ledger. Persist that observation BEFORE removal, so a failed phase
      // write cannot make its unreconciled expiry look like a manual grant.
      // A purchase between the initial ledger and owner reads can make the
      // original independence decision stale too. Current ledger provenance
      // takes precedence over that earlier inferred decision.
      pending = { ...pending, subscription_owner_snapshot: beforeOwner as RevokeOwner,
        independent_coverage: representedOriginal ? false : pending.independent_coverage };
      const { error } = await sb.from("processed_webhook_events").update({ payload: pending })
        .eq("provider", "whop").eq("event_id", claimKey);
      if (error) throw error;
    }
    pending = planWhopRevoke(pending, (freshRows ?? []) as RevokeSub[]);
    for (const update of pending.updates) {
      let write = sb.from("subscriptions").update(update.values).eq("id", update.id).eq("user_id", userId)
        .eq("payment_provider", "whop");
      const snapshot = update.snapshot;
      for (const column of ["tier", "status", "expires_at", "amount_cents", "started_at", "provider_payment_id", "whop_membership_id", "updated_at"] as const) {
        write = snapshot[column] == null ? write.is(column, null) : write.eq(column, snapshot[column]);
      }
      write = snapshot.granted_payment_ids == null ? write.is("granted_payment_ids", null)
        : write.filter("granted_payment_ids", "eq", JSON.stringify(snapshot.granted_payment_ids));
      const { data: changed, error } = await write.select("id");
      if (error) throw error;
      if (changed?.length !== 1) throw new Error("Subscription changed; retry revoke from fresh ledger");
    }
    pending = { ...pending, ledger_applied: true };
    const { error: phaseError } = await sb.from("processed_webhook_events").update({ payload: pending })
      .eq("provider", "whop").eq("event_id", claimKey);
    if (phaseError) throw phaseError;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const { data: activeRows, error: coverageError } = await sb.from("subscriptions")
      .select("id, expires_at").eq("user_id", userId).eq("status", "active");
    if (coverageError) throw coverageError;
    const coverage = (activeRows ?? []).filter(row => row.expires_at == null || Date.parse(row.expires_at) > nowMs);
    const keptIds = Array.from(new Set([...pending.kept_active_ids, ...coverage.map(row => row.id)]));
    const covered = coverage.length > 0;
    let proRevoked = false;
    const { data: currentOwner, error: ownerError } = await sb.from("users")
      .select("tier, role, tier_expires_at, updated_at").eq("id", userId).maybeSingle();
    if (ownerError || !currentOwner) throw ownerError ?? new Error("Account coverage unavailable");
    const current = currentOwner as RevokeOwner;
    const unchangedOwner = sameOwner(current, pending.owner_snapshot);
    const ownPreviousWrite = sameOwner(current, pending.entitlement_update) ||
      sameOwner(current, pending.subscription_owner_snapshot);
    // A changed live Pro entitlement not explained by current subscription
    // coverage is an independent owner grant. The original unreconciled
    // refunded expiry is explicitly exempt from this inference.
    const coveringExpiry = covered ? (coverage.some(row => row.expires_at == null) ? null
      : new Date(Math.max(...coverage.map(row => Date.parse(row.expires_at!)))).toISOString()) : undefined;
    const independent = current.role === "admin" || current.tier === "admin" ||
      (unchangedOwner && pending.independent_coverage) ||
      (!unchangedOwner && !ownPreviousWrite && current.tier === "pro" &&
        (current.tier_expires_at == null || Date.parse(current.tier_expires_at) > nowMs) &&
        !sameTimestamp(current.tier_expires_at, coveringExpiry));
    let desired: RevokeOwner | undefined;
    if (!independent) {
      if (keptIds.length > 0 && covered) {
        // Surviving paid coverage establishes Pro as well as its window: a
        // preceding grant may have written the row but not the user.
        desired = { ...current, tier: "pro", tier_expires_at: coveringExpiry!, updated_at: nowIso };
      } else if (!covered) {
        const days = Number((process.env.WHOP_DUNNING_GRACE_DAYS ?? "7").trim() || "7");
        const since = new Date(nowMs - (Number.isFinite(days) && days > 0 ? days : 7) * 86400_000).toISOString();
        const { data: recoveries, error: recoveryError } = await sb.from("processed_webhook_events")
          .select("event_id").eq("provider", "whop").like("event_id", "recover:%")
          .eq("payload->>user_id", userId).gte("processed_at", since).limit(1);
        if (recoveryError) throw recoveryError;
        if ((recoveries ?? []).length > 0) {
          await recordEvent(sb, userId, "whop_revoke_deferred_dunning", {
            event: pending.event, kind: pending.kind, affected_subscription_ids: pending.flipped_ids,
            note: "user downgrade skipped: dunning recovery in flight",
          });
        } else {
          desired = { ...current, tier: "free", tier_expires_at: null, updated_at: nowIso };
          proRevoked = true;
        }
      }
    }
    if (desired) {
      // Save the intended output BEFORE the user CAS. On a completion failure
      // we recognize our own write without confusing it with a manual grant.
      pending = { ...pending, entitlement_update: desired };
      const { error: intentError } = await sb.from("processed_webhook_events").update({ payload: pending })
        .eq("provider", "whop").eq("event_id", claimKey);
      if (intentError) throw intentError;
      let write = sb.from("users").update({ tier: desired.tier, tier_expires_at: desired.tier_expires_at, updated_at: nowIso })
        .eq("id", userId).eq("tier", current.tier).eq("role", current.role);
      write = current.tier_expires_at == null ? write.is("tier_expires_at", null) : write.eq("tier_expires_at", current.tier_expires_at);
      write = current.updated_at == null ? write.is("updated_at", null) : write.eq("updated_at", current.updated_at);
      const { data: changed, error } = await write.select("id");
      if (error) throw error;
      if (changed?.length !== 1) throw new Error("Account entitlement changed; retry reconciliation");
    }
    // Mark complete only AFTER the user entitlement write succeeds. Even a
    // failed completion write is retryable with the same durable plan.
    const { error: receiptError } = await sb.from("processed_webhook_events")
      .update({ payload: { ...pending, state: "complete" } })
      .eq("provider", "whop").eq("event_id", claimKey);
    if (receiptError) throw receiptError;
    const referralReversed = pending.kind === "refunded"
      ? await reverseRefereeReferral(sb, userId, pending.event) : false;
    await recordEvent(sb, userId, "whop_subscription_revoked", {
      event: pending.event, kind: pending.kind,
      affected_subscription_ids: [...pending.flipped_ids, ...keptIds],
      flipped_ids: pending.flipped_ids, partial_kept_active_ids: keptIds,
      pro_revoked: proRevoked, had_other_active: covered, referral_reversed: referralReversed,
    });
    return NextResponse.json({ ok: true, revoked: true, kind: pending.kind,
      subscriptions: pending.flipped_ids.length + keptIds.length,
      partial_kept: keptIds.length, pro_revoked: proRevoked, referral_reversed: referralReversed });
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "webhooks/whop", step: "revoke_pending_resume" }, extra: { userId } });
    return NextResponse.json({ error: "Revoke pending; retry reconciliation" }, { status: 503 });
  }
}

/**
 * a-fo-09 (flag on, refund class only; cancellations keep the old call): an
 * unmatched refund or dispute is a ledger row, written with its error read.
 * One that names a payment becomes a PENDING revoke in the shared bucket (the
 * grant side finds it by payment id, whoever the buyer turns out to be),
 * stored once per payment set (refund.created, refund.updated and
 * payment.refunded of one refund add no second row); one without a payment
 * id keeps the learner bucket, or the shared one when no learner is known
 * (user_id is NOT NULL, so a null used to drop the row). Returns a 503
 * response when the read or write failed (no claim was taken, so Whop's retry
 * stores it), else null.
 */
async function storeUnmatchedRevoke(
  sb: ReturnType<typeof getServiceClient>,
  kind: WhopRevokeKind,
  paymentCandidates: string[],
  userId: string | null,
  base: Record<string, unknown>
): Promise<NextResponse | null> {
  const pending = isPendingRevokeCandidate(kind, paymentCandidates);
  if (pending) {
    const existing = await findPendingRevokes(sb, paymentCandidates[0]);
    if (existing.error !== null) {
      Sentry.captureMessage(`Whop pending revoke lookup failed (${existing.error}); Whop will retry`, "warning");
      return NextResponse.json({ error: "Revoke not recorded; retry" }, { status: 503 });
    }
    if (pendingAlreadyStored(existing.rows, paymentCandidates)) return null;
  }
  const write = await recordLedgerEvent(
    sb,
    pending ? PENDING_REVOKE_USER : userId ?? PENDING_REVOKE_USER,
    REVOKE_UNMATCHED_EVENT,
    // The payer email is never stored in these rows (ops act on Whop ids).
    pending ? pendingRevokeData(base, paymentCandidates, userId) : { ...base, email: undefined }
  );
  if (write.ok) return null;
  Sentry.captureMessage(`Whop unmatched revoke could not be stored (${write.error}); Whop will retry`, "error");
  return NextResponse.json({ error: "Revoke not recorded; retry" }, { status: 503 });
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

  // a-mentor-open: a refund or dispute of a referee's charge claws back the
  // referral mentor lot it earned. Independent of the Pro revoke below,
  // idempotent, never throws; on every refund it does a few keyed reads.
  if (kind === "refunded") {
    await clawbackReferralMentorCredit(getServiceClient({ fastFail: false }), [r.paymentId, r.originalPaymentId].filter((x): x is string => Boolean(x)), event);
  }

  try {
    const sb = getServiceClient({ fastFail: false });
    const { data: priorReceipt, error: receiptReadError } = await sb.from("processed_webhook_events")
      .select("event_id, payload").eq("provider", "whop").eq("event_id", claimKey).maybeSingle();
    if (receiptReadError) return NextResponse.json({ error: "Could not verify revoke receipt" }, { status: 503 });
    if (priorReceipt) {
      if (priorReceipt.payload?.state === "pending") {
        return finishPendingWhopRevoke(sb, claimKey, priorReceipt.payload as PendingWhopRevoke);
      }
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // ── Find the affected whop subscription(s) ── (BEFORE the idempotency
    // claim, deliberately — see nowpayments webhook §intermediate-states.
    // If we can't match a sub yet, we must NOT consume the idempotency key,
    // or a Whop retry after the row exists would dedupe and never revoke.)
    // Refund/dispute: join on provider_payment_id (the grant stored the
    // payment id there) — Fix 6 (2026-09-21) ALSO matches any entry in the
    // row's granted_payment_ids history, because with extend semantics the
    // latest payment overwrites provider_payment_id while OLDER payments
    // contributed windows on the same row. Try the event's payment id first,
    // then the explicit original/parent payment id.
    const paymentCandidates = Array.from(
      new Set([r.paymentId, r.originalPaymentId].filter((x): x is string => Boolean(x)))
    );


    let subs: RevokeSub[] = [];
    if (paymentCandidates.length > 0) {
      const { data: byPay, error: byPayErr } = await sb
        .from("subscriptions")
        .select(
          REVOKE_COLUMNS
        )
        .eq("payment_provider", "whop")
        .in("provider_payment_id", paymentCandidates);
      if (byPayErr) {
        Sentry.captureException(byPayErr, { tags: { route: "webhooks/whop", step: "revoke_sub_lookup" } });
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      subs = (byPay ?? []) as RevokeSub[];

      if (subs.length === 0) {
        // Fix 6: scan the user's active whop rows for a granted_payment_ids
        // entry carrying one of the payment candidates (the refunded payment
        // is an OLDER payment on an extended row). The active-whop set is
        // small (real payers), so a scan is cheap and avoids jsonb queries
        // PostgREST can't express cleanly.
        const { data: allActive, error: scanErr } = await sb
          .from("subscriptions")
          .select(
            REVOKE_COLUMNS
          )
          .eq("payment_provider", "whop")
          .eq("status", "active");
        if (scanErr) {
          Sentry.captureException(scanErr, { tags: { route: "webhooks/whop", step: "revoke_granted_ids_scan" } });
          return NextResponse.json({ error: "Could not verify payment history" }, { status: 503 });
        } else {
          subs = ((allActive ?? []) as RevokeSub[]).filter((s) =>
            (s.granted_payment_ids ?? []).some(
              (e) => e.payment_id && paymentCandidates.includes(e.payment_id)
            )
          );
        }
      }
    }

    if (subs.length === 0 && r.membershipId) {
      const { data: byMembership, error: membershipErr } = await sb
        .from("subscriptions")
        .select(
          REVOKE_COLUMNS
        )
        .eq("payment_provider", "whop")
        .eq("whop_membership_id", r.membershipId);
      if (membershipErr) {
        Sentry.captureException(membershipErr, {
          tags: { route: "webhooks/whop", step: "revoke_membership_lookup" },
        });
      } else {
        subs = (byMembership ?? []) as RevokeSub[];
      }
    }

    // Resolve the affected user. From the matched sub if we have one; else via
    // the shared buyer resolver (fix A: membership pin / metadata / checkout
    // session / Whop membership API, email last).
    let userId: string | null = subs[0]?.user_id ?? null;
    if (!userId) {
      const buyer = await resolveWhopBuyer(sb, {
        membershipId: r.membershipId,
        metaUserId: r.metaUserId,
        checkoutConfigId: r.checkoutConfigId,
        email: r.email,
      });
      if (buyer.kind === "provider_unavailable") {
        return NextResponse.json({ error: "membership lookup unavailable, retry" }, { status: 503 });
      }
      // Review fix: an email-only match for a MEMBERSHIP event is the payer's
      // email account, not necessarily the subscriber (Mezoo case). Never
      // revoke on that; fall to the loud unmatched branch below.
      userId =
        buyer.kind === "resolved" && !(buyer.source === "email" && r.membershipId)
          ? buyer.userId
          : null;
    }

    // If we still matched no sub but DID resolve a user (membership event with
    // no payment id), target that user's active whop subscription(s).
    if (subs.length === 0 && userId) {
      const { data: byUser } = await sb
        .from("subscriptions")
        .select(REVOKE_COLUMNS)
        .eq("payment_provider", "whop")
        .eq("user_id", userId)
        .eq("status", "active");
      // a-renew-early: a membership event never flips a row pinned to ANOTHER
      // membership (an extension or a switch has its own row and pin); only
      // rows without a real pin are left for it, as before.
      const eventPin = whopMembershipIdOrNull(r.membershipId);
      subs = ((byUser ?? []) as typeof subs).filter((sub) => {
        if (!eventPin || paymentCandidates.length > 0) return true;
        const rowPin = whopMembershipIdOrNull(sub.whop_membership_id);
        return !rowPin || rowPin === eventPin;
      });
    }

    if (subs.length === 0 || !userId) {
      // Nothing to revoke that we can identify. Loud, not silent — record +
      // Sentry so a real refund that we failed to match gets manual attention.
      Sentry.captureMessage(
        `Whop revoke '${event}' matched no whop subscription (paymentCandidates=${paymentCandidates.join(",") || "none"} membership=${r.membershipId ?? "none"} user=${userId ?? "unmapped"}) — manual revoke may be needed`,
        "warning"
      );
      const unmatched = {
        event,
        kind,
        payment_id: r.paymentId,
        original_payment_id: r.originalPaymentId,
        membership_id: r.membershipId,
        email: r.email,
      };
      if (pendingRevokeEnabled() && kind === "refunded") {
        const stored = await storeUnmatchedRevoke(sb, kind, paymentCandidates, userId, unmatched);
        if (stored) return stored;
      } else {
        await recordEvent(getServiceClient({ fastFail: false }), userId, "whop_revoke_unmatched", unmatched);
      }
      return NextResponse.json(
        { ok: false, error: "revoke matched no subscription", event },
        { status: 200 }
      );
    }

    // A direct payment match does not exhaust the affected history: old
    // reconciliation artifacts can copy that payment into a second row.
    // Read every active Whop row for this user before the idempotency claim,
    // both to remove all copies and to avoid counting another row's payment.
    const { data: activeWhop, error: activeWhopError } = await sb
      .from("subscriptions")
      .select(REVOKE_COLUMNS)
      .eq("payment_provider", "whop")
      .eq("user_id", userId)
      .eq("status", "active");
    if (activeWhopError) {
      Sentry.captureException(activeWhopError, { tags: { route: "webhooks/whop", step: "revoke_user_history_scan" } });
      return NextResponse.json({ error: "Could not verify payment history" }, { status: 503 });
    }
    const activeWhopRows = (activeWhop ?? []) as RevokeSub[];
    const affected = new Map(subs.map(sub => [sub.id, sub]));
    for (const sub of activeWhopRows) {
      if ((sub.granted_payment_ids ?? []).some(entry => paymentCandidates.includes(entry.payment_id))) {
        affected.set(sub.id, sub);
      }
    }
    subs = [...affected.values()];

    // A membership pin identifies the account, not proof that this payment
    // granted time. Never turn an unknown payment refund into a full revoke.
    if (paymentCandidates.length > 0 && !subs.some(sub => grantsCandidate(sub, paymentCandidates))) {
      Sentry.captureMessage(
        `Whop revoke '${event}' matched no granted payment (paymentCandidates=${paymentCandidates.join(",")} membership=${r.membershipId ?? "none"} user=${userId})`,
        "warning"
      );
      const unmatched = {
        event, kind, payment_id: r.paymentId, original_payment_id: r.originalPaymentId,
        membership_id: r.membershipId, reason: "no_granted_payment_match",
      };
      if (pendingRevokeEnabled() && kind === "refunded") {
        const stored = await storeUnmatchedRevoke(sb, kind, paymentCandidates, userId, unmatched);
        if (stored) return stored;
      } else {
        await recordEvent(sb, userId, "whop_revoke_unmatched", unmatched);
      }
      return NextResponse.json({ ok: false, error: "revoke matched no subscription", event }, { status: 200 });
    }

    if (process.env.WHOP_ATOMIC_GRANTS_ENABLED === "true") {
      const graceValue = Number((process.env.WHOP_DUNNING_GRACE_DAYS ?? "7").trim() || "7");
      const { data: committed, error: commitError } = await sb.rpc("commit_whop_revoke", {
        p_user_id: userId, p_claim_key: claimKey, p_kind: kind, p_event: event,
        p_expected_subscriptions: subs, p_payment_candidates: paymentCandidates,
        p_grace_days: Number.isFinite(graceValue) && graceValue > 0 ? graceValue : 7,
      });
      const result = Array.isArray(committed) ? committed[0] : null;
      if (commitError || !result || !Array.isArray(result.kept_active_ids) || !Array.isArray(result.flipped_ids) ||
          typeof result.pro_revoked !== "boolean" || typeof result.replayed !== "boolean") {
        Sentry.captureException(commitError ?? new Error("Invalid atomic revoke result"), {
          tags: { route: "webhooks/whop", step: "atomic_revoke" },
        });
        return NextResponse.json({ error: "Revoke pending; retry from fresh subscription state" }, { status: 503 });
      }
      // Referral reversal is independently idempotent (already-reversed rows
      // are excluded). A duplicate retries that best-effort side effect.
      const referralReversed = kind === "refunded" ? await reverseRefereeReferral(sb, userId, event) : false;
      if (result.replayed) return NextResponse.json({ ok: true, duplicate: true, referral_reversed: referralReversed });
      await recordEvent(sb, userId, "whop_subscription_revoked", {
        event, kind, affected_subscription_ids: [...result.flipped_ids, ...result.kept_active_ids],
        flipped_ids: result.flipped_ids, partial_kept_active_ids: result.kept_active_ids,
        pro_revoked: result.pro_revoked, had_other_active: result.had_other_active,
        referral_reversed: referralReversed, atomic: true,
      });
      return NextResponse.json({ ok: true, revoked: true, kind,
        subscriptions: result.flipped_ids.length + result.kept_active_ids.length,
        partial_kept: result.kept_active_ids.length, pro_revoked: result.pro_revoked,
        referral_reversed: referralReversed });
    }

    // Read coverage before claiming or mutating: an independent manual grant
    // is not owned by the membership being revoked. Read failures must retry.
    const { data: coverageOwner, error: coverageError } = await sb
      .from("users")
      .select("tier, role, tier_expires_at, updated_at")
      .eq("id", userId)
      .maybeSingle();
    if (coverageError || !coverageOwner) {
      return NextResponse.json({ error: "Could not verify account coverage" }, { status: 503 });
    }
    const ownerExpiryMs = Date.parse(coverageOwner.tier_expires_at ?? "");
    const affectedExpiryMs = Math.max(...subs.map((sub) => Date.parse(sub.expires_at ?? "")).filter(Number.isFinite));
    // An owner expiry (including NULL) that current Whop coverage explains is
    // subscription-owned, not an independent grant, even when it is longer
    // than the affected rows (a stacked row or a non-expiring Whop row).
    const whopCovering = activeWhopRows.filter(row => row.expires_at == null || Date.parse(row.expires_at) > Date.now());
    const whopCoverExpiry = whopCovering.length === 0 ? undefined : whopCovering.some(row => row.expires_at == null) ? null
      : new Date(Math.max(...whopCovering.map(row => Date.parse(row.expires_at!)))).toISOString();
    const whopExplained = whopCoverExpiry !== undefined && sameTimestamp(coverageOwner.tier_expires_at, whopCoverExpiry);
    const independentCoverage = coverageOwner.role === "admin" || coverageOwner.tier === "admin" ||
      (coverageOwner.tier === "pro" && !whopExplained && (coverageOwner.tier_expires_at == null ||
        (Number.isFinite(ownerExpiryMs) && ownerExpiryMs > Date.now() && ownerExpiryMs > affectedExpiryMs)));

    let pending: PendingWhopRevoke;
    try {
      pending = planWhopRevoke({
        state: "pending", user_id: userId, event, kind, independent_coverage: independentCoverage,
        owner_snapshot: coverageOwner as RevokeOwner, payment_candidates: paymentCandidates,
        original_subscriptions: subs, updates: [], flipped_ids: [], kept_active_ids: [],
      }, [...activeWhopRows, ...subs.filter(sub => !activeWhopRows.some(row => row.id === sub.id))]);
    } catch (error) {
      Sentry.captureException(error, { tags: { route: "webhooks/whop", step: "revoke_recompute_window" } });
      return NextResponse.json({ error: "Could not verify remaining payment window" }, { status: 503 });
    }
    const { data: claim, error: claimError } = await sb.from("processed_webhook_events")
      .insert({ provider: "whop", event_id: claimKey, payload: pending }).select("event_id").maybeSingle();
    if (claimError || !claim) {
      // A concurrent delivery may have created a pending receipt. Never ACK
      // it as completed; redelivery reads and resumes it at the entry point.
      return NextResponse.json({ error: "Revoke pending; retry receipt" }, { status: 503 });
    }
    return finishPendingWhopRevoke(sb, claimKey, pending);
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
 *      recovery link, DE copy honest about what happened. A mail that
 *      certainly did not go out answers 503 once so Whop redelivers and the
 *      mail is tried one more time (src/lib/whop-dunning-claim.ts); every
 *      other email failure answers 200 and is Sentry-flagged.
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
  const rawRecoveryUrl = str(d.recovery_url) ?? str(d.recoveryUrl);
  // Only ever link the buyer to an https Whop URL.
  const recoveryUrl =
    rawRecoveryUrl && /^https:\/\/([a-z0-9-]+\.)*whop\.com\//i.test(rawRecoveryUrl) ? rawRecoveryUrl : null;
  const status = str(d.status);

  console.info(
    `[whop webhook] RECOVERY event=${event} paymentId=${f.paymentId ?? "(none)"} status=${status ?? "(none)"} hasRecoveryUrl=${Boolean(recoveryUrl)}`
  );

  const sb = getServiceClient({ fastFail: false });

  // ── Resolve the subscriber FIRST (fix A), so the claim can record whose
  // dunning this is and the grace guard can filter by user (fix B). The old
  // metadata-then-email order emailed the Whop payer's email account. ──
  const buyer = await resolveWhopBuyer(sb, {
    membershipId: f.membershipId,
    metaUserId: f.metaUserId,
    membershipMetaUserId: f.membershipMetaUserId,
    checkoutConfigId: f.checkoutConfigId,
    email: f.email,
  });
  if (buyer.kind === "provider_unavailable") {
    return NextResponse.json({ error: "membership lookup unavailable, retry" }, { status: 503 });
  }
  const userId: string | null = buyer.kind === "resolved" ? buyer.userId : null;

  // ── Recipient BEFORE the claim (a-dunning-check): a failed users read used
  // to look like "no address", consume the claim and drop the mail for every
  // redelivery. A read error now answers 503 with no claim taken. ──
  let email: string | null = null;
  let firstName: string | null = null;
  let languageCode: string | null = null;
  if (userId) {
    const { data: u, error: userErr } = await sb
      .from("users")
      .select("id, email, first_name, language_code")
      .eq("id", userId)
      .maybeSingle();
    if (userErr) {
      Sentry.captureMessage(`Whop ${event} dunning recipient read failed (payment=${f.paymentId ?? "none"}); asking Whop to retry`, "warning");
      return NextResponse.json({ error: "recipient lookup unavailable, retry" }, { status: 503 });
    }
    if (u) {
      email = (u.email as string | null) ?? null;
      firstName = (u.first_name as string | null) ?? null;
      languageCode = (u.language_code as string | null) ?? null;
    }
  }
  const hasRecipient = Boolean(userId && email);

  // ── Dedupe: one dunning claim (and at most one email) per failed payment.
  // FIX (2026-10-02): the old code checked `if (!claim)` on the whole
  // supabase response object, which is always truthy, and supabase-js never
  // throws on 23505, so retries were never deduped (pay_5iKl… recorded 4x).
  // a-dunning-check: the claim records the mail state; a redelivery retries
  // only a mail that certainly did not go out (src/lib/whop-dunning-claim.ts). ──
  let isMailRetry = false;
  if (f.paymentId) {
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "whop",
        event_id: dunningClaimKey(f.paymentId),
        payload: {
          claimed_at: new Date().toISOString(),
          event,
          user_id: userId,
          membership_id: f.membershipId,
          mail: hasRecipient ? "pending" : "no_recipient",
          mail_attempts: hasRecipient ? 1 : 0,
        },
      })
      .select("event_id")
      .maybeSingle();
    if (claimErr) {
      if ((claimErr as { code?: string }).code === "23505") {
        if (hasRecipient && (await retakeDunningClaim(sb, f.paymentId, new Date().toISOString()))) {
          isMailRetry = true;
        } else {
          return NextResponse.json({ ok: true, duplicate: true });
        }
      } else {
        Sentry.captureException(claimErr, { tags: { route: "webhooks/whop", step: "recovery_claim" } });
        // Unknown DB error: do not email (we could not record the claim, so a
        // retry could double-send). Let Whop redeliver.
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
    } else if (!claim) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  if (!isMailRetry) {
    await logPaymentEvent(sb, {
      event: "webhook_received",
      provider: "whop",
      userId,
      email: f.email,
      planId: f.planId,
      paymentId: f.paymentId,
      amountCents: f.amountCents,
      currency: f.currency,
      signatureValid: true,
      matched: Boolean(userId),
      metadata: {
        event,
        whop_event: event,
        status: status ?? null,
        decline_code: declineCode ?? null,
        failure_message: failureMessage ?? null,
        has_recovery_url: Boolean(recoveryUrl),
        membership_id: f.membershipId,
        resolved_via: buyer.kind === "resolved" ? buyer.source : null,
      },
    });
  }

  // The link the buyer uses to fix the card. Whop's recovery_url resumes the
  // exact charge; when Whop sends none (the common case on declines), fall
  // back to the member's Whop billing page (membership.manage_url, or the
  // documented /billing/manage/<mber_> form), then the company page.
  const manageUrl =
    buyer.manageUrl ??
    (f.memberId ? `https://whop.com/billing/manage/${f.memberId}` : null) ??
    "https://whop.com/medpruf";
  const actionUrl = recoveryUrl ?? manageUrl;

  const recoveryData = {
    event,
    payment_id: f.paymentId,
    plan_id: f.planId,
    membership_id: f.membershipId,
    status,
    decline_code: declineCode,
    failure_message: failureMessage,
    recovery_url: recoveryUrl,
    action_url: actionUrl,
    mapped_user_id: userId,
  };
  // Telemetry once per failed payment, not again on a mail retry (a-dunning-check).
  if (!isMailRetry && pendingRevokeEnabled()) {
    // a-fo-09: the dunning row is a ledger row. Nothing irreversible happened
    // yet (the email follows), so on a failed write free the recover: claim
    // and 503: Whop's retry writes the row and sends the email once. If the
    // claim cannot be freed, a 503 would dedupe the retry and lose the email,
    // so the email goes out and the missing row goes to Sentry instead.
    const ledger = await recordLedgerEvent(sb, userId ?? PENDING_REVOKE_USER, "whop_payment_recovery_needed", recoveryData);
    if (!ledger.ok) {
      const released = f.paymentId ? await releaseRecoveryClaim(sb, f.paymentId) : false;
      Sentry.captureMessage(`Whop recovery ledger write failed (payment=${f.paymentId ?? "none"}, claim released=${released}): ${ledger.error}`, "warning");
      if (released) return NextResponse.json({ error: "Ledger write pending; retry" }, { status: 503 });
    }
  } else if (!isMailRetry) {
    try {
      await sb.from("user_events").insert({
        user_id: userId ?? "whop-webhook",
        event_type: "whop_payment_recovery_needed",
        event_data: recoveryData,
      });
    } catch (err) {
      console.error("[webhooks/whop] recovery telemetry", err);
    }
  }

  if (!userId || !email) {
    Sentry.captureMessage(
      `Whop ${event} unmapped (payment=${f.paymentId ?? "none"} membership=${f.membershipId ?? "none"}): buyer may churn without dunning`,
      "warning"
    );
    return NextResponse.json({ ok: true, ignored: "unmapped_recovery_event" });
  }

  const isDe = !(languageCode ?? "").toLowerCase().startsWith("en");
  const href = escapeHtml(actionUrl);
  const reason = declineCode ? escapeHtml(declineCode) : null;
  const subject = isDe
    ? "Aktion erforderlich: Ihre MedPrüf-Zahlung"
    : "Action required: your MedPrüf payment";
  const html = isDe
    ? `<p>Hallo${firstName ? ` ${escapeHtml(firstName)}` : ""},</p>` +
      `<p>die letzte Zahlung Ihrer MedPrüf-Mitgliedschaft konnte von Ihrer Bank nicht abgeschlossen werden${reason ? ` (Grund: ${reason})` : ""}. Ihr Pro-Zugang läuft sonst zum Ende der bezahlten Laufzeit aus.</p>` +
      (recoveryUrl
        ? `<p>Sie können das in einer Minute beheben: öffnen Sie den untenstehenden Whop-Link, bestätigen Sie die Zahlung oder aktualisieren Sie Ihre Karte, und alles läuft automatisch weiter.</p>` +
          `<p><a href="${href}">Zahlung jetzt abschließen</a></p>`
        : `<p>Sie können das in einer Minute beheben: öffnen Sie Ihre Whop-Abrechnung über den untenstehenden Link und hinterlegen Sie eine gültige Karte. Whop versucht die Zahlung danach automatisch erneut.</p>` +
          `<p><a href="${href}">Karte in Whop aktualisieren</a></p>`) +
      `<p>Falls Sie das Abo stattdessen beenden möchten, ist dafür kein weiterer Schritt nötig.</p>` +
      `<p>Mit freundlichen Grüßen<br>Das MedPrüf-Team</p>`
    : `<p>Hi${firstName ? ` ${escapeHtml(firstName)}` : ""},</p>` +
      `<p>The latest payment on your MedPrüf membership could not be completed${reason ? ` (reason: ${reason})` : ""}. Your Pro access runs until the end of the period you already paid for.</p>` +
      (recoveryUrl
        ? `<p>You can fix this in one minute: open the Whop link below and confirm the payment or update your card.</p>` +
          `<p><a href="${href}">Complete the payment now</a></p>`
        : `<p>You can fix this in one minute: open your Whop billing page below and add a working card. Whop then retries the payment automatically.</p>` +
          `<p><a href="${href}">Update your card on Whop</a></p>`) +
      `<p>If you would rather end the membership, no action is needed.</p>` +
      `<p>Best,<br>The MedPrüf Team</p>`;
  let res: Awaited<ReturnType<typeof sendZohoEmail>> | null = null;
  try {
    res = await sendZohoEmail({ to: email, subject, htmlBody: html });
  } catch (err) {
    console.error("[webhooks/whop] dunning email threw", err);
  }
  const mailState = classifyDunningSend(res);
  const failReason = res ? (res.ok ? null : res.reason) : "send_threw";
  const failStatus = res && !res.ok ? res.status ?? null : null;
  const claimMarked = f.paymentId
    ? await markDunningClaim(sb, f.paymentId, mailState, {
        reason: failReason,
        status: failStatus,
        nowIso: new Date().toISOString(),
      })
    : false;
  if (f.paymentId && !claimMarked) {
    Sentry.captureMessage(`Whop dunning claim for ${f.paymentId} could not record mail=${mailState}`, "warning");
  }

  if (mailState === "sent") {
    // Recorded only for an accepted mail, so the count is the number of
    // dunning mails that went out (it used to include failed sends).
    await recordEvent(sb, userId, "whop_dunning_email", {
      event,
      payment_id: f.paymentId,
      membership_id: f.membershipId,
      to: email,
      ok: true,
      reason: null,
      has_recovery_url: Boolean(recoveryUrl),
      link_kind: recoveryUrl ? "recovery_url" : "manage_url",
      retry: isMailRetry,
    });
    return NextResponse.json({ ok: true, handled: event });
  }

  // One retry at most: a failed retry is final (retakeDunningClaim refuses it too).
  const willRetry = mailState === "not_sent" && claimMarked && !isMailRetry;
  await recordEvent(sb, userId, "whop_dunning_email_failed", {
    event,
    payment_id: f.paymentId,
    membership_id: f.membershipId,
    to: email,
    outcome: mailState,
    reason: failReason,
    status: failStatus,
    will_retry: willRetry,
  });
  Sentry.captureMessage(
    `Whop dunning mail ${mailState} (payment=${f.paymentId ?? "none"} reason=${failReason ?? "none"}${failStatus ? ` status=${failStatus}` : ""})${willRetry ? ": asking Whop to redeliver" : ": send it by hand"}`,
    "error"
  );
  if (willRetry) {
    // Certainly not delivered and the claim says so: Whop's redelivery finds
    // the claim in state not_sent and tries the mail once more.
    return NextResponse.json({ error: "dunning mail not sent, retry" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, handled: event, mail: mailState });
}

/** Frees the dunning claim of one failed payment; true only when the delete succeeded. */
async function releaseRecoveryClaim(sb: ReturnType<typeof getServiceClient>, paymentId: string): Promise<boolean> {
  try {
    const { error } = await sb.from("processed_webhook_events").delete()
      .eq("provider", "whop").eq("event_id", dunningClaimKey(paymentId));
    return !error;
  } catch {
    return false;
  }
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
  // This provider signal shares the cron's release gate and membership claim.
  if (!prechargeRemindersEnabled()) return NextResponse.json({ ok: true, skipped: "reminders_disabled" });
  const d = rec(data);
  // a-stability: only a membership (mem_) id. member.id is the buyer's MEMBER
  // record (mber_), never a membership, and must not become a pin or a claim key.
  const membershipId = trialEndingMembershipId(d);
  if (!membershipId) return NextResponse.json({ ok: true, skipped: "no_membership" });
  const metadata = rec(d.metadata);
  const sb = getServiceClient({ fastFail: false });
  const buyer = await resolveWhopBuyer(sb, {
    membershipId, metaUserId: str(d.medpruef_user_id) ?? str(metadata.medpruef_user_id) ?? f.metaUserId,
    checkoutConfigId: str(d.checkout_configuration_id) ?? f.checkoutConfigId, email: f.email,
  });
  if (buyer.kind === "provider_unavailable") return NextResponse.json({ error: "membership lookup unavailable, retry" }, { status: 503 });
  if (buyer.kind !== "resolved") return NextResponse.json({ ok: true, ignored: "unmapped_trial_ending" });
  const result = await sendPrechargeTrialReminder(sb, { userId: buyer.userId, membershipId });
  return NextResponse.json({ ok: result !== "unavailable", handled: event, reminder: result }, { status: result === "unavailable" ? 503 : 200 });
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
function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function recordEvent(
  sb: ReturnType<typeof getServiceClient>,
  userId: string | null,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    // supabase-js returns insert errors instead of throwing: read it, or a
    // failed row (for example whop_dunning_email) disappears silently.
    const { error } = await sb.from("user_events").insert({ user_id: userId, event_type: eventType, event_data: data });
    if (error) console.error(`[recordEvent:${eventType}] insert failed`, { code: error.code, message: error.message });
  } catch (err) {
    console.error(`[recordEvent:${eventType}]`, err);
  }
}
