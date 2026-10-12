import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { assertReadSucceeded } from "@/lib/admin/read-result";
import { loadLedgerRows, loadResolutions } from "@/lib/admin/moneyMetrics";
import { PAYMENT_ID_RE, buildLedger } from "@/lib/admin/money-rules";
import { whopPlanToTier } from "@/lib/whop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/stats/admin/payments/trace?payment_id=pay_x — one payment end to
 * end (ADM-02 A): every payment_events row for it, the webhook deliveries,
 * the idempotency claims (grant, refund, dispute, cancel, recovery), the
 * subscription rows it contributed to and its resolution. Read-only,
 * revenue.read. Claim payloads and delivery bodies are never returned.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    const paymentId = new URL(req.url).searchParams.get("payment_id")?.trim() ?? "";
    if (!PAYMENT_ID_RE.test(paymentId)) {
      return NextResponse.json({ error: "Enter a payment id (letters, digits, _ or -)." }, { status: 400 });
    }
    const sb = getServiceClient();
    const claimKeys = [paymentId, `refund:${paymentId}`, `dispute:${paymentId}`, `cancel:${paymentId}`, `recover:${paymentId}`];
    const [rows, resolutions, deliveriesRes, claimsRes, byLatestRes, byHistoryRes] = await Promise.all([
      loadLedgerRows(sb, paymentId),
      loadResolutions(sb, paymentId),
      sb.from("webhook_attempts").select("provider, result, error, received_at").eq("event_id", paymentId).order("received_at", { ascending: true }).limit(100),
      sb.from("processed_webhook_events").select("provider, event_id, processed_at").in("event_id", claimKeys).limit(20),
      sb.from("subscriptions").select("id, user_id, tier, status, payment_provider, started_at, expires_at").eq("provider_payment_id", paymentId).limit(20),
      sb.from("subscriptions").select("id, user_id, tier, status, payment_provider, started_at, expires_at").contains("granted_payment_ids", JSON.stringify([{ payment_id: paymentId }])).limit(20),
    ]);
    for (const r of [deliveriesRes, claimsRes, byLatestRes, byHistoryRes]) assertReadSucceeded(r);

    const ledger = buildLedger(rows, resolutions.rows);
    const payment = ledger.payments.find((p) => p.payment_id === paymentId) ?? null;
    const refund = ledger.refunds.find((r) => r.refund_id === paymentId) ?? null;
    const subs = new Map<string, Record<string, unknown>>();
    for (const s of [...(byLatestRes.data ?? []), ...(byHistoryRes.data ?? [])] as Array<Record<string, unknown>>) subs.set(String(s.id), s);

    return NextResponse.json({
      payment_id: paymentId,
      found: rows.length > 0 || subs.size > 0 || (deliveriesRes.data ?? []).length > 0,
      payment,
      refund,
      linkable_tier: payment && payment.provider === "whop" ? whopPlanToTier(payment.plan_id) : null,
      events: rows.map((r) => ({
        event: r.event,
        whop_event: typeof r.metadata?.whop_event === "string" ? String(r.metadata.whop_event).slice(0, 60) : null,
        reason: r.reason,
        amount_cents: r.amount_cents,
        currency: r.currency,
        user_id: r.user_id,
        matched: r.matched,
        source: typeof r.metadata?.source === "string" ? String(r.metadata.source).slice(0, 60) : null,
        created_at: r.created_at,
      })),
      deliveries: deliveriesRes.data ?? [],
      claims: claimsRes.data ?? [],
      subscriptions: [...subs.values()],
      resolution: resolutions.rows[0] ?? null,
      resolutions_available: resolutions.available,
    });
  },
  { route: "/api/stats/admin/payments/trace", rateLimit: { limit: 60, windowMs: 60_000 } }
);
