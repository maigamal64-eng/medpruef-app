/**
 * Server side of the Whop renewal and case signals (a-whop-cancel-signal).
 * Shared by the webhook and the daily membership read. Every database call
 * here is a read, except three writes that never touch access: the dedupe
 * claim and renewal state key in processed_webhook_events (provider
 * `whop_signal`) and one user_events log row. subscriptions and users are
 * only read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { whopPlanToTier } from "@/lib/whop";
import { mentorPackageForWhopPlan } from "@/lib/mentor/config";
import {
  CASE_SIGNAL_EVENT,
  RENEWAL_SIGNAL_EVENT,
  SIGNAL_CLAIM_PROVIDER,
  UNMATCHED_USER_ID,
  formatSignalAlert,
  renewalStateKey,
  sendSecretaryAlert,
  type AlertOutcome,
  type SignalAlertConfig,
  type SignalProduct,
  type WhopSignal,
} from "@/lib/whop-signal";

export type SignalMatch = "pin" | "payment" | "metadata" | "none" | "read_error";

export type RecordSignalResult =
  | { status: "logged"; userId: string | null; match: SignalMatch; product: SignalProduct }
  | { status: "duplicate" }
  | { status: "unavailable"; step: "claim" | "log" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function productFor(planId: string | null, pinnedTier: string | null): SignalProduct {
  if (mentorPackageForWhopPlan(planId)) return "Mentor";
  if (whopPlanToTier(planId) || pinnedTier) return "Pro";
  return "unknown plan";
}

async function usersByPin(sb: SupabaseClient, membershipId: string): Promise<{ ids: string[]; tier: string | null } | null> {
  const { data, error } = await sb.from("subscriptions").select("user_id, tier").eq("whop_membership_id", membershipId).limit(10);
  if (error) return null;
  const rows = (data ?? []) as Array<{ user_id: string | null; tier: string | null }>;
  return { ids: [...new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v)))], tier: rows[0]?.tier ?? null };
}

async function usersByPayment(sb: SupabaseClient, paymentId: string): Promise<string[] | null> {
  const direct = await sb.from("subscriptions").select("user_id").eq("provider_payment_id", paymentId).limit(5);
  if (direct.error) return null;
  let rows = (direct.data ?? []) as Array<{ user_id: string | null }>;
  if (rows.length === 0) {
    const hist = await sb.from("subscriptions").select("user_id").contains("granted_payment_ids", [{ payment_id: paymentId }]).limit(5);
    if (hist.error) return null;
    rows = (hist.data ?? []) as Array<{ user_id: string | null }>;
  }
  return [...new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v)))];
}

/** Read-only: which learner the signal belongs to, if one can be named without doubt. */
export async function resolveSignalUser(
  sb: SupabaseClient,
  signal: WhopSignal,
): Promise<{ userId: string | null; match: SignalMatch; pinnedTier: string | null }> {
  let readError = false;
  let pinnedTier: string | null = null;
  if (signal.kind === "case" && signal.paymentId) {
    const ids = await usersByPayment(sb, signal.paymentId);
    if (ids === null) readError = true;
    else if (ids.length === 1) return { userId: ids[0], match: "payment", pinnedTier };
  }
  if (signal.membershipId) {
    const pin = await usersByPin(sb, signal.membershipId);
    if (pin === null) readError = true;
    else {
      pinnedTier = pin.tier;
      if (pin.ids.length === 1) return { userId: pin.ids[0], match: "pin", pinnedTier };
    }
  }
  if (signal.kind === "renewal" && signal.metaUserId && UUID_RE.test(signal.metaUserId)) {
    const { data, error } = await sb.from("users").select("id").eq("id", signal.metaUserId).maybeSingle();
    if (error) readError = true;
    else if (data) return { userId: signal.metaUserId, match: "metadata", pinnedTier };
  }
  return { userId: null, match: readError ? "read_error" : "none", pinnedTier };
}

function logData(signal: WhopSignal, extra: Record<string, unknown>): Record<string, unknown> {
  if (signal.kind === "renewal") {
    return {
      event: signal.event, membership_id: signal.membershipId, cancel_at_period_end: signal.cancelAtPeriodEnd,
      period_end: signal.periodEnd, status: signal.status, plan_id: signal.planId, product_id: signal.productId,
      cancel_option: signal.cancelOption, manage_url: signal.manageUrl, ...extra,
    };
  }
  return {
    event: signal.event, case_id: signal.caseId, status: signal.status, reason: signal.reason, outcome: signal.outcome,
    refund: signal.refund, amount: signal.amount, currency: signal.currency, response_due_at: signal.responseDueAt,
    payment_id: signal.paymentId, membership_id: signal.membershipId, plan_id: signal.planId,
    product_id: signal.productId, escalated: signal.escalated, ...extra,
  };
}

/** A claim older than this that never reached its log row is taken over (run killed mid-way). */
export const SIGNAL_STALE_CLAIM_MS = 2 * 60_000;

/**
 * Take over a claim a killed run left before its log row (payload logged:false,
 * older than SIGNAL_STALE_CLAIM_MS). Compare-and-set on processed_at, so two
 * retries cannot both take it. Claims without `logged` (state keys written by
 * the webhook, older rows) are never taken over.
 */
async function takeOverStaleClaim(
  sb: SupabaseClient, claimKey: string, payload: Record<string, unknown>, nowMs: number,
): Promise<"taken" | "pending" | "duplicate"> {
  const { data, error } = await sb.from("processed_webhook_events").select("processed_at, payload")
    .eq("provider", SIGNAL_CLAIM_PROVIDER).eq("event_id", claimKey).maybeSingle();
  if (error) return "pending";
  if (!data) return "duplicate";
  const row = data as { processed_at: string | null; payload: Record<string, unknown> | null };
  if (row.payload?.logged !== false || !row.processed_at) return "duplicate";
  // Younger than the stale window: another run may still be writing. Answer
  // "pending" (503) so Whop keeps retrying; a 200 would end its retries.
  if (nowMs - Date.parse(row.processed_at) < SIGNAL_STALE_CLAIM_MS) return "pending";
  const { data: gone, error: delError } = await sb.from("processed_webhook_events").delete()
    .eq("provider", SIGNAL_CLAIM_PROVIDER).eq("event_id", claimKey).eq("processed_at", row.processed_at).select("event_id");
  if (delError) return "pending";
  if (!gone || (gone as unknown[]).length !== 1) return "duplicate";
  const again = await sb.from("processed_webhook_events").insert({ provider: SIGNAL_CLAIM_PROVIDER, event_id: claimKey, payload });
  return again.error ? "duplicate" : "taken";
}

/**
 * Claim, resolve, log. A duplicate claim is a Whop retry of a message already
 * logged, unless a killed run left it without its log row (taken over after
 * SIGNAL_STALE_CLAIM_MS). A failed log write releases the claim so Whop's
 * retry writes it.
 */
export async function recordWhopSignal(
  sb: SupabaseClient,
  signal: WhopSignal,
  opts: { claimKey: string; source: "webhook" | "daily_read"; webhookId: string | null; nowMs?: number },
): Promise<RecordSignalResult> {
  const claimPayload = { v: 1, kind: signal.kind, event: signal.event, source: opts.source, alert: "pending", logged: false };
  const claim = await sb.from("processed_webhook_events").insert({
    provider: SIGNAL_CLAIM_PROVIDER,
    event_id: opts.claimKey,
    payload: claimPayload,
  });
  if (claim.error) {
    if ((claim.error as { code?: string }).code !== "23505") {
      console.error(`[whop-signal] claim failed: ${claim.error.message}`);
      return { status: "unavailable", step: "claim" };
    }
    const takeover = await takeOverStaleClaim(sb, opts.claimKey, claimPayload, opts.nowMs ?? Date.now());
    if (takeover === "duplicate") return { status: "duplicate" };
    if (takeover === "pending") return { status: "unavailable", step: "claim" };
  }

  const who = await resolveSignalUser(sb, signal);
  const product = productFor(signal.planId, who.pinnedTier);
  const { error: logError } = await sb.from("user_events").insert({
    user_id: who.userId ?? UNMATCHED_USER_ID,
    event_type: signal.kind === "renewal" ? RENEWAL_SIGNAL_EVENT : CASE_SIGNAL_EVENT,
    event_data: logData(signal, { source: opts.source, match: who.match, product, webhook_id: opts.webhookId }),
  });
  if (logError) {
    console.error(`[whop-signal] log row failed: ${logError.message}`);
    const { error: releaseError } = await sb.from("processed_webhook_events").delete()
      .eq("provider", SIGNAL_CLAIM_PROVIDER).eq("event_id", opts.claimKey);
    if (releaseError) console.error(`[whop-signal] claim release failed: ${releaseError.message}`);
    return { status: "unavailable", step: "log" };
  }
  const { error: markError } = await sb.from("processed_webhook_events")
    .update({ payload: { ...claimPayload, logged: true } })
    .eq("provider", SIGNAL_CLAIM_PROVIDER).eq("event_id", opts.claimKey);
  if (markError) console.warn(`[whop-signal] claim not marked logged: ${markError.message}`);

  // The renewal state key lets the daily read skip a change the webhook already reported.
  if (signal.kind === "renewal" && signal.membershipId && signal.cancelAtPeriodEnd !== null) {
    const stateKey = renewalStateKey(signal.membershipId, signal.cancelAtPeriodEnd, signal.periodEnd);
    if (stateKey !== opts.claimKey) {
      const { error } = await sb.from("processed_webhook_events").insert({
        provider: SIGNAL_CLAIM_PROVIDER, event_id: stateKey, payload: { v: 1, kind: "state", from: opts.claimKey },
      });
      if (error && (error as { code?: string }).code !== "23505") console.warn(`[whop-signal] state key not written: ${error.message}`);
    }
  }
  return { status: "logged", userId: who.userId, match: who.match, product };
}

/** Send the secretary-bot alert (when switched on) and stamp the outcome on the claim. */
export async function deliverWhopSignalAlert(
  sb: SupabaseClient,
  signal: WhopSignal,
  logged: { userId: string | null; product: SignalProduct },
  opts: { claimKey: string; source: "webhook" | "daily_read"; config: SignalAlertConfig; fetchImpl?: typeof fetch },
): Promise<AlertOutcome> {
  const text = formatSignalAlert(signal, { userId: logged.userId, product: logged.product, origin: opts.config.origin, source: opts.source });
  const outcome = await sendSecretaryAlert(text, opts.config, opts.fetchImpl);
  const { error } = await sb.from("processed_webhook_events")
    .update({ payload: { v: 1, kind: signal.kind, event: signal.event, source: opts.source, logged: true, alert: outcome, alert_at: new Date().toISOString() } })
    .eq("provider", SIGNAL_CLAIM_PROVIDER).eq("event_id", opts.claimKey);
  if (error) console.warn(`[whop-signal] alert outcome not stamped: ${error.message}`);
  return outcome;
}
