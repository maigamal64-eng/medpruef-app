/**
 * Stop the old renewal after a switch to a longer pass (a-renew-early, E2).
 *
 * A learner whose plan still renews buys a strictly longer plan; checkout
 * writes `switch_from_membership` (the renewing mem_ id) into the Whop
 * session metadata and the checkout_session_created event. The new payment
 * gets its own row starting at the old end (grant_whop_paid_subscription_pinned).
 * Only AFTER that payment is granted does this set cancel_at_period_end on the
 * old membership, so the old plan never charges again and access runs on
 * without a gap: the old row ends, Whop's membership.deactivated flips only
 * that row (its own pin), and the new row covers from there.
 *
 * Order (the half-year guard pattern; a webhook has no admin actor, so the
 * claim payload is the audit record with before and after images):
 *   1. proof: the new live row that holds this payment as its first one
 *      (the grant), pinned to the new membership, the old live row pinned to
 *      the switched membership, and the new row starting at the old row's
 *      end (a later renewal of the new membership is not a switch);
 *   2. claim billing_action switch_cancel:<old mem>:<payment> (a claim left
 *      by a run that died is taken over after 10 minutes);
 *   3. a fresh Whop read: still renewing (not already set to cancel);
 *   4. cancel_at_period_end, confirmed on a fresh read;
 *   5. phase "stopped" and a user_events row.
 * A transient Whop failure releases the claim and answers "retry": the
 * webhook then answers 503 and Whop's redelivery runs this again through the
 * duplicate path (never a second grant). A refusal or an unconfirmed stop is
 * reported to Sentry as an error for a look by hand.
 *
 * Off unless WHOP_SWITCH_CANCEL_ENABLED (and WHOP_EXTENSIONS_ENABLED) is on.
 */
import { WHOP_STALE_CLAIM_MS } from "@/lib/whop-stranded-claim";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";
import { whopSwitchCancelEnabled } from "@/lib/whop-extension";
import { cancelMembershipAtPeriodEnd } from "@/lib/whop-membership-cancel";
import { loadWhopBillingRead } from "@/lib/whop-subscription-snapshot";
import { snapshotRenews } from "@/lib/renewal-state";

export type SwitchStopOutcome = "not_switch" | "stopped" | "already_stopped" | "skipped" | "retry" | "failed";

const TOLERANCE_MS = 60_000;
// Shared with the webhook's stranded payment claims and the admin payment link.
const STALE_CLAIM_MS = WHOP_STALE_CLAIM_MS;

interface Row {
  id: string;
  tier: string;
  user_id: string;
  status: string;
  started_at: string | null;
  expires_at: string | null;
  whop_membership_id: string | null;
  provider_payment_id: string | null;
  granted_payment_ids: Array<{ payment_id?: string }> | null;
}

/** The switched (renewing) membership the checkout recorded for this payment. */
async function switchIntent(sb: SupabaseClient, metaSwitchFrom: string | null, checkoutConfigId: string | null): Promise<string | null> {
  const direct = whopMembershipIdOrNull(metaSwitchFrom);
  if (direct) return direct;
  if (!checkoutConfigId) return null;
  const { data, error } = await sb.from("payment_events").select("metadata")
    .eq("event", "checkout_session_created").eq("checkout_session_id", checkoutConfigId)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`switch intent read failed: ${error.message}`);
  const meta = (data?.[0]?.metadata ?? null) as Record<string, unknown> | null;
  return whopMembershipIdOrNull(typeof meta?.switch_from_membership === "string" ? meta.switch_from_membership : null);
}

const holdsPayment = (row: Row, paymentId: string) =>
  row.provider_payment_id === paymentId || (row.granted_payment_ids ?? []).some((e) => e?.payment_id === paymentId);

export async function stopSwitchedRenewal(
  sb: SupabaseClient,
  args: {
    paymentId: string | null;
    /** The granted learner when the caller knows it (fresh and replay paths). */
    userId?: string | null;
    newMembershipId: string | null;
    metaSwitchFrom: string | null;
    checkoutConfigId: string | null;
    now?: Date;
    env?: Record<string, string | undefined>;
    loadSnapshot?: typeof loadWhopBillingRead;
    fetchImpl?: typeof fetch;
  },
): Promise<SwitchStopOutcome> {
  const now = args.now ?? new Date();
  const loadSnapshot = args.loadSnapshot ?? loadWhopBillingRead;
  const newPin = whopMembershipIdOrNull(args.newMembershipId);
  if (!args.paymentId) return "not_switch";
  // Flags off: no read at all for ordinary payments (renewals carry no
  // metadata); only an echoed switch intent is reported below.
  if (!whopSwitchCancelEnabled(args.env) && !whopMembershipIdOrNull(args.metaSwitchFrom)) return "not_switch";
  let oldPin: string | null;
  try {
    oldPin = await switchIntent(sb, args.metaSwitchFrom, args.checkoutConfigId);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "whop-switch", step: "intent" } });
    return "retry";
  }
  if (!oldPin) return "not_switch";
  if (!whopSwitchCancelEnabled(args.env)) {
    // The checkout offered the switch while the flag was on; the old plan
    // would charge again. Nothing is changed at Whop without the flag.
    Sentry.captureMessage(`renew switch: payment ${args.paymentId} switched from ${oldPin} but WHOP_SWITCH_CANCEL_ENABLED is off; stop the old renewal by hand`, "error");
    return "skipped";
  }
  if (!newPin || newPin === oldPin) {
    Sentry.captureMessage(`renew switch: payment ${args.paymentId} has no new membership distinct from ${oldPin}; old renewal left as is`, "warning");
    return "skipped";
  }

  // (1) Proof that the new payment is granted and covers after the old row.
  // The grant itself is the proof (a live row that holds the payment), never
  // a best-effort log row.
  let userId = args.userId ?? null;
  if (!userId) {
    const { data: holders, error: holderError } = await sb.from("subscriptions").select("user_id")
      .eq("payment_provider", "whop").eq("provider_payment_id", args.paymentId).limit(1);
    if (holderError) return "retry";
    userId = (holders?.[0]?.user_id as string | undefined) ?? null;
  }
  if (!userId) {
    Sentry.captureMessage(`renew switch: payment ${args.paymentId} (from ${oldPin}) has no granted row yet; the stop waits for the grant`, "warning");
    return "skipped";
  }
  const { data: rows, error: rowsError } = await sb.from("subscriptions")
    .select("id, tier, user_id, status, started_at, expires_at, whop_membership_id, provider_payment_id, granted_payment_ids")
    .eq("user_id", userId).eq("payment_provider", "whop").eq("status", "active");
  if (rowsError) return "retry";
  const live = ((rows ?? []) as Row[]).filter((r) => r.expires_at && Date.parse(r.expires_at) > now.getTime());
  const newRow = live.find((r) => r.whop_membership_id === newPin && holdsPayment(r, args.paymentId as string));
  // A later renewal of the new membership still names the switch checkout
  // (checkout_configuration_id round-trips); only the payment that created
  // the row is the switch.
  const first = newRow?.granted_payment_ids?.[0]?.payment_id ?? newRow?.provider_payment_id ?? null;
  if (newRow && first !== args.paymentId) return "not_switch";
  const oldRow = live.find((r) => r.whop_membership_id === oldPin);
  const covers = Boolean(newRow && oldRow && newRow.started_at && oldRow.expires_at &&
    Date.parse(newRow.started_at) >= Date.parse(oldRow.expires_at) - TOLERANCE_MS &&
    Date.parse(newRow.expires_at as string) > Date.parse(oldRow.expires_at));
  if (!newRow || !oldRow || !covers) {
    Sentry.captureMessage(`renew switch: payment ${args.paymentId} for ${userId.slice(0, 8)} does not cover after ${oldPin} (new row ${newRow ? "found" : "missing"}, old row ${oldRow ? "found" : "missing"}); old renewal left as is, check by hand`, "error");
    return "skipped";
  }

  // (2) Claim; its payload is the audit record.
  const key = `switch_cancel:${oldPin}:${args.paymentId}`;
  const audit = {
    reason: "renew_switch", user_id: userId, payment_id: args.paymentId,
    old_membership_id: oldPin, new_membership_id: newPin,
    old_subscription_id: oldRow.id, new_subscription_id: newRow.id,
    before: { old_expires_at: oldRow.expires_at, new_started_at: newRow.started_at, new_expires_at: newRow.expires_at },
    claimed_at: now.toISOString(),
  };
  const insertClaim = () => sb.from("processed_webhook_events")
    .insert({ provider: "billing_action", event_id: key, payload: { ...audit, phase: "claimed" } })
    .select("event_id").maybeSingle();
  let { data: claim, error: claimError } = await insertClaim();
  if (claimError && claimError.code !== "23505") return "retry";
  if (claimError || !claim) {
    const { data: prior, error: priorError } = await sb.from("processed_webhook_events").select("payload")
      .eq("provider", "billing_action").eq("event_id", key).maybeSingle();
    if (priorError) return "retry";
    const priorPayload = (prior?.payload ?? null) as { phase?: string; claimed_at?: string } | null;
    const priorPhase = priorPayload?.phase;
    if (priorPhase === "stopped" || priorPhase === "already_cancelling") return "already_stopped";
    if (priorPhase !== "claimed") return "failed";
    // A claim left by a run that died after claiming (timeout, failed
    // release): take it over after 10 minutes, never sooner.
    const claimedAt = Date.parse(priorPayload?.claimed_at ?? "");
    if (Number.isFinite(claimedAt) && now.getTime() - claimedAt < STALE_CLAIM_MS) return "retry";
    Sentry.captureMessage(`renew switch: taking over a stale claim ${key}`, "warning");
    const { error: dropError } = await sb.from("processed_webhook_events").delete()
      .eq("provider", "billing_action").eq("event_id", key);
    if (dropError) return "retry";
    ({ data: claim, error: claimError } = await insertClaim());
    if (claimError || !claim) return "retry";
  }
  const phase = async (name: string, extra: Record<string, unknown> = {}) => {
    await sb.from("processed_webhook_events").update({ payload: { ...audit, phase: name, ...extra } })
      .eq("provider", "billing_action").eq("event_id", key);
  };
  const release = async () => {
    const { error } = await sb.from("processed_webhook_events").delete().eq("provider", "billing_action").eq("event_id", key);
    // A claim that cannot be released is taken over after STALE_CLAIM_MS.
    if (error) Sentry.captureMessage(`renew switch: could not release ${key} (${error.message}); a redelivery takes it over after 10 minutes`, "warning");
  };

  // (3) Compare at Whop: only a membership that still renews is stopped.
  const before = await loadSnapshot(oldPin, oldRow.tier);
  const snapshot = before.snapshot;
  if (!snapshot) {
    const status = before.status ?? 0;
    if (status === 0 || status >= 500 || status === 429) { await release(); return "retry"; }
    await phase("read_failed", { status });
    Sentry.captureMessage(`renew switch: Whop read of ${oldPin} failed (HTTP ${status}); the old plan may still charge, check by hand`, "error");
    return "failed";
  }
  if (!snapshot.provider_state_verified) {
    await phase("read_failed", { status: before.status ?? null, unverified: true });
    Sentry.captureMessage(`renew switch: Whop state of ${oldPin} could not be verified; the old plan may still charge, check by hand`, "error");
    return "failed";
  }
  if (snapshot.cancel_at_period_end) {
    await phase("already_cancelling");
    return "already_stopped";
  }
  if (!snapshotRenews(snapshot)) {
    await phase("not_renewing", { provider_status: snapshot.provider_status ?? null });
    return "skipped";
  }

  // (4) The stop, at the period end, confirmed on a fresh read.
  const cancel = await cancelMembershipAtPeriodEnd(oldPin, `renew-switch:${oldPin}:${args.paymentId}`, args.fetchImpl);
  if (!cancel.ok) {
    if (cancel.status === 0 || cancel.status >= 500 || cancel.status === 429) { await release(); return "retry"; }
    await phase("stop_refused", { status: cancel.status, code: cancel.code ?? null });
    Sentry.captureMessage(`renew switch: Whop refused the stop for ${oldPin} (HTTP ${cancel.status} ${cancel.code ?? ""}); the old plan may still charge, check by hand`, "error");
    return "failed";
  }
  const after = (await loadSnapshot(oldPin, oldRow.tier)).snapshot;
  const scheduled = Boolean(after?.provider_state_verified && after.cancel_at_period_end &&
    (after.provider_status === "active" || after.provider_status === "canceling" || after.provider_status === "trialing"));
  if (!scheduled) {
    await phase("stop_unconfirmed", { provider_status: after?.provider_status ?? null });
    Sentry.captureMessage(`renew switch: stop not confirmed for ${oldPin} (status ${after?.provider_status ?? "unreadable"}); check the membership at Whop by hand`, "error");
    return "failed";
  }

  // (5) Done.
  await phase("stopped", { after: { cancel_at_period_end: true, old_period_end: after?.next_charge_at ?? oldRow.expires_at } });
  await sb.from("user_events").insert({ user_id: userId, event_type: "whop_switch_renewal_stopped", event_data: {
    payment_id: args.paymentId, old_membership_id: oldPin, new_membership_id: newPin,
    old_subscription_id: oldRow.id, new_subscription_id: newRow.id, old_expires_at: oldRow.expires_at, new_expires_at: newRow.expires_at,
  } });
  return "stopped";
}
