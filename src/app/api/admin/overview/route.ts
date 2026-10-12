import { checkedRead } from "@/lib/admin/read-result";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { accountsById, loadAccounts, loadLedger, loadSubscriptions, loadWhopDeliveries } from "@/lib/admin/moneyMetrics";
import {
  PAYING_BASIS,
  classifyPayers,
  computeMoneyIn,
  computePaymentHealth,
  firstPaidAtByUser,
  isActiveUnexpired,
  isStaffOrTestAccount,
  rowPaymentIds,
} from "@/lib/admin/money-rules";
import { classifySubscriptionCadence } from "@/lib/billing-cadence";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/overview — the snapshot behind the 11 live tiles on
 * /admin/overview.
 *
 * Returns one flat JSON blob that hydrates every tile's initial value.
 * Each tile then subscribes to postgres_changes via useAdminRealtime()
 * and bumps its counter locally. That keeps the Realtime channels
 * narrow (one per table) and avoids the N round-trips per event that
 * a "re-query on every change" pattern would cost.
 *
 * Money tiles (a14, 2026-10-12) read the shared definitions in
 * src/lib/admin/money-rules.ts: cash in by payment date, paying learners
 * with trials apart, and the same payment health the Payments page shows.
 */
export const GET = adminRouteShell(
  async ({ actor }) => {
    const permissionSnapshot = await loadAdminPermissionSnapshot(actor.userId);
    const canReadRevenue = canAccessAdminPermission(permissionSnapshot, "revenue.read");
    const canReadUsers = canAccessAdminPermission(permissionSnapshot, "users.read");
    const canReadSystem = canAccessAdminPermission(permissionSnapshot, "system.read");
    const sb = getServiceClient();
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);

    // 1-2. Money in, paying learners and payment health (ADM-01 A, UX-ADM-04).
    //      One shared definition (src/lib/admin/money-rules.ts): cash by
    //      payment date, gross, refunds on their own day, Vienna days; paying
    //      = distinct real learners with a positive payment, trials apart.
    const money = canReadRevenue ? await (async () => {
      const [{ ledger }, accounts, subs, deliveries] = await Promise.all([
        loadLedger(sb),
        loadAccounts(sb),
        loadSubscriptions(sb, sevenDaysAgo.toISOString()),
        loadWhopDeliveries(sb, sevenDaysAgo.toISOString()),
      ]);
      const users = accountsById(accounts);
      const paymentsById = new Map(ledger.payments.map((p) => [p.payment_id, p]));
      const payers = classifyPayers(subs, users, now, paymentsById);
      const byCadence = { renews: 0, one_time: 0, unknown: 0 };
      for (const userId of payers.paying) {
        const cadences = subs
          .filter((s) => s.user_id === userId && isActiveUnexpired(s, now))
          .map((s) => classifySubscriptionCadence({
            tier: s.tier ?? "",
            payment_provider: s.payment_provider,
            plan_id: rowPaymentIds(s).map((id) => paymentsById.get(id)?.plan_id).find(Boolean) ?? null,
          }));
        if (cadences.includes("auto_renews")) byCadence.renews += 1;
        else if (cadences.includes("unknown")) byCadence.unknown += 1;
        else byCadence.one_time += 1;
      }
      const realSignups7d = accounts.filter((a) =>
        !isStaffOrTestAccount(a) && a.created_at && Date.parse(a.created_at) >= sevenDaysAgo.getTime()).length;
      let newPayers7d = 0;
      for (const [userId, at] of firstPaidAtByUser(ledger)) {
        if (isStaffOrTestAccount(users.get(userId))) continue;
        if (Date.parse(at) >= sevenDaysAgo.getTime()) newPayers7d += 1;
      }
      return {
        moneyIn: computeMoneyIn(ledger, now),
        payers,
        byCadence,
        realSignups7d,
        newPayers7d,
        health: computePaymentHealth(deliveries, ledger, now),
      };
    })() : null;

    // 3. New signups today.
    const { count: signupsToday } = await checkedRead(sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString()));

    // 4. 150Q paywall hits today — from user_events. event_type literal
    //    is tentative; if the events aren't landed yet the count is 0.
    const { count: paywallHits } = await checkedRead(sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "paywall_hit")
      .gte("created_at", startOfDay.toISOString()));

    // 5. Referrals awaiting action (qualified but not rewarded).
    const { count: referralsAwaitingAction } = canReadRevenue ? await checkedRead(sb
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("status", "qualified")) : { count: null };

    // 6. PUYP verifications pending.
    const { count: puypPending } = canReadRevenue ? await checkedRead(sb
      .from("exam_attempts")
      .select("id", { count: "exact", head: true })
      .eq("result", "fail")
      .is("verified_at", null)) : { count: null };

    // 7. Flagged questions (open).
    const { count: flaggedOpen } = await checkedRead(sb
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"));

    // 8b. Stuck pending subscriptions — pending checkout rows older
    //     than 24h (in practice the Apr to Jun NOWPayments backlog). Surfaces operational debt: every entry here is either
    //     a user who abandoned at the BTC checkout screen or a webhook
    //     that never delivered. Should be 0 in steady state. The post-
    //     PR-#7 audit (review-2026-04-25-A2) found 8; cancelling them is
    //     handled by `/api/admin/subscriptions/reconcile-pending`.
    const { count: stuckPending24h } = canReadRevenue ? await checkedRead(sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", twentyFourHoursAgo.toISOString())) : { count: null };

    // 10. Cron health — derived from cron_runs last-seen.
    const { data: cronRuns } = canReadSystem ? await checkedRead(sb
      .from("cron_runs")
      .select("cron_name, status, started_at, finished_at")
      .gte("started_at", twentyFourHoursAgo.toISOString())
      .order("started_at", { ascending: false })
      .limit(200)) : { data: null };

    const cronMap: Record<
      string,
      { lastStatus: string; lastStartedAt: string | null }
    > = {};
    for (const r of cronRuns || []) {
      const n = r.cron_name as string;
      if (!cronMap[n]) {
        cronMap[n] = {
          lastStatus: (r.status as string) || "unknown",
          lastStartedAt: (r.started_at as string) || null,
        };
      }
    }

    // 10a. Telegram bot activation rate — how many of the users who
    //      registered via the Telegram Login Widget have actually DM'd
    //      the bot. Lower-bound for who we can push messages to. Should
    //      trend up after the /dashboard activation card ships
    //      (review-2026-04-26-B2).
    const [{ count: tgRegistered }, { count: tgConfirmed }] = canReadSystem ? await Promise.all([
      checkedRead(sb
        .from("users")
        .select("id", { count: "exact", head: true })
        .not("telegram_id", "is", null)),
      checkedRead(sb
        .from("users")
        .select("id", { count: "exact", head: true })
        .not("telegram_chat_id_confirmed", "is", null)),
    ]) : [{ count: null }, { count: null }];

    // 10b. AI chat health — last 60 minutes of completed vs failed
    //      events. Tile shows {requests, completed, failed, avg_latency_ms}
    //      so drift surfaces before users complain (review-2026-04-26-A4).
    // NOTE (review-2026-04-26-A3): user_events column is `event_data`,
    // not `metadata`. PR #9 read the wrong field; 24h of "0/0" data
    // came from this mismatch (the writes also used `metadata` and
    // silently failed). Both halves fixed in the same commit.
    const oneHourAgoIso = new Date(now.getTime() - 60 * 60_000).toISOString();
    const [{ data: aiCompleted }, { count: aiFailedCountRaw }] = canReadSystem ? await Promise.all([
      checkedRead(sb
        .from("user_events")
        .select("event_data, created_at")
        .eq("event_type", "ai_chat_completed")
        .gte("created_at", oneHourAgoIso)),
      checkedRead(sb
        .from("user_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "ai_chat_failed")
        .gte("created_at", oneHourAgoIso)),
    ]) : [{ data: null }, { count: null }];
    const aiCompletedCount = aiCompleted?.length ?? 0;
    const aiFailedCount = aiFailedCountRaw ?? 0;
    const aiAvgLatencyMs = (() => {
      if (!aiCompleted || aiCompleted.length === 0) return null;
      const lats = aiCompleted
        .map(
          (e) =>
            ((e.event_data as Record<string, unknown> | null)?.duration_ms as
              | number
              | undefined) ?? null,
        )
        .filter((n): n is number => typeof n === "number");
      if (lats.length === 0) return null;
      return Math.round(lats.reduce((a, b) => a + b, 0) / lats.length);
    })();

    // 11. Live activity feed — recent significant events.
    const { count: recentEvents } = canReadUsers ? await checkedRead(sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", twentyFourHoursAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(20)) : { count: null };
    const { count: recentEventCount } = !canReadUsers ? await checkedRead(sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", twentyFourHoursAgo.toISOString())) : { count: null };

    return NextResponse.json({
      generated_at: now.toISOString(),
      tiles: {
        revenue: money ? {
          today_cents: money.moneyIn.today.cash_cents,
          mtd_cents: money.moneyIn.month_to_date.cash_cents,
          series_7d: money.moneyIn.series_7d,
          today: money.moneyIn.today,
          month_to_date: money.moneyIn.month_to_date,
          other_currencies: money.moneyIn.other_currencies,
          basis: money.moneyIn.basis,
        } : null,
        active_subs: money ? {
          total: money.payers.paying.size,
          in_trial: money.payers.inTrial.size,
          by_cadence: money.byCadence,
          basis: PAYING_BASIS,
        } : null,
        signups_today: signupsToday || 0,
        paywall_hits_today: paywallHits || 0,
        referrals_awaiting_action: canReadRevenue ? referralsAwaitingAction || 0 : null,
        puyp_pending: canReadRevenue ? puypPending || 0 : null,
        flagged_open: flaggedOpen || 0,
        payment_health: money ? {
          level: money.health.level,
          diagnosis: money.health.diagnosis,
          failures_24h: money.health.failures_24h,
          probes_24h: money.health.probes_24h,
          unresolved_total: money.health.unresolved_total,
        } : null,
        stuck_pending_24h: canReadRevenue ? stuckPending24h || 0 : null,
        new_payers_7d: money ? {
          new_payers: money.newPayers7d,
          signups: money.realSignups7d,
          ratio: money.realSignups7d > 0 ? money.newPayers7d / money.realSignups7d : null,
        } : null,
        ai_chat_1h: canReadSystem ? {
          requests: aiCompletedCount + aiFailedCount,
          completed: aiCompletedCount,
          failed: aiFailedCount,
          avg_latency_ms: aiAvgLatencyMs,
        } : null,
        telegram_activation: canReadSystem ? {
          registered: tgRegistered ?? 0,
          confirmed: tgConfirmed ?? 0,
        } : null,
        crons: canReadSystem ? cronMap : null,
        recent_events: null,
        recent_events_aggregate: { total_last_24h: (canReadUsers ? recentEvents : recentEventCount) ?? 0 },
      },
      restricted_sections: [
        ...(!canReadRevenue ? ["revenue"] : []),
        ...(!canReadUsers ? ["recent_events"] : []),
        ...(!canReadSystem ? ["system"] : []),
      ],
    });
  },
  { route: "/api/admin/overview", rateLimit: { limit: 120, windowMs: 60_000 } }
);
