import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { checkedRead } from "@/lib/admin/read-result";
import { loadLedger, loadWhopDeliveries } from "@/lib/admin/moneyMetrics";
import { ALERT_CLAIM_PROVIDER, buildAlertItems, formatAlertMessage, readAlertConfig } from "@/lib/admin/action-alerts";
import { repeatCounts } from "@/lib/reports/report-metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/admin-action-alert (a19, ADM-03 A, TR-14). Hourly.
 *
 * Pushes one internal Telegram message (default [name] bot, ids only) when
 * something needs [name]; silent otherwise. OFF unless
 * ADMIN_ACTION_ALERT_ENABLED='true' and TELEGRAM_OPS_FORWARD_TOKEN is set:
 * while off it computes nothing beyond its heartbeat and sends nothing.
 *
 * Each item key is claimed in processed_webhook_events (provider
 * 'admin_alert') before the send; only newly claimed keys are sent, and a
 * failed send releases its claims so the next run retries.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), got = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServiceClient();
  const now = new Date();
  // Heartbeat first, so /admin/crons can tell "did it fire" (ADM-12 B).
  try {
    await sb.from("user_events").insert({ user_id: "cron", event_type: "cron_admin_action_alert_heartbeat", event_data: { at: now.toISOString() } });
  } catch { /* observability only */ }

  const config = readAlertConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, skipped: "disabled" });
  if (!config.token) return NextResponse.json({ ok: true, skipped: "no_destination" });

  try {
    const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const [{ ledger }, deliveries, puypRes, pendingRes] = await Promise.all([
      loadLedger(sb),
      loadWhopDeliveries(sb, new Date(now.getTime() - 48 * 3_600_000).toISOString()),
      checkedRead(sb.from("exam_attempts").select("id, created_at").eq("result", "fail").is("verified_at", null).gte("created_at", since7d).limit(200)),
      checkedRead(sb.from("question_suggestions").select("id, question_id").eq("status", "pending").limit(1000)),
    ]);
    const pending = (pendingRes.data ?? []) as Array<{ id: number; question_id: number | null }>;
    const qids = [...new Set(pending.map((p) => p.question_id).filter((q): q is number => typeof q === "number"))];
    const allRes = qids.length ? await checkedRead(sb.from("question_suggestions").select("question_id").in("question_id", qids).limit(10_000)) : { data: [] };
    const counts = repeatCounts((allRes.data ?? []) as Array<{ question_id: number | null }>);
    const repeatReports = pending.flatMap((p) => (typeof p.question_id === "number" ? [{ report_id: p.id, question_id: p.question_id, count: counts.get(p.question_id) ?? 0 }] : []));

    const items = buildAlertItems({
      payments: ledger.payments,
      refunds: ledger.refunds,
      deliveries,
      puyp: (puypRes.data ?? []) as Array<{ id: string | number; created_at: string }>,
      repeatReports,
    }, now);
    if (items.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    // Claim: only keys inserted now are new.
    const { data: claimed, error: claimError } = await sb.from("processed_webhook_events")
      .upsert(items.map((i) => ({ provider: ALERT_CLAIM_PROVIDER, event_id: i.key, payload: { kind: i.kind } })), { onConflict: "provider,event_id", ignoreDuplicates: true })
      .select("event_id");
    if (claimError) throw claimError;
    const fresh = new Set((claimed ?? []).map((c) => c.event_id as string));
    const toSend = items.filter((i) => fresh.has(i.key));
    if (toSend.length === 0) return NextResponse.json({ ok: true, sent: 0, already_sent: items.length });

    let sent = false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.chatId, text: formatAlertMessage(toSend, config.origin), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8_000),
      });
      sent = res.ok;
    } catch {
      sent = false;
    }
    if (!sent) {
      // Release the claims so the next hourly run retries these items.
      await sb.from("processed_webhook_events").delete().eq("provider", ALERT_CLAIM_PROVIDER).in("event_id", toSend.map((i) => i.key));
      captureServerError(new Error("admin action alert send failed"), { route: "/api/cron/admin-action-alert" });
      return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sent: toSend.length });
  } catch (err) {
    captureServerError(err, { route: "/api/cron/admin-action-alert" });
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 500 });
  }
}
