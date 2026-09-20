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
import type { SupabaseClient } from "@supabase/supabase-js";

export interface WhopGrantOutcome {
  mode: "extended" | "inserted" | "failed";
  subscriptionId: string | null;
  expiresAt: string;
  previousExpiresAt: string | null;
  error?: string;
}

interface GrantArgs {
  userId: string;
  tier: string;
  paymentId: string;
  amountCents: number | null;
  currency: string;
}

type Db = SupabaseClient;

interface ActiveSubRow {
  id: string;
  tier: string;
  expires_at: string | null;
  amount_cents: number | null;
  currency: string | null;
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
    .select("id, tier, expires_at, amount_cents, currency")
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
    const { error: updErr } = await sb
      .from("subscriptions")
      .update({
        expires_at: newExpiry.toISOString(),
        provider_payment_id: paymentId,
        amount_cents: amountCents ?? live.amount_cents ?? null,
        currency: currency || live.currency || "EUR",
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