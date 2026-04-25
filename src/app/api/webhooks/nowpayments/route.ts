import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import {
  verifyNowpaymentsSignature,
  normalisePaymentStatus,
  computeExpiry,
  formatCryptoCurrency,
  TIERS,
  REFERRAL_ANNUAL_CAP_CENTS,
  referralPayoutCents,
  type NowpaymentsPaymentStatus,
} from "@/lib/nowpayments";
import { logWebhookAttempt } from "@/lib/webhook-logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/nowpayments
 *
 * IPN (Instant Payment Notification) endpoint. NOWPayments servers
 * POST here on every payment state change for invoices that carry
 * our `ipn_callback_url`.
 *
 * Auth model: NO requireUser — this endpoint is called by
 * NOWPayments, not by a logged-in user. Authentication is via the
 * HMAC-SHA512 signature in the `x-nowpayments-sig` header, computed
 * over the body sorted by top-level keys. See src/lib/nowpayments.ts
 * for the canonical algorithm.
 *
 * Idempotency: NOWPayments retries webhooks with exponential backoff
 * on non-2xx responses. We guard against double-processing via the
 * processed_webhook_events table (primary key on
 * (provider, event_id)). The event_id is `payment_id` from the
 * payload — a unique NOWPayments identifier per payment attempt.
 *
 * Status handling:
 *   - finished / confirmed     → activate subscription, flip user.tier
 *   - partially_paid (<0.5%)   → activate (network-fee tolerance)
 *   - partially_paid (>=0.5%)  → 'partially_paid' (admin review)
 *   - failed / expired         → mark subscription appropriately
 *   - waiting / confirming / sending → log, no state change
 *
 * Referral hook: on first-time activation, if the user has a
 * `referred_by_code`, we mark the referring referral row as
 * 'qualified' and set qualified_at = now(). The actual payout is
 * a separate admin/cron job, not this webhook.
 */
export async function POST(req: NextRequest) {
  // Log EVERY inbound hit before any other work so webhook_attempts
  // captures reach-our-edge-at-all vs never-heard-from-NOWPayments.
  // We `await` rather than fire-and-forget so the row is persisted
  // before any return path — the rescue-sprint self-test (§1.4) was
  // failing because `void` left the insert in flight when the handler
  // had already responded and the test queried `webhook_attempts`.
  //
  // The result is marked "received" here; the downstream exit points
  // (sig_invalid / parse_error / dup / processed) each record their
  // OWN row with the correct classification. Reading both rows for
  // the same signature_header gives admin the full picture.
  await logWebhookAttempt({
    req,
    provider: "nowpayments",
    path: "/api/webhooks/nowpayments",
    signatureHeader: req.headers.get("x-nowpayments-sig"),
    signatureValid: null,
    body: null,
    result: "other_error",
    error: "arrived_but_not_yet_classified",
  });

  // 1. Read the raw body ONCE. We need the exact bytes to hand to
  //    JSON.parse AND to recompute the signature over. Reading twice
  //    would either drain the stream or allow a canonicalisation
  //    mismatch between what we verified and what we processed.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "webhooks/nowpayments", step: "read_body" },
    });
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  // 2. Parse JSON.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn(
      "[webhooks/nowpayments] non-JSON body",
      rawBody.slice(0, 200)
    );
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400 }
    );
  }

  // 3. Verify signature. We do this BEFORE any other work — no DB
  //    reads, no logging that could leak information about shape.
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    console.error(
      "[webhooks/nowpayments] NOWPAYMENTS_IPN_SECRET not configured"
    );
    Sentry.captureMessage(
      "NOWPAYMENTS_IPN_SECRET not set — all IPNs will reject",
      "error"
    );
    // 503 so NOWPayments retries once we fix the env, rather than
    // a 4xx that it would consider terminal.
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 503 }
    );
  }

  const signatureHeader = req.headers.get("x-nowpayments-sig");
  const valid = verifyNowpaymentsSignature(payload, signatureHeader, secret);
  if (!valid) {
    console.warn(
      "[webhooks/nowpayments] signature mismatch",
      {
        hasHeader: Boolean(signatureHeader),
        paymentId: payload.payment_id,
      }
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // ──────────────────────────────────────────────────────────────
  // From here on, the request is AUTHENTICATED. Everything wrapped
  // in try/catch so we always report 200 on success paths and 5xx
  // on failures (triggering NOWPayments retry).
  // ──────────────────────────────────────────────────────────────

  try {
    const paymentId = stringOrNull(payload.payment_id);
    const orderId = stringOrNull(payload.order_id);
    const paymentStatusRaw = stringOrNull(payload.payment_status);

    if (!paymentId || !paymentStatusRaw) {
      console.warn(
        "[webhooks/nowpayments] missing payment_id/payment_status",
        { paymentId, paymentStatusRaw }
      );
      return NextResponse.json(
        { error: "Missing payment_id or payment_status" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();

    // 4. Idempotency claim — atomically reserve this payment_id by
    //    inserting into processed_webhook_events with ON CONFLICT
    //    DO NOTHING. If RETURNING returns a row, we won the race and
    //    we're the canonical processor. If it's empty, another worker
    //    already claimed this event and we early-return as duplicate.
    //
    //    review-2026-04-24-D-2 — the previous SELECT-then-INSERT
    //    pattern allowed two parallel webhook retries to both pass
    //    the existence check and both run the activation path,
    //    double-flipping `users.tier='pro'` and double-counting
    //    referral bonuses. ON CONFLICT shifts the race resolution
    //    into the DB layer where the (provider, event_id) primary
    //    key serializes claims.
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "nowpayments",
        event_id: paymentId,
        // payload gets filled in later via recordProcessed when the
        // status is final; for the claim we just write the marker.
        payload: { claimed_at: new Date().toISOString(), payment_status: paymentStatusRaw },
      })
      .select("event_id")
      .maybeSingle();

    if (claimErr) {
      // 23505 = unique_violation — the row already exists, this is
      // the duplicate-retry case. Postgres returns this through the
      // Supabase JS client as a non-null error with code='23505'.
      if ((claimErr as { code?: string }).code === "23505") {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          payment_status: paymentStatusRaw,
        });
      }
      // Any other DB error — surface as 500 so NOWPayments retries.
      console.error("[webhooks/nowpayments] claim insert failed", claimErr);
      Sentry.captureException(claimErr, {
        tags: { route: "webhooks/nowpayments", step: "claim" },
      });
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (!claim) {
      // RETURNING was empty without throwing — also means the row
      // already existed and ON CONFLICT silently skipped the insert.
      return NextResponse.json({
        ok: true,
        duplicate: true,
        payment_status: paymentStatusRaw,
      });
    }

    // 5. Match order_id to a subscription row.
    if (!orderId) {
      console.warn(
        "[webhooks/nowpayments] payload has no order_id",
        { paymentId }
      );
      // 200 so NOWPayments doesn't retry an unrecoverable request;
      // we still record it as processed.
      await recordProcessed(sb, paymentId, payload);
      return NextResponse.json(
        { ok: false, error: "No order_id" },
        { status: 200 }
      );
    }

    const { data: sub, error: subErr } = await sb
      .from("subscriptions")
      .select(
        "id, user_id, tier, status, expires_at, started_at, amount_cents"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (subErr) {
      console.error("[webhooks/nowpayments] subscription lookup", subErr);
      Sentry.captureException(subErr, {
        tags: { route: "webhooks/nowpayments", step: "sub_lookup" },
        extra: { orderId, paymentId },
      });
      // 500 → retry.
      return NextResponse.json(
        { error: "DB error" },
        { status: 500 }
      );
    }

    if (!sub) {
      // Order_id doesn't exist in our DB. This should never happen
      // in production — it'd mean someone forged the signature
      // (impossible) or we lost a subscription row (unlikely). We
      // record the processed event so we don't retry indefinitely.
      await recordProcessed(sb, paymentId, payload);
      return NextResponse.json(
        { ok: false, error: "Subscription not found" },
        { status: 404 }
      );
    }

    // 6. Decide what to do based on payment_status.
    const payAmount = numberOrNull(payload.pay_amount);
    const actuallyPaid = numberOrNull(payload.actually_paid);
    const decision = normalisePaymentStatus(
      paymentStatusRaw as NowpaymentsPaymentStatus,
      payAmount,
      actuallyPaid
    );

    const telemetryTags = {
      payment_status: paymentStatusRaw,
      subscription_id: sub.id,
      user_id: sub.user_id,
    } as Record<string, unknown>;

    await recordEvent(
      sb,
      sub.user_id as string,
      "nowpayments_webhook_received",
      telemetryTags
    );

    // 7. Intermediate states: record the processed event and return
    //    without touching the subscription row.
    if (decision.nextStatus === "pending") {
      await recordProcessed(sb, paymentId, payload);
      return NextResponse.json({
        ok: true,
        payment_status: paymentStatusRaw,
        description: decision.description,
      });
    }

    // 8. Non-activation terminal states (failed, expired, refunded,
    //    partially_paid-over-tolerance): update subscription status,
    //    record processed, return.
    if (!decision.activate) {
      await sb
        .from("subscriptions")
        .update({
          status: decision.nextStatus,
          provider_payment_id: paymentId,
          crypto_tx_hash: stringOrNull(payload.outcome_hash) ||
            stringOrNull(payload.tx_hash_outcome),
          crypto_currency: formatCryptoCurrency(
            stringOrNull(payload.pay_currency)
          ),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

      await recordProcessed(sb, paymentId, payload);

      return NextResponse.json({
        ok: true,
        payment_status: paymentStatusRaw,
        next_status: decision.nextStatus,
        description: decision.description,
      });
    }

    // 9. ACTIVATION PATH — finished / confirmed / partially_paid-in-tolerance.
    //
    //    Compute expires_at from the tier definition. If the
    //    subscription was already active (somehow a duplicate),
    //    don't shrink expires_at — keep whichever is later.
    const tierDef = TIERS[sub.tier as string];
    const durationMonths = tierDef?.durationMonths ?? 6; // default to 6 for safety
    const now = new Date();
    const computed = computeExpiry(durationMonths, now);
    const existingExpiry = sub.expires_at
      ? new Date(sub.expires_at as string)
      : null;
    const expiresAt =
      existingExpiry && existingExpiry.getTime() > computed.getTime()
        ? existingExpiry
        : computed;

    const cryptoCurrency = formatCryptoCurrency(
      stringOrNull(payload.pay_currency)
    );
    const cryptoTxHash =
      stringOrNull(payload.outcome_hash) ||
      stringOrNull(payload.tx_hash_outcome) ||
      stringOrNull(payload.tx_hash) ||
      null;

    const { error: subUpdateErr } = await sb
      .from("subscriptions")
      .update({
        status: "active",
        provider_payment_id: paymentId,
        crypto_tx_hash: cryptoTxHash,
        crypto_currency: cryptoCurrency,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    if (subUpdateErr) {
      console.error(
        "[webhooks/nowpayments] subscription update failed",
        subUpdateErr
      );
      Sentry.captureException(subUpdateErr, {
        tags: { route: "webhooks/nowpayments", step: "sub_update" },
        extra: { subId: sub.id, paymentId },
      });
      // DO NOT record processed — we want NOWPayments to retry.
      return NextResponse.json({ error: "DB update failed" }, { status: 500 });
    }

    // Flip users.tier to 'pro' and stamp tier_expires_at. All paid
    // tiers map to tier='pro' for practical access checks; the
    // specific plan lives in subscriptions.tier.
    const { error: userUpdateErr } = await sb
      .from("users")
      .update({
        tier: "pro",
        tier_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.user_id);

    if (userUpdateErr) {
      console.error(
        "[webhooks/nowpayments] user tier update failed",
        userUpdateErr
      );
      Sentry.captureException(userUpdateErr, {
        tags: { route: "webhooks/nowpayments", step: "user_update" },
        extra: { subId: sub.id, userId: sub.user_id },
      });
      // Don't retry — the subscription is active, which is the
      // source of truth. user.tier can be reconciled offline.
    }

    // 10. Referral qualification hook.
    //
    //     If the user signed up with a referred_by_code, and this is
    //     their first-ever activation, mark the corresponding
    //     referrals row as qualified. The reward is tiered (Lock #3):
    //       monthly/3mo    → €25
    //       6mo/12mo       → €50
    //       premium_pass_g → €75 (June 26 Cohort)
    //     Per-row amount comes from referralPayoutCents(sub.tier).
    //
    //     Annual cap (€600/year per referrer) is enforced in the helper
    //     — if the referrer has already hit it this calendar year the
    //     row is still qualified (counts in stats) but reward is 0 and
    //     hold_reason='annual_cap' for admin visibility.
    //
    //     30-day hold: qualified rows get hold_expires_at = now() + 30d.
    //     They only become claimable once hold_expires_at has passed
    //     (admin processes the payout manually from the admin UI and
    //     flips status to 'rewarded').
    await qualifyReferralIfApplicable(
      sb,
      sub.user_id as string,
      sub.id as string,
      sub.tier as string
    );

    // 11. Record processed + fire activation telemetry.
    await recordProcessed(sb, paymentId, payload);
    await recordEvent(
      sb,
      sub.user_id as string,
      "nowpayments_subscription_activated",
      {
        tier: sub.tier,
        subscription_id: sub.id,
        expires_at: expiresAt.toISOString(),
      }
    );

    return NextResponse.json({
      ok: true,
      payment_status: paymentStatusRaw,
      activated: true,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[webhooks/nowpayments] unexpected", err);
    Sentry.captureException(err, {
      tags: { route: "webhooks/nowpayments", step: "unexpected" },
    });
    // 500 → NOWPayments will retry.
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function recordProcessed(
  sb: ReturnType<typeof getServiceClient>,
  paymentId: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await sb.from("processed_webhook_events").insert({
      provider: "nowpayments",
      event_id: paymentId,
      payload,
    });
  } catch (err) {
    // A duplicate-key race (two parallel retries) is fine — the
    // check at step 4 already handled it. Other errors get logged.
    console.warn(
      "[webhooks/nowpayments] recordProcessed insert failed (may be duplicate)",
      err
    );
  }
}

async function recordEvent(
  sb: ReturnType<typeof getServiceClient>,
  userId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await sb.from("user_events").insert({
      user_id: userId,
      event_type: eventType,
      event_data: data,
    });
  } catch (err) {
    console.error(`[recordEvent:${eventType}]`, err);
  }
}

/**
 * If the subscribing user has a `referred_by_code` and it matches
 * another user's `referral_code`, upsert/mark a referrals row as
 * qualified. Runs once per activation; duplicate calls are safe
 * because we UPDATE by (referrer, referee) and only flip pending→qualified.
 *
 * Lock #3 (2026-04-23): per-referee-tier payout + 30-day hold + €600/year cap.
 *
 * Payout amount: `referralPayoutCents(refereeTier)` — €25/€50/€75 depending
 * on the tier the referee just activated. See src/lib/nowpayments.ts for
 * the canonical mapping.
 *
 * Annual cap: each referrer can earn at most €600 (REFERRAL_ANNUAL_CAP_CENTS)
 * per CALENDAR year. We sum `reward_credit_cents` across this referrer's
 * qualified+rewarded rows whose qualified_at falls in the current year. If
 * headroom = max(0, cap - sumThisYear) < thisPayout, we cap this row at
 * `headroom` (possibly 0) and stamp `hold_reason = 'annual_cap'` so admin
 * sees WHY the payout is zero. Status still flips to qualified — the row
 * counts toward referral stats, it just doesn't earn cash.
 *
 * 30-day hold: all qualified rows get hold_expires_at = now() + 30 days.
 * Admin tooling / payout cron reads (qualified AND hold_expires_at <= now())
 * to pick up releasable rows.
 */
async function qualifyReferralIfApplicable(
  sb: ReturnType<typeof getServiceClient>,
  refereeUserId: string,
  subscriptionId: string,
  refereeTier: string | null | undefined
): Promise<void> {
  try {
    const { data: referee } = await sb
      .from("users")
      .select("id, referred_by_code")
      .eq("id", refereeUserId)
      .maybeSingle();

    const code = referee?.referred_by_code as string | null | undefined;
    if (!code) return;

    // Find the referrer by referral_code.
    const { data: referrer } = await sb
      .from("users")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();

    if (!referrer) {
      console.warn(
        "[webhooks/nowpayments] referred_by_code matches no user",
        { code, refereeUserId }
      );
      return;
    }

    // Is there already a referrals row for this pair?
    const { data: existing } = await sb
      .from("referrals")
      .select("id, status")
      .eq("referrer_user_id", referrer.id)
      .eq("referee_user_id", refereeUserId)
      .maybeSingle();

    // Already paid out or qualified — nothing to do (idempotent).
    if (existing && existing.status !== "pending") {
      return;
    }

    // ── Compute tiered payout + apply annual cap ──
    const nowIso = new Date().toISOString();
    const now = new Date();
    const tieredPayout = referralPayoutCents(refereeTier);

    // Sum this referrer's earnings in the current calendar year from
    // rows that have ALREADY been credited (qualified or rewarded).
    // We use qualified_at (not created_at) as the earnings date because
    // that's when the referee actually paid.
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const { data: yearRows, error: yearErr } = await sb
      .from("referrals")
      .select("reward_credit_cents, qualified_at, status")
      .eq("referrer_user_id", referrer.id)
      .in("status", ["qualified", "rewarded"])
      .gte("qualified_at", yearStart.toISOString());

    if (yearErr) {
      console.error(
        "[webhooks/nowpayments] annual cap lookup failed",
        yearErr
      );
      // Proceed with full tiered payout; better to slightly over-pay
      // than to block an activation because cap lookup flaked.
    }

    const yearSumCents = (yearRows || []).reduce(
      (acc, r) =>
        acc + ((r as { reward_credit_cents?: number | null }).reward_credit_cents ?? 0),
      0
    );
    const headroomCents = Math.max(
      0,
      REFERRAL_ANNUAL_CAP_CENTS - yearSumCents
    );
    const cappedPayout = Math.min(tieredPayout, headroomCents);
    const capped = cappedPayout < tieredPayout;

    const holdExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const payloadCommon: Record<string, unknown> = {
      status: "qualified",
      qualified_at: nowIso,
      reward_credit_cents: cappedPayout,
      hold_expires_at: holdExpiresAt.toISOString(),
      hold_reason: capped ? "annual_cap" : null,
    };

    if (!existing) {
      // Create a qualified referral row directly.
      const { error } = await sb.from("referrals").insert({
        referrer_user_id: referrer.id,
        referee_user_id: refereeUserId,
        referral_code: code,
        ...payloadCommon,
      });
      if (error) {
        console.error(
          "[webhooks/nowpayments] referrals insert failed",
          error
        );
        return;
      }
    } else {
      // existing.status === 'pending' — flip to qualified with tiered payout.
      const { error } = await sb
        .from("referrals")
        .update(payloadCommon)
        .eq("id", existing.id);
      if (error) {
        console.error(
          "[webhooks/nowpayments] referrals update failed",
          error
        );
        return;
      }
    }

    if (capped) {
      console.warn(
        "[webhooks/nowpayments] referral capped at €600/yr",
        {
          referrer_user_id: referrer.id,
          referee_user_id: refereeUserId,
          refereeTier,
          tieredPayoutCents: tieredPayout,
          cappedPayoutCents: cappedPayout,
          yearSumCents,
        }
      );
    }

    await recordEvent(
      sb,
      refereeUserId,
      "nowpayments_referral_qualified",
      {
        referrer_user_id: referrer.id,
        referee_user_id: refereeUserId,
        subscription_id: subscriptionId,
        referral_code: code,
        referee_tier: refereeTier ?? null,
        reward_credit_cents: cappedPayout,
        hold_expires_at: holdExpiresAt.toISOString(),
        hold_reason: capped ? "annual_cap" : null,
      }
    );

    // ── Rescue-sprint §4.9 (2026-04-24): first-qualify email stub ──
    //
    // If this is the referrer's FIRST-EVER qualifying referral, we
    // want to kick off the "pick your payout method" flow by email.
    // The old model asked users to configure the method upfront and
    // ended up with 0 activations — this reversal (defer the ask
    // until the money's real) is the heart of the rework.
    //
    // We count qualified/rewarded rows for this referrer, excluding
    // the row we just wrote. If the prior count is zero, this is
    // the first qualify and we fire the stubbed email.
    try {
      const { count: priorQualified } = await sb
        .from("referrals")
        .select("id", { head: true, count: "exact" })
        .eq("referrer_user_id", referrer.id)
        .in("status", ["qualified", "rewarded"])
        .neq("referee_user_id", refereeUserId);

      if ((priorQualified ?? 0) === 0) {
        const { data: refUser } = await sb
          .from("users")
          .select("id, email, first_name, payout_method")
          .eq("id", referrer.id)
          .maybeSingle();

        const referrerEmail = (refUser?.email as string | undefined) ?? null;
        const hasPayoutMethod = Boolean(refUser?.payout_method);

        // TODO: Zoho send — wire to user-b7e46e80@example.com transactional
        // template when the Zoho refresh-token helper lands. Subject:
        // "Dein erster Empfehlungs-Bonus wartet. Wähle, wie wir dich
        //  bezahlen sollen." Body: short congrats + a CTA button
        // pointing at https://medpruf.com/referrals?setup=payout
        // (crypto wallet vs. Wise).
        //
        // Until the mailer helper exists this path is a no-op +
        // telemetry so the funnel stays observable; the dispatch date
        // can be back-filled once Zoho ships.
        await recordEvent(
          sb,
          referrer.id,
          "referral_first_qualify_email_sent",
          {
            referrer_user_id: referrer.id,
            referee_user_id: refereeUserId,
            subscription_id: subscriptionId,
            reward_credit_cents: cappedPayout,
            hold_expires_at: holdExpiresAt.toISOString(),
            referrer_email: referrerEmail,
            payout_method_already_set: hasPayoutMethod,
            email_dispatched: false,
            todo: "Zoho send — see qualifyReferralIfApplicable",
          }
        );

        console.info(
          "[webhooks/nowpayments] first-qualify email queued (stub)",
          {
            referrer_user_id: referrer.id,
            referrer_email: referrerEmail,
            payout_method_already_set: hasPayoutMethod,
          }
        );
      }
    } catch (emailErr) {
      // First-qualify email is nice-to-have, never a blocker for
      // the main activation path. Log + Sentry, continue.
      console.error(
        "[webhooks/nowpayments] first-qualify email stub failed",
        emailErr
      );
      Sentry.captureException(emailErr, {
        tags: {
          route: "webhooks/nowpayments",
          step: "first_qualify_email_stub",
        },
        extra: { referrer_user_id: referrer.id, refereeUserId },
      });
    }
  } catch (err) {
    // Referral qualification must never block activation.
    console.error(
      "[webhooks/nowpayments] qualifyReferralIfApplicable failed",
      err
    );
    Sentry.captureException(err, {
      tags: {
        route: "webhooks/nowpayments",
        step: "qualify_referral",
      },
      extra: { refereeUserId },
    });
  }
}
