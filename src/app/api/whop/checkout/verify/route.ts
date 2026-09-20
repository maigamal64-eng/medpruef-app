import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { tierToWhopPlan, TIERS } from "@/lib/whop";
import { extendOrInsertWhopSubscription, reconcileUserTierPro } from "@/lib/whop-grant";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { qualifyReferralOnActivity } from "@/lib/referral-exam-reward";

export const dynamic = "force-dynamic";

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
 */

const LIVE_TIERS = new Set([
  "first_month_19",
  "first_3mo_27",
  "premium_pass_guaranteed",
]);

// Whop membership statuses we treat as "access is live" (mirrors trial/verify).
const VALID_STATUSES = new Set(["active", "trialing", "completed"]);

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
  metaUserId: string | null;
  valid: boolean;
  status: string | null;
}

function parseMembership(m: unknown): PlanMembership {
  const d = rec(m);
  const plan = rec(d.plan);
  const metadata = rec(d.metadata);
  return {
    id: str(d.id) ?? "",
    metaUserId: str(metadata.medpruef_user_id) ?? str(metadata.user_id),
    valid: d.valid === true || d.valid === "true",
    status: str(d.status),
  };
}

interface PlanPayment {
  id: string;
  memberId: string | null;
  status: string | null;
  createdAtMs: number | null;
}

function parsePayment(p: unknown): PlanPayment | null {
  const d = rec(p);
  const member = rec(d.member);
  const plan = rec(d.plan);
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
    memberId: str(member.id) ?? str(d.member_id),
    status: str(d.status),
    createdAtMs: Number.isFinite(createdMs) ? createdMs : null,
  };
}

async function fetchPlanMemberships(
  apiKey: string,
  planId: string
): Promise<unknown[]> {
  const res = await fetch(
    `https://api.whop.com/api/v1/memberships?plan_id=${encodeURIComponent(planId)}&per=50`,
    { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
  );
  const raw = await res.text();
  if (!res.ok) throw new Error(`Whop memberships HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { data?: unknown[] }).data)
      ? ((parsed as { data: unknown[] }).data)
      : [];
}

async function fetchRecentPayments(apiKey: string): Promise<unknown[]> {
  const res = await fetch(
    `https://api.whop.com/api/v1/payments?company_id=${encodeURIComponent(process.env.WHOP_COMPANY_ID ?? "")}&per=100`,
    { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
  );
  const raw = await res.text();
  if (!res.ok) throw new Error(`Whop payments HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { data?: unknown[] }).data)
      ? ((parsed as { data: unknown[] }).data)
      : [];
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
  try {
    const body = await req.json().catch(() => ({}));
    tier = String(body?.tier || "");
  } catch {
    tier = "";
  }

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
    // Already Pro? Report success so the UI proceeds.
    const { data: user } = await sb
      .from("users")
      .select("tier, tier_expires_at, email")
      .eq("id", userId)
      .maybeSingle();
    if (user && (user.tier === "pro" || user.tier === "admin")) {
      return NextResponse.json({
        granted: true,
        already: true,
        tier_expires_at: user.tier_expires_at ?? null,
      });
    }

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

    // 1. Find THIS user's membership on the tier's plan (metadata match only —
    //    never grant off an email guess).
    const list = await fetchPlanMemberships(apiKey, planId).catch((err) => {
      console.error("[whop/checkout/verify] memberships fetch", err);
      Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "fetch_memberships" } });
      return null;
    });
    if (list === null) {
      return NextResponse.json({ granted: false, reason: "provider_unavailable" }, { status: 200 });
    }
    const mine = list
      .map(parseMembership)
      .filter((m) => m.id && m.metaUserId === userId)
      .find((m) => m.valid || (m.status ? VALID_STATUSES.has(m.status) : true));

    if (!mine) {
      console.info(
        `[whop/checkout/verify] no valid membership for user=${userId} plan=${planId} (scanned ${list.length})`
      );
      return NextResponse.json({ granted: false, reason: "membership_not_found" }, { status: 200 });
    }

    // 2. Resolve the PAYMENT for this membership (the cross-path idempotency
    // key the webhook grant also claims). Only a 'paid' payment grants.
    const payments = await fetchRecentPayments(apiKey).catch((err) => {
      console.error("[whop/checkout/verify] payments fetch", err);
      Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "fetch_payments" } });
      return null;
    });
    if (payments === null) {
      return NextResponse.json({ granted: false, reason: "provider_unavailable" }, { status: 200 });
    }
    const cutoff = Date.now() - 48 * 3600_000;
    const payment = payments
      .map(parsePayment)
      .find(
        (p): p is PlanPayment =>
          p !== null &&
          Boolean(p.id) &&
          p.memberId === mine.id &&
          p.status === "paid" &&
          p.createdAtMs !== null &&
          p.createdAtMs >= cutoff
      );

    if (!payment) {
      // Charge still settling (or the webhook already granted and this scan
      // predates the ledger row). The page keeps polling; the webhook is the
      // backstop.
      return NextResponse.json({ granted: false, reason: "payment_not_found" }, { status: 200 });
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
        granted: u2?.tier === "pro" || u2?.tier === "admin",
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
    });
    if (grant.mode === "failed") {
      Sentry.captureException(new Error(grant.error ?? "grant failed"), {
        tags: { route: "whop/checkout/verify", step: "grant" },
        extra: { userId, tier, paymentId },
      });
      await logPaymentEvent(sb, {
        event: "grant_failed",
        userId,
        email: user?.email ?? null,
        tier,
        planId,
        paymentId,
        amountCents: tierDef?.priceCents ?? null,
        reason: "db_error",
        matched: true,
        metadata: { step: "extend_or_insert", source: "checkout_verify", ok: false },
      });
      return NextResponse.json({ granted: false, reason: "db_error" }, { status: 200 });
    }

    try {
      await reconcileUserTierPro(sb, userId, grant.expiresAt);
    } catch (userErr) {
      Sentry.captureException(userErr, { tags: { route: "whop/checkout/verify", step: "user_update" } });
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
      email: user?.email ?? null,
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

    return NextResponse.json({ granted: true, tier, tier_expires_at: grant.expiresAt });
  } catch (err) {
    console.error("[whop/checkout/verify]", err);
    Sentry.captureException(err, { tags: { route: "whop/checkout/verify", step: "unexpected" } });
    return NextResponse.json({ granted: false, reason: "error" }, { status: 200 });
  }
}