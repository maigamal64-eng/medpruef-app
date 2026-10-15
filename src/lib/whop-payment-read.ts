/**
 * Read one Whop payment by id (GET /api/v1/payments/{id}, read only) and
 * decide whether it may grant a Pro tier (a-whop-verify-fallback-guard,
 * Whop review 16 Oct, gap G1).
 *
 * Used by checkout verify step 3b: a payment_events row is only a hint that
 * money may have moved; the grant needs Whop's own current record of that
 * payment. Any failed or unreadable read refuses (fail closed): the webhook
 * remains the backstop for a real payment.
 */

import { extractWhopPayment, looksRefunded } from "@/lib/whop";
import { paidAmountCents } from "@/lib/mentor/credits/grant-payment";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";

export type PaymentFetcher = (paymentId: string, apiKey: string) => Promise<unknown>;

export type PaymentGrantCheck =
  | {
      ok: true;
      /** mem_ membership the payment belongs to, null when Whop names none. */
      membershipId: string | null;
      /** What the buyer paid (lowest amount field), null when unknown. */
      amountCents: number | null;
    }
  | {
      ok: false;
      reason: "reread_failed" | "not_paid" | "zero_amount" | "refunded" | "plan_mismatch" | "other_account";
    };

async function fetchWhopPayment(paymentId: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.whop.com/api/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Whop payment HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/** Unwrap a `{ data: {...} }` envelope when the object itself is not the payment. */
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!("id" in r) && r.data && typeof r.data === "object") return r.data as Record<string, unknown>;
  return r;
}

/**
 * Pure decision on a payment object: status paid, no refund or dispute, the
 * tier's plan, the expected payment id, no other MedPrüf account in its
 * metadata and a positive paid amount.
 */
export function judgePaymentForGrant(
  raw: unknown,
  expect: { paymentId: string; planId: string; userId: string },
): PaymentGrantCheck {
  const p = unwrap(raw);
  if (!p) return { ok: false, reason: "reread_failed" };
  const f = extractWhopPayment(p);
  if (f.paymentId !== expect.paymentId) return { ok: false, reason: "reread_failed" };
  if (looksRefunded(p)) return { ok: false, reason: "refunded" };
  if (p.status !== "paid") return { ok: false, reason: "not_paid" };
  if (!f.planId || f.planId !== expect.planId) return { ok: false, reason: "plan_mismatch" };
  const owner = f.metaUserId ?? f.membershipMetaUserId;
  if (owner && owner !== expect.userId) return { ok: false, reason: "other_account" };
  // A EUR 0 "paid" charge (a 100 percent coupon, a trial phase) is no purchase.
  const amountCents = paidAmountCents(p);
  if (amountCents === null || !(amountCents > 0)) return { ok: false, reason: "zero_amount" };
  return { ok: true, membershipId: whopMembershipIdOrNull(f.membershipId), amountCents };
}

export async function checkWhopPaymentForGrant(args: {
  paymentId: string;
  planId: string;
  userId: string;
  apiKey: string;
  fetchPayment?: PaymentFetcher;
}): Promise<PaymentGrantCheck> {
  let raw: unknown;
  try {
    raw = await (args.fetchPayment ?? fetchWhopPayment)(args.paymentId, args.apiKey);
  } catch {
    return { ok: false, reason: "reread_failed" };
  }
  return judgePaymentForGrant(raw, args);
}
