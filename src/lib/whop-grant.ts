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
import { logPaymentEvent, type PaymentFailureReason } from "@/lib/paymentEvents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";
import { sittingPassAddedMonths, sittingPassEnd } from "@/lib/pricing-v2/sitting-pass";
import { whopExtensionsEnabled } from "@/lib/whop-extension";
import * as Sentry from "@sentry/nextjs";

export interface WhopGrantOutcome {
  mode: "extended" | "inserted" | "failed";
  subscriptionId: string | null;
  expiresAt: string;
  previousExpiresAt: string | null;
  /** True only when the gated SQL transaction also handled user entitlements. */
  entitlementReconciled?: boolean;
  /** This payment was already granted; do not report a new purchase window. */
  replayed?: boolean;
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
  /** Zero-month trial entries only: the trial's actual end (trial/verify). */
  trial_ends_at?: string;
  /** a-pricing-v2 Sitting Pass: the exact end sold (added_months is it rounded up). */
  ends_at?: string;
}

interface GrantArgs {
  userId: string;
  tier: string;
  paymentId: string;
  amountCents: number | null;
  currency: string;
  membershipId?: string | null;
  /**
   * a-pricing-v2 Sitting Pass: last day of the chosen sitting from the
   * checkout metadata. Absent = read the buyer's own checkout session event;
   * none = the 3-month maximum. Never an open end.
   */
  sittingLastDay?: string | null;
  /**
   * a-renew-early (reviewer P2): a caller that knows no membership (the
   * verify payment_events fallback, the admin link) must not merge a payment
   * into a row pinned to another membership: with extensions on, an account
   * with live pinned Whop rows gets mode "failed", error MEMBERSHIP_REQUIRED,
   * and the webhook (which carries the membership) grants it instead.
   */
  holdWithoutMembership?: boolean;
}

export const MEMBERSHIP_REQUIRED = "MEMBERSHIP_REQUIRED";

type Db = SupabaseClient;

/**
 * The Sitting Pass hint when the payment carried none (a verify or admin
 * link path): the buyer's newest sitting_pass checkout session in the last
 * 7 days. Any read problem returns null, which grants the 3-month maximum.
 */
export async function sittingHintFromCheckout(sb: Db, userId: string): Promise<string | null> {
  try {
    const { data, error } = await sb.from("payment_events")
      .select("metadata, created_at")
      .eq("user_id", userId).eq("event", "checkout_session_created").eq("tier", "sitting_pass")
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false }).limit(1);
    if (error) return null;
    const meta = (data?.[0]?.metadata ?? null) as Record<string, unknown> | null;
    const day = meta?.sitting_last_day;
    return typeof day === "string" ? day : null;
  } catch {
    return null;
  }
}

/** Exact window of one grant: months for every plan, an end date for the Sitting Pass. */
interface GrantWindow { months: number; end: Date | null }
async function grantWindow(sb: Db, args: GrantArgs, now: Date): Promise<GrantWindow> {
  if (args.tier !== "sitting_pass") return { months: tierDurationMonths(args.tier), end: null };
  const hint = args.sittingLastDay ?? await sittingHintFromCheckout(sb, args.userId);
  const end = sittingPassEnd(hint, now);
  return { months: sittingPassAddedMonths(end, now), end };
}

/** New end after `base` for a window: whole months, or the pass length added to base. */
function windowEnd(window: GrantWindow, base: Date, now: Date): Date {
  if (!window.end) return computeExpiry(window.months, base);
  return new Date(base.getTime() + Math.max(0, window.end.getTime() - now.getTime()));
}

export interface ActiveSubRow {
  id: string;
  tier: string;
  expires_at: string | null;
  amount_cents: number | null;
  currency: string | null;
  granted_payment_ids: GrantedPaymentEntry[] | null;
  whop_membership_id: string | null;
}

/** PostgREST / Postgres: the function does not exist (changeset not applied). */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}
let pinnedMissingReported = false;
/** Until when this instance skips the pinned call (a missing function is not looked up on every grant). */
let pinnedMissingUntil = 0;
const PINNED_MISSING_RECHECK_MS = 10 * 60_000;
function reportPinnedMissingOnce(): void {
  pinnedMissingUntil = Date.now() + PINNED_MISSING_RECHECK_MS;
  if (pinnedMissingReported) return;
  pinnedMissingReported = true;
  Sentry.captureMessage("grant_whop_paid_subscription_pinned not installed: granting with grant_whop_paid_subscription (20270104090000 not applied)", "warning");
}
/** Test seam. */
export function resetPinnedGrantCacheForTests(): void { pinnedMissingReported = false; pinnedMissingUntil = 0; }

export type PinnedGrantTarget =
  | { kind: "extend"; row: ActiveSubRow }
  | { kind: "stack"; pin: string; start: Date }
  | { kind: "insert" };

/**
 * Which row a paid grant writes (a-renew-early; mirrors the SQL function
 * grant_whop_paid_subscription_pinned). `live` are the user's active,
 * unexpired Whop rows.
 */
export function pinnedGrantTarget(live: ActiveSubRow[], membershipId: string | null, now: Date): PinnedGrantTarget {
  const pin = whopMembershipIdOrNull(membershipId);
  const byEnd = [...live].sort((a, b) => {
    if (a.expires_at == null) return -1;
    if (b.expires_at == null) return 1;
    return Date.parse(b.expires_at) - Date.parse(a.expires_at);
  });
  if (pin) {
    const own = byEnd.find((row) => row.whop_membership_id === pin);
    if (own) return { kind: "extend", row: own };
    const otherPinned = live.some((row) => whopMembershipIdOrNull(row.whop_membership_id));
    const unbounded = live.some((row) => row.expires_at == null);
    if (otherPinned && !unbounded) {
      const end = Math.max(...live.map((row) => Date.parse(row.expires_at as string)));
      return { kind: "stack", pin, start: new Date(Math.max(end, now.getTime())) };
    }
  }
  return byEnd[0] ? { kind: "extend", row: byEnd[0] } : { kind: "insert" };
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
  if (args.holdWithoutMembership && whopExtensionsEnabled() && !whopMembershipIdOrNull(args.membershipId)) {
    const { data: pinned, error: pinnedError } = await sb.from("subscriptions")
      .select("id, expires_at, whop_membership_id").eq("user_id", userId).eq("payment_provider", "whop").eq("status", "active");
    if (pinnedError) return { mode: "failed", subscriptionId: null, expiresAt: "", previousExpiresAt: null, error: pinnedError.message };
    const live = ((pinned ?? []) as Array<{ expires_at: string | null; whop_membership_id: string | null }>)
      .filter((row) => (!row.expires_at || Date.parse(row.expires_at) > Date.now()) && whopMembershipIdOrNull(row.whop_membership_id));
    if (live.length > 0) return { mode: "failed", subscriptionId: null, expiresAt: "", previousExpiresAt: null, error: MEMBERSHIP_REQUIRED };
  }
  // Rollout gate defaults OFF until the SQL migration is approved/applied.
  // When enabled, missing RPCs and errors fail closed: never silently lose
  // atomicity by falling through to the historical read/update implementation.
  const window = await grantWindow(sb, args, new Date());
  if (process.env.WHOP_ATOMIC_GRANTS_ENABLED === "true") {
    try {
      // a-pricing-v2: an exact-end grant (the Sitting Pass) goes through the
      // separate _until function (20270103090000); every other tier keeps the
      // applied months function unchanged.
      const monthsArgs = {
        p_user_id: userId,
        p_tier: tier,
        p_payment_id: paymentId,
        p_amount_cents: amountCents,
        p_currency: currency,
        p_duration_months: window.months,
        p_membership_id: args.membershipId ?? null,
      };
      let { data, error } = window.end
        ? await sb.rpc("grant_whop_paid_subscription_until", {
            p_user_id: userId,
            p_tier: tier,
            p_payment_id: paymentId,
            p_amount_cents: amountCents,
            p_currency: currency,
            p_expires_at: window.end.toISOString(),
            p_added_months: window.months,
            p_membership_id: args.membershipId ?? null,
          })
        // a-renew-early: the pinned function (20270104090000) gives a new
        // membership its own row after running coverage. Until that
        // changeset is applied, today's function, but only while extensions
        // are off: with them on, merging an extension into the old row is
        // exactly what the flag waits for, so the grant fails closed.
        : !whopExtensionsEnabled() && Date.now() < pinnedMissingUntil
          ? await sb.rpc("grant_whop_paid_subscription", monthsArgs)
          : await sb.rpc("grant_whop_paid_subscription_pinned", monthsArgs);
      if (!window.end && error && isMissingFunction(error)) {
        if (whopExtensionsEnabled()) throw new Error("grant_whop_paid_subscription_pinned is missing while WHOP_EXTENSIONS_ENABLED is on");
        reportPinnedMissingOnce();
        ({ data, error } = await sb.rpc("grant_whop_paid_subscription", monthsArgs));
      }
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : null;
      if (!row || !["extended", "inserted"].includes(row.mode) ||
          typeof row.subscription_id !== "string" ||
          (row.expires_at !== null && (typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)))) ||
          row.entitlement_reconciled !== true) {
        throw new Error("Atomic grant returned an invalid result");
      }
      return {
        mode: row.mode,
        subscriptionId: row.subscription_id,
        expiresAt: row.expires_at ?? "",
        previousExpiresAt: row.previous_expires_at ?? null,
        entitlementReconciled: true,
        replayed: row.replayed === true,
      };
    } catch (error) {
      return {
        mode: "failed", subscriptionId: null, expiresAt: "", previousExpiresAt: null,
        error: error instanceof Error ? error.message : "Atomic grant failed",
      };
    }
  }
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

  // a-db-timeouts: a write can commit after the 8 s database deadline made it
  // look failed; the claim is then released and the payment redelivered. A
  // payment already in an active row's history is a replay: never extend
  // twice. Access is reconciled by the caller (entitlementReconciled false).
  const already = ((actives ?? []) as ActiveSubRow[]).find((row) =>
    Array.isArray(row.granted_payment_ids) && row.granted_payment_ids.some((e) => e?.payment_id === paymentId));
  if (already?.id) {
    return {
      mode: "extended",
      subscriptionId: already.id,
      expiresAt: already.expires_at ?? "",
      previousExpiresAt: already.expires_at ?? null,
      replayed: true,
      entitlementReconciled: already.expires_at === null,
    };
  }

  const liveRows = ((actives ?? []) as ActiveSubRow[]).filter((row) =>
    !row.expires_at || new Date(row.expires_at).getTime() > now.getTime());
  // a-renew-early, the same rule as grant_whop_paid_subscription_pinned:
  // (1) a renewal extends the live row pinned to this membership; (2) a new
  // membership while other pinned coverage runs gets its own row starting at
  // that coverage's end; (3) otherwise today's rule (newest live row).
  // The Sitting Pass (an exact end) keeps today's rule on both paths: its SQL
  // function grant_whop_paid_subscription_until is not membership-aware, and
  // checkout never sells it onto running access.
  const exact = window.end !== null;
  const pick = pinnedGrantTarget(liveRows, exact ? null : args.membershipId ?? null, now);
  if (pick.kind === "stack") {
    const start = pick.start;
    const newExpiry = windowEnd(window, start, now);
    const stackEntry: GrantedPaymentEntry = {
      payment_id: paymentId,
      amount_cents: amountCents,
      added_months: window.months,
      granted_at: now.toISOString(),
      ...(window.end ? { ends_at: window.end.toISOString() } : {}),
    };
    const { data: stacked, error: stackErr } = await sb
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
        granted_payment_ids: [stackEntry],
        whop_membership_id: pick.pin,
        started_at: start.toISOString(),
        expires_at: newExpiry.toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (stackErr || !stacked) {
      return { mode: "failed", subscriptionId: null, expiresAt: "", previousExpiresAt: start.toISOString(), error: stackErr?.message ?? "insert returned no row" };
    }
    return { mode: "inserted", subscriptionId: stacked.id, expiresAt: newExpiry.toISOString(), previousExpiresAt: start.toISOString() };
  }
  const live = pick.kind === "extend" ? pick.row : undefined;

  if (live?.id) {
    const base = laterOf(live.expires_at, now);
    const newExpiry = windowEnd(window, base, now);
    // Fix 6: append this payment to the row's granted_payment_ids history.
    const history: GrantedPaymentEntry[] = Array.isArray(live.granted_payment_ids)
      ? live.granted_payment_ids
      : [];
    const entry: GrantedPaymentEntry = {
      payment_id: paymentId,
      amount_cents: amountCents,
      added_months: window.months,
      granted_at: now.toISOString(),
      ...(window.end ? { ends_at: window.end.toISOString() } : {}),
    };
    const { error: updErr } = await sb
      .from("subscriptions")
      .update({
        expires_at: newExpiry.toISOString(),
        provider_payment_id: paymentId,
        amount_cents: amountCents ?? live.amount_cents ?? null,
        currency: currency || live.currency || "EUR",
        granted_payment_ids: [...history, entry],
        // a-stability: only a real membership (mem_) id ever becomes the pin;
        // a-renew-early: a row already pinned to a membership keeps it.
        ...(whopMembershipIdOrNull(args.membershipId) && !whopMembershipIdOrNull(live.whop_membership_id) ? { whop_membership_id: whopMembershipIdOrNull(args.membershipId) } : {}),
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

  const newExpiry = windowEnd(window, now, now);
  const insertEntry: GrantedPaymentEntry = {
    payment_id: paymentId,
    amount_cents: amountCents,
    added_months: window.months,
    granted_at: now.toISOString(),
    ...(window.end ? { ends_at: window.end.toISOString() } : {}),
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
      whop_membership_id: whopMembershipIdOrNull(args.membershipId),
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
  const { data: user, error: lookupError } = await sb
    .from("users")
    .select("tier, role, tier_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!user) throw new Error("User not found during entitlement reconciliation");
  // A null expiry on Pro is an explicit non-expiring grant.
  if (user.tier === "pro" && user.tier_expires_at == null) return;
  // Never touch an admin account's tier.
  if (user.tier === "admin" || user.role === "admin") return;

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
  paymentId: string,
  /** The grant_failed reason logged with the release (a-whop-buyer-fail-closed). */
  reason: PaymentFailureReason = "db_error"
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
      reason,
      metadata: { claim_released: true, step: "release_claim", ok: false },
    });
    return true;
  } catch (err) {
    console.error("[whop-grant] releaseWhopClaim unexpected", { paymentId, err });
    return false;
  }
}
