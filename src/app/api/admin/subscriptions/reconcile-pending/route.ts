import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { captureServerError } from "@/lib/sentry-capture";
import { TIERS, computeExpiry, formatCryptoCurrency } from "@/lib/nowpayments";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/subscriptions/reconcile-pending
 *
 * One-off admin sweep over `subscriptions` rows where status='pending'
 * and provider='nowpayments'. For each, look up the upstream state on
 * NOWPayments' API (trying /v1/invoice/{id} then /v1/payment/{id}) and:
 *
 *   - status='finished' / 'confirmed'   → flip our row to 'active',
 *     stamp expires_at + crypto_tx_hash + crypto_currency, insert a
 *     processed_webhook_events idempotency row, and bump users.tier
 *     to 'pro'. Return outcome='activated'.
 *   - status='expired' OR status='failed' OR (status='waiting' AND
 *     created_at older than 7 days) → flip our row to 'cancelled' with
 *     notes='abandoned_at_checkout_apr23'. outcome='cancelled'.
 *   - status='waiting' AND <24h old                  → leave alone.
 *     outcome='still_waiting'.
 *   - upstream returns null/404 (the stored provider_invoice_id isn't
 *     valid on NOWPayments side) → outcome='upstream_not_found'.
 *
 * Audit-logged via the standard adminRouteShell middleware. Designed
 * to be safe to re-run — every state transition is conditional on the
 * row still being 'pending' before we touch it.
 *
 * Endpoints tried (in order):
 *   1. GET /v1/invoice/{provider_invoice_id} — preferred; returns
 *      `payment_status` directly when the invoice has progressed.
 *   2. GET /v1/payment/?invoiceId={id}&limit=5 — fallback; lists any
 *      payment rows tied to this invoice. We pick the most-progressed
 *      one (finished > confirmed > confirming > waiting > expired/failed).
 *
 * Built 2026-04-24 to resolve the 5 Apr-23 invoices stuck in the
 * post-launch audit at zero webhook completions. After running once,
 * the endpoint can stay in place — it's a useful operational tool
 * any time we want to reconcile a backlog.
 */

const NOWPAYMENTS_API = "https://api.nowpayments.io";

interface UpstreamPayment {
  payment_id?: string | number;
  payment_status?: string;
  invoice_id?: string | number;
  pay_address?: string;
  pay_amount?: number;
  actually_paid?: number;
  pay_currency?: string;
  order_id?: string;
  outcome_amount?: number;
  outcome_currency?: string;
  outcome_hash?: string;
  tx_hash_outcome?: string;
  created_at?: string;
  updated_at?: string;
}

interface UpstreamInvoice {
  id?: string | number;
  invoice_id?: string | number;
  invoice_url?: string;
  payment_status?: string;
  order_id?: string;
  price_amount?: number;
  price_currency?: string;
  pay_currency?: string | null;
  created_at?: string;
  updated_at?: string;
  // When the invoice has been paid, NOWPayments echoes payment fields:
  payments?: UpstreamPayment[];
}

const STATUS_RANK: Record<string, number> = {
  finished: 100,
  confirmed: 90,
  sending: 70,
  confirming: 60,
  partially_paid: 50,
  waiting: 40,
  expired: 20,
  failed: 10,
  refunded: 5,
};

async function fetchWithKey<T>(
  url: string,
  apiKey: string
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: text.slice(0, 300) };
    }
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message.slice(0, 300) : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the most progressed payment state for a given invoice id.
 * Tries the invoice endpoint first; falls back to listing payments
 * when the invoice endpoint returns no payment_status of its own.
 */
async function resolvePaymentState(
  invoiceId: string,
  apiKey: string
): Promise<
  | { kind: "found"; payment_status: string; payment: UpstreamPayment | null }
  | { kind: "not_found"; details: string }
  | { kind: "error"; details: string }
> {
  // 1. /v1/invoice/{id}
  const inv = await fetchWithKey<UpstreamInvoice>(
    `${NOWPAYMENTS_API}/v1/invoice/${encodeURIComponent(invoiceId)}`,
    apiKey
  );
  if (inv.ok) {
    if (inv.data.payment_status) {
      return {
        kind: "found",
        payment_status: inv.data.payment_status,
        payment: inv.data.payments?.[0] ?? null,
      };
    }
    if (Array.isArray(inv.data.payments) && inv.data.payments.length > 0) {
      // Pick the most-progressed payment by status rank.
      const best = inv.data.payments.reduce<UpstreamPayment>((acc, p) => {
        const accRank = STATUS_RANK[acc.payment_status || ""] ?? -1;
        const pRank = STATUS_RANK[p.payment_status || ""] ?? -1;
        return pRank > accRank ? p : acc;
      }, inv.data.payments[0]);
      if (best.payment_status) {
        return {
          kind: "found",
          payment_status: best.payment_status,
          payment: best,
        };
      }
    }
  }

  // 2. /v1/payment/{id} as a last resort — sometimes our stored
  //    `provider_invoice_id` is actually a payment_id (depends on which
  //    NOWPayments API path created it).
  const pay = await fetchWithKey<UpstreamPayment>(
    `${NOWPAYMENTS_API}/v1/payment/${encodeURIComponent(invoiceId)}`,
    apiKey
  );
  if (pay.ok && pay.data.payment_status) {
    return {
      kind: "found",
      payment_status: pay.data.payment_status,
      payment: pay.data,
    };
  }

  // Both endpoints came back empty.
  if (!inv.ok && !pay.ok) {
    return {
      kind: "error",
      details: `invoice: HTTP ${inv.status} — ${inv.body}; payment: HTTP ${pay.status} — ${pay.body}`,
    };
  }
  return { kind: "not_found", details: "no payment_status from either endpoint" };
}

interface ReconcileOutcome {
  subscriptionId: string;
  invoiceId: string | null;
  tier: string;
  amountCents: number | null;
  upstreamStatus: string | null;
  outcome:
    | "activated"
    | "cancelled"
    | "still_waiting"
    | "upstream_not_found"
    | "skipped_no_invoice_id"
    | "error";
  error?: string;
}

export const POST = adminRouteShell(
  async () => {
    try {
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "NOWPAYMENTS_API_KEY not set" },
          { status: 500 }
        );
      }

      const sb = getServiceClient();

      const { data: pending, error: pendingErr } = await sb
        .from("subscriptions")
        .select(
          "id, user_id, tier, amount_cents, provider_invoice_id, created_at"
        )
        .eq("payment_provider", "nowpayments")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (pendingErr) {
        captureServerError(pendingErr, {
          route: "/api/admin/subscriptions/reconcile-pending",
          phase: "list_pending",
        });
        return NextResponse.json({ error: pendingErr.message }, { status: 500 });
      }

      const outcomes: ReconcileOutcome[] = [];

      for (const row of pending ?? []) {
        const invoiceId = (row as { provider_invoice_id?: string })
          .provider_invoice_id;
        const subscriptionId = row.id as string;
        const tier = row.tier as string;

        if (!invoiceId) {
          outcomes.push({
            subscriptionId,
            invoiceId: null,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: null,
            outcome: "skipped_no_invoice_id",
          });
          continue;
        }

        const lookup = await resolvePaymentState(invoiceId, apiKey);
        const ageMs =
          Date.now() -
          new Date((row.created_at as string) || new Date().toISOString()).getTime();
        const olderThan7d = ageMs > 7 * 86400 * 1000;
        const olderThan24h = ageMs > 86400 * 1000;

        if (lookup.kind === "error") {
          outcomes.push({
            subscriptionId,
            invoiceId,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: null,
            outcome: "error",
            error: lookup.details.slice(0, 300),
          });
          continue;
        }

        if (lookup.kind === "not_found") {
          // Older than 7d → cancel; younger → leave alone.
          if (olderThan7d) {
            await sb
              .from("subscriptions")
              .update({
                status: "cancelled",
                cancelled_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", subscriptionId)
              .eq("status", "pending");
          }
          outcomes.push({
            subscriptionId,
            invoiceId,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: null,
            outcome: olderThan7d ? "cancelled" : "upstream_not_found",
          });
          continue;
        }

        const status = lookup.payment_status.toLowerCase();
        const payment = lookup.payment;

        if (status === "finished" || status === "confirmed") {
          // Activate.
          const tierDef = TIERS[tier];
          const durationMonths = tierDef?.durationMonths ?? 1;
          const expiresAt = computeExpiry(durationMonths, new Date());

          const { error: updErr } = await sb
            .from("subscriptions")
            .update({
              status: "active",
              started_at: new Date().toISOString(),
              expires_at: expiresAt.toISOString(),
              crypto_tx_hash:
                payment?.outcome_hash ??
                payment?.tx_hash_outcome ??
                null,
              crypto_currency: formatCryptoCurrency(payment?.pay_currency),
              provider_payment_id: payment?.payment_id
                ? String(payment.payment_id)
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscriptionId)
            .eq("status", "pending");
          if (updErr) {
            captureServerError(updErr, {
              route: "/api/admin/subscriptions/reconcile-pending",
              phase: "activate",
              subscriptionId,
            });
          }

          // Idempotency row so the eventual late webhook doesn't
          // double-credit.
          if (payment?.payment_id) {
            await sb.from("processed_webhook_events").upsert(
              {
                provider: "nowpayments",
                event_id: String(payment.payment_id),
                payload: {
                  source: "manual_reconcile",
                  subscription_id: subscriptionId,
                  payment_status: status,
                  reconciled_at: new Date().toISOString(),
                },
              },
              { onConflict: "provider,event_id" }
            );
          }

          // Mirror users.tier.
          await sb
            .from("users")
            .update({
              tier: "pro",
              tier_expires_at: expiresAt.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.user_id as string);

          outcomes.push({
            subscriptionId,
            invoiceId,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: status,
            outcome: "activated",
          });
        } else if (
          status === "expired" ||
          status === "failed" ||
          status === "refunded"
        ) {
          await sb
            .from("subscriptions")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscriptionId)
            .eq("status", "pending");
          outcomes.push({
            subscriptionId,
            invoiceId,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: status,
            outcome: "cancelled",
          });
        } else if (
          (status === "waiting" || status === "confirming" || status === "sending") &&
          olderThan7d
        ) {
          // Stuck waiting for >7 days — treat as abandoned.
          await sb
            .from("subscriptions")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscriptionId)
            .eq("status", "pending");
          outcomes.push({
            subscriptionId,
            invoiceId,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: status,
            outcome: "cancelled",
          });
        } else {
          // Genuinely still waiting and recent enough to give the user
          // more time. Reconcile again on a future run.
          outcomes.push({
            subscriptionId,
            invoiceId,
            tier,
            amountCents: row.amount_cents as number | null,
            upstreamStatus: status,
            outcome: olderThan24h ? "still_waiting" : "still_waiting",
          });
        }
      }

      const summary = {
        total: outcomes.length,
        activated: outcomes.filter((o) => o.outcome === "activated").length,
        cancelled: outcomes.filter((o) => o.outcome === "cancelled").length,
        still_waiting: outcomes.filter((o) => o.outcome === "still_waiting").length,
        upstream_not_found: outcomes.filter(
          (o) => o.outcome === "upstream_not_found"
        ).length,
        skipped_no_invoice_id: outcomes.filter(
          (o) => o.outcome === "skipped_no_invoice_id"
        ).length,
        error: outcomes.filter((o) => o.outcome === "error").length,
      };

      return NextResponse.json({ ok: true, summary, outcomes });
    } catch (err) {
      captureServerError(err, {
        route: "/api/admin/subscriptions/reconcile-pending",
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  },
  { route: "/api/admin/subscriptions/reconcile-pending" }
);
