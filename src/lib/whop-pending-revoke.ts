/**
 * Whop ordering safety (a-fo-09), behind WHOP_PENDING_REVOKE (default OFF).
 *
 * A refund or dispute can reach the webhook before the payment.succeeded that
 * it reverses (Whop delivers out of order and retries late). The revoke path
 * then matches no subscription and used to record a best-effort
 * `whop_revoke_unmatched` row only, so the later grant gave Pro for money that
 * was already returned.
 *
 * With the flag on:
 *   - an unmatched refund-class revoke that names a payment is stored as a
 *     PENDING revoke: the same `whop_revoke_unmatched` user_events row, with
 *     `pending_revoke: true` and `payment_candidates` in its payload, always
 *     under the PENDING_REVOKE_USER bucket so the grant side finds it through
 *     the (user_id, event_type) index without knowing the buyer;
 *   - the grant path looks the payment up before granting and, on a hit,
 *     withholds the grant and records `whop_revoke_applied_late` (paged by
 *     the checkout watch, a-fo-03);
 *   - ledger rows are written with their error read: a failed write answers
 *     5xx so Whop redelivers, and the redelivery completes the row without a
 *     second grant (see `completeGrantLedger`).
 *
 * The decision itself (`decideGrant`) is pure, so the replay harness can feed
 * it real delivery sequences without a database.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { grantedPaymentIdsContainsValue } from "@/lib/whop-entitlement";

/** user_events.user_id is text NOT NULL; buyer-less Whop rows use this bucket. */
export const PENDING_REVOKE_USER = "whop-webhook";
export const REVOKE_UNMATCHED_EVENT = "whop_revoke_unmatched";
export const REVOKE_APPLIED_LATE_EVENT = "whop_revoke_applied_late";
export const SUBSCRIPTION_ACTIVATED_EVENT = "whop_subscription_activated";
/** A grant the verify route already gave: the webhook dedupes, never a missing ledger. */
const GRANT_LEDGER_EVENTS = [SUBSCRIPTION_ACTIVATED_EVENT, "whop_trial_grant_deduped"];

export function pendingRevokeEnabled(): boolean {
  return process.env.WHOP_PENDING_REVOKE === "true";
}

export interface PendingRevokeData {
  pending_revoke: true;
  payment_candidates: string[];
  [key: string]: unknown;
}

export interface PendingRevokeRow {
  id?: string | number;
  created_at?: string;
  event_data?: Record<string, unknown> | null;
}

export type GrantDecision =
  | { action: "grant" }
  | { action: "withhold"; pending: PendingRevokeRow };

/** Only a refund or dispute that names a payment can wait for its grant. */
export function isPendingRevokeCandidate(kind: string, paymentCandidates: readonly string[]): boolean {
  return kind === "refunded" && paymentCandidates.length > 0;
}

/** Payment ids a stored row reverses (candidates plus the legacy single fields). */
export function pendingRevokePayments(row: PendingRevokeRow): string[] {
  const data = row.event_data ?? {};
  if (data.pending_revoke !== true) return [];
  const out = new Set<string>();
  if (Array.isArray(data.payment_candidates)) {
    for (const id of data.payment_candidates) if (typeof id === "string" && id) out.add(id);
  }
  for (const key of ["payment_id", "original_payment_id"]) {
    const id = data[key];
    if (typeof id === "string" && id) out.add(id);
  }
  return [...out];
}

/**
 * Pure grant decision. Withhold only when a stored pending revoke (marker set,
 * refund class) names exactly this payment id. Rows without the marker
 * (written before the flag, or cancellations) never block a grant.
 */
export function decideGrant(args: { paymentId: string | null; pendingRows: readonly PendingRevokeRow[] }): GrantDecision {
  if (!args.paymentId) return { action: "grant" };
  for (const row of args.pendingRows) {
    if ((row.event_data ?? {}).kind !== "refunded") continue;
    if (pendingRevokePayments(row).includes(args.paymentId)) return { action: "withhold", pending: row };
  }
  return { action: "grant" };
}

/**
 * Payload for a pending revoke row: the existing unmatched fields plus the
 * marker. The payer email is dropped: the row lives in the shared bucket,
 * which account erasure never reaches, and ops act on the Whop ids.
 */
export function pendingRevokeData(base: Record<string, unknown>, paymentCandidates: readonly string[], mappedUserId: string | null): PendingRevokeData {
  const { email: _email, ...rest } = base;
  void _email;
  return { ...rest, pending_revoke: true, payment_candidates: [...paymentCandidates], mapped_user_id: mappedUserId };
}

/** Pure: does an already stored pending row cover every candidate of this revoke? */
export function pendingAlreadyStored(rows: readonly PendingRevokeRow[], paymentCandidates: readonly string[]): boolean {
  return rows.some((row) => {
    const covered = pendingRevokePayments(row);
    return (row.event_data ?? {}).kind === "refunded" && paymentCandidates.every((id) => covered.includes(id));
  });
}

type Db = Pick<SupabaseClient, "from">;

/** Insert one ledger row and READ its error (supabase-js never throws on one). */
export async function recordLedgerEvent(
  sb: Db,
  userId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await sb.from("user_events").insert({ user_id: userId, event_type: eventType, event_data: data });
    if (error) return { ok: false, error: String(error.message ?? "insert failed").slice(0, 200) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "insert threw" };
  }
}

/** Pending revokes naming this payment (indexed: one bucket, one event type, jsonb containment). */
export async function findPendingRevokes(
  sb: Db,
  paymentId: string,
): Promise<{ rows: PendingRevokeRow[]; error: null } | { rows: null; error: string }> {
  try {
    const { data, error } = await sb
      .from("user_events")
      .select("id, created_at, event_data")
      .eq("user_id", PENDING_REVOKE_USER)
      .eq("event_type", REVOKE_UNMATCHED_EVENT)
      .contains("event_data", { pending_revoke: true, payment_candidates: [paymentId] })
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) return { rows: null, error: String(error.message ?? "read failed").slice(0, 200) };
    return { rows: (data ?? []) as PendingRevokeRow[], error: null };
  } catch (err) {
    return { rows: null, error: err instanceof Error ? err.message.slice(0, 200) : "read threw" };
  }
}

/**
 * Pure: the applied-late ledger payload (ids only, never the payer email).
 * `alreadyGranted`: a subscription row already holds this payment (a first
 * attempt whose write committed after its deadline), so Pro is on and must be
 * revoked by hand; the pager shows that reason.
 */
export function appliedLateData(args: {
  paymentId: string;
  event: string;
  pending: PendingRevokeRow;
  userId: string | null;
  membershipId: string | null;
  planId: string | null;
  amountCents: number | null;
  alreadyGranted?: boolean;
}): Record<string, unknown> {
  const data = args.pending.event_data ?? {};
  return {
    event: args.event,
    kind: "refunded",
    reason: args.alreadyGranted ? "granted_before_refund_seen" : "refund_before_grant",
    payment_id: args.paymentId,
    revoke_event: typeof data.event === "string" ? data.event : null,
    pending_revoke_id: args.pending.id ?? null,
    pending_revoke_at: args.pending.created_at ?? null,
    mapped_user_id: args.userId,
    membership_id: args.membershipId,
    plan_id: args.planId,
    amount_cents: args.amountCents,
    granted: Boolean(args.alreadyGranted),
  };
}

/** Learners whose Whop subscription rows hold this payment (latest id or history). */
export async function paymentOwners(sb: Db, paymentId: string): Promise<string[]> {
  const [latest, history] = await Promise.all([
    sb.from("subscriptions").select("user_id").eq("payment_provider", "whop").eq("provider_payment_id", paymentId),
    sb.from("subscriptions").select("user_id").eq("payment_provider", "whop")
      .filter("granted_payment_ids", "cs", grantedPaymentIdsContainsValue(paymentId)),
  ]);
  if (latest.error) throw new Error(`owner read failed: ${String(latest.error.message ?? "").slice(0, 150)}`);
  if (history.error) throw new Error(`owner read failed: ${String(history.error.message ?? "").slice(0, 150)}`);
  return [...new Set([...(latest.data ?? []), ...(history.data ?? [])].map((row) => String((row as { user_id: string }).user_id)))];
}

/**
 * The one guard every grant path calls before it claims or releases a payment
 * id (webhook, /api/whop/checkout/verify and its payment_events fallback,
 * admin resolve "link"): "withheld" when a pending revoke names the payment,
 * "unavailable" when that cannot be read (callers refuse and retry), else
 * "clear". Always "clear" with the flag off.
 */
export async function pendingRevokeGuard(sb: Db, paymentId: string): Promise<"clear" | "withheld" | "unavailable"> {
  if (!pendingRevokeEnabled()) return "clear";
  const pending = await findPendingRevokes(sb, paymentId);
  if (pending.error !== null) return "unavailable";
  return decideGrant({ paymentId, pendingRows: pending.rows }).action === "withhold" ? "withheld" : "clear";
}

async function hasLedgerRow(sb: Db, userId: string, eventTypes: string[], paymentId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("user_events")
    .select("id")
    .eq("user_id", userId)
    .in("event_type", eventTypes)
    .contains("event_data", { payment_id: paymentId })
    .limit(1);
  if (error) throw new Error(`ledger read failed: ${String(error.message ?? "").slice(0, 150)}`);
  return (data ?? []).length > 0;
}

/**
 * A redelivery of an already-claimed payment (the 23505 duplicate path, or a
 * grant that replayed): make sure the ledger row the first attempt owed
 * exists, without granting anything.
 *   - the payment granted time (its owner is known from the subscription
 *     rows): write `whop_subscription_activated` if neither it nor the trial
 *     dedupe row exists for that owner and payment;
 *   - the payment was withheld for a pending revoke: write
 *     `whop_revoke_applied_late` if it is missing.
 * Throws on a read or write failure so the caller answers 5xx and Whop retries.
 */
export async function completeGrantLedger(
  sb: Db,
  args: { paymentId: string; event: string; ownerUserId?: string | null },
): Promise<"written" | "present" | "none"> {
  const { paymentId } = args;
  const owners = args.ownerUserId ? [args.ownerUserId] : await paymentOwners(sb, paymentId);
  if (owners.length > 1) throw new Error("Ambiguous stored payment owner");
  if (owners.length === 1) {
    if (await hasLedgerRow(sb, owners[0], GRANT_LEDGER_EVENTS, paymentId)) return "present";
    const write = await recordLedgerEvent(sb, owners[0], SUBSCRIPTION_ACTIVATED_EVENT, {
      payment_id: paymentId, event: args.event, source: "webhook_ledger_retry",
    });
    if (!write.ok) throw new Error(`ledger write failed: ${write.error}`);
    return "written";
  }
  // No grant holds this payment: only a withheld refund-before-grant owes a row.
  const pending = await findPendingRevokes(sb, paymentId);
  if (pending.error !== null) throw new Error(`pending revoke read failed: ${pending.error}`);
  const decision = decideGrant({ paymentId, pendingRows: pending.rows });
  if (decision.action === "grant") return "none";
  if (await hasLedgerRow(sb, PENDING_REVOKE_USER, [REVOKE_APPLIED_LATE_EVENT], paymentId)) return "present";
  const write = await recordLedgerEvent(sb, PENDING_REVOKE_USER, REVOKE_APPLIED_LATE_EVENT, appliedLateData({
    paymentId, event: args.event, pending: decision.pending,
    userId: typeof decision.pending.event_data?.mapped_user_id === "string" ? decision.pending.event_data.mapped_user_id : null,
    membershipId: null, planId: null, amountCents: null,
  }));
  if (!write.ok) throw new Error(`ledger write failed: ${write.error}`);
  return "written";
}
