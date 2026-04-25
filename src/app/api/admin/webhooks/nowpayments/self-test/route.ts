import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
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
  async (req) => {
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
      const sb = getServiceClient();
      const { data: processedRow } = await sb
        .from("processed_webhook_events")
        .select("provider, event_id, processed_at")
        .eq("provider", "nowpayments")
        .eq("event_id", sentinelPaymentId)
        .maybeSingle();

      // Also check webhook_attempts for the matching row — confirms
      // the logger is wired.
      const { data: attemptRow } = await sb
        .from("webhook_attempts")
        .select("provider, result, signature_valid, received_at, error")
        .eq("provider", "nowpayments")
        .eq("event_id", sentinelPaymentId)
        .maybeSingle();

      // Clean up the sentinel processed row so repeated self-tests
      // don't clutter the audit trail. We leave `webhook_attempts`
      // rows intact — they're useful for admin-visibility.
      if (processedRow) {
        await sb
          .from("processed_webhook_events")
          .delete()
          .eq("provider", "nowpayments")
          .eq("event_id", sentinelPaymentId);
      }

      const durationMs = Date.now() - startedAt;
      const ok =
        fetchError === null &&
        status === 200 &&
        Boolean(processedRow) &&
        Boolean(attemptRow) &&
        attemptRow?.signature_valid === true;

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
