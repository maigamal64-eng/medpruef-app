/**
 * Dunning claim state (a-dunning-check, 2026-10-15).
 *
 * One `recover:<paymentId>` row in processed_webhook_events per failed Whop
 * payment. The row stays once taken: handleRevoke reads it as the per-user
 * "dunning in flight" grace guard. The one exception: with WHOP_PENDING_REVOKE
 * on, a failed ledger write before the mail frees it (releaseRecoveryClaim in
 * the webhook) so Whop's retry starts over. Its payload records
 * what happened to the mail:
 *
 *   pending       claimed, send attempt running (or crashed: never re-sent)
 *   sent          Zoho accepted the mail
 *   not_sent      certainly not delivered (mail env missing, auth failed,
 *                 Zoho answered 4xx): the only state a redelivery may retry,
 *                 once, within 24 hours, and never after the payment succeeded
 *   unknown       timeout, transport error or Zoho 5xx: never re-sent
 *                 (at most one mail, same rule as the pre-charge reminder)
 *   no_recipient  no mapped learner or no address, or the address is on the
 *                 do-not-email list (a-intercom-suppression-sync)
 *
 * Claims written before this change have no `mail` field and are never
 * retried.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardedSendResult } from "@/lib/mail-suppression";

export type DunningMailState = "pending" | "sent" | "not_sent" | "unknown" | "no_recipient";

export function dunningClaimKey(paymentId: string): string {
  return `recover:${paymentId}`;
}

/**
 * Map a guarded send result (or a thrown send) to a claim state.
 * a-intercom-suppression-sync: the mail goes through sendUnlessSuppressed.
 * A suppressed or unkeyable address is final (no_recipient, never retried);
 * an unreadable do-not-email list certainly sent nothing (not_sent: one retry
 * within 24 hours on Whop's next delivery of the same payment).
 */
export function classifyDunningSend(result: GuardedSendResult | null): Exclude<DunningMailState, "pending"> {
  if (!result) return "unknown";
  if (result.ok) return "sent";
  if (result.reason === "suppressed" || result.reason === "invalid_address") return "no_recipient";
  if (result.reason === "suppression_check_failed") return "not_sent";
  if (result.reason === "not_configured" || result.reason === "auth_failed") return "not_sent";
  const status = (result as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) return "not_sent";
  return "unknown";
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** One retry at most: the first attempt plus one redelivery. */
export const DUNNING_MAX_MAIL_ATTEMPTS = 2;
/** A retry older than this could reach a learner who has fixed the card since. */
export const DUNNING_RETRY_WINDOW_MS = 24 * 3600_000;

/**
 * A redelivery of a payment whose earlier mail certainly did not go out.
 * Refused after one retry, after 24 hours, or once the same payment has
 * succeeded (its grant claim, event_id = payment id, exists): the learner
 * must never be told to fix a card that already paid. Compare-and-set
 * `not_sent` -> `pending`: of two concurrent redeliveries only one wins, so
 * the learner gets at most one mail. Any read or write error answers false
 * (no retry, no second mail).
 */
export async function retakeDunningClaim(sb: SupabaseClient, paymentId: string, nowIso: string): Promise<boolean> {
  const key = dunningClaimKey(paymentId);
  const { data, error } = await sb
    .from("processed_webhook_events")
    .select("payload")
    .eq("provider", "whop")
    .eq("event_id", key)
    .maybeSingle();
  if (error || !data) return false;
  const payload = rec((data as { payload?: unknown }).payload);
  if (payload.mail !== "not_sent") return false;
  const attempts = typeof payload.mail_attempts === "number" ? payload.mail_attempts : 1;
  if (attempts >= DUNNING_MAX_MAIL_ATTEMPTS) return false;
  const claimedMs = typeof payload.claimed_at === "string" ? Date.parse(payload.claimed_at) : NaN;
  if (!Number.isFinite(claimedMs) || Date.parse(nowIso) - claimedMs > DUNNING_RETRY_WINDOW_MS) return false;
  const { data: paid, error: paidErr } = await sb
    .from("processed_webhook_events")
    .select("event_id")
    .eq("provider", "whop")
    .eq("event_id", paymentId)
    .maybeSingle();
  if (paidErr || paid) return false;
  const { data: won, error: upErr } = await sb
    .from("processed_webhook_events")
    .update({ payload: { ...payload, mail: "pending", mail_attempts: attempts + 1, retried_at: nowIso } })
    .eq("provider", "whop")
    .eq("event_id", key)
    .eq("payload->>mail", "not_sent")
    .select("event_id");
  return !upErr && Array.isArray(won) && won.length === 1;
}

/** Stamp the outcome on the claim. Returns false when the write failed. */
export async function markDunningClaim(
  sb: SupabaseClient,
  paymentId: string,
  state: Exclude<DunningMailState, "pending">,
  detail: { reason?: string | null; status?: number | null; nowIso: string }
): Promise<boolean> {
  const key = dunningClaimKey(paymentId);
  const { data, error } = await sb
    .from("processed_webhook_events")
    .select("payload")
    .eq("provider", "whop")
    .eq("event_id", key)
    .maybeSingle();
  if (error || !data) return false;
  const payload = rec((data as { payload?: unknown }).payload);
  const { data: done, error: upErr } = await sb
    .from("processed_webhook_events")
    .update({
      payload: {
        ...payload,
        mail: state,
        mail_reason: detail.reason ?? null,
        mail_status: detail.status ?? null,
        mail_at: detail.nowIso,
      },
    })
    .eq("provider", "whop")
    .eq("event_id", key)
    .eq("payload->>mail", "pending")
    .select("event_id");
  return !upErr && Array.isArray(done) && done.length === 1;
}
