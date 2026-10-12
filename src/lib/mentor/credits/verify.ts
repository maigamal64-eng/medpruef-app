/**
 * Mentor credits: return-from-Whop verification (GET /api/mentor/checkout/verify).
 *
 * Mirrors the proven Pro verify flow (src/app/api/whop/checkout/verify):
 *   1. the payment lot linked to this buyer's persisted checkout -> granted
 *   2. otherwise read Whop: memberships on each configured mentor plan whose
 *      metadata names this user, then a `paid` payment on one of those
 *      memberships within 48 h -> grant through grantMentorPayment (the same
 *      function and the same payment-id key as the webhook, so the two race
 *      safely) -> granted
 *   3. nothing yet, a provider error or a truncated ledger scan -> pending
 *      (the page keeps polling; the webhook is the backstop). Never "failed"
 *      on a partial scan.
 *   4. failed: only when the only matching payment is failed/declined, or the
 *      grant is permanently impossible (needs a manual grant).
 * Read-only on Whop. Never touches users.tier or subscriptions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { extractWhopPayment, paginateWhopLedger, type WhopLedgerResult } from "@/lib/whop";
import { mentorPackageForWhopPlan, mentorWhopPlanId, type MentorSoldPackageId } from "../config";
import type { MentorCheckoutVerifyResponse } from "../contract";
import { confirmedRenewal } from "./receipt";
import { grantMentorPayment, paidAmountCents } from "./grant-payment";
import { checkoutSessionFromPayment, clearPendingPurchase, getMentorPurchase, readPurchaseFailure, type MentorPurchase, type MentorPurchaseFailure } from "./purchases";

type Env = Record<string, string | undefined>;
type Db = Pick<SupabaseClient, "from" | "rpc">;

export const VERIFY_WINDOW_MS = 48 * 3600_000;
const VALID_MEMBERSHIP = new Set(["active", "trialing", "completed"]);
const FAILED_PAYMENT = new Set(["failed", "declined", "canceled", "cancelled"]);
/** MUX-84: only these provider statuses mean the bank or processor declined the charge. */
const DECLINED_PAYMENT = new Set(["failed", "declined"]);
/** Status or substatus words that mean the money was taken back (review H3). */
const REFUNDED_WORDS = /refund|chargeback|charged_back|dispute/i;

export type LedgerFn = (args: Parameters<typeof paginateWhopLedger>[0]) => Promise<WhopLedgerResult>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number") return String(v);
  return null;
}
function createdMs(row: unknown): number | null {
  const raw = rec(row).created_at ?? rec(row).createdAt;
  const t = typeof raw === "number" ? (raw > 1e12 ? raw : raw * 1000) : typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Does this payment row show a refund or dispute? How Whop marks a refunded
 * payment was NOT confirmed against a real one, so every plausible signal
 * counts: a refund word in status or substatus, a refunded amount above zero,
 * or a refunded_at timestamp. Check one real refunded payment before launch.
 */
export function looksRefunded(row: unknown): boolean {
  const d = rec(row);
  if (REFUNDED_WORDS.test(str(d.status) ?? "") || REFUNDED_WORDS.test(str(d.substatus) ?? "")) return true;
  for (const k of ["refunded_amount", "amount_refunded", "refunded_total"]) {
    const v = d[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : 0;
    if (Number.isFinite(n) && n > 0) return true;
  }
  return Boolean(str(d.refunded_at) ?? str(d.refunded_on) ?? str(d.disputed_at));
}

export interface VerifyDeps {
  db: Db;
  apiKey: string | null;
  companyId: string | null;
  env?: Env;
  ledger?: LedgerFn;
  now?: () => number;
}

/** A prior lot for the same package never confirms this purchase. */
async function purchaseLot(db: Db, purchase: MentorPurchase): Promise<boolean> {
  if (!purchase.payment_id) return false;
  const { data, error } = await db.from("ai_credit_lot").select("id")
    .eq("user_id", purchase.user_id).eq("package_id", purchase.package_id)
    .eq("source", "whop_payment").eq("source_id", purchase.payment_id).eq("status", "live").limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/** Provider row must carry this checkout's correlation, never merely this user's plan. */
function belongsToPurchase(row: unknown, purchase: MentorPurchase, membershipMatches: boolean): boolean {
  const d = rec(row);
  const explicit = checkoutSessionFromPayment(row);
  if (explicit) return explicit === purchase.checkout_session_id;
  const external = str(d.checkout_session_id) ?? str(d.checkout_configuration_id)
    ?? str(rec(d.checkout_configuration).id) ?? str(rec(d.checkout_session).id);
  if (external) return external === purchase.whop_checkout_session_id;
  // Whop may retain checkout metadata only on the membership. In that case
  // require the exact correlated membership AND a payment made after checkout.
  return membershipMatches;
}

export async function verifyMentorCheckout(
  deps: VerifyDeps,
  userId: string,
  onlyPackage: MentorSoldPackageId | null,
  checkoutSessionId: string | null = null,
): Promise<MentorCheckoutVerifyResponse["status"]> {
  return (await verifyMentorCheckoutDetailed(deps, userId, onlyPackage, checkoutSessionId)).status;
}

export interface MentorVerifyOutcome {
  status: MentorCheckoutVerifyResponse["status"];
  /** MUX-84: present only when the stored purchase or the provider ledger shows why. */
  reason?: MentorPurchaseFailure;
}

export async function verifyMentorCheckoutDetailed(
  deps: VerifyDeps,
  userId: string,
  onlyPackage: MentorSoldPackageId | null,
  checkoutSessionId: string | null = null,
): Promise<MentorVerifyOutcome> {
  if (!checkoutSessionId) return { status: "pending" };
  const purchase = await getMentorPurchase(deps.db, userId, checkoutSessionId);
  if (!purchase || (onlyPackage && onlyPackage !== purchase.package_id)) return { status: "pending" };
  if (purchase.status === "refunded") return { status: "failed", reason: "refunded" };
  if (purchase.status === "failed") {
    const reason = await readPurchaseFailure(deps.db, userId, checkoutSessionId);
    return reason ? { status: "failed", reason } : { status: "failed" };
  }
  if (await purchaseLot(deps.db, purchase)) return { status: "granted" };

  const env = deps.env ?? process.env;
  const now = deps.now ? deps.now() : Date.now();
  const cutoff = Math.max(now - VERIFY_WINDOW_MS, Date.parse(purchase.created_at));
  const ledger = deps.ledger ?? paginateWhopLedger;
  if (!deps.apiKey) return { status: "pending" };
  const planId = mentorWhopPlanId(purchase.package_id, env);
  if (!planId) return { status: "pending" };
  const plans = [{ pkg: purchase.package_id, plan: planId }];

  // Memberships on the mentor plans whose metadata names this user.
  const renewals = new Map<string, string>();
  const mine = new Map<string, MentorSoldPackageId>();
  let truncated = false;
  try {
    for (const { pkg, plan } of plans) {
      const res = await ledger({
        apiKey: deps.apiKey,
        endpoint: "memberships",
        query: `plan_id=${encodeURIComponent(plan)}`,
        cutoffMs: cutoff,
        tag: "mentor_verify.memberships",
      });
      truncated = truncated || res.truncated;
      for (const m of res.rows) {
        const d = rec(m);
        const meta = rec(d.metadata);
        const id = str(d.id);
        const metaUser = str(meta.medpruef_user_id) ?? str(meta.user_id);
        const status = str(d.status);
        const valid = d.valid === true || d.valid === "true" || (status !== null && VALID_MEMBERSHIP.has(status));
        if (id && metaUser === userId && valid && checkoutSessionFromPayment(m) === purchase.checkout_session_id) { mine.set(id, pkg); const date = confirmedRenewal(m); if (date) renewals.set(id, date); }
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout/verify", step: "memberships" } });
    return { status: "pending" };
  }


  let payments: WhopLedgerResult;
  try {
    payments = await ledger({
      apiKey: deps.apiKey,
      endpoint: "payments",
      query: `account_id=${encodeURIComponent(deps.companyId ?? "")}`,
      cutoffMs: cutoff,
      tag: "mentor_verify.payments",
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout/verify", step: "payments" } });
    return { status: "pending" };
  }

  let sawFailed = false;
  let sawRefund = false;
  let sawDecline = false;
  for (const row of payments.rows) {
    const f = extractWhopPayment(row);
    const memberRaw = str(rec(rec(row).member).id) ?? str(rec(row).member_id);
    const membershipId = [f.membershipId, memberRaw].find((x): x is string => Boolean(x && mine.has(x))) ?? null;
    if (!f.paymentId || !belongsToPurchase(row, purchase, Boolean(membershipId))) continue;
    if (f.metaUserId && f.metaUserId !== userId) continue;
    const rowPackage = mentorPackageForWhopPlan(f.planId, env);
    if (rowPackage && rowPackage !== purchase.package_id) continue;
    const at = createdMs(row);
    if (at === null || at < cutoff) continue;
    const status = str(rec(row).status);
    if (looksRefunded(row)) {
      sawFailed = true;
      sawRefund = true;
      continue;
    }
    if (status !== "paid") {
      if (status && FAILED_PAYMENT.has(status)) sawFailed = true;
      if (status && DECLINED_PAYMENT.has(status)) sawDecline = true;
      continue;
    }
    const pkg = purchase.package_id;
    const g = await grantMentorPayment(deps.db, {
      userId,
      packageId: pkg,
      paymentId: f.paymentId,
      membershipId: membershipId ?? f.membershipId,
      paidCents: paidAmountCents(row),
      currency: f.currency,
      checkoutSessionId: purchase.checkout_session_id,
      renewsAt: membershipId ? renewals.get(membershipId) ?? null : confirmedRenewal(rec(row).membership),
    });
    if (g.kind === "granted" || g.kind === "duplicate") return { status: "granted" };
    if (g.kind === "retry") return { status: "pending" };
    Sentry.captureMessage(`mentor verify: payment ${f.paymentId} cannot be granted (${g.reason}); manual grant needed`, "error");
    await clearPendingPurchase(deps.db, { status: "failed", checkoutSessionId: purchase.checkout_session_id, reason: "needs_manual" });
    return { status: "failed", reason: "needs_manual" };
  }
  if (payments.truncated || truncated) return { status: "pending" };
  if (sawFailed) {
    // A refund wins over a decline; a cancelled payment alone gets no reason (never guessed).
    const reason: MentorPurchaseFailure | undefined = sawRefund ? "refunded" : sawDecline ? "declined" : undefined;
    await clearPendingPurchase(deps.db, { status: "failed", checkoutSessionId: purchase.checkout_session_id, ...(reason ? { reason } : {}) });
    return reason ? { status: "failed", reason } : { status: "failed" };
  }
  return { status: "pending" };
}
