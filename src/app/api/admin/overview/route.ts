import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

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
 * Sprint §2.2 — 6 tiles are live-wired (revenue today, active subs,
 * new signups today, paywall hits, referrals awaiting action, PUYP
 * pending). The other 5 return skeleton numbers for the scaffold.
 */
export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);

    // 1. Revenue today (cents) + month-to-date (cents) + 7-day sparkline.
    //    One select across the last 7 days powers today + sparkline; MTD
    //    is a separate fetch since the month-window often exceeds 7 days.
    const [recent7dRes, mtdPaidRes] = await Promise.all([
      sb
        .from("subscriptions")
        .select("amount_cents, started_at")
        .eq("status", "active")
        .gte("started_at", sevenDaysAgo.toISOString()),
      sb
        .from("subscriptions")
        .select("amount_cents, started_at")
        .eq("status", "active")
        .gte("started_at", startOfMonth.toISOString()),
    ]);

    const revenueMtdCents = (mtdPaidRes.data || []).reduce(
      (sum, r) => sum + (Number(r.amount_cents) || 0),
      0
    );

    // Bucket the last-7-days revenue into per-day cents (oldest → newest).
    // series_7d[0] = 6 days ago, series_7d[6] = today.
    const series7d: number[] = new Array(7).fill(0);
    let revenueTodayCents = 0;
    const todayMs = startOfDay.getTime();
    for (const row of recent7dRes.data || []) {
      const startedAt = row.started_at ? new Date(row.started_at as string) : null;
      if (!startedAt || isNaN(startedAt.getTime())) continue;
      const amount = Number(row.amount_cents) || 0;
      const daysAgo = Math.floor((todayMs - startedAt.getTime()) / 86400_000);
      if (daysAgo >= 0 && daysAgo < 7) {
        series7d[6 - daysAgo] += amount;
      }
      if (startedAt.getTime() >= todayMs) {
        revenueTodayCents += amount;
      }
    }

    // 2. Active paid subscriptions (by tier).
    const { data: activeSubs } = await sb
      .from("subscriptions")
      .select("tier, status, expires_at")
      .eq("status", "active");
    const activeByTier: Record<string, number> = {};
    let activeTotal = 0;
    for (const row of activeSubs || []) {
      const tier = (row.tier as string) || "unknown";
      if (
        !row.expires_at ||
        new Date(row.expires_at as string).getTime() > now.getTime()
      ) {
        activeByTier[tier] = (activeByTier[tier] || 0) + 1;
        activeTotal += 1;
      }
    }

    // 3. New signups today.
    const { count: signupsToday } = await sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString());

    // 4. 150Q paywall hits today — from user_events. event_type literal
    //    is tentative; if the events aren't landed yet the count is 0.
    const { count: paywallHits } = await sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "paywall_hit")
      .gte("created_at", startOfDay.toISOString());

    // 5. Referrals awaiting action (qualified but not rewarded).
    const { count: referralsAwaitingAction } = await sb
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("status", "qualified");

    // 6. PUYP verifications pending.
    const { count: puypPending } = await sb
      .from("exam_attempts")
      .select("id", { count: "exact", head: true })
      .eq("result", "fail")
      .is("verified_at", null);

    // 7. Flagged questions (open).
    const { count: flaggedOpen } = await sb
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");

    // 8. Webhook failures (last 24h) — best-effort; processed_webhook_events
    //    currently has no status column, so return 0.
    const webhookFailures24h = 0;

    // 8b. Stuck pending subscriptions — pending NOWPayments rows older
    //     than 24h. Surfaces operational debt: every entry here is either
    //     a user who abandoned at the BTC checkout screen or a webhook
    //     that never delivered. Should be 0 in steady state. The post-
    //     PR-#7 audit (review-2026-04-25-A2) found 8; cancelling them is
    //     handled by `/api/admin/subscriptions/reconcile-pending`.
    const { count: stuckPending24h } = await sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("payment_provider", "nowpayments")
      .lt("created_at", twentyFourHoursAgo.toISOString());

    // 9. Free-to-paid conversion (rolling 7d) — signups vs active new subs.
    const [{ count: signups7d }, { count: newPaid7d }] = await Promise.all([
      sb
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo.toISOString()),
      sb
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .gte("started_at", sevenDaysAgo.toISOString()),
    ]);

    const conversion7d =
      signups7d && signups7d > 0 && newPaid7d != null
        ? newPaid7d / signups7d
        : null;

    // 10. Cron health — derived from cron_runs last-seen.
    const { data: cronRuns } = await sb
      .from("cron_runs")
      .select("cron_name, status, started_at, finished_at")
      .gte("started_at", twentyFourHoursAgo.toISOString())
      .order("started_at", { ascending: false })
      .limit(200);

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
    const [{ count: tgRegistered }, { count: tgConfirmed }] = await Promise.all([
      sb
        .from("users")
        .select("id", { count: "exact", head: true })
        .not("telegram_id", "is", null),
      sb
        .from("users")
        .select("id", { count: "exact", head: true })
        .not("telegram_chat_id_confirmed", "is", null),
    ]);

    // 10b. AI chat health — last 60 minutes of completed vs failed
    //      events. Tile shows {requests, completed, failed, avg_latency_ms}
    //      so drift surfaces before users complain (review-2026-04-26-A4).
    // NOTE (review-2026-04-26-A3): user_events column is `event_data`,
    // not `metadata`. PR #9 read the wrong field; 24h of "0/0" data
    // came from this mismatch (the writes also used `metadata` and
    // silently failed). Both halves fixed in the same commit.
    const oneHourAgoIso = new Date(now.getTime() - 60 * 60_000).toISOString();
    const [{ data: aiCompleted }, { count: aiFailedCountRaw }] = await Promise.all([
      sb
        .from("user_events")
        .select("event_data, created_at")
        .eq("event_type", "ai_chat_completed")
        .gte("created_at", oneHourAgoIso),
      sb
        .from("user_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "ai_chat_failed")
        .gte("created_at", oneHourAgoIso),
    ]);
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
    const { data: recentEvents } = await sb
      .from("user_events")
      .select("id, event_type, user_id, created_at")
      .gte("created_at", twentyFourHoursAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      generated_at: now.toISOString(),
      tiles: {
        revenue: {
          today_cents: revenueTodayCents,
          mtd_cents: revenueMtdCents,
          series_7d: series7d,
        },
        active_subs: {
          total: activeTotal,
          by_tier: activeByTier,
        },
        signups_today: signupsToday || 0,
        paywall_hits_today: paywallHits || 0,
        referrals_awaiting_action: referralsAwaitingAction || 0,
        puyp_pending: puypPending || 0,
        flagged_open: flaggedOpen || 0,
        webhook_failures_24h: webhookFailures24h,
        stuck_pending_24h: stuckPending24h || 0,
        conversion_7d: conversion7d,
        ai_chat_1h: {
          requests: aiCompletedCount + aiFailedCount,
          completed: aiCompletedCount,
          failed: aiFailedCount,
          avg_latency_ms: aiAvgLatencyMs,
        },
        telegram_activation: {
          registered: tgRegistered ?? 0,
          confirmed: tgConfirmed ?? 0,
        },
        crons: cronMap,
        recent_events: recentEvents || [],
      },
    });
  },
  { route: "/api/admin/overview", rateLimit: { limit: 120, windowMs: 60_000 } }
);
