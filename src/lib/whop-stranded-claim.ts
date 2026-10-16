/**
 * Stranded Whop payment claims (a-whop-webhook-ack, review G3).
 *
 * The grant path claims processed_webhook_events(provider 'whop', event_id
 * pay_...) before it grants. A run killed after the claim but before the
 * grant (a Whop hang, a database stall, the 60 s function limit) never
 * releases it, so every Whop retry used to answer "200 duplicate" and a paid
 * renewal stayed ungranted. On a duplicate the webhook now asks
 * `checkStrandedClaim` whether the claim is a dead run's leftover and, if so,
 * takes it over with a compare-and-set. Before granting it re-reads the
 * payment at Whop (`readTakenOverPayment`): only a paid, unrefunded payment
 * is granted, because a refund that arrived while the claim was stranded
 * found nothing to revoke.
 *
 * A claim counts as stranded only when ALL hold:
 *   - it was written by this webhook after this change (payload.v ==
 *     WHOP_CLAIM_VERSION). Older claims, and claims written by checkout
 *     verify or the admin payment link, are never taken over (as before);
 *   - no subscriptions row holds the payment (provider_payment_id or
 *     granted_payment_ids), and no payment_events row says it was granted
 *     (grant_succeeded) or kept on purpose (grant_failed with a KEPT reason);
 *   - the claim carries no recorded outcome (a deliberate keep stamps
 *     `outcome`);
 *   - no admin payment resolution (link, test, not ours) names the payment;
 *   - the claim row is older than WHOP_STALE_CLAIM_MS by its database time.
 * A younger claim with no grant may still be a live run: "retry" (503), so
 * Whop comes back once that run has either granted or died.
 *
 * Known gap: an admin who compensates a stranded payment with the Users
 * Grant (no subscriptions row, no payment id) is invisible here. Link a
 * stranded payment through Payments > Unresolved instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentOwners } from "@/lib/whop-pending-revoke";
import { WHOP_FETCH_TIMEOUT_MS } from "@/lib/whop-timeouts";
import { whopHeaders } from "@/lib/whop-api";

/**
 * One stale-claim age for the Whop payment claim paths: the admin payment
 * link (src/app/api/admin/payments/resolve), checkout verify's
 * payment_events fallback and the renewal switch stop (src/lib/whop-switch.ts)
 * use the same 10 minutes, so no path takes over a claim another path still
 * treats as live. Well above the webhook's 60 s maxDuration.
 */
export const WHOP_STALE_CLAIM_MS = 10 * 60_000;

/** Marks a payment claim written by the webhook with outcome stamping. */
export const WHOP_CLAIM_VERSION = 2;

/** Outcomes a run stamps on a claim it keeps on purpose without a grant. */
export type WhopClaimOutcome =
  | "unmapped"
  | "amount_unreadable"
  | "trial_reuse_refused"
  | "refunded_before_grant"
  | "takeover_refused"
  // release-int-8 seam: a-whop-grant-amount-guard holds the payment (enforce).
  | "amount_mismatch";

/** payment_events grant_failed reasons written where the claim is kept on purpose. */
const KEPT_REASONS = ["unmapped", "trial_reuse", "refunded_before_grant", "takeover_refused", "amount_mismatch"];

export type StrandedClaimCheck =
  /** Granted, kept on purpose or not ours to take over: answer as a duplicate. */
  | { kind: "settled" }
  /** Unsettled and young, a race, or a read failed: answer 503 so Whop redelivers. */
  | { kind: "retry"; reason: string }
  /** A dead run's claim was replaced by this delivery's claim. */
  | { kind: "taken_over"; previousProcessedAt: string; payload: Record<string, unknown> };

function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

export async function checkStrandedClaim(
  sb: SupabaseClient,
  args: { paymentId: string; event: string; now?: Date },
): Promise<StrandedClaimCheck> {
  const now = args.now ?? new Date();
  let owners: string[];
  try {
    owners = await paymentOwners(sb, args.paymentId);
  } catch {
    return { kind: "retry", reason: "owner_read_failed" };
  }
  if (owners.length > 0) return { kind: "settled" };

  const { data: granted, error: grantedError } = await sb
    .from("payment_events")
    .select("id")
    .eq("event", "grant_succeeded")
    .eq("payment_id", args.paymentId)
    .limit(1);
  if (grantedError) return { kind: "retry", reason: "grant_read_failed" };
  if ((granted ?? []).length > 0) return { kind: "settled" };

  const { data: row, error: rowError } = await sb
    .from("processed_webhook_events")
    .select("payload, processed_at")
    .eq("provider", "whop")
    .eq("event_id", args.paymentId)
    .maybeSingle();
  if (rowError) return { kind: "retry", reason: "claim_read_failed" };
  if (!row) return { kind: "retry", reason: "claim_vanished" };

  const payload = (row.payload ?? {}) as { outcome?: unknown; v?: unknown };
  if (typeof payload.outcome === "string" && payload.outcome) return { kind: "settled" };
  // Claims from before this change, checkout verify and the admin link keep
  // today's duplicate answer.
  if (payload.v !== WHOP_CLAIM_VERSION) return { kind: "settled" };

  // A kept-on-purpose exit whose outcome stamp failed still wrote its
  // grant_failed funnel row (user id nullable there).
  const { data: kept, error: keptError } = await sb
    .from("payment_events")
    .select("id")
    .eq("event", "grant_failed")
    .eq("payment_id", args.paymentId)
    .in("reason", KEPT_REASONS)
    .limit(1);
  if (keptError) return { kind: "retry", reason: "kept_read_failed" };
  if ((kept ?? []).length > 0) return { kind: "settled" };

  const { data: resolutions, error: resolutionError } = await sb
    .from("payment_resolutions")
    .select("payment_id")
    .eq("payment_id", args.paymentId)
    .limit(1);
  if (resolutionError && !isMissingRelation(resolutionError)) return { kind: "retry", reason: "resolution_read_failed" };
  if ((resolutions ?? []).length > 0) return { kind: "settled" };

  const processedAt = typeof row.processed_at === "string" ? row.processed_at : null;
  const processedMs = processedAt ? Date.parse(processedAt) : NaN;
  if (!processedAt || !Number.isFinite(processedMs)) return { kind: "retry", reason: "claim_time_unreadable" };
  if (now.getTime() - processedMs < WHOP_STALE_CLAIM_MS) return { kind: "retry", reason: "claim_in_flight" };

  // Compare-and-set: remove exactly the stale row that was read. A row that
  // changed meanwhile (another delivery took it over) is left alone.
  const { data: dropped, error: dropError } = await sb
    .from("processed_webhook_events")
    .delete()
    .eq("provider", "whop")
    .eq("event_id", args.paymentId)
    .eq("processed_at", processedAt)
    .select("event_id");
  if (dropError) return { kind: "retry", reason: "claim_drop_failed" };
  if ((dropped ?? []).length === 0) return { kind: "retry", reason: "claim_changed" };

  const newPayload = { v: WHOP_CLAIM_VERSION, claimed_at: now.toISOString(), event: args.event, taken_over_from: processedAt };
  const { data: claim, error: claimError } = await sb
    .from("processed_webhook_events")
    .insert({ provider: "whop", event_id: args.paymentId, payload: newPayload })
    .select("event_id")
    .maybeSingle();
  if (claimError || !claim) return { kind: "retry", reason: "claim_retake_failed" };
  return { kind: "taken_over", previousProcessedAt: processedAt, payload: newPayload };
}

/**
 * Records why a run keeps its claim without a grant, so a later delivery
 * never treats it as stranded. Merges into the claim's payload and only
 * writes while the claim is still this run's (claimed_at compare-and-set).
 * Best effort: a failed stamp is backed by the grant_failed funnel row.
 */
export async function stampWhopClaimOutcome(
  sb: SupabaseClient,
  args: { paymentId: string; claimPayload: Record<string, unknown>; outcome: WhopClaimOutcome },
): Promise<void> {
  try {
    const claimedAt = String(args.claimPayload.claimed_at ?? "");
    const { error } = await sb
      .from("processed_webhook_events")
      .update({ payload: { ...args.claimPayload, outcome: args.outcome } })
      .eq("provider", "whop")
      .eq("event_id", args.paymentId)
      .eq("payload->>claimed_at", claimedAt);
    if (error) console.warn("[whop] claim outcome stamp failed", { paymentId: args.paymentId, outcome: args.outcome });
  } catch {
    console.warn("[whop] claim outcome stamp threw", { paymentId: args.paymentId, outcome: args.outcome });
  }
}

export type TakenOverPayment =
  /** Whop says paid and not refunded: grant. */
  | { kind: "paid" }
  /** Whop says it is not (or no longer) paid: never grant. */
  | { kind: "not_paid"; status: string | null; refunded: boolean }
  /** The key may not read this payment (401/403/404): manual review. */
  | { kind: "unverifiable"; status: number }
  /** No API key, timeout, network failure, 429 or 5xx: keep the claim, answer 503. */
  | { kind: "unavailable"; status: number };

/**
 * One read of GET /v1/payments/{id} before a stranded claim is granted.
 * `isRefunded` is the shared ledger rule (looksRefunded in src/lib/whop.ts),
 * passed in to keep this module free of the Whop helper's imports.
 */
export async function readTakenOverPayment(
  paymentId: string,
  isRefunded: (row: unknown) => boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<TakenOverPayment> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  // A missing key is a configuration gap, not a verdict: 503 until it is set.
  if (!apiKey) return { kind: "unavailable", status: 0 };
  try {
    const res = await fetchImpl(`https://api.whop.com/api/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: whopHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(WHOP_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: "unverifiable", status: res.status };
    if (!res.ok) return { kind: "unavailable", status: res.status };
    const body = (await res.json()) as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status : null;
    const refunded = isRefunded(body);
    if (status === "paid" && !refunded) return { kind: "paid" };
    return { kind: "not_paid", status, refunded };
  } catch {
    return { kind: "unavailable", status: 0 };
  }
}
