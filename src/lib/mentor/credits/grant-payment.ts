/**
 * Mentor credits: grant one Whop mentor payment. The ONLY place a
 * whop_payment lot is created, shared by the webhook branch and
 * GET /api/mentor/checkout/verify, so both race safely through
 * mentor_grant_credits' UNIQUE (source, source_id) = ('whop_payment', pay_id).
 * Never touches users.tier or subscriptions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorSoldPackageId } from "../config";
import { isUuid, rpcGrantCredits, type GrantReason } from "./db";

export type MentorPaymentGrant =
  | { kind: "granted"; lotId: string | null; grantedMicro: number | null }
  | { kind: "duplicate"; lotId: string | null }
  /** Permanent: retrying cannot help (bad ids, package missing, key owned by another user). */
  | { kind: "unmapped"; reason: GrantReason | "no_payment_id" | "invalid_user" }
  /** Transient: DB or transport error, or the ledger migration is not applied yet. */
  | { kind: "retry"; reason: GrantReason };

export async function grantMentorPayment(
  sb: Pick<SupabaseClient, "rpc">,
  args: {
    userId: string;
    packageId: MentorSoldPackageId;
    paymentId: string | null;
    membershipId: string | null;
  },
): Promise<MentorPaymentGrant> {
  if (!args.paymentId) return { kind: "unmapped", reason: "no_payment_id" };
  if (!isUuid(args.userId)) return { kind: "unmapped", reason: "invalid_user" };
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
  if (r.ok) return r.duplicate ? { kind: "duplicate", lotId: r.lotId } : { kind: "granted", lotId: r.lotId, grantedMicro: r.grantedMicro };
  const reason = r.reason ?? "bad_response";
  if (reason === "db_error" || reason === "missing_function" || reason === "bad_response") return { kind: "retry", reason };
  return { kind: "unmapped", reason };
}
