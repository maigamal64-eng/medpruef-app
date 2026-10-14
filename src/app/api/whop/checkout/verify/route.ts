import { repairWhopUserAccess } from "@/lib/whop-entitlement";
import { whopExtensionsEnabled } from "@/lib/whop-extension";
import { isPaidTier } from "@/lib/free-tier";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { tierToWhopPlan, TIERS, paginateWhopLedger, whopPlanQuery, dedupeById, extractWhopPayment, looksRefunded } from "@/lib/whop";
import { extendOrInsertWhopSubscription, reconcileUserTierPro, releaseWhopClaim } from "@/lib/whop-grant";
import { logPaymentEvent, hashEmail } from "@/lib/paymentEvents";
import { noPaymentSettled, shouldRecordVerifiedAbsent, type CheckoutEvent } from "@/lib/checkout-pending";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { qualifyReferralOnActivity } from "@/lib/referral-exam-reward";
import { rewardReferrerOnFirstCharge } from "@/lib/referral-mentor-credits";
import { mentorOpenForAccount } from "@/lib/mentor/access-account";
import { afterResponse } from "@/lib/after-response";
import { paidAmountCents } from "@/lib/mentor/credits/grant-payment";
import { sendRedditConversion } from "@/lib/reddit-capi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/whop/checkout/verify — deterministic grant when a PAID buyer
 * returns from Whop (2026-09-20 Wave 1, [name]-directed).
 *
 * WHY: /checkout/success for paid tiers used to poll /api/auth/me and trust
 * the webhook alone. Whop's documented delivery schedule retries with delays
 * up to 12h, and on 2026-09-17 a real delivery landed ~3h late — the buyer,
 * still showing free on return, paid AGAIN. This route closes that blind
 * spot the same way the trial's /api/whop/trial/verify does: read the buyer's
 * Whop membership + payment SERVER-SIDE via the API and grant immediately if
 * the money is real. The webhook remains the backstop.
 *
 * IDEMPOTENCY (the important part): the verify route claims
 * processed_webhook_events(provider='whop', event_id=<payment id>) — the
 * SAME key the webhook grant claims. So whichever path runs first wins and
 * the other acks as a duplicate; one payment can never extend twice. If the
 * charge is still settling (no 'paid' payment on the ledger yet), we return
 * granted:false and the success page keeps polling — the webhook lands later.
 *
 * GRANT SEMANTICS: shared extendOrInsertWhopSubscription helper (extension,
 * not overwrite). No trial logic here — this route only handles the paid
 * one-time tiers (first_month_19 / first_3mo_27 / premium_pass_guaranteed).
 *
 * 2026-09-21 HARDENING (Fixes 3+4):
 *   - Buyer→payment tie resolves through THREE steps, not metadata alone:
 *       1. membership metadata match (unchanged, the primary)
 *       2. membership email match: case-insensitive exact match between the
 *          Whop member email and users.email; REFUSED as ambiguous when the
 *          email maps to multiple memberships or multiple user rows
 *       3. payment_events fallback: a webhook_received row within 48h whose
 *          email_hash matches the buyer email (salted hash, same
 *          PAYMENT_EVENTS_SALT scheme the webhook writes) AND whose tier or
 *          amount lines up with the requested tier. On a hit the grant runs
 *          and the row's user_id is backfilled.
 *   - A payment that plausibly exists but cannot be tied returns
 *     {granted:false, reason:"payment_unmatched", payment_ref} instead of a
 *     blanket membership_not_found, so the success page can show the honest
 *     "we will email you and unlock you" state.
 *   - Both Whop ledgers page through the shared paginateWhopLedger helper
 *     (5 pages / 3s budget) instead of one fixed page; a truncated scan is
 *     Sentry-flagged (whop_ledger_truncated) and NEVER reported as
 *     payment_not_found.
 */

const LIVE_TIERS = new Set([
  "first_month_19",
  "first_3mo_27",
  "premium_pass_guaranteed",
]);

// Whop membership statuses we treat as "access is live" (mirrors trial/verify).
const VALID_STATUSES = new Set(["active", "trialing", "completed"]);

const PAYMENT_WINDOW_MS = 48 * 3600_000;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

interface PlanMembership {
  id: string;
  /** null when the row does not name its plan. */
  planId: string | null;
  metaUserId: string | null;
  email: string | null;
  valid: boolean;
  status: string | null;
}

function parseMembership(m: unknown): PlanMembership {
  const d = rec(m);
  const plan = rec(d.plan);
  const metadata = rec(d.metadata);
  const member = rec(d.member);
  return {
    id: str(d.id) ?? "",
    planId: str(plan.id) ?? str(d.plan_id) ?? (typeof d.plan === "string" ? d.plan : null),
    metaUserId: str(metadata.medpruef_user_id) ?? str(metadata.user_id),
    email: str(member.email) ?? str(d.member_email) ?? str(d.email),
    valid: d.valid === true || d.valid === "true",
    status: str(d.status),
  };
}

interface PlanPayment {
  id: string;
  /** The membership (mem_) the payment belongs to; member.id is the mber_ record. */
  membershipId: string | null;
  status: string | null;
  /** Whop marks the charge refunded or disputed: never grant on it. */
  refunded: boolean;
  createdAtMs: number | null;
  /** Lowest amount any Whop field reports (a coupon shows in final_amount); null when none. */
  amountCents: number | null;
}

function parsePayment(p: unknown): PlanPayment | null {
  const d = rec(p);
  const id = str(d.id);
  if (!id) return null;
  const createdRaw = d.created_at ?? d.createdAt ?? null;
  const createdMs =
    typeof createdRaw === "number"
      ? createdRaw > 1e12
        ? createdRaw
        : createdRaw * 1000
      : typeof createdRaw === "string"
        ? Date.parse(createdRaw)
        : NaN;
  return {
    id,
    membershipId:
      extractWhopPayment(p).membershipId ??
      (str(d.member_id)?.startsWith("mem_") ? str(d.member_id) : null),
    status: str(d.status),
    refunded: looksRefunded(p),
    createdAtMs: Number.isFinite(createdMs) ? createdMs : null,
    amountCents: paidAmountCents(d),
  };
}

/** Paginated membership scan for a plan (Fix 4: no more single 50-row page). */
async function fetchPlanMemberships(
  apiKey: string,
  planId: string
): Promise<{ rows: unknown[]; truncated: boolean }> {
  return paginateWhopLedger({
    apiKey,
    endpoint: "memberships",
    query: whopPlanQuery(planId),
    cutoffMs: Date.now() - PAYMENT_WINDOW_MS,
    tag: "checkout_verify.memberships",
  });
}

/** Paginated company payment scan (Fix 4: no more single 100-row page). */
async function fetchRecentPayments(apiKey: string): Promise<{
  rows: unknown[];
  truncated: boolean;
}> {
  return paginateWhopLedger({
    apiKey,
    endpoint: "payments",
    query: `account_id=${encodeURIComponent(process.env.WHOP_COMPANY_ID ?? "")}`,
    cutoffMs: Date.now() - PAYMENT_WINDOW_MS,
    tag: "checkout_verify.payments",
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;
  const sb = getServiceClient();

  // Rate-limit the API-touching path (mirror the trial POST).
  const gate = checkRateLimit({ key: rateKey("whop-verify", userId), limit: 10, windowMs: 60_000 });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please wait a moment." },
      { status: 429, headers: rateLimitHeaders(gate, { limit: 10 }) }
    );
  }

  let tier = "";
  // Extension of active Pro (a21): the end date the learner had when the
  // checkout started. Access that was already active proves nothing until
  // the end date moves past it; the webhook applies the extension.
  let extendsFromMs: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    tier = String(body?.tier || "");
    // Ignored while extensions are off (default): no checkout carries one.
    const from = whopExtensionsEnabled() && typeof body?.extends_from === "string" ? Date.parse(body.extends_from) : NaN;
    extendsFromMs = Number.isFinite(from) ? from : null;
  } catch {
    tier = "";
  }
  const extensionApplied = (expiresAt: string | null | undefined) =>
    extendsFromMs === null || expiresAt == null || (Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > extendsFromMs);

  if (!LIVE_TIERS.has(tier) || !TIERS[tier]) {
    await logPaymentEvent(sb, {
      event: "grant_failed",
      userId,
      tier: tier || null,
      reason: "unrecognized_event",
      metadata: { source: "checkout_verify", ok: false, cause: "unknown_tier" },
    });
    return NextResponse.json({ granted: false, reason: "unknown_tier" }, { status: 400 });
  }

  try {
    // A subscription may have landed before a failed denormalized-user write.
    // Repair that same window before querying the provider or claiming again.
    const repaired = await repairWhopUserAccess(sb, userId);
    if (repaired.granted && extendsFromMs === null) return NextResponse.json({ ...repaired, already: true, paid_after_checkout: await paidAfterCheckout(sb, userId) });
    // Already Pro? Report success so the UI proceeds.
    const { data: user } = await sb
      .from("users")
      .select("tier, tier_expires_at, email")
      .eq("id", userId)
      .maybeSingle();
    if (user && (isPaidTier(user.tier, user.tier_expires_at))) {
      // An extension is granted by the webhook on the same payment-id claim;
      // until the end date moves, report it as still being applied (no scan:
      // an older membership on the same plan must not be read as this one).
      if (!extensionApplied(user.tier_expires_at)) {
        return NextResponse.json({ granted: false, reason: "extension_pending", tier_expires_at: user.tier_expires_at ?? null });
      }
      return NextResponse.json({
        granted: true,
        already: true,
        tier_expires_at: user.tier_expires_at ?? null,
        paid_after_checkout: await paidAfterCheckout(sb, userId),
      });
    }
    const buyerEmail = (user?.email as string | null) ?? null;

    const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
    if (!apiKey) {
      Sentry.captureMessage("WHOP_API_KEY not set — checkout verify unavailable", "error");
      return NextResponse.json({ granted: false, reason: "provider_unavailable" }, { status: 200 });
    }

    const planId = tierToWhopPlan(tier);
    if (!planId) {
      Sentry.captureMessage(`WHOP_PLAN_* not set for tier ${tier} — checkout verify unavailable`, "error");
      await logPaymentEvent(sb, {
        event: "grant_failed",
        userId,
        tier,
        reason: "plan_not_configured",
        metadata: { source: "checkout_verify", ok: false, status: 503 },
      });
      return NextResponse.json({ granted: false, reason: "plan_not_configured" }, { status: 200 });
    }

    // 1. Find THIS user's membership on the tier's plan. Metadata match first;
    //    then the email fallback (Fix 3a). Never grant off an ambiguous tie.
    const list = await fetchPlanMemberships(apiKey, planId).catch((err) => {
      console.error("[whop/checkout/verify] memberships fetch", err);
      Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "fetch_memberships" } });
      return null;
    });
    if (list === null) {
      return NextResponse.json({ granted: false, reason: "provider_unavailable" }, { status: 200 });
    }
    // Keep only rows on this tier's plan (a key that ignores plan_ids must not
    // let a membership on another plan, e.g. the trial, stand in for a paid
    // tier) and one row per membership id (the ledger can repeat a row).
    const parsed = dedupeById(
      list.rows.map(parseMembership).filter((m) => m.id && m.planId === planId)
    );
    const mine =
      parsed
        .filter((m) => m.metaUserId === userId)
        .find((m) => m.valid || (m.status ? VALID_STATUSES.has(m.status) : true)) ?? null;

    if (!mine) {
      const resolved = await resolveMembershipByEmailMatch(sb, {
        apiKey,
        planId,
        tier,
        userId,
        buyerEmail,
        parsed,
        membershipsTruncated: list.truncated,
      });

      if (resolved.kind === "resolved_payment") {
        // Fix 3: the payment is tied by email (membership email match or the
        // payment_events fallback); grant through the single grant entry.
        const granted = await grantFromPaymentEventRow(sb, {
          userId,
          buyerEmail,
          tier,
          planId,
          paymentId: resolved.paymentId,
          eventRowId: resolved.eventRowId,
          amountCents: resolved.amountCents ?? null,
        });
        return NextResponse.json(
          { ...granted, amount_cents: TIERS[tier]?.priceCents ?? null, tier },
          { status: 200 }
        );
      }
      if (resolved.kind === "membership_payment_pending") {
        // Same answer as the metadata path with a valid membership and no paid
        // row yet: the page keeps polling and the second-checkout guard holds.
        return NextResponse.json({ granted: false, reason: "payment_not_found", settled: false }, { status: 200 });
      }
      if (resolved.kind === "payment_unmatched") {
        await logPaymentEvent(sb, {
          event: "grant_failed",
          userId,
          email: buyerEmail,
          tier,
          planId,
          paymentId: resolved.paymentId ?? null,
          reason: "unmapped",
          matched: false,
          metadata: {
            source: "checkout_verify",
            cause: resolved.cause ?? "payment_unmatched",
            ok: false,
          },
        });
        return NextResponse.json({
          granted: false,
          reason: "payment_unmatched",
          payment_ref: resolved.paymentId ?? null,
        });
      }
      console.info(
        `[whop/checkout/verify] no valid membership for user=${userId} plan=${planId} (scanned ${parsed.length})`
      );
      const settled = await recordVerifiedAbsent(sb, userId, tier);
      return NextResponse.json({ granted: false, reason: "membership_not_found", settled }, { status: 200 });
    }

    // 2. Resolve the PAYMENT for this membership (the cross-path idempotency
    //    key the webhook grant also claims). Only a 'paid' payment grants.
    const payments = await fetchRecentPayments(apiKey).catch((err) => {
      console.error("[whop/checkout/verify] payments fetch", err);
      Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "fetch_payments" } });
      return null;
    });
    if (payments === null) {
      return NextResponse.json({ granted: false, reason: "provider_unavailable" }, { status: 200 });
    }
    const cutoff = Date.now() - PAYMENT_WINDOW_MS;
    const payment = payments.rows
      .map(parsePayment)
      .find(
        (p): p is PlanPayment =>
          p !== null &&
          Boolean(p.id) &&
          p.membershipId === mine.id &&
          p.status === "paid" &&
          !p.refunded &&
          p.createdAtMs !== null &&
          p.createdAtMs >= cutoff
      );

    if (!payment) {
      if (payments.truncated) {
        // Fix 4: a partial scan must NEVER be reported as payment_not_found —
        // the buyer's payment may sit beyond the scanned pages.
        Sentry.captureMessage(
          "whop_ledger_truncated: checkout_verify payments scan hit the cap; reporting payment_unmatched instead of payment_not_found",
          "warning"
        );
        return NextResponse.json({
          granted: false,
          reason: "payment_unmatched",
          payment_ref: null,
          truncated: true,
        });
      }
      // Charge still settling (or the webhook already granted and this scan
      // predates the ledger row). The page keeps polling; the webhook is the
      // backstop. Whop already shows a valid membership here, so this is
      // never a verified "no payment": the second-checkout guard is not
      // released and the page stays pending (issue 7 review P1).
      return NextResponse.json({ granted: false, reason: "payment_not_found", settled: false }, { status: 200 });
    }
    const paymentId = payment.id;

    // 3. Claim the payment id (same key the webhook grant uses). If the
    //    webhook already granted, this 23505s → return the current state.
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "whop",
        event_id: paymentId,
        payload: { claimed_at: new Date().toISOString(), source: "checkout_verify" },
      })
      .select("event_id")
      .maybeSingle();

    if (claimErr && (claimErr as { code?: string }).code !== "23505") {
      Sentry.captureException(claimErr, { tags: { route: "whop/checkout/verify", step: "claim" } });
      return NextResponse.json({ granted: false, reason: "db_error" }, { status: 200 });
    }
    if (!claim) {
      const { data: u2 } = await sb
        .from("users")
        .select("tier, tier_expires_at")
        .eq("id", userId)
        .maybeSingle();
      return NextResponse.json({
        granted: isPaidTier(u2?.tier, u2?.tier_expires_at),
        already: true,
        tier_expires_at: (u2?.tier_expires_at as string | null) ?? null,
      });
    }

    // 4. Grant: extend-or-insert + user tier reconcile (never shortens).
    const tierDef = TIERS[tier];
    const grant = await extendOrInsertWhopSubscription(sb, {
      userId,
      tier,
      paymentId,
      amountCents: tierDef?.priceCents ?? null,
      currency: "EUR",
      membershipId: mine.id,
    });
    if (grant.mode === "failed") {
      Sentry.captureException(new Error(grant.error ?? "grant failed"), {
        tags: { route: "whop/checkout/verify", step: "grant" },
        extra: { userId, tier, paymentId },
      });
      await logPaymentEvent(sb, {
        event: "grant_failed",
        userId,
        email: buyerEmail,
        tier,
        planId,
        paymentId,
        amountCents: tierDef?.priceCents ?? null,
        reason: "db_error",
        matched: true,
        metadata: { step: "extend_or_insert", source: "checkout_verify", ok: false },
      });
      // Fix 2: the write failed after the claim was taken — release it so the
      // webhook (or a later verify) can re-grant instead of deduping against
      // a stale claim that burned the payment id.
      await releaseWhopClaim(sb, paymentId);
      return NextResponse.json({ granted: false, reason: "db_error" }, { status: 200 });
    }

    if (grant.replayed) {
      const repaired = await repairWhopUserAccess(sb, userId);
      return NextResponse.json({ ...repaired, already: true });
    }
    try {
      if (!grant.entitlementReconciled) await reconcileUserTierPro(sb, userId, grant.expiresAt);
    } catch (userErr) {
      Sentry.captureException(userErr, { tags: { route: "whop/checkout/verify", step: "user_update" } });
      return NextResponse.json({ granted: false, reason: "entitlement_pending" }, { status: 200 });
    }

    try {
      await sb.from("user_events").insert({
        user_id: userId,
        event_type: "whop_subscription_activated",
        event_data: {
          source: "checkout_verify",
          payment_id: paymentId,
          membership_id: mine.id,
          tier,
          expires_at: grant.expiresAt,
          mode: grant.mode,
        },
      });
    } catch {
      /* non-blocking */
    }

    // Referral exam-reward: a paid whop-card subscription row now exists (the
    // card-trial signal), so a referee whose activity already cleared the bar
    // qualifies here too. Best-effort, never-throw.
    try {
      await qualifyReferralOnActivity(sb, userId);
    } catch (referralErr) {
      console.error("[whop/checkout/verify] referral exam-reward qualification:", referralErr);
    }

    await logPaymentEvent(sb, {
      event: "grant_succeeded",
      userId,
      email: buyerEmail,
      tier,
      planId,
      paymentId,
      amountCents: tierDef?.priceCents ?? null,
      currency: "EUR",
      matched: true,
      metadata: {
        source: "checkout_verify",
        membership_status: mine.status,
        mode: grant.mode,
        previous_expires_at: grant.previousExpiresAt,
        expires_at: grant.expiresAt,
        ok: true,
      },
    });

    // a-mentor-open: referral mentor credits on the referee's first paid
    // charge, after grant_succeeded, with the amount Whop reported (null never
    // rewards; the webhook's delivery then decides). Deferred, never throws.
    const paidCents = payment.amountCents;
    await afterResponse("referral-mentor-credits", async () => {
      await rewardReferrerOnFirstCharge(sb, { refereeId: userId, paymentId, amountCents: paidCents, via: "checkout_verify", referrerAdmitted: (id) => mentorOpenForAccount(sb, id) });
    });

    if (tierDef?.priceCents != null && tierDef.priceCents > 0) {
      void sendRedditConversion({
        trackingType: "Purchase",
        conversionId: paymentId,
        email: buyerEmail,
        valueDecimal: tierDef.priceCents / 100,
        currency: "EUR",
        externalId: userId,
      });
    }

    return NextResponse.json({
      granted: true,
      tier,
      payment_ref: paymentId,
      amount_cents: tierDef?.priceCents ?? null,
      tier_expires_at: grant.expiresAt,
    });
  } catch (err) {
    console.error("[whop/checkout/verify]", err);
    Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "unexpected" } });
    return NextResponse.json({ granted: false, reason: "error" }, { status: 200 });
  }
}

type EmailResolution =
  | { kind: "resolved_payment"; paymentId: string; eventRowId: number | null; amountCents?: number | null }
  | { kind: "payment_unmatched"; paymentId: string | null; cause: string }
  | { kind: "membership_payment_pending" }
  | { kind: "none" };

/**
 * Fix 3: buyer→payment tie resolution when the membership metadata match
 * fails. Runs AFTER the metadata attempt, BEFORE any "not found" answer.
 * Pure resolution: the caller performs the actual grant (single claim +
 * extend-or-insert path) so no branch can double-grant.
 */
async function resolveMembershipByEmailMatch(
  sb: ReturnType<typeof getServiceClient>,
  args: {
    apiKey: string;
    planId: string;
    tier: string;
    userId: string;
    buyerEmail: string | null;
    parsed: PlanMembership[];
    membershipsTruncated: boolean;
  }
): Promise<EmailResolution> {
  const tierDef = TIERS[args.tier];

  // 3a. Membership email match: case-insensitive exact equality between the
  // Whop member email and users.email. Ambiguity (multiple memberships or
  // multiple user rows sharing the email) refuses to grant.
  if (args.buyerEmail) {
    const { data: sameEmailUsers } = await sb
      .from("users")
      .select("id")
      .ilike("email", escapeLikeForPostgrest(args.buyerEmail));
    const userCount = (sameEmailUsers ?? []).length;
    const emailCandidates = dedupeById(args.parsed).filter(
      (m) =>
        m.email &&
        m.email.trim().toLowerCase() === args.buyerEmail?.trim().toLowerCase() &&
        // 2026-10-02: never claim a membership whose metadata names ANOTHER
        // MedPrüf account (the Whop payer email can belong to a different
        // account than the subscriber, e.g. the Mezoo/Bader case).
        (!m.metaUserId || m.metaUserId === args.userId) &&
        (m.valid || (m.status ? VALID_STATUSES.has(m.status) : true))
    );
    if (emailCandidates.length === 1 && userCount <= 1) {
      const mine = emailCandidates[0];
      const payments = await fetchRecentPayments(args.apiKey).catch((err) => {
        console.error("[whop/checkout/verify] payments fetch (email fallback)", err);
        Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "fetch_payments_email_fallback" } });
        return null;
      });
      if (payments !== null) {
        const cutoff = Date.now() - PAYMENT_WINDOW_MS;
        const payment = payments.rows
          .map(parsePayment)
          .find(
            (p): p is PlanPayment =>
              p !== null &&
              Boolean(p.id) &&
              p.membershipId === mine.id &&
              p.status === "paid" &&
          !p.refunded &&
              p.createdAtMs !== null &&
              p.createdAtMs >= cutoff
          );
        if (payment) {
          return { kind: "resolved_payment", paymentId: payment.id, eventRowId: null, amountCents: payment.amountCents };
        }
        if (payments.truncated) {
          Sentry.captureMessage(
            "whop_ledger_truncated: checkout_verify payments scan (email fallback) hit the cap",
            "warning"
          );
          return { kind: "payment_unmatched", paymentId: null, cause: "ledger_truncated" };
        }
      }
      // Whop shows this buyer's valid membership: a missing (still settling)
      // payment or a failed payments read is never a verified "no payment".
      return { kind: "membership_payment_pending" };
    }
    if (emailCandidates.length > 1 || userCount > 1) {
      Sentry.captureMessage(
        `checkout_verify email match ambiguous (memberships=${emailCandidates.length}, users=${userCount}) for plan=${args.planId} — refusing to grant`,
        "warning"
      );
      return { kind: "payment_unmatched", paymentId: null, cause: "email_ambiguous" };
    }
  }

  // 3b. payment_events fallback: a webhook_received row within 48h with
  // user_id IS NULL and THIS buyer's salted email hash, tier/amount lining up
  // with the requested tier.
  if (args.buyerEmail) {
    const emailHash = hashEmail(args.buyerEmail);
    if (emailHash) {
      const since = new Date(Date.now() - PAYMENT_WINDOW_MS).toISOString();
      const { data: rows } = await sb
        .from("payment_events")
        .select("id, payment_id, tier, amount_cents, event")
        .eq("event", "webhook_received")
        .is("user_id", null)
        .eq("email_hash", emailHash)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      const candidate = (rows ?? []).find((r) => {
        const row = r as {
          payment_id: string | null;
          tier: string | null;
          amount_cents: number | null;
        };
        if (!row.payment_id) return false;
        if (row.tier === args.tier) return true;
        if (
          typeof row.amount_cents === "number" &&
          tierDef?.priceCents != null &&
          row.amount_cents === tierDef.priceCents
        ) {
          return true;
        }
        return false;
      });
      if (candidate?.payment_id) {
        // The webhook claimed this payment id but failed to map it (no
        // grant_succeeded row can exist with user_id NULL on the receive row
        // unless grant never happened — verified by the caller's grant step,
        // which releases stale claims when no grant_succeeded exists).
        return {
          kind: "resolved_payment",
          paymentId: candidate.payment_id,
          eventRowId: (candidate as { id: number }).id,
          // The webhook's own record of what Whop charged.
          amountCents: (candidate as { amount_cents: number | null }).amount_cents,
        };
      }
    }
  }

  // Plausibility probe: does ANY payment-funnel row from the last 48h suggest
  // money moved for this buyer? If yes: payment_unmatched, not
  // membership_not_found.
  const emailHash = hashEmail(args.buyerEmail);
  if (emailHash) {
    const since = new Date(Date.now() - PAYMENT_WINDOW_MS).toISOString();
    const { data: probe } = await sb
      .from("payment_events")
      .select("payment_id")
      .in("event", ["webhook_received", "grant_failed"])
      .eq("email_hash", emailHash)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (probe ?? [])[0] as { payment_id?: string | null } | undefined;
    if (row) {
      return { kind: "payment_unmatched", paymentId: row.payment_id ?? null, cause: "funnel_row_unresolved" };
    }
  }
  if (args.membershipsTruncated) {
    Sentry.captureMessage(
      "whop_ledger_truncated: checkout_verify memberships scan hit the cap; reporting payment_unmatched instead of membership_not_found",
      "warning"
    );
    return { kind: "payment_unmatched", paymentId: null, cause: "ledger_truncated" };
  }
  return { kind: "none" };
}

function escapeLikeForPostgrest(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
}

/**
 * Single grant entry for the email/payment_events-tied paths: claim the
 * payment id (releasing a stale unmapped webhook claim first when no
 * grant_succeeded row exists for it), extend-or-insert, reconcile, backfill
 * the payment_events row. Returns the response payload for the caller.
 */
async function grantFromPaymentEventRow(
  sb: ReturnType<typeof getServiceClient>,
  args: {
    userId: string;
    buyerEmail: string | null;
    tier: string;
    planId: string;
    paymentId: string;
    eventRowId: number | null;
    /** What Whop charged, when known (referral mentor credits only; null never rewards). */
    amountCents?: number | null;
  }
): Promise<{
  granted: boolean;
  already?: boolean;
  reason?: string;
  payment_ref?: string | null;
  tier_expires_at?: string | null;
}> {
  const tierDef = TIERS[args.tier];

  // Claim discipline: if the webhook already claimed this payment id, check
  // whether it actually GRANTED (a grant_succeeded row with that payment id).
  // If it did not (stale unmapped claim, the 3b case), release + reclaim.
  let claim: { event_id: string } | null = null;
  for (let attempt = 0; attempt < 2 && !claim; attempt++) {
    if (attempt === 1) {
      // Second pass: release the stale claim first (no grant_succeeded).
      const { data: grantedRows } = await sb
        .from("payment_events")
        .select("id")
        .eq("event", "grant_succeeded")
        .eq("payment_id", args.paymentId)
        .limit(1);
      if ((grantedRows ?? []).length === 0) {
        await releaseWhopClaim(sb, args.paymentId);
      }
    }
    const res = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "whop",
        event_id: args.paymentId,
        payload: {
          claimed_at: new Date().toISOString(),
          source: "checkout_verify_payment_events_fallback",
        },
      })
      .select("event_id")
      .maybeSingle();
    if (res.error && (res.error as { code?: string }).code !== "23505") {
      Sentry.captureException(res.error, { tags: { route: "whop/checkout/verify", step: "claim_payment_events_fallback" } });
      return { granted: false, reason: "db_error" };
    }
    claim = (res.data as { event_id: string } | null) ?? null;
  }
  if (!claim) {
    // Claimed by a path that genuinely granted (or raced us): report state.
    const { data: u2 } = await sb
      .from("users")
      .select("tier, tier_expires_at")
      .eq("id", args.userId)
      .maybeSingle();
    return {
      granted: isPaidTier(u2?.tier, u2?.tier_expires_at),
      already: true,
      payment_ref: args.paymentId,
      tier_expires_at: (u2?.tier_expires_at as string | null) ?? null,
    };
  }

  const grant = await extendOrInsertWhopSubscription(sb, {
    userId: args.userId,
    tier: args.tier,
    paymentId: args.paymentId,
    amountCents: tierDef?.priceCents ?? null,
    currency: "EUR",
    membershipId: null,
  });
  if (grant.mode === "failed") {
    Sentry.captureException(new Error(grant.error ?? "grant failed"), {
      tags: { route: "whop/checkout/verify", step: "grant_payment_events_fallback" },
      extra: { userId: args.userId, tier: args.tier, paymentId: args.paymentId },
    });
    await logPaymentEvent(sb, {
      event: "grant_failed",
      userId: args.userId,
      email: args.buyerEmail,
      tier: args.tier,
      planId: args.planId,
      paymentId: args.paymentId,
      amountCents: tierDef?.priceCents ?? null,
      reason: "db_error",
      matched: true,
      metadata: { step: "extend_or_insert", source: "checkout_verify_payment_events_fallback", ok: false },
    });
    // Fix 2: write failed after the claim — release it so a retry can re-grant.
    await releaseWhopClaim(sb, args.paymentId);
    return { granted: false, reason: "db_error" };
  }
  if (grant.replayed) return { ...(await repairWhopUserAccess(sb, args.userId)), already: true, payment_ref: args.paymentId };
  try {
    if (!grant.entitlementReconciled) await reconcileUserTierPro(sb, args.userId, grant.expiresAt);
  } catch (userErr) {
    Sentry.captureException(userErr, { tags: { route: "whop/checkout/verify", step: "user_update_payment_events_fallback" } });
    return { granted: false, reason: "entitlement_pending", payment_ref: args.paymentId };
  }
  try {
    await sb.from("user_events").insert({
      user_id: args.userId,
      event_type: "whop_subscription_activated",
      event_data: {
        source: "checkout_verify_payment_events_fallback",
        payment_id: args.paymentId,
        tier: args.tier,
        expires_at: grant.expiresAt,
        mode: grant.mode,
      },
    });
  } catch {
    /* non-blocking */
  }
  await logPaymentEvent(sb, {
    event: "grant_succeeded",
    userId: args.userId,
    email: args.buyerEmail,
    tier: args.tier,
    planId: args.planId,
    paymentId: args.paymentId,
    amountCents: tierDef?.priceCents ?? null,
    currency: "EUR",
    matched: true,
    metadata: {
      source: "checkout_verify_payment_events_fallback",
      mode: grant.mode,
      expires_at: grant.expiresAt,
      ok: true,
    },
  });
  if (tierDef?.priceCents != null && tierDef.priceCents > 0) {
    void sendRedditConversion({
      trackingType: "Purchase",
      conversionId: args.paymentId,
      email: args.buyerEmail,
      valueDecimal: tierDef.priceCents / 100,
      currency: "EUR",
      externalId: args.userId,
    });
  }
  // a-mentor-open: referral mentor credits after grant_succeeded (deferred, never throws).
  await afterResponse("referral-mentor-credits", async () => {
    await rewardReferrerOnFirstCharge(sb, { refereeId: args.userId, paymentId: args.paymentId, amountCents: args.amountCents ?? null, via: "checkout_verify_fallback", referrerAdmitted: (id) => mentorOpenForAccount(sb, id) });
  });
  if (args.eventRowId) {
    try {
      await sb.from("payment_events").update({ user_id: args.userId }).eq("id", args.eventRowId);
    } catch (backfillErr) {
      console.error("[whop/checkout/verify] payment_events backfill", backfillErr);
    }
  }
  return { granted: true, payment_ref: args.paymentId, tier_expires_at: grant.expiresAt };
}

/**
 * Release the second-checkout guard only for a settled "no payment" result:
 * once per redirect, after CHECKOUT_SETTLE_MS (see src/lib/checkout-pending.ts).
 * Best-effort: a failed read keeps the guard, which is the safe side.
 * Returns whether the no-payment answer is settled: true only when the
 * release row is present after this call (re-read, because the write is
 * best-effort), null without a redirect row for the tier, false otherwise
 * (a failed read included), so the success page keeps checking.
 */
async function recordVerifiedAbsent(sb: ReturnType<typeof getServiceClient>, userId: string, tier: string): Promise<boolean | null> {
  try {
    const { data, error } = await sb
      .from("payment_events")
      .select("event, created_at, tier, reason")
      .eq("user_id", userId)
      .in("event", ["checkout_redirected", "checkout_failed"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return false;
    const events = (data ?? []) as CheckoutEvent[];
    if (!shouldRecordVerifiedAbsent(events, tier)) return noPaymentSettled(events, tier);
    await logPaymentEvent(sb, { event: "checkout_failed", userId, tier, reason: "verified_payment_not_found" });
    const reread = await sb
      .from("payment_events")
      .select("event, created_at, tier, reason")
      .eq("user_id", userId)
      .in("event", ["checkout_redirected", "checkout_failed"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (reread.error) return false;
    return noPaymentSettled((reread.data ?? []) as CheckoutEvent[], tier);
  } catch (err) {
    console.error("[whop/checkout/verify] verified-absent record", err);
    return false;
  }
}

/**
 * Read only (a21 P2): did a grant land for this learner after their latest
 * checkout redirect, within 24 hours? The usual order is the webhook first,
 * so verify answers already:true for a fresh buyer too; the success page
 * keeps the "receipt by email" line in that case and drops it only on a
 * revisit with no new payment. A failed read answers true (keep the line).
 */
async function paidAfterCheckout(sb: ReturnType<typeof getServiceClient>, userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb.from("payment_events").select("event, created_at")
      .eq("user_id", userId).in("event", ["checkout_redirected", "grant_succeeded"])
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      .order("created_at", { ascending: false }).limit(20);
    if (error) return true;
    const rows = (data ?? []) as Array<{ event: string }>;
    const grant = rows.findIndex((r) => r.event === "grant_succeeded");
    const redirect = rows.findIndex((r) => r.event === "checkout_redirected");
    return grant !== -1 && (redirect === -1 || grant < redirect);
  } catch {
    return true;
  }
}
