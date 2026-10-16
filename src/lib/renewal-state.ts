/**
 * Does the learner's current plan really renew by itself? (a21 P2, 2026-10-12)
 *
 * `loadRenewalOfferSuppression` (billing-cadence.ts) fails closed for sales
 * prompts: an unknown plan suppresses the offer. That answer must not be
 * shown to the learner as "Ihr Abo verlängert sich automatisch", because an
 * unknown plan, a failed check or a plan cancelled at Whop does not renew.
 * This helper answers the learner-facing question and claims an automatic
 * renewal only when Whop itself confirms it:
 *
 *   renews   - a row on an auto-renewing plan whose Whop membership is active
 *              or trialing, not set to cancel, with a next charge date
 *   unknown  - a row on an unclassified plan, an auto-renewing row whose
 *              membership cannot be read, or any read error (reported to
 *              Sentry so a Whop outage or missing key does not stay silent)
 *   cancelled - a renewing plan Whop confirms is cancelled: it will not
 *              charge again. Since a-renew-early an extension gets its own
 *              row and pin, so this access is extendable like one-time
 *              access (whop-extension.ts)
 *   one_time - only one-time or non-Whop rows, or no active rows
 *
 * Read only: no grant, webhook or revoke behaviour depends on it.
 *
 * Reporting (a-stability, Sentry JAVASCRIPT-NEXTJS-13): only a real mem_ pin
 * is read. A legacy mber_ pin (a Whop MEMBER id stored by pre-2 Oct code) or
 * no pin counts as "no pin": unknown, never reported. A 401/403 from Whop is
 * a key permission problem, not a learner problem: one Sentry warning per
 * hour per server instance names it, instead of one error per read.
 */
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySubscriptionCadence } from "@/lib/billing-cadence";
import { loadWhopBillingRead, type ProviderBillingSnapshot, type WhopBillingRead } from "@/lib/whop-subscription-snapshot";
import { captureServerError } from "@/lib/sentry-capture";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";

export type RenewalState = "renews" | "unknown" | "cancelled" | "one_time";
/** A loader may return the bare snapshot (status unknown) or the read with its HTTP status. */
export type SnapshotLoader = (membershipId: string | null, tier: string) => Promise<ProviderBillingSnapshot | WhopBillingRead | null>;

function asRead(value: ProviderBillingSnapshot | WhopBillingRead | null): WhopBillingRead {
  if (value && "snapshot" in value && "status" in value) return value;
  return { snapshot: (value as ProviderBillingSnapshot | null) ?? null, status: null };
}

const AUTH_WARNING_INTERVAL_MS = 60 * 60 * 1000;
let lastAuthWarningAt = 0;

/** Test seam: forget when the last permission warning was sent. */
export function resetWhopAuthWarningForTests(): void {
  lastAuthWarningAt = 0;
}

/**
 * The production key was answered "not authorized" by GET /api/v1/memberships
 * (and /payments). Say so once an hour, not on every learner's read.
 */
export function warnWhopKeyUnauthorized(status: number, endpoint: string, now: number = Date.now()): boolean {
  if (now - lastAuthWarningAt < AUTH_WARNING_INTERVAL_MS) return false;
  lastAuthWarningAt = now;
  try {
    Sentry.captureMessage(
      `Whop API key not authorized (HTTP ${status}) for ${endpoint}: the server key (WHOP_API_KEY or WHOP_APP_API_KEY) needs read permission for memberships and payments. Renewal state shows "unknown" until the key is replaced.`,
      { level: "warning", tags: { route: "renewal-state", step: "whop_key_unauthorized", status: String(status) } },
    );
  } catch { /* Sentry unavailable: the console line below still lands in the runtime log */ }
  console.warn(`[renewal-state] Whop API key not authorized (HTTP ${status}) for ${endpoint}; reported at most once per hour`);
  return true;
}

/** True only for a provider-confirmed membership that will charge again. */
export function snapshotRenews(snapshot: ProviderBillingSnapshot | null): boolean {
  return Boolean(
    snapshot?.provider_state_verified &&
    snapshot.billing_cadence === "auto_renews" &&
    !snapshot.cancel_at_period_end &&
    (snapshot.provider_status === "active" || snapshot.provider_status === "trialing") &&
    snapshot.next_charge_at,
  );
}

export async function loadRenewalState(
  sb: SupabaseClient,
  userId: string,
  loadSnapshot: SnapshotLoader = loadWhopBillingRead,
): Promise<RenewalState> {
  return (await readRenewal(sb, userId, loadSnapshot, false)).state;
}

/** One membership Whop confirms will charge again. */
export interface RenewingMembership { pin: string; tier: string }
export interface RenewalDetail { state: RenewalState; renewing: RenewingMembership[]; unknownRows: boolean }

/**
 * a-renew-early: the same answer plus every renewing membership (the switch
 * to a longer pass needs to know which one to stop). Reads every row instead
 * of stopping at the first renewing one; `unknownRows` says whether any row
 * could not be classified or read.
 */
export async function loadRenewalDetail(
  sb: SupabaseClient,
  userId: string,
  loadSnapshot: SnapshotLoader = loadWhopBillingRead,
): Promise<RenewalDetail> {
  return readRenewal(sb, userId, loadSnapshot, true);
}

async function readRenewal(
  sb: SupabaseClient,
  userId: string,
  loadSnapshot: SnapshotLoader,
  full: boolean,
): Promise<RenewalDetail> {
  const unknownDetail: RenewalDetail = { state: "unknown", renewing: [], unknownRows: true };
  const report = (err: unknown, step: string) => captureServerError(err, { route: "renewal-state", userId, step });
  try {
    const { data: subs, error } = await sb.from("subscriptions")
      .select("tier, payment_provider, provider_payment_id, whop_membership_id")
      .eq("user_id", userId).eq("status", "active");
    if (error) { report(error, "subscriptions_read"); return unknownDetail; }
    const rows = (subs ?? []) as Array<{ tier: string; payment_provider: string | null; provider_payment_id: string | null; whop_membership_id: string | null }>;
    if (rows.length === 0) return { state: "one_time", renewing: [], unknownRows: false };

    const paymentIds = rows.filter((r) => r.payment_provider === "whop" && r.provider_payment_id).map((r) => r.provider_payment_id as string);
    const planByPayment = new Map<string, string>();
    if (paymentIds.length > 0) {
      const { data: events, error: evError } = await sb.from("payment_events")
        .select("payment_id, plan_id").in("payment_id", paymentIds).not("plan_id", "is", null);
      if (evError) { report(evError, "plan_read"); return unknownDetail; }
      for (const e of (events ?? []) as Array<{ payment_id: string; plan_id: string | null }>) {
        if (e.plan_id && !planByPayment.has(e.payment_id)) planByPayment.set(e.payment_id, e.plan_id);
      }
    }

    let unknown = false;
    let cancelled = false;
    const renewing: RenewingMembership[] = [];
    for (const row of rows) {
      const cadence = classifySubscriptionCadence({
        tier: String(row.tier),
        payment_provider: row.payment_provider,
        plan_id: row.provider_payment_id ? planByPayment.get(row.provider_payment_id) ?? null : null,
      });
      if (cadence === "one_time") continue;
      if (cadence === "unknown") { unknown = true; continue; }
      // A legacy mber_ member id is not a membership: treat it as no pin.
      const pin = whopMembershipIdOrNull(row.whop_membership_id);
      if (!pin) { unknown = true; continue; }
      const { snapshot, status } = asRead(await loadSnapshot(pin, String(row.tier)));
      if (snapshotRenews(snapshot)) {
        if (!full) return { state: "renews", renewing: [{ pin, tier: String(row.tier) }], unknownRows: unknown };
        if (!renewing.some((r) => r.pin === pin)) renewing.push({ pin, tier: String(row.tier) });
        continue;
      }
      // A provider-confirmed cancellation will not charge again; anything
      // the provider did not confirm stays unknown.
      if (snapshot?.provider_state_verified && snapshot.cancel_at_period_end) { cancelled = true; continue; }
      unknown = true;
      // Report only a failed read of a real membership (a missing key would
      // otherwise report on every subscription read); a refused key once an hour.
      if (!snapshot && (process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY)) {
        if (status === 401 || status === 403) warnWhopKeyUnauthorized(status, "GET /api/v1/memberships/{id}");
        else report(new Error(`Whop membership read failed for an auto-renewing row (status ${status ?? "unknown"})`), "membership_read");
      }
    }
    const state: RenewalState = renewing.length > 0 ? "renews" : unknown ? "unknown" : cancelled ? "cancelled" : "one_time";
    return { state, renewing, unknownRows: unknown };
  } catch (err) {
    report(err, "unexpected");
    return unknownDetail;
  }
}
