/**
 * Shared Whop grant primitive: EXTEND-or-INSERT subscription semantics.
 *
 * WHY THIS EXISTS (2026-09-20, [name]-directed Wave 1): the webhook grant path
 * used to INSERT a new subscriptions row and OVERWRITE users.tier_expires_at
 * with computeExpiry(now) on EVERY payment.succeeded. A repeat purchase
 * (renewal-prompt conversion, a buyer paying again after webhook lag, a
 * multi-month intent) therefore LOST all accumulated time — the second grant
 * reset the expiry clock to "1 month from now". That cost a real double-paid
 * buyer a manual expiry correction (user 805082ec, 2026-09-17: two €19
 * payments the same day, first webhook delivered ~3h late by Whop).
 *
 * SEMANTICS: if the user already has an ACTIVE, unexpired whop subscription,
 * extend THAT row in place: new expiry = max(current expiry, now) + the
 * tier's durationMonths. Update provider_payment_id/amount to the newest
 * payment so revoke/refund lookups keep working. Otherwise insert a fresh
 * row (unchanged behavior for first purchases and post-expiry re-purchases).
 *
 * Callers (webhook grant + /api/whop/checkout/verify) share this helper so
 * both paths produce identical rows and the same extension math.
 */
import { computeExpiry, tierDurationMonths } from "@/lib/whop";
import { logPaymentEvent } from "@/lib/paymentEvents";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WhopGrantOutcome {
  mode: "extended" | "inserted" | "failed";
  subscriptionId: string | null;
  expiresAt: string;
  previousExpiresAt: string | null;
  error?: string;
}

/**
 * One grant = one entry in subscriptions.granted_payment_ids. The array is
 * the full payment history of the row (Fix 6, 2026-09-21): provider_payment_id
 * stays the LATEST-payment view (existing readers unchanged), while the array
 * lets a later refund/dispute revoke match ANY payment that contributed time
 * and recompute the surviving window (extension semantics, no refund math on
 * money, only on time).
 */
export interface GrantedPaymentEntry {
  payment_id: string;
  amount_cents: number | null;
  added_months: number;
  granted_at: string;
}

interface GrantArgs {
  userId: string;
  tier: string;
  paymentId: string;
  amountCents: number | null;
  currency: string;
  membershipId?: string | null;
}

type Db = SupabaseClient;

interface ActiveSubRow {
  id: string;
  tier: string;
  expires_at: string | null;
  amount_cents: number | null;
  currency: string | null;
  granted_payment_ids: GrantedPaymentEntry[] | null;
  whop_membership_id: string | null;
}

function laterOf(aIso: string | null | undefined, b: Date): Date {
  if (!aIso) return b;
  const t = Date.parse(aIso);
  return Number.isFinite(t) && t > b.getTime() ? new Date(t) : b;
}

/**
 * Extend the user's dominant active whop subscription in place, or insert a
 * new row. A stale 'active' row whose date already passed is NOT extended
 * (the cron sweep expires it); only genuinely live windows accumulate.
 * The EXISTING row's tier is kept when extending; the NEW tier's duration is
 * what gets added (a repeat payment buys its tier's window from the current
 * end of access).
 */
export async function extendOrInsertWhopSubscription(
  sb: Db,
  args: GrantArgs
): Promise<WhopGrantOutcome> {
  const { userId, tier, paymentId, amountCents, currency } = args;
  const now = new Date();

  const { data: actives, error } = await sb
    .from("subscriptions")
    .select("id, tier, expires_at, amount_cents, currency, granted_payment_ids, whop_membership_id")
    .eq("user_id", userId)
    .eq("payment_provider", "whop")
    .eq("status", "active")
    .order("expires_at", { ascending: false })
    .limit(5);

  if (error) {
    return {
      mode: "failed",
      subscriptionId: null,
      expiresAt: "",
      previousExpiresAt: null,
      error: error.message,
    };
  }

  const live = ((actives ?? []) as ActiveSubRow[]).find((row) => {
    if (!row.expires_at) return true; // never-expiring row: still extendable
    return new Date(row.expires_at).getTime() > now.getTime();
  });

  if (live?.id) {
    const base = laterOf(live.expires_at, now);
    const newExpiry = computeExpiry(tierDurationMonths(tier), base);
    // Fix 6: append this payment to the row's granted_payment_ids history.
    const history: GrantedPaymentEntry[] = Array.isArray(live.granted_payment_ids)
      ? live.granted_payment_ids
      : [];
    const entry: GrantedPaymentEntry = {
      payment_id: paymentId,
      amount_cents: amountCents,
      added_months: tierDurationMonths(tier),
      granted_at: now.toISOString(),
    };
    const { error: updErr } = await sb
      .from("subscriptions")
      .update({
        expires_at: newExpiry.toISOString(),
        provider_payment_id: paymentId,
        amount_cents: amountCents ?? live.amount_cents ?? null,
        currency: currency || live.currency || "EUR",
        granted_payment_ids: [...history, entry],
        ...(args.membershipId ? { whop_membership_id: args.membershipId } : {}),
        updated_at: now.toISOString(),
      })
      .eq("id", live.id);
    if (updErr) {
      return {
        mode: "failed",
        subscriptionId: live.id,
        expiresAt: "",
        previousExpiresAt: live.expires_at ?? null,
        error: updErr.message,
      };
    }
    return {
      mode: "extended",
      subscriptionId: live.id,
      expiresAt: newExpiry.toISOString(),
      previousExpiresAt: live.expires_at ?? null,
    };
  }

  const newExpiry = computeExpiry(tierDurationMonths(tier), now);
  const insertEntry: GrantedPaymentEntry = {
    payment_id: paymentId,
    amount_cents: amountCents,
    added_months: tierDurationMonths(tier),
    granted_at: now.toISOString(),
  };
  const { data: inserted, error: insErr } = await sb
    .from("subscriptions")
    .insert({
      user_id: userId,
      tier,
      status: "active",
      payment_provider: "whop",
      payment_method: "card",
      amount_cents: amountCents,
      currency,
      provider_payment_id: paymentId,
      granted_payment_ids: [insertEntry],
      whop_membership_id: args.membershipId ?? null,
      started_at: now.toISOString(),
      expires_at: newExpiry.toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (insErr || !inserted) {
    return {
      mode: "failed",
      subscriptionId: null,
      expiresAt: "",
      previousExpiresAt: null,
      error: insErr?.message ?? "insert returned no row",
    };
  }
  return {
    mode: "inserted",
    subscriptionId: inserted.id,
    expiresAt: newExpiry.toISOString(),
    previousExpiresAt: null,
  };
}

/**
 * Set users.tier='pro' with tier_expires_at = MAX(current, new). Never
 * shortens a longer active window (e.g. a Cohort buyer who adds a one-month
 * extension must not lose Cohort time). Admin accounts are left untouched.
 */
export async function reconcileUserTierPro(
  sb: Db,
  userId: string,
  expiresAtIso: string
): Promise<void> {
  const { data: user } = await sb
    .from("users")
    .select("tier, tier_expires_at")
    .eq("id", userId)
    .maybeSingle();
  // Never touch an admin account's tier.
  if (user?.tier === "admin") return;

  const newMs = Date.parse(expiresAtIso);
  const curIso = (user?.tier_expires_at as string | null) ?? null;
  const curMs = curIso ? Date.parse(curIso) : NaN;
  const finalIso =
    Number.isFinite(curMs) && Number.isFinite(newMs) && curMs > newMs
      ? new Date(curMs).toISOString()
      : expiresAtIso;

  const { error: updErr } = await sb
    .from("users")
    .update({
      tier: "pro",
      tier_expires_at: finalIso,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (updErr) {
    // The subscription row is the source of truth; tier reconciles offline.
    throw updErr;
  }
}
/**
 * Fix 2 (2026-09-21): release the idempotency claim on a payment id when the
 * grant failed at the DB/write step AFTER the claim was taken. Without this
 * the payment id stays burned: the webhook's own retry dedupes against the
 * stale claim and a real paid buyer never gets granted (the money arrived,
 * the claim just blocks reprocessing).
 *
 * Deletes processed_webhook_events(provider='whop', event_id=paymentId),
 * best-effort. When the deletion happened, logs a payment_events
 * grant_failed row with metadata {claim_released:true} so the release is
 * visible in /admin/payments.
 *
 * Call it ONLY on DB/write failures after the claim was taken. NEVER on
 * validation failures (unmapped, unknown_tier, membership_not_found,
 * payment_not_found): those claims stay burned until an admin maps them,
 * so an unmapped payment can never double-grant after a manual fix.
 */
export async function releaseWhopClaim(
  sb: Db,
  paymentId: string
): Promise<boolean> {
  try {
    const { error } = await sb
      .from("processed_webhook_events")
      .delete()
      .eq("provider", "whop")
      .eq("event_id", paymentId);
    if (error) {
      console.error("[whop-grant] releaseWhopClaim delete failed", {
        paymentId,
        code: (error as { code?: string }).code,
        message: error.message?.slice(0, 200),
      });
      return false;
    }
    await logPaymentEvent(sb, {
      event: "grant_failed",
      paymentId,
      reason: "db_error",
      metadata: { claim_released: true, step: "release_claim", ok: false },
    });
    return true;
  } catch (err) {
    console.error("[whop-grant] releaseWhopClaim unexpected", { paymentId, err });
    return false;
  }
}
