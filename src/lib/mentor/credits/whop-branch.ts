/**
 * Mentor credits: the early mentor branch of POST /api/webhooks/whop
 * (contract.ts RouteMentorWhopEvent / MENTOR_WHOP_ID_RULES, W2-CREDITS).
 *
 * Called once, after the webhook_received log and BEFORE the Pro revoke,
 * dunning and grant paths:
 *     const mentor = await routeMentorWhopEvent(event, data);
 *     if (mentor.handled) return NextResponse.json(mentor.body, { status: mentor.status });
 *
 * Hard rules:
 *  - A mentor event never touches users.tier, subscriptions or handleRevoke.
 *    Once an event is recognised as mentor it is ALWAYS handled here (200 or
 *    503), never handed to the Pro paths.
 *  - Revoke-class coverage is the union of contract MENTOR_WHOP_EVENTS and
 *    src/lib/whop.ts classifyWhopRevoke, so a mentor refund.updated,
 *    payment.refunded, membership.cancelled or membership.expired can never
 *    reach the Pro revoke fallback (which resolves the buyer by metadata or
 *    email and could cancel their Pro).
 *  - Recognition order: checkout metadata kind, mentor plan id, then the
 *    ledger (mentor_whop_lookup by payment, then the membership pin).
 *  - Unconfigured (no WHOP_PLAN_MENTOR_* set): no mentor checkout can have
 *    happened, so no RPC is made; only metadata/plan recognition applies.
 *    A missing ledger function (migration not applied) on a lookup is
 *    treated as "not mentor" and Sentry-flagged; any other DB error on
 *    recognition returns 503 so Whop redelivers.
 *  - Clawback/deactivate ids come from extractWhopRevoke, never data.id on a
 *    non-payment event. A recognised refund or dispute first TOMBSTONES every
 *    payment id (mentor_revoke_payment, review H1: a grant that arrives later
 *    is refused), then claws back the matched payment lot (unspent part gone,
 *    spent part becomes debt, review H2). A refund with no lot yet is 200
 *    "recorded" (tombstoned); a membership match alone claws nothing back.
 *  - A grant needs a real payment (review H3): paid amount > 0, EUR, and at
 *    least the package price less a small tolerance; else 200 "unmapped".
 */

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { classifyWhopRevoke, extractWhopPayment, extractWhopRevoke, isKnownTier, whopPlanToTier } from "@/lib/whop";
import { MENTOR_WHOP_PLAN_ENV, mentorPackageForWhopPlan, type MentorSoldPackageId } from "../config";
import {
  MENTOR_CHECKOUT_METADATA_KIND,
  MENTOR_WHOP_EVENTS,
  type MentorWhopDecision,
  type MentorWhopRecognition,
  type RouteMentorWhopEvent,
} from "../contract";
import { isUuid, rpcClawback, rpcMembershipStatus, rpcRevokePayment, rpcWhopLookup, type WhopLookup } from "./db";
import { confirmedRenewal } from "./receipt";
import { grantMentorPayment, paidAmountCents } from "./grant-payment";
import { isSoldPackageId } from "./packages";
import { checkoutSessionFromPayment, clearPendingPurchase } from "./purchases";

type Env = Record<string, string | undefined>;
type Db = Pick<SupabaseClient, "from" | "rpc">;

export type MentorEventClass = "grant" | "record_only" | "clawback" | "deactivate" | "other";

const has = (list: readonly string[], e: string) => list.includes(e);

/** Event name -> effect. Revoke coverage includes every name the Pro revoke path accepts. */
export function classifyMentorEvent(event: string): MentorEventClass {
  if (has(MENTOR_WHOP_EVENTS.grant, event)) return "grant";
  if (has(MENTOR_WHOP_EVENTS.record_only, event)) return "record_only";
  if (has(MENTOR_WHOP_EVENTS.clawback, event)) return "clawback";
  if (has(MENTOR_WHOP_EVENTS.deactivate, event)) return "deactivate";
  const revoke = classifyWhopRevoke(event);
  if (revoke === "refunded") return "clawback";
  if (revoke === "cancelled") return "deactivate";
  return "other";
}

/** Any mentor plan configured? Without one no mentor checkout can exist. */
export function mentorCommerceConfigured(env: Env = process.env): boolean {
  return Object.values(MENTOR_WHOP_PLAN_ENV).some((k) => Boolean(env[k]?.trim()));
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** metadata.kind on the payment or on its embedded membership. */
function metadataSaysMentor(data: unknown): boolean {
  const d = rec(data);
  return (
    str(rec(d.metadata).kind) === MENTOR_CHECKOUT_METADATA_KIND ||
    str(rec(rec(d.membership).metadata).kind) === MENTOR_CHECKOUT_METADATA_KIND
  );
}

function metadataPackage(data: unknown): MentorSoldPackageId | null {
  const d = rec(data);
  const p = str(rec(d.metadata).package) ?? str(rec(rec(d.membership).metadata).package);
  return isSoldPackageId(p) ? p : null;
}

function uniq(xs: Array<string | null | undefined>): string[] {
  return Array.from(new Set(xs.filter((x): x is string => typeof x === "string" && x !== "")));
}

export interface MentorRouterDeps {
  /** Lazy service client (only created when a DB call is needed). */
  db?: () => Db;
  env?: Env;
  log?: typeof logPaymentEvent;
}

type Decision = Extract<MentorWhopDecision, { handled: true }>;

function decide(
  status: 200 | 503,
  action: Decision["body"]["action"],
  recognisedBy: MentorWhopRecognition | undefined,
  paymentId: string | null,
): Decision {
  const ok = status === 200 && action !== "unmapped";
  return { handled: true, status, body: { ok, mentor: true, action, recognised_by: recognisedBy, payment_id: paymentId } };
}

const NOT_MENTOR: MentorWhopDecision = { handled: false };

export function createMentorWhopRouter(deps: MentorRouterDeps = {}): RouteMentorWhopEvent {
  const env = deps.env ?? process.env;
  const log = deps.log ?? logPaymentEvent;
  let client: Db | null = null;
  const db = (): Db => {
    if (!client) client = (deps.db ?? (getServiceClient as () => Db))();
    return client;
  };

  return async function routeMentorWhopEvent(event: string, data: unknown): Promise<MentorWhopDecision> {
    const cls = classifyMentorEvent(event);
    const f = extractWhopPayment(data);
    // A refund or dispute nests the payment under data.payment: its metadata
    // and plan are positive mentor evidence too (review H1: a refund that
    // beats its grant has no lot and no membership pin yet).
    const nested = cls === "clawback" && rec(data).payment && typeof rec(data).payment === "object" ? rec(data).payment : null;
    const metaMentor = metadataSaysMentor(data) || (nested !== null && metadataSaysMentor(nested));
    const planPkg = mentorPackageForWhopPlan(f.planId, env) ?? (nested !== null ? mentorPackageForWhopPlan(extractWhopPayment(nested).planId, env) : null);
    const configured = mentorCommerceConfigured(env);

    // Positive Pro evidence (a Pro plan id or a Pro tier in metadata) and no
    // mentor metadata: this is a Pro event, no ledger lookup needed.
    const proEvidence = !metaMentor && !planPkg && (whopPlanToTier(f.planId) !== null || isKnownTier(f.metaTier));

    const cheap: MentorWhopRecognition | null = metaMentor ? "metadata" : planPkg ? "plan_id" : null;

    // Unknown event kinds: never a ledger lookup. Recognised by metadata or
    // plan -> record and ack; otherwise the Pro webhook continues.
    if (cls === "other") {
      if (!cheap) return NOT_MENTOR;
      console.info(`[whop webhook] mentor event=${event} recorded (no handler)`);
      return decide(200, "recorded", cheap, f.paymentId);
    }

    const canLookup = configured || cheap !== null;
    const lookup = async (paymentId: string | null, membershipId: string | null): Promise<WhopLookup> => {
      if (!canLookup || proEvidence) return { kind: "not_mentor" };
      const r = await rpcWhopLookup(db(), paymentId, membershipId);
      if (r.kind === "missing_function") {
        Sentry.captureMessage("mentor_whop_lookup missing: ledger migration not applied while mentor plans are configured", "warning");
      }
      return r;
    };

    // ── grant + record_only: ids from extractWhopPayment ──
    if (cls === "grant" || cls === "record_only") {
      let lk: WhopLookup | null = null;
      if (!cheap) {
        lk = await lookup(f.paymentId, f.membershipId);
        if (lk.kind === "error") return decide(503, "retry", undefined, f.paymentId);
        if (lk.kind !== "mentor") return NOT_MENTOR;
      }
      const recognisedBy: MentorWhopRecognition =
        cheap ?? (lk && lk.kind === "mentor" && lk.via === "payment" ? "ledger_payment" : "membership_pin");

      if (cls === "record_only") {
        const checkoutSessionId = checkoutSessionFromPayment(data);
        if (checkoutSessionId) {
          try { await clearPendingPurchase(db(), { status: "failed", checkoutSessionId, paymentIds: f.paymentId ? [f.paymentId] : [] }); }
          catch { return decide(503, "retry", recognisedBy, f.paymentId); }
        }
        // Whop runs its own dunning for mentor plans in v1: record, never the Pro recovery email.
        console.info(`[whop webhook] mentor ${event} recorded payment=${f.paymentId ?? "(none)"}`);
        return decide(200, "recorded", recognisedBy, f.paymentId);
      }

      const unmapped = async (cause: string, by: MentorWhopRecognition, uid: string | null = null): Promise<Decision> => {
        Sentry.captureMessage(`mentor payment ${f.paymentId ?? "(none)"} unmapped (${cause}): manual grant needed`, "error");
        try {
          await log(db() as SupabaseClient, {
            event: "grant_failed",
            userId: uid,
            planId: f.planId,
            paymentId: f.paymentId,
            amountCents: f.amountCents,
            currency: f.currency,
            reason: "unmapped",
            matched: false,
            metadata: { kind: MENTOR_CHECKOUT_METADATA_KIND, cause, recognised_by: by, ok: false },
          });
        } catch {
          /* best effort */
        }
        return decide(200, "unmapped", by, f.paymentId);
      };

      // Resolve user: payment metadata, membership metadata, then the pin.
      let userId = (metaMentor ? f.metaUserId : null) ?? (metaMentor ? f.membershipMetaUserId : null);
      let pinPkg: MentorSoldPackageId | null = null;
      const metaPkg = metaMentor ? metadataPackage(data) : null;
      if (!userId || (!planPkg && !metaPkg)) {
        if (!lk) {
          lk = await lookup(f.paymentId, f.membershipId);
          if (lk.kind === "error") return decide(503, "retry", recognisedBy, f.paymentId);
        }
        if (lk.kind === "mentor") {
          if (lk.packageId && isSoldPackageId(lk.packageId)) pinPkg = lk.packageId;
          if (!userId) userId = lk.userId;
          else if (lk.userId && lk.userId !== userId) {
            Sentry.captureMessage(`mentor payment ${f.paymentId}: metadata user differs from pinned user`, "error");
            return unmapped("user_conflict", recognisedBy);
          }
        }
      }
      const packageId = planPkg ?? metaPkg ?? pinPkg;
      if (planPkg && metaPkg && planPkg !== metaPkg) {
        Sentry.captureMessage(`mentor payment ${f.paymentId}: plan says ${planPkg}, metadata says ${metaPkg}; using the plan`, "warning");
      }
      if (!userId || !isUuid(userId) || !packageId) {
        return unmapped(!packageId ? "no_package" : "no_user", recognisedBy);
      }

      // The user must exist (no FK on the ledger by design).
      const { data: u, error: uErr } = await db().from("users").select("id").eq("id", userId).maybeSingle();
      if (uErr) return decide(503, "retry", recognisedBy, f.paymentId);
      if (!u) return unmapped("user_not_found", recognisedBy);

      const g = await grantMentorPayment(db(), {
        userId,
        packageId,
        paymentId: f.paymentId,
        membershipId: f.membershipId,
        paidCents: paidAmountCents(data),
        renewsAt: confirmedRenewal(rec(data).membership),
        currency: f.currency,
        checkoutSessionId: checkoutSessionFromPayment(data),
      });
      if (g.kind === "retry") {
        await log(db() as SupabaseClient, {
          event: "grant_failed",
          userId,
          planId: f.planId,
          paymentId: f.paymentId,
          reason: "db_error",
          metadata: { kind: MENTOR_CHECKOUT_METADATA_KIND, package: packageId, cause: g.reason, ok: false },
        });
        return decide(503, "retry", recognisedBy, f.paymentId);
      }
      if (g.kind === "unmapped") return unmapped(g.reason, recognisedBy, userId);
      if (g.kind === "duplicate") return decide(200, "duplicate", recognisedBy, f.paymentId);
      await log(db() as SupabaseClient, {
        event: "grant_succeeded",
        userId,
        planId: f.planId,
        paymentId: f.paymentId,
        amountCents: f.amountCents,
        currency: f.currency,
        matched: true,
        metadata: { kind: MENTOR_CHECKOUT_METADATA_KIND, package: packageId, recognised_by: recognisedBy, granted_micro: g.grantedMicro },
      });
      return decide(200, "granted", recognisedBy, f.paymentId);
    }

    // ── clawback + deactivate: ids from extractWhopRevoke ──
    const r = extractWhopRevoke(data);
    const payments = uniq([r.paymentId, r.originalPaymentId]);

    // Find a payment lot (the only thing a refund/dispute may claw back).
    let matchedPayment: string | null = null;
    for (const p of payments) {
      const lk = await lookup(p, null);
      if (lk.kind === "error") return decide(503, "retry", cheap ?? undefined, p);
      if (lk.kind === "mentor" && lk.via === "payment") {
        matchedPayment = p;
        break;
      }
    }
    let pinned = false;
    if (r.membershipId && (cls === "deactivate" || !matchedPayment)) {
      const lk = await lookup(null, r.membershipId);
      if (lk.kind === "error") return decide(503, "retry", cheap ?? undefined, matchedPayment);
      pinned = lk.kind === "mentor" && lk.via === "membership";
    }
    const recognisedBy: MentorWhopRecognition | null =
      cheap ?? (matchedPayment ? "ledger_payment" : pinned ? "membership_pin" : null);
    if (!recognisedBy) return NOT_MENTOR;

    if (cls === "clawback") {
      // Tombstone every payment id of a recognised mentor refund/dispute FIRST,
      // whether or not a lot exists yet (H1). A failure is a 503 so Whop redelivers.
      for (const p of payments) {
        const t = await rpcRevokePayment(db(), p, event);
        if (!t.ok) {
          if (t.reason === "missing_function") {
            Sentry.captureMessage("mentor_revoke_payment missing: ledger migration not applied while a mentor refund arrived", "error");
          }
          return decide(503, "retry", recognisedBy, p);
        }
      }
      // Release the matching checkout only, after durable payment tombstones.
      try {
        await clearPendingPurchase(db(), {
          status: "refunded", checkoutSessionId: checkoutSessionFromPayment(data), paymentIds: payments,
        });
      } catch { return decide(503, "retry", recognisedBy, matchedPayment); }
      if (!matchedPayment) {
        Sentry.captureMessage(
          `mentor ${event} with no matched payment lot (payments=${payments.join(",") || "none"}): tombstoned, nothing clawed back`,
          "warning",
        );
        return payments.length > 0 ? decide(200, "recorded", recognisedBy, payments[0]) : decide(200, "unmapped", recognisedBy, null);
      }
      const c = await rpcClawback(db(), "whop_payment", matchedPayment, event);
      if (c.ok) {
        if (!c.duplicate && c.debtAddedMicro && c.debtAddedMicro > 0) {
          Sentry.captureMessage(`mentor refund ${matchedPayment}: ${c.debtAddedMicro} micro-USD of spent credit became wallet debt`, "warning");
        }
        return decide(200, c.duplicate ? "duplicate" : "clawed_back", recognisedBy, matchedPayment);
      }
      if (c.reason === "not_found" || c.reason === "invalid_args") {
        Sentry.captureMessage(`mentor clawback ${matchedPayment}: ${c.reason}`, "warning");
        return decide(200, "unmapped", recognisedBy, matchedPayment);
      }
      return decide(503, "retry", recognisedBy, matchedPayment);
    }

    // deactivate: stop treating the pinned membership as active. Lots run to expiry.
    if (!pinned || !r.membershipId) {
      Sentry.captureMessage(`mentor ${event} without a pinned membership (membership=${r.membershipId ?? "none"})`, "warning");
      return decide(200, "unmapped", recognisedBy, matchedPayment);
    }
    const m = await rpcMembershipStatus(db(), r.membershipId, "inactive");
    if (m.ok) return decide(200, "deactivated", recognisedBy, matchedPayment);
    if (m.reason === "not_found" || m.reason === "invalid_args") return decide(200, "unmapped", recognisedBy, matchedPayment);
    return decide(503, "retry", recognisedBy, matchedPayment);
  };
}

/** The production router (lazy service client, process.env). */
export const routeMentorWhopEvent: RouteMentorWhopEvent = (event, data) => createMentorWhopRouter()(event, data);
