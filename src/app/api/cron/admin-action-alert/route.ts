import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { checkedRead } from "@/lib/admin/read-result";
import { loadLedger, loadWhopDeliveries } from "@/lib/admin/moneyMetrics";
import { ALERT_CLAIM_PROVIDER, MAX_ITEMS_PER_MESSAGE, buildAlertItems, formatAlertMessage, readAlertConfig, type AlertItem } from "@/lib/admin/action-alerts";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Items whose key has not been claimed yet (read in chunks, fails closed). */
async function unclaimed(sb: SupabaseClient, items: AlertItem[]): Promise<AlertItem[]> {
  const claimed = new Set<string>();
  for (let i = 0; i < items.length; i += 200) {
    const keys = items.slice(i, i + 200).map((x) => x.key);
    const { data } = await checkedRead(sb.from("processed_webhook_events").select("event_id").eq("provider", ALERT_CLAIM_PROVIDER).in("event_id", keys));
    for (const row of data ?? []) claimed.add(row.event_id as string);
  }
  return items.filter((x) => !claimed.has(x.key));
}
import { repeatCounts } from "@/lib/reports/report-metrics";
import { readPendingReports, readReportQuestionIds } from "@/lib/reports/report-reads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
      readPendingReports(sb),
    ]);
    const pending = pendingRes;
    const qids = [...new Set(pending.map((p) => p.question_id).filter((q): q is number => typeof q === "number"))];
    const counts = repeatCounts(qids.length ? await readReportQuestionIds(sb, qids) : []);
    const repeatReports = pending.flatMap((p) => (typeof p.question_id === "number" ? [{ report_id: p.id, question_id: p.question_id, count: counts.get(p.question_id) ?? 0 }] : []));

    const items = buildAlertItems({
      payments: ledger.payments,
      refunds: ledger.refunds,
      deliveries,
      puyp: (puypRes.data ?? []) as Array<{ id: string | number; created_at: string }>,
      repeatReports,
    }, now);
    if (items.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    // Claim: only keys inserted now are new. Only the items one message can list are claimed;
    // the rest stay unclaimed and go out on the next run.
    const candidates = await unclaimed(sb, items);
    if (candidates.length === 0) return NextResponse.json({ ok: true, sent: 0, already_sent: items.length });
    const batch = candidates.slice(0, MAX_ITEMS_PER_MESSAGE);
    const { data: claimed, error: claimError } = await sb.from("processed_webhook_events")
      .upsert(batch.map((i) => ({ provider: ALERT_CLAIM_PROVIDER, event_id: i.key, payload: { kind: i.kind } })), { onConflict: "provider,event_id", ignoreDuplicates: true })
      .select("event_id");
    if (claimError) throw claimError;
    const fresh = new Set((claimed ?? []).map((c) => c.event_id as string));
    const toSend = batch.filter((i) => fresh.has(i.key));
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
      const { error: releaseError } = await sb.from("processed_webhook_events").delete().eq("provider", ALERT_CLAIM_PROVIDER).in("event_id", toSend.map((i) => i.key));
      captureServerError(new Error(releaseError ? "admin action alert send failed and its claims could not be released" : "admin action alert send failed"), { route: "/api/cron/admin-action-alert", keys: toSend.length });
      return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sent: toSend.length });
  } catch (err) {
    captureServerError(err, { route: "/api/cron/admin-action-alert" });
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 500 });
  }
}
