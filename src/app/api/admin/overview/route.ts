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

    // 1. Revenue today (cents) + month-to-date (cents).
    const [todayPaid, mtdPaid] = await Promise.all([
      sb
        .from("subscriptions")
        .select("amount_cents, started_at")
        .eq("status", "active")
        .gte("started_at", startOfDay.toISOString()),
      sb
        .from("subscriptions")
        .select("amount_cents, started_at")
        .eq("status", "active")
        .gte("started_at", startOfMonth.toISOString()),
    ]);

    const revenueTodayCents =
      (todayPaid.data || []).reduce(
        (sum, r) => sum + (Number(r.amount_cents) || 0),
        0
      );
    const revenueMtdCents =
      (mtdPaid.data || []).reduce(
        (sum, r) => sum + (Number(r.amount_cents) || 0),
        0
      );

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
        conversion_7d: conversion7d,
        crons: cronMap,
        recent_events: recentEvents || [],
      },
    });
  },
  { route: "/api/admin/overview", rateLimit: { limit: 120, windowMs: 60_000 } }
);
