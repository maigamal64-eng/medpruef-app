/**
 * Mentor credits: return-from-Whop verification (GET /api/mentor/checkout/verify).
 *
 * Mirrors the proven Pro verify flow (src/app/api/whop/checkout/verify):
 *   1. a whop_payment lot created for this user in the last 48 h -> granted
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
import { grantMentorPayment } from "./grant-payment";
import { SOLD_PACKAGE_IDS } from "./packages";

type Env = Record<string, string | undefined>;
type Db = Pick<SupabaseClient, "from" | "rpc">;

export const VERIFY_WINDOW_MS = 48 * 3600_000;
const VALID_MEMBERSHIP = new Set(["active", "trialing", "completed"]);
const FAILED_PAYMENT = new Set(["failed", "declined", "canceled", "cancelled"]);

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

export interface VerifyDeps {
  db: Db;
  apiKey: string | null;
  companyId: string | null;
  env?: Env;
  ledger?: LedgerFn;
  now?: () => number;
}

/** Step 1: has a whop_payment lot for this user landed recently? */
async function recentLot(db: Db, userId: string, sinceIso: string, pkg: MentorSoldPackageId | null): Promise<boolean | null> {
  let q = db
    .from("ai_credit_lot")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "whop_payment")
    .gte("created_at", sinceIso);
  if (pkg) q = q.eq("package_id", pkg);
  const { data, error } = await q.limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length > 0;
}

export async function verifyMentorCheckout(
  deps: VerifyDeps,
  userId: string,
  onlyPackage: MentorSoldPackageId | null,
): Promise<MentorCheckoutVerifyResponse["status"]> {
  const env = deps.env ?? process.env;
  const now = deps.now ? deps.now() : Date.now();
  const cutoff = now - VERIFY_WINDOW_MS;
  const ledger = deps.ledger ?? paginateWhopLedger;

  const hit = await recentLot(deps.db, userId, new Date(cutoff).toISOString(), onlyPackage);
  if (hit) return "granted";

  if (!deps.apiKey) return "pending";
  const plans = (onlyPackage ? [onlyPackage] : [...SOLD_PACKAGE_IDS])
    .map((p) => ({ pkg: p, plan: mentorWhopPlanId(p, env) }))
    .filter((x): x is { pkg: MentorSoldPackageId; plan: string } => Boolean(x.plan));
  if (plans.length === 0) return "pending";

  // Memberships on the mentor plans whose metadata names this user.
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
        if (id && metaUser === userId && valid) mine.set(id, pkg);
      }
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout/verify", step: "memberships" } });
    return "pending";
  }
  if (mine.size === 0) return "pending";

  let payments: WhopLedgerResult;
  try {
    payments = await ledger({
      apiKey: deps.apiKey,
      endpoint: "payments",
      query: `company_id=${encodeURIComponent(deps.companyId ?? "")}`,
      cutoffMs: cutoff,
      tag: "mentor_verify.payments",
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/checkout/verify", step: "payments" } });
    return "pending";
  }

  let sawFailed = false;
  for (const row of payments.rows) {
    const f = extractWhopPayment(row);
    const memberRaw = str(rec(rec(row).member).id) ?? str(rec(row).member_id);
    const membershipId = [f.membershipId, memberRaw].find((x): x is string => Boolean(x && mine.has(x))) ?? null;
    if (!membershipId || !f.paymentId) continue;
    const at = createdMs(row);
    if (at === null || at < cutoff) continue;
    const status = str(rec(row).status);
    if (status !== "paid") {
      if (status && FAILED_PAYMENT.has(status)) sawFailed = true;
      continue;
    }
    const pkg = mentorPackageForWhopPlan(f.planId, env) ?? (mine.get(membershipId) as MentorSoldPackageId);
    const g = await grantMentorPayment(deps.db, { userId, packageId: pkg, paymentId: f.paymentId, membershipId });
    if (g.kind === "granted" || g.kind === "duplicate") return "granted";
    if (g.kind === "retry") return "pending";
    Sentry.captureMessage(`mentor verify: payment ${f.paymentId} cannot be granted (${g.reason}); manual grant needed`, "error");
    return "failed";
  }
  if (payments.truncated || truncated) return "pending";
  return sawFailed ? "failed" : "pending";
}
