/**
 * Mentor credits: grant one Whop mentor payment. The ONLY place a
 * whop_payment lot is created, shared by the webhook branch and
 * GET /api/mentor/checkout/verify, so both race safely through
 * mentor_grant_credits' UNIQUE (source, source_id) = ('whop_payment', pay_id).
 * Never touches users.tier or subscriptions.
 *
 * Review H3: a grant needs a real payment. A EUR 0 trial phase, a 100 percent
 * coupon or a wrong-currency payment is "unmapped" (200 for the webhook, a
 * Sentry error, a manual grant if it was legitimate), never credits.
 * Review H1: a refunded or disputed payment is refused by the ledger itself
 * (reason "revoked"), whatever order the events arrived in.
 */

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whopMoneyMajor } from "@/lib/whop-api";
import type { MentorSoldPackageId } from "../config";
import { isUuid, rpcGrantCredits, type GrantReason } from "./db";
import { loadPackageCatalogue } from "./packages";
import { markPurchaseGranted } from "./purchases";

/**
 * A payment counts when it paid at least this share of the package price.
 * The slack absorbs VAT shown inside or outside the price and the
 * amount_after_fees fallback (Whop fees are a few percent). A 20 percent
 * coupon passes; a larger coupon is an operational no (no coupons on mentor
 * plans, [name] 10 Oct 2026).
 */
export const MIN_PAID_RATIO = 0.8;

export type MentorPaymentGrant =
  | { kind: "granted"; lotId: string | null; grantedMicro: number | null }
  | { kind: "duplicate"; lotId: string | null; grantedMicro?: number | null }
  /** Permanent: retrying cannot help (bad ids, package missing, key owned by another user, refunded, wrong amount). */
  | { kind: "unmapped"; reason: GrantReason | "no_payment_id" | "invalid_user" | "amount_mismatch" | "package_not_priced" }
  /** Transient: DB or transport error, or the ledger migration is not applied yet. */
  | { kind: "retry"; reason: GrantReason };

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * What the buyer actually paid, in cents, from a Whop payment object (webhook
 * data or a payments-list row). The LOWEST amount any field reports, so a
 * discount that only shows in final_amount still counts. null when no amount
 * field is present (fail closed).
 */
export function paidAmountCents(payment: unknown): number | null {
  const d = payment && typeof payment === "object" ? (payment as Record<string, unknown>) : {};
  const seen = ["final_amount", "total", "amount", "subtotal", "amount_after_fees"]
    .map((k) => whopMoneyMajor(d[k])) // numbers, numeric strings and money objects
    .filter((n): n is number => n !== null);
  if (seen.length === 0) return null;
  return Math.round(Math.min(...seen) * 100);
}

/** Pure amount rule. Returns null when the payment may grant, else the reason. */
export function amountProblem(
  paidCents: number | null,
  currency: string | null,
  priceCents: number | null,
): "amount_mismatch" | "package_not_priced" | null {
  if (priceCents == null || priceCents <= 0) return "package_not_priced";
  if (paidCents == null || !(paidCents > 0)) return "amount_mismatch";
  if (currency && currency.toLowerCase() !== "eur") return "amount_mismatch";
  if (paidCents < Math.floor(priceCents * MIN_PAID_RATIO)) return "amount_mismatch";
  return null;
}

export async function grantMentorPayment(
  sb: Pick<SupabaseClient, "rpc" | "from">,
  args: {
    userId: string;
    packageId: MentorSoldPackageId;
    paymentId: string | null;
    membershipId: string | null;
    /** What was paid (paidAmountCents of the payment object). null = unknown, refused. */
    paidCents: number | null;
    /** ISO currency of the payment, lower or upper case. Absent is tolerated (the plan check pins EUR at checkout). */
    currency: string | null;
    /** Correlation for an initial checkout only. Renewals leave it absent. */
    checkoutSessionId?: string | null;
    renewsAt?: string | null;
  },
): Promise<MentorPaymentGrant> {
  if (!args.paymentId) return { kind: "unmapped", reason: "no_payment_id" };
  if (!isUuid(args.userId)) return { kind: "unmapped", reason: "invalid_user" };

  let price: number | null;
  try {
    price = (await loadPackageCatalogue(sb)).get(args.packageId)?.price_eur_cents ?? null;
  } catch {
    return { kind: "retry", reason: "db_error" };
  }
  const problem = amountProblem(args.paidCents, args.currency, price);
  if (problem) return { kind: "unmapped", reason: problem };

  // Package lots keep the package expiry_days: no p_expires_at, start now.
  const r = await rpcGrantCredits(sb, {
    userId: args.userId,
    packageId: args.packageId,
    source: "whop_payment",
    sourceId: args.paymentId,
    micro: null,
    startsAt: null,
    expiresAt: null,
    whopPaymentId: args.paymentId,
    whopMembershipId: args.membershipId,
  });
  if (r.ok) {
    let grantedMicro = r.grantedMicro;
    if (args.packageId !== "mentor_topup" && args.renewsAt && Number.isFinite(Date.parse(args.renewsAt))) {
      const { error } = await sb.from("ai_credit_lot").update({ renews_at: args.renewsAt })
        .eq("user_id", args.userId).eq("source", "whop_payment").eq("source_id", args.paymentId).eq("package_id", args.packageId).is("renews_at", null);
      if (error) return { kind: "retry", reason: "db_error" };
    }
    if (args.checkoutSessionId) {
      try {
        // Duplicate grants do not return an amount; read the same immutable payment lot.
        if (grantedMicro == null) {
          const { data, error } = await sb.from("ai_credit_lot").select("granted_micro").eq("user_id", args.userId)
            .eq("source", "whop_payment").eq("source_id", args.paymentId).eq("package_id", args.packageId).maybeSingle();
          if (error) return { kind: "retry", reason: "db_error" };
          grantedMicro = num(data?.granted_micro);
        }
        const marked = await markPurchaseGranted(sb, {
          userId: args.userId, packageId: args.packageId, checkoutSessionId: args.checkoutSessionId,
          paymentId: args.paymentId, lotId: r.lotId, grantedMicro,
        });
        if (marked === "mismatch") {
          // The lot is granted; only the receipt correlation is wrong. A 503
          // here made Whop redeliver forever (review P2), so report and ack.
          Sentry.captureMessage(`mentor payment ${args.paymentId}: credits granted, purchase receipt ${args.checkoutSessionId} missing or for another package`, "warning");
        }
      } catch { return { kind: "retry", reason: "db_error" }; }
    }
    return r.duplicate ? { kind: "duplicate", lotId: r.lotId, grantedMicro } : { kind: "granted", lotId: r.lotId, grantedMicro };
  }
  const reason = r.reason ?? "bad_response";
  if (reason === "db_error" || reason === "missing_function" || reason === "bad_response") return { kind: "retry", reason };
  return { kind: "unmapped", reason };
}
