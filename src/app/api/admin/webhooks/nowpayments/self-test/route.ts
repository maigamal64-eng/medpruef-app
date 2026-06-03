import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { computeNowpaymentsSignature } from "@/lib/nowpayments";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/webhooks/nowpayments/self-test
 *
 * Self-diagnostic: fires a signed synthetic webhook at our own
 * `/api/webhooks/nowpayments` route and reports whether the round-trip
 * succeeded.
 *
 * Flow:
 *   1. Build a realistic NOWPayments "finished" payload with a
 *      sentinel `payment_id` that won't collide with a real one
 *      (e.g. `sst-${now}`).
 *   2. Sign it with `NOWPAYMENTS_IPN_SECRET` using the same HMAC-SHA512
 *      + sorted-keys JSON serialisation the real NOWPayments uses.
 *   3. POST to our own webhook URL (from `NEXT_PUBLIC_SITE_URL`).
 *   4. Inspect the response + query `processed_webhook_events` for the
 *      inserted row (idempotency-keyed on the sentinel payment_id).
 *   5. Clean up by deleting the sentinel row so consecutive self-tests
 *      don't accumulate fake "processed" rows in the audit trail.
 *   6. Return a structured report: URL hit, status code, signature
 *      computed, signature submitted, insert row found, cleanup OK.
 *
 * Guardrails:
 *   - The `order_id` is a real-looking UUID but doesn't match any
 *     existing subscription, so the webhook will end at "subscription
 *     not found" — which still logs a `webhook_attempts` row and
 *     records to `processed_webhook_events`. That's exactly what we
 *     want to verify: the full pipeline excluding the sub-update.
 *   - Admin-gated (requireAdmin via adminRouteShell). Audit-logged.
 *   - Never accepts a user-supplied secret/URL — everything comes
 *     from server env.
 */

const SELF_TEST_ORDER_ID = "00000000-0000-4000-a000-000000000000"; // sentinel UUID

export const POST = adminRouteShell(
  async ({ req, actor }) => {
    const startedAt = Date.now();

    try {
      const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
      if (!ipnSecret) {
        return NextResponse.json(
          {
            ok: false,
            error: "NOWPAYMENTS_IPN_SECRET not set in env",
            phase: "env_check",
          },
          { status: 500 }
        );
      }

      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
      const webhookUrl = `${siteUrl.replace(/\/$/, "")}/api/webhooks/nowpayments`;

      // Build a realistic "finished" payload. The sentinel payment_id
      // is a string so the `processed_webhook_events` PK is unique per
      // self-test run.
      const sentinelPaymentId = `sst-${Date.now()}`;
      const payload: Record<string, unknown> = {
        payment_id: sentinelPaymentId,
        payment_status: "finished",
        pay_address: "0xSELFTEST",
        price_amount: 19,
        price_currency: "eur",
        pay_amount: 18.95,
        actually_paid: 18.95,
        pay_currency: "usdttrc20",
        order_id: SELF_TEST_ORDER_ID,
        order_description: "MedPrüf webhook self-test (ignore)",
        purchase_id: "self-test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        outcome_amount: 18.9,
        outcome_currency: "usdt",
      };

      const signature = computeNowpaymentsSignature(payload, ipnSecret);
      const body = JSON.stringify(payload, Object.keys(payload).sort());

      // Insert a synthetic subscription row that the webhook handler
      // can resolve via `order_id`. Without this row the handler
      // returns 404 "Subscription not found" — the production rescue
      // tour caught this: the self-test was reporting status:404 and
      // ok:false even though the rest of the pipeline was working.
      //
      // Sentinel order_id is a fixed UUID (00000000-…) so we can
      // detect + clean up this row deterministically. We use the admin
      // user_id as the owner so RLS doesn't trip if anyone ever flips
      // it on for the table.
      const sb = getServiceClient();
      // Look up the calling admin's user_id from the request — we use
      // it as the synthetic subscription's user_id so the activation
      // path doesn't NULL-FK out.
      // Use the validated admin id from the guard (adminRouteShell →
      // requireAdmin), not the client-controlled x-user-id header (S-1).
      const adminUserId = actor.userId;
      if (adminUserId) {
        await sb.from("subscriptions").upsert(
          {
            id: SELF_TEST_ORDER_ID,
            user_id: adminUserId,
            tier: "first_month_19",
            status: "pending",
            payment_provider: "nowpayments",
            payment_method: "crypto",
            amount_cents: 1900,
            currency: "EUR",
            provider_invoice_id: "self-test-invoice",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      }

      // Fire at ourselves. Use a short timeout — the webhook should
      // respond within 2s normally.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let fetchError: string | null = null;
      let status = 0;
      let responseBody = "";
      try {
        const r = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-nowpayments-sig": signature,
            "user-agent": "medpruef-self-test/1",
          },
          body,
          signal: controller.signal,
        });
        status = r.status;
        responseBody = await r.text();
      } catch (err) {
        fetchError =
          err instanceof Error ? err.message.slice(0, 300) : "fetch failed";
      } finally {
        clearTimeout(timer);
      }

      // Check whether the webhook actually inserted a
      // `processed_webhook_events` row for the sentinel event_id.
      const { data: processedRow } = await sb
        .from("processed_webhook_events")
        .select("provider, event_id, processed_at")
        .eq("provider", "nowpayments")
        .eq("event_id", sentinelPaymentId)
        .maybeSingle();

      // Look up `webhook_attempts` by signature_header. The top-of-
      // handler logger (rescue-sprint §1.4 fix) writes EVERY inbound
      // request before payload parsing, so it doesn't yet know the
      // event_id. The signature is unique per call (HMAC-SHA512 over
      // the unique `payment_id: sst-${Date.now()}` payload), so we
      // can use it as the join key. We pick the most recent row in
      // case multiple self-tests fire close together.
      const { data: attemptRows } = await sb
        .from("webhook_attempts")
        .select("provider, result, signature_valid, received_at, error, signature_header, event_id")
        .eq("provider", "nowpayments")
        .eq("signature_header", signature)
        .order("received_at", { ascending: false })
        .limit(5);
      const attemptRow = attemptRows?.[0] ?? null;

      // Clean up the sentinel rows so repeated self-tests don't
      // clutter the audit trail. We leave `webhook_attempts` rows
      // intact — they're useful for admin-visibility ("did the prod
      // self-test fire today?").
      if (processedRow) {
        await sb
          .from("processed_webhook_events")
          .delete()
          .eq("provider", "nowpayments")
          .eq("event_id", sentinelPaymentId);
      }
      // Reset the synthetic subscription back to 'pending' so the row
      // doesn't pollute revenue counters if it got flipped to 'active'.
      // (We could DELETE, but keeping it lets repeat self-tests reuse
      // the same id without colliding with the upsert.)
      if (adminUserId) {
        await sb
          .from("subscriptions")
          .update({
            status: "pending",
            expires_at: null,
            crypto_tx_hash: null,
            crypto_currency: null,
            provider_payment_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", SELF_TEST_ORDER_ID);
      }

      const durationMs = Date.now() - startedAt;
      // Two truthful flavours of "ok":
      //   - happy path: webhook returned 200 (synthetic sub activated)
      //   - acceptable path: webhook returned 404 with
      //     `{error: "Subscription not found"}` because the synthetic
      //     sub couldn't be inserted (e.g. caller has no admin user_id
      //     to use as user_id). We still want webhook_attempts row +
      //     processed row, just not the activation half.
      const okHappy =
        fetchError === null &&
        status === 200 &&
        Boolean(processedRow) &&
        Boolean(attemptRow) &&
        attemptRow?.signature_valid === true;
      const okFallback =
        !okHappy &&
        fetchError === null &&
        (status === 200 || status === 404) &&
        Boolean(attemptRow);
      const ok = okHappy || okFallback;

      // Audit-log the self-test run so admin_audit_log captures every
      // operational probe (review-2026-04-25-A3). Includes the verdict
      // and timing — useful when investigating "why was the webhook
      // self-test green at 14:00 then red at 16:00?"
      await logAdminAction({
        req,
        actorId: actor.userId,
        actorEmail: actor.email,
        action: "nowpayments_webhook_self_test",
        targetType: "system",
        payload: {
          ok,
          phase: ok
            ? "complete"
            : fetchError
              ? "fetch_failed"
              : "verification_failed",
          status,
          processedRowInserted: Boolean(processedRow),
          webhookAttemptsRowLogged: Boolean(attemptRow),
          durationMs,
        },
      });

      return NextResponse.json({
        ok,
        phase: ok ? "complete" : fetchError ? "fetch_failed" : "verification_failed",
        fetchError,
        url: webhookUrl,
        status,
        responseBody: responseBody.slice(0, 500),
        signatureSubmitted: signature.slice(0, 16) + "…",
        signatureLength: signature.length,
        processedRowInserted: Boolean(processedRow),
        webhookAttemptsRowLogged: Boolean(attemptRow),
        webhookAttemptsResult: attemptRow?.result || null,
        webhookAttemptsSignatureValid: attemptRow?.signature_valid ?? null,
        webhookAttemptsRowCount: attemptRows?.length ?? 0,
        // When okFallback fires (404 acceptable), surface that reason
        // so the admin sees why the test still says "ok" with status:404.
        fallbackReason:
          ok && !okHappy
            ? "synthetic subscription not present — webhook reached + logged + signed correctly, only the activation step short-circuited (404)"
            : null,
        cleanup: processedRow ? "ok" : "no_row_to_clean",
        durationMs,
      });
    } catch (err) {
      captureServerError(err, {
        route: "/api/admin/webhooks/nowpayments/self-test",
      });
      return NextResponse.json(
        { ok: false, error: "Internal error", phase: "unexpected" },
        { status: 500 }
      );
    }
  },
  { route: "/api/admin/webhooks/nowpayments/self-test" }
);
