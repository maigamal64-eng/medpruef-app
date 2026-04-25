import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/webhooks/nowpayments/status
 *
 * Diagnostic dashboard for the NOWPayments rail. Surfaces four things
 * on one endpoint so /admin/webhooks can render a single pane:
 *
 *   1. `attempts` — the last 50 rows from `webhook_attempts` (every
 *      inbound POST, signature-valid or not). Tells us whether
 *      NOWPayments is reaching our edge at all.
 *
 *   2. `processed` — the last 50 rows from `processed_webhook_events`
 *      (idempotency-keyed successes). Tells us what actually got
 *      recorded as a completed payment.
 *
 *   3. `pending` — every subscription with `status='pending'` and
 *      `provider='nowpayments'`. These are the "we created an invoice
 *      but never heard back" rows. Combined with (1), we can tell
 *      which pending rows had an attempt logged vs which never heard
 *      back at all.
 *
 *   4. `liveStatus` — for each pending subscription, query
 *      NOWPayments' GET /v1/payment/{invoice_id} and return the
 *      upstream status. This tells us what NOWPayments believes —
 *      did the user pay but the webhook never reached us? Or did the
 *      user bail without paying?
 *
 * Added 2026-04-24 after the audit found 5 pending subscriptions +
 * 0 processed webhooks. Admin-gated; never surface to users.
 */

const NOWPAYMENTS_API = "https://api.nowpayments.io";

interface NowpaymentsPaymentStatus {
  payment_id: number | string;
  payment_status: string;
  pay_address?: string;
  price_amount?: number;
  price_currency?: string;
  pay_amount?: number;
  actually_paid?: number;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  purchase_id?: string | number;
  created_at?: string;
  updated_at?: string;
  outcome_amount?: number;
  outcome_currency?: string;
}

/**
 * Best-effort NOWPayments status lookup. Returns `null` for any
 * failure (missing API key, 4xx, timeout). Never throws — the
 * diagnostic page should render even when the upstream is down.
 */
async function fetchNowpaymentsStatus(
  invoiceId: string,
  apiKey: string | undefined
): Promise<NowpaymentsPaymentStatus | { error: string } | null> {
  if (!apiKey) return { error: "NOWPAYMENTS_API_KEY not set" };
  if (!invoiceId) return { error: "missing invoiceId" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `${NOWPAYMENTS_API}/v1/payment/${encodeURIComponent(invoiceId)}`,
      {
        headers: { "x-api-key": apiKey },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text();
      return { error: `HTTP ${res.status} — ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as NowpaymentsPaymentStatus;
    return json;
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message.slice(0, 200) : "unknown fetch error",
    };
  }
}

export const GET = adminRouteShell(
  async () => {
    try {
      const sb = getServiceClient();

      // Pull the diagnostic slices in parallel — all three are
      // bounded reads, no heavy scans.
      const [attemptsRes, processedRes, pendingRes] = await Promise.all([
        sb
          .from("webhook_attempts")
          .select("*")
          .eq("provider", "nowpayments")
          .order("received_at", { ascending: false })
          .limit(50),
        sb
          .from("processed_webhook_events")
          .select("provider, event_id, processed_at, payload")
          .eq("provider", "nowpayments")
          .order("processed_at", { ascending: false, nullsFirst: false })
          .limit(50),
        sb
          .from("subscriptions")
          .select(
            "id, user_id, tier, status, amount_cents, provider_invoice_id, provider_payment_id, created_at, expires_at"
          )
          .eq("payment_provider", "nowpayments")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

      const attempts = attemptsRes.data ?? [];
      const processed = processedRes.data ?? [];
      const pending = pendingRes.data ?? [];

      // For each pending subscription with a provider_invoice_id, look
      // up what NOWPayments thinks. We cap at 10 concurrent requests
      // to avoid hammering NOWPayments if the list grows.
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      const liveStatusEntries = await Promise.all(
        pending.slice(0, 10).map(async (row) => {
          const invoiceId = (row as { provider_invoice_id?: string })
            .provider_invoice_id;
          if (!invoiceId) {
            return {
              subscriptionId: row.id,
              invoiceId: null,
              status: null,
              error: "no provider_invoice_id",
            };
          }
          const live = await fetchNowpaymentsStatus(invoiceId, apiKey);
          if (live && "error" in live) {
            return {
              subscriptionId: row.id,
              invoiceId,
              status: null,
              error: live.error,
            };
          }
          return {
            subscriptionId: row.id,
            invoiceId,
            status: live?.payment_status ?? null,
            actuallyPaid: live?.actually_paid ?? null,
            payAmount: live?.pay_amount ?? null,
            payCurrency: live?.pay_currency ?? null,
            updatedAt: live?.updated_at ?? null,
            error: null,
          };
        })
      );

      // Summary counts for the overview pane.
      const attemptsByResult = attempts.reduce<Record<string, number>>(
        (acc, a) => {
          const k = (a as { result?: string }).result || "unknown";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        },
        {}
      );

      return NextResponse.json({
        summary: {
          attempts_total: attempts.length,
          attempts_by_result: attemptsByResult,
          processed_total: processed.length,
          pending_total: pending.length,
          env: {
            api_key_configured: Boolean(process.env.NOWPAYMENTS_API_KEY),
            ipn_secret_configured: Boolean(process.env.NOWPAYMENTS_IPN_SECRET),
            site_url: process.env.NEXT_PUBLIC_SITE_URL || null,
            // Don't echo the secret — only confirm shape.
            ipn_secret_hash: process.env.NOWPAYMENTS_IPN_SECRET
              ? hashTruncate(process.env.NOWPAYMENTS_IPN_SECRET)
              : null,
          },
        },
        attempts,
        processed,
        pending,
        liveStatus: liveStatusEntries,
      });
    } catch (err) {
      captureServerError(err, {
        route: "/api/admin/webhooks/nowpayments/status",
      });
      return NextResponse.json(
        { error: "Internal error" },
        { status: 500 }
      );
    }
  },
  { route: "/api/admin/webhooks/nowpayments/status" }
);

/**
 * Safe "fingerprint" of the IPN secret — first 4 + last 4 chars +
 * sha256[:8]. Lets the admin compare against the NOWPayments dashboard
 * value ("cUWf...ZXyZ" per the screenshot) without exposing the secret.
 */
function hashTruncate(s: string): string {
  if (!s) return "";
  const head = s.slice(0, 4);
  const tail = s.slice(-4);
  const h = createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);
  return `${head}…${tail} (sha256:${h})`;
}
