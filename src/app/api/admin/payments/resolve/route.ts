import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { logAdminAction } from "@/lib/admin/audit";
import { loadLedgerRows, loadResolutions } from "@/lib/admin/moneyMetrics";
import { PAYMENT_ID_RE, buildLedger, type PaymentResolution } from "@/lib/admin/money-rules";
import { logPaymentEvent } from "@/lib/paymentEvents";
import { whopPlanToTier, tierDurationMonths } from "@/lib/whop";
import { extendOrInsertWhopSubscription, reconcileUserTierPro, releaseWhopClaim } from "@/lib/whop-grant";
import { captureServerError } from "@/lib/sentry-capture";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// No PostgREST/LIKE wildcards (* and %) in an email reference.
const EMAIL_RE = /^[^\s@*%]{1,64}@[^\s@*%]{1,190}$/;
const ACTIONS = new Set(["link", "test", "not_ours"]);

type Action = "link" | "test" | "not_ours";

interface LearnerRow {
  id: string;
  email: string | null;
  first_name: string | null;
  tier: string | null;
  tier_expires_at: string | null;
}

interface Body {
  payment_id?: unknown;
  action?: unknown;
  reason?: unknown;
  user_ref?: unknown;
  confirm?: unknown;
}

const NOT_APPLIED =
  "Payment resolutions are not available until the a14 changeset (payment_resolutions) is applied. Nothing was changed.";

function sameResolution(existing: PaymentResolution, action: Action, userId: string | null): boolean {
  return existing.kind === action && (action !== "link" || existing.user_id === userId);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_*]/g, (c) => `\\${c}`);
}

/**
 * POST /api/admin/payments/resolve — the Unresolved payments queue actions
 * (ADM-02 option A). Body: { payment_id, action, reason, user_ref?, confirm? }.
 *
 *  - action "test" / "not_ours": dismiss a paid payment that never granted.
 *    It leaves the queue and is excluded from money in. No access change.
 *  - action "link": tie the payment to a learner and grant its plan's Pro
 *    window through the same primitive the webhook and checkout verify use
 *    (extendOrInsertWhopSubscription + the processed_webhook_events claim on
 *    the payment id), so a later refund can still revoke it. Without
 *    confirm:true it only previews the learner, plan and window. Only Whop
 *    payments whose plan maps to a MedPrüf Pro tier can be linked.
 *
 * revenue.manage (permission map); a link also needs users.read (it looks a
 * learner up by email) and users.entitlements.write (it grants access), the
 * same permission the audited Grant action requires. One resolution per payment id (unique
 * row), written before any grant so a double submit cannot grant twice; a
 * failed grant removes the row and releases the claim so it can be retried.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const paymentId = typeof body.payment_id === "string" ? body.payment_id.trim() : "";
    const action = typeof body.action === "string" && ACTIONS.has(body.action) ? (body.action as Action) : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const confirm = body.confirm === true;
    if (!PAYMENT_ID_RE.test(paymentId) || !action) {
      return NextResponse.json({ error: "payment_id and an action (link, test or not_ours) are required" }, { status: 400 });
    }
    if (reason.length < 5 || reason.length > 500) {
      return NextResponse.json({ error: "Give a reason between 5 and 500 characters." }, { status: 400 });
    }

    const sb = getServiceClient();
    try {
      if (action === "link") {
        const snapshot = await loadAdminPermissionSnapshot(actor.userId);
        if (!canAccessAdminPermission(snapshot, "users.read") || !canAccessAdminPermission(snapshot, "users.entitlements.write")) {
          return NextResponse.json({ error: "Linking a payment needs the users.read and users.entitlements.write permissions." }, { status: 403 });
        }
      }
      const resolutions = await loadResolutions(sb, paymentId);
      if (!resolutions.available) return NextResponse.json({ error: NOT_APPLIED }, { status: 503 });

      const rows = await loadLedgerRows(sb, paymentId);
      const payment = buildLedger(rows).payments.find((p) => p.payment_id === paymentId);
      if (!payment) return NextResponse.json({ error: "No payment with this id was recorded." }, { status: 404 });

      // Resolve the learner first so a replayed link can be recognised.
      let learner: LearnerRow | null = null;
      if (action === "link") {
        const ref = typeof body.user_ref === "string" ? body.user_ref.trim() : "";
        if (!UUID_RE.test(ref) && !EMAIL_RE.test(ref)) {
          return NextResponse.json({ error: "Enter the learner's account email or user id." }, { status: 400 });
        }
        const q = sb.from("users").select("id, email, first_name, tier, tier_expires_at");
        const { data, error } = UUID_RE.test(ref)
          ? await q.eq("id", ref.toLowerCase()).limit(2)
          : await q.ilike("email", escapeLike(ref.toLowerCase())).limit(2);
        if (error) throw error;
        if (!data || data.length === 0) return NextResponse.json({ error: "No learner matches this email or id." }, { status: 404 });
        if (data.length > 1) return NextResponse.json({ error: "More than one account matches. Use the user id instead." }, { status: 409 });
        learner = data[0] as LearnerRow;
      }

      const existing = resolutions.rows[0];
      if (existing) {
        if (sameResolution(existing, action, learner?.id ?? null)) {
          return NextResponse.json({ ok: true, duplicate: true, kind: existing.kind });
        }
        return NextResponse.json({ error: `This payment was already resolved as ${existing.kind.replace("_", " ")}.` }, { status: 409 });
      }
      if (payment.gross_cents == null || payment.gross_cents <= 0) {
        return NextResponse.json({ error: "This is not a paid payment (no positive amount was recorded)." }, { status: 409 });
      }
      if (payment.granted) {
        return NextResponse.json({ error: "This payment already granted access. Nothing to resolve." }, { status: 409 });
      }

      const tier = action === "link" && payment.provider === "whop" ? whopPlanToTier(payment.plan_id) : null;
      if (action === "link" && !tier) {
        return NextResponse.json({
          error: "This payment's plan is not a MedPrüf Pro plan (for example a mentor credit package or another product), so it cannot grant Pro here. Mark it not ours only if the money is not MedPrüf's.",
        }, { status: 422 });
      }
      if (action === "link") {
        // A payment already carried by a subscription row granted access even if
        // its grant_succeeded log line was lost: never grant it twice.
        const [latest, history] = await Promise.all([
          sb.from("subscriptions").select("id").eq("provider_payment_id", paymentId).limit(1),
          sb.from("subscriptions").select("id").contains("granted_payment_ids", JSON.stringify([{ payment_id: paymentId }])).limit(1),
        ]);
        if (latest.error) throw latest.error;
        if (history.error) throw history.error;
        if ((latest.data ?? []).length > 0 || (history.data ?? []).length > 0) {
          return NextResponse.json({ error: "This payment is already on a subscription row, so it granted access before. Open Trace a payment to check; nothing was changed." }, { status: 409 });
        }
      }

      if (action === "link" && !confirm) {
        return NextResponse.json({
          preview: {
            payment_id: paymentId,
            learner_id: learner!.id,
            learner_label: [learner!.first_name, learner!.email].filter(Boolean).join(", ") || learner!.id,
            current_access: learner!.tier === "pro"
              ? learner!.tier_expires_at ? `Pro until ${learner!.tier_expires_at.slice(0, 10)}` : "Pro, no end date"
              : learner!.tier ?? "free",
            tier,
            months: tierDurationMonths(tier!),
            // A learner who already holds Pro may have been comped by hand for
            // this payment; the dialog asks the admin to check first.
            already_pro: learner!.tier === "pro",
            gross_cents: payment.gross_cents,
            currency: payment.currency,
          },
        });
      }
      if (!confirm) return NextResponse.json({ error: "Confirm the action to continue." }, { status: 400 });

      // 1. The resolution row is the lock: one per payment id.
      const { error: insertError } = await sb.from("payment_resolutions").insert({
        payment_id: paymentId,
        provider: payment.provider,
        kind: action,
        user_id: learner?.id ?? null,
        reason,
        actor_id: actor.userId,
      });
      if (insertError) {
        if ((insertError as { code?: string }).code === "23505") {
          const again = await loadResolutions(sb, paymentId);
          const winner = again.rows[0];
          if (winner && sameResolution(winner, action, learner?.id ?? null)) {
            return NextResponse.json({ ok: true, duplicate: true, kind: winner.kind });
          }
          return NextResponse.json({ error: "Another admin resolved this payment a moment ago. Refresh the queue." }, { status: 409 });
        }
        throw insertError;
      }

      if (action !== "link") {
        await logAdminAction({
          req, actorId: actor.userId, actorEmail: actor.email,
          action: action === "test" ? "payment_marked_test" : "payment_marked_not_ours",
          targetType: "payment", targetId: paymentId,
          payload: { payment_id: paymentId, reason, gross_cents: payment.gross_cents, currency: payment.currency },
        });
        return NextResponse.json({ ok: true, kind: action });
      }

      const undo = async () => {
        await sb.from("payment_resolutions").delete().eq("payment_id", paymentId).eq("kind", "link");
      };

      // 2. Claim the payment id the way /api/whop/checkout/verify does. An
      //    unmapped webhook left a claim with no grant on purpose ("burned
      //    until an admin maps it"); release it only when no grant exists.
      const { data: granted, error: grantedError } = await sb
        .from("payment_events").select("id").eq("event", "grant_succeeded").eq("payment_id", paymentId).limit(1);
      if (grantedError) {
        await undo();
        throw grantedError;
      }
      if ((granted ?? []).length > 0) {
        await undo();
        return NextResponse.json({ error: "This payment granted access a moment ago. Refresh the queue." }, { status: 409 });
      }
      // A claim younger than 10 minutes may be a live webhook delivery: keep it.
      const { error: releaseError } = await sb.from("processed_webhook_events").delete()
        .eq("provider", "whop").eq("event_id", paymentId)
        .lt("processed_at", new Date(Date.now() - 10 * 60_000).toISOString());
      if (releaseError) {
        await undo();
        throw releaseError;
      }
      const { data: claim, error: claimError } = await sb
        .from("processed_webhook_events")
        .insert({
          provider: "whop",
          event_id: paymentId,
          payload: { claimed_at: new Date().toISOString(), source: "admin_payment_link", actor_id: actor.userId, user_id: learner!.id },
        })
        .select("event_id")
        .maybeSingle();
      if (claimError || !claim) {
        await undo();
        if ((claimError as { code?: string } | null)?.code === "23505" || !claimError) {
          return NextResponse.json({ error: "Whop is delivering this payment right now. Refresh in a minute." }, { status: 409 });
        }
        throw claimError;
      }

      // 3. Grant through the shared primitive.
      const grant = await extendOrInsertWhopSubscription(sb, {
        userId: learner!.id,
        tier: tier!,
        paymentId,
        amountCents: payment.gross_cents,
        currency: payment.currency,
        membershipId: null,
      });
      if (grant.mode === "failed") {
        await undo();
        await releaseWhopClaim(sb, paymentId);
        captureServerError(new Error(grant.error ?? "admin payment link grant failed"), { route: "/api/admin/payments/resolve", step: "grant" });
        return NextResponse.json({ error: "The grant failed and nothing was kept. Try again." }, { status: 500 });
      }
      let entitlementPending = false;
      if (!grant.entitlementReconciled && !grant.replayed) {
        try {
          await reconcileUserTierPro(sb, learner!.id, grant.expiresAt);
        } catch (err) {
          entitlementPending = true;
          captureServerError(err, { route: "/api/admin/payments/resolve", step: "reconcile_user" });
        }
      }

      await logPaymentEvent(sb, {
        event: "grant_succeeded",
        provider: "whop",
        userId: learner!.id,
        tier: tier!,
        planId: payment.plan_id,
        paymentId,
        amountCents: payment.gross_cents,
        currency: payment.currency,
        matched: true,
        metadata: { source: "admin_payment_link", actor_id: actor.userId, mode: grant.mode, expires_at: grant.expiresAt, ok: true },
      });
      await sb.from("payment_resolutions").update({ subscription_id: grant.subscriptionId, updated_at: new Date().toISOString() }).eq("payment_id", paymentId);
      await logAdminAction({
        req, actorId: actor.userId, actorEmail: actor.email,
        action: "payment_linked_to_learner",
        targetType: "user", targetId: learner!.id,
        payload: {
          payment_id: paymentId, reason, tier, mode: grant.mode,
          previous_expires_at: grant.previousExpiresAt, expires_at: grant.expiresAt,
          gross_cents: payment.gross_cents, currency: payment.currency, entitlement_pending: entitlementPending,
        },
      });
      return NextResponse.json({ ok: true, kind: "link", expires_at: grant.expiresAt || null, mode: grant.mode, entitlement_pending: entitlementPending });
    } catch (err) {
      return adminErrorResponse(err, "/api/admin/payments/resolve");
    }
  },
  { route: "/api/admin/payments/resolve", rateLimit: { limit: 20, windowMs: 60_000 } }
);
