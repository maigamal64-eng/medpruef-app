import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { safeEqual } from "@/lib/security/timing-safe";
import { classifySubscriptionCadence } from "@/lib/billing-cadence";
import { warnWhopKeyUnauthorized } from "@/lib/renewal-state";
import {
  SIGNAL_CLAIM_PROVIDER,
  dailyReadDecision,
  readSignalAlertConfig,
  readWhopMembershipCancelState,
  renewalStateKey,
  rotateForDay,
  whopCancelReadEnabled,
} from "@/lib/whop-signal";
import { deliverWhopSignalAlert, recordWhopSignal, SIGNAL_STALE_CLAIM_MS } from "@/lib/whop-signal-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** At most this many memberships are read per run, one at a time. */
const MAX_READS = 40;
/** Stop starting reads after this, well inside maxDuration (40 reads at the 4 s timeout would not fit). */
const TIME_BUDGET_MS = 40_000;

/**
 * GET /api/cron/whop-cancel-read (a-whop-cancel-signal), daily 07:40 UTC.
 *
 * Fallback for a hook that cannot subscribe to the renewal event: reads each
 * live, pinned (mem_) Whop membership with GET /memberships/{id} (read only,
 * pinned API version, 4 s timeout) and reports a payer who turned renewal off
 * once per period, and "back on" only after an "off" was recorded. Reports go
 * through the same log row and secretary-bot alert as the webhook, and share
 * its renewal state keys, so the two never report one change twice.
 *
 * Never writes to Whop, subscriptions or users. Default OFF:
 * WHOP_CANCEL_READ_ENABLED must be 'true' (off = {enabled:false}, no read).
 * Until the production key can read memberships it answers key_unauthorized.
 * Auth: Bearer CRON_SECRET, constant-time compare, fail closed.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!whopCancelReadEnabled()) return NextResponse.json({ enabled: false });
  if (!process.env.WHOP_API_KEY && !process.env.WHOP_APP_API_KEY) {
    return NextResponse.json({ enabled: true, ok: false, reason: "no_whop_key" });
  }

  const sb = getServiceClient();
  try {
    const { data, error } = await sb
      .from("subscriptions")
      .select("whop_membership_id, tier, payment_provider")
      .eq("status", "active")
      .eq("payment_provider", "whop")
      .gt("expires_at", new Date().toISOString())
      .like("whop_membership_id", "mem_%")
      .order("whop_membership_id", { ascending: true })
      .limit(500);
    if (error) throw error;
    const byMembership = new Map<string, string>();
    for (const row of (data ?? []) as Array<{ whop_membership_id: string; tier: string }>) {
      if (!byMembership.has(row.whop_membership_id)) byMembership.set(row.whop_membership_id, String(row.tier));
    }

    const config = readSignalAlertConfig();
    const started = Date.now();
    const order = rotateForDay([...byMembership.entries()].sort(([a], [b]) => a.localeCompare(b)), MAX_READS, started);
    const counts = { memberships: byMembership.size, read: 0, read_failed: 0, one_time: 0, reported: 0, alerts_sent: 0, skipped_cap: 0 };
    for (const [membershipId, tier] of order) {
      if (counts.read + counts.read_failed >= MAX_READS || Date.now() - started > TIME_BUDGET_MS) { counts.skipped_cap += 1; continue; }
      const read = await readWhopMembershipCancelState(membershipId);
      if (read.status === 401 || read.status === 403) {
        warnWhopKeyUnauthorized(read.status, "GET /api/v1/memberships/{id} (whop-cancel-read)");
        return NextResponse.json({ enabled: true, ok: false, reason: "key_unauthorized", status: read.status, ...counts });
      }
      if (!read.signal) { counts.read_failed += 1; continue; }
      counts.read += 1;
      const signal = read.signal;
      if (classifySubscriptionCadence({ tier, payment_provider: "whop", plan_id: signal.planId }) === "one_time") { counts.one_time += 1; continue; }
      if (signal.cancelAtPeriodEnd === null) continue;

      const keys = [true, false].map((flag) => renewalStateKey(membershipId, flag, signal.periodEnd));
      const { data: existing, error: keyError } = await sb
        .from("processed_webhook_events")
        .select("event_id, processed_at, payload")
        .eq("provider", SIGNAL_CLAIM_PROVIDER)
        .in("event_id", keys);
      if (keyError) throw keyError;
      // A key a killed run left before its log row (logged:false, past the stale
      // window) does not count, so recordWhopSignal can take it over.
      const have = new Set(((existing ?? []) as Array<{ event_id: string; processed_at: string | null; payload: Record<string, unknown> | null }>)
        .filter((r) => r.payload?.logged !== false || !r.processed_at || Date.now() - Date.parse(r.processed_at) < SIGNAL_STALE_CLAIM_MS)
        .map((r) => r.event_id));
      const decision = dailyReadDecision(signal, (k) => have.has(k));
      if (!decision.report || !decision.key) continue;

      const logged = await recordWhopSignal(sb, signal, { claimKey: decision.key, source: "daily_read", webhookId: null });
      if (logged.status !== "logged") continue;
      counts.reported += 1;
      if (config.enabled) {
        const outcome = await deliverWhopSignalAlert(sb, signal, logged, { claimKey: decision.key, source: "daily_read", config });
        if (outcome === "sent") counts.alerts_sent += 1;
      }
    }
    return NextResponse.json({ enabled: true, ok: true, ...counts });
  } catch (err) {
    captureServerError(err, { route: "/api/cron/whop-cancel-read" });
    return NextResponse.json({ enabled: true, ok: false, reason: "read_failed" }, { status: 500 });
  }
}
