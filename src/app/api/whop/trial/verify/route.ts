import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { tierToWhopPlan, paginateWhopLedger, whopPlanQuery } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { repairWhopUserAccess } from "@/lib/whop-entitlement";
import { releaseWhopClaim, reconcileUserTierPro } from "@/lib/whop-grant";
import { qualifyReferralOnActivity } from "@/lib/referral-exam-reward";
import { isPaidTier } from "@/lib/free-tier";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/whop/trial/verify — the PRIMARY grant for the Whop card trial.
 *
 * Called by /checkout/success when the user returns from the trial checkout
 * (?trial=1). A €0 trial start does NOT fire `payment.succeeded` (no money
 * moved), so the payment-webhook grant path never triggers at trial start —
 * we grant here instead, deterministically: read the user's Whop membership
 * via the API, confirm it's valid + tied to THIS user (metadata), and flip the
 * account to Pro. This is API-verified, not a client claim.
 *
 * Idempotent: claims processed_webhook_events(provider='whop',
 * event_id=<membership_id>). The (future) membership.went_valid webhook branch
 * will claim the SAME key, so verify + webhook can both run and grant at most
 * once. Renewals (the €19/mo charges) fire payment.succeeded and extend Pro via
 * the existing webhook — this route handles only the trial-START grant.
 *
 * Gracefully degrades: if no valid membership is found yet (webhook lag, or a
 * membership object that doesn't carry our metadata), it returns granted:false
 * and the success page keeps polling — the webhook remains the backstop.
 */

const TRIAL_TIER = "notes_pro_trial";
const TRIAL_ENABLED =
  (process.env.NOTES_TRIAL_ENABLED ?? "false").toLowerCase() === "true";

// Whop membership statuses we treat as "access is live".
const VALID_STATUSES = new Set(["active", "trialing", "completed"]);

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

interface Membership {
  id: string | null;
  planId: string | null;
  status: string | null;
  valid: boolean;
  metaUserId: string | null;
  /** epoch-seconds or ISO end of the current period, if present. */
  periodEnd: number | null;
}

function parseMembership(m: unknown): Membership {
  const d = rec(m);
  const plan = rec(d.plan);
  const metadata = rec(d.metadata);
  // period end appears under several names across Whop schemas; read epoch-secs
  // or ISO. renewal_period_end = when the next charge (or trial end) lands.
  const endRaw =
    d.renewal_period_end ??
    d.expires_at ??
    d.valid_until ??
    d.current_period_end ??
    null;
  let periodEnd: number | null = null;
  if (typeof endRaw === "number" && Number.isFinite(endRaw)) {
    periodEnd = endRaw > 1e12 ? Math.round(endRaw) : Math.round(endRaw * 1000); // secs→ms
  } else if (typeof endRaw === "string") {
    const t = Date.parse(endRaw);
    if (Number.isFinite(t)) periodEnd = t;
  }
  return {
    id: str(d.id),
    planId: str(plan.id) ?? str(d.plan_id) ?? str(d.plan),
    status: str(d.status),
    valid: d.valid === true || d.valid === "true",
    metaUserId: str(metadata.medpruef_user_id) ?? str(metadata.user_id),
    periodEnd,
  };
}

/** This account's live membership on the trial plan (metadata names the user). */
function isUsableTrialMembership(m: Membership, userId: string, planId: string): boolean {
  return Boolean(m.id) && m.metaUserId === userId && m.planId === planId &&
    (m.valid || (m.status ? VALID_STATUSES.has(m.status) : true));
}

/**
 * Cursor-paged membership scan on the trial plan (shared ledger helper,
 * 2026-10-14): `plan_ids` filters (v1 ignores `plan_id`), rows are unique by
 * id, and the scan stops at the first row whose metadata names this account.
 */
async function fetchTrialMemberships(
  planId: string,
  userId: string,
): Promise<{ list: unknown[]; truncated: boolean }> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY / WHOP_APP_API_KEY not set");
  const { rows, truncated } = await paginateWhopLedger({
    apiKey,
    endpoint: "memberships",
    query: whopPlanQuery(planId),
    match: (row) => isUsableTrialMembership(parseMembership(row), userId, planId),
    tag: "trial_verify.memberships",
  });
  return { list: rows, truncated };
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;
  const sb = getServiceClient();

  if (!TRIAL_ENABLED) {
    return NextResponse.json({ granted: false, reason: "trial_disabled" }, { status: 200 });
  }

  try {
    const repaired = await repairWhopUserAccess(sb, userId);
    if (repaired.granted) return NextResponse.json({ ...repaired, already: true });
    // Already Pro? Nothing to do — report success so the UI proceeds.
    const { data: user } = await sb
      .from("users")
      .select("tier, tier_expires_at, email")
      .eq("id", userId)
      .maybeSingle();
    // Expiry-aware (2026-10-02): a stale tier='pro' whose tier_expires_at
    // passed is NOT paid, so it must not short-circuit as "already granted".
    if (user && isPaidTier(user.tier as string | null, user.tier_expires_at as string | null)) {
      return NextResponse.json({
        granted: true,
        already: true,
        tier_expires_at: user.tier_expires_at ?? null,
      });
    }

    const planId = tierToWhopPlan(TRIAL_TIER);
    if (!planId) {
      Sentry.captureMessage("WHOP_PLAN_NOTES_TRIAL not set — trial verify cannot run", "error");
      return NextResponse.json({ granted: false, reason: "plan_not_configured" }, { status: 200 });
    }

    let list: unknown[];
    try {
      ({ list } = await fetchTrialMemberships(planId, userId));
    } catch (err) {
      // Whop read failed — not fatal; the webhook is the backstop. Log + let the
      // success page keep polling.
      console.error("[whop/trial/verify] memberships fetch", err);
      Sentry.captureException(err, { tags: { route: "whop/trial/verify", step: "fetch" } });
      return NextResponse.json({ granted: false, reason: "provider_unavailable" }, { status: 200 });
    }

    // Find THIS user's membership: metadata match is the reliable link. Also
    // accept a plan-scoped membership even if metadata is absent ONLY when it's
    // the single membership on the plan for a just-completed checkout — but to
    // stay safe we require the metadata match (no wrong-user grant).
    const mine = list.map(parseMembership).find((m) => isUsableTrialMembership(m, userId, planId));

    if (!mine || !mine.id) {
      // No valid membership tied to this user yet. Webhook lag or metadata not
      // on the membership object — degrade gracefully; the page keeps polling.
      console.info(
        `[whop/trial/verify] no valid membership for user=${userId} plan=${planId} (scanned ${list.length})`,
      );
      return NextResponse.json({ granted: false, reason: "membership_not_found" }, { status: 200 });
    }

    // ── Trial-reuse guard (2026-10-02): one free trial window per ACCOUNT,
    //    ever. /api/whop/trial already refuses a second checkout, but a reused
    //    or second membership on the plan must not re-grant a free window
    //    here either. A paid start (Whop charges a repeat payer EUR 19 at
    //    subscription_create) is granted by the payment.succeeded webhook. ──
    const { data: priorTrials } = await sb
      .from("subscriptions")
      .select("id, status, expires_at, whop_membership_id, provider_payment_id")
      .eq("user_id", userId)
      .eq("tier", TRIAL_TIER)
      .limit(5);
    const priorRows = (priorTrials ?? []) as Array<{
      id: string;
      status: string;
      expires_at: string | null;
      whop_membership_id: string | null;
      provider_payment_id: string | null;
    }>;
    const sameMembership = priorRows.some(
      (r) => r.whop_membership_id === mine.id || r.provider_payment_id === mine.id
    );
    if (priorRows.length > 0 && !sameMembership) {
      const live = priorRows.find(
        (r) => r.status === "active" && r.expires_at && Date.parse(r.expires_at) > Date.now()
      );
      if (live) {
        // The webhook backstop already granted this trial; report it.
        return NextResponse.json({ granted: true, already: true, tier_expires_at: live.expires_at });
      }
      Sentry.captureMessage(
        `trial_verify: account ${userId} already used its trial; membership ${mine.id} gets no second free window`,
        "warning"
      );
      await logPaymentEvent(sb, {
        event: "grant_failed",
        userId,
        email: user?.email ?? null,
        tier: TRIAL_TIER,
        planId,
        paymentId: mine.id,
        reason: "trial_reuse",
        matched: true,
        metadata: { source: "trial_verify", ok: false },
      });
      return NextResponse.json({ granted: false, reason: "trial_already_used" }, { status: 200 });
    }

    // ── Idempotency claim on the membership id (shared with the future
    //    membership.went_valid webhook branch) — first writer wins. ──
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: "whop",
        event_id: mine.id,
        payload: { claimed_at: new Date().toISOString(), source: "trial_verify", status: mine.status },
      })
      .select("event_id")
      .maybeSingle();

    if (claimErr && (claimErr as { code?: string }).code !== "23505") {
      Sentry.captureException(claimErr, { tags: { route: "whop/trial/verify", step: "claim" } });
      return NextResponse.json({ granted: false, reason: "db_error" }, { status: 200 });
    }
    if (!claim) {
      // Already granted by a prior verify or the webhook — return current state.
      const { data: u2 } = await sb
        .from("users")
        .select("tier, tier_expires_at")
        .eq("id", userId)
        .maybeSingle();
      return NextResponse.json({
        granted: isPaidTier(u2?.tier, u2?.tier_expires_at),
        already: true,
        tier_expires_at: u2?.tier_expires_at ?? null,
      });
    }

    // ── Expiry: cover the trial window + a buffer past the first charge so a
    //    renewal webhook has time to land. Keep exactly one day after the
    //    membership's real period end; else now + (trial_days + 1). ──
    const now = Date.now();
    const trialDays = 7;
    const fallback = now + (trialDays + 1) * 86400_000;
    const expiresMs = mine.periodEnd
      ? mine.periodEnd + 1 * 86400_000
      : fallback;
    const expiresIso = new Date(expiresMs).toISOString();
    const nowIso = new Date(now).toISOString();

    // Subscription row (the "has trialed" record + the cron's expiry hook).
    const { error: subErr } = await sb.from("subscriptions").insert({
      user_id: userId,
      tier: TRIAL_TIER,
      status: "active",
      payment_provider: "whop",
      payment_method: "card",
      amount_cents: 0, // €0 at trial start; the €19 renewals log their own rows
      currency: "EUR",
      provider_payment_id: mine.id, // membership id — the grant/idempotency key
      whop_membership_id: mine.id, // 2026-10-02: the renewal routing pin (fix A)
      // Trial provenance: a later renewal refund keeps exactly this window.
      granted_payment_ids: [
        { payment_id: mine.id, amount_cents: 0, added_months: 0, granted_at: nowIso, trial_ends_at: expiresIso },
      ],
      started_at: nowIso,
      expires_at: expiresIso,
    });
    if (subErr) {
      Sentry.captureException(subErr, {
        tags: { route: "whop/trial/verify", step: "sub_insert" },
        extra: { userId, membershipId: mine.id },
      });
      await logPaymentEvent(sb, {
        event: "grant_failed",
        userId,
        email: user?.email ?? null,
        tier: TRIAL_TIER,
        planId,
        paymentId: mine.id,
        reason: "db_error",
        matched: true,
        metadata: { step: "sub_insert", source: "trial_verify", ok: false },
      });
      // Fix 2: the insert failed after the membership-id claim was taken —
      // release it so the webhook backstop can grant instead of deduping
      // against a stale claim.
      await releaseWhopClaim(sb, mine.id);
      return NextResponse.json({ granted: false, reason: "db_error" }, { status: 200 });
    }

    try {
      await reconcileUserTierPro(sb, userId, expiresIso);
    } catch (userErr) {
      Sentry.captureException(userErr, { tags: { route: "whop/trial/verify", step: "user_update" }, extra: { userId } });
      // Subscription already landed. Keep the claim, then retry repairs only
      // the existing access window via repairWhopUserAccess above.
      return NextResponse.json({ granted: false, reason: "entitlement_pending" }, { status: 200 });
    }

    try {
      await sb.from("user_events").insert({
        user_id: userId,
        event_type: "notes_trial_activated",
        event_data: { provider: "whop", membership_id: mine.id, expires_at: expiresIso, source: "trial_verify" },
      });
    } catch {
      /* non-blocking */
    }

    // Referral exam-reward: the card just linked (this insert IS the
    // card-trial signal), so a referee whose activity already cleared
    // the bar before linking a card should qualify immediately, not
    // wait for their next answer. Best-effort, never-throw, same
    // swallow-log pattern as elsewhere in this route.
    try {
      await qualifyReferralOnActivity(sb, userId);
    } catch (referralErr) {
      console.error("[whop/trial/verify] referral exam-reward qualification:", referralErr);
    }

    await logPaymentEvent(sb, {
      event: "grant_succeeded",
      userId,
      email: user?.email ?? null,
      tier: TRIAL_TIER,
      planId,
      paymentId: mine.id,
      amountCents: 0,
      currency: "EUR",
      matched: true,
      metadata: { source: "trial_verify", membership_status: mine.status, expires_at: expiresIso, ok: true },
    });

    return NextResponse.json({ granted: true, tier: "pro", tier_expires_at: expiresIso });
  } catch (err) {
    console.error("[whop/trial/verify]", err);
    Sentry.captureException(err, { tags: { route: "whop/trial/verify", step: "unexpected" } });
    return NextResponse.json({ granted: false, reason: "error" }, { status: 200 });
  }
}
