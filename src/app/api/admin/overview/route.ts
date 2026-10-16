import { checkedRead } from "@/lib/admin/read-result";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { accountsById, loadAccounts, loadLedger, loadSubscriptions, loadWhopDeliveries } from "@/lib/admin/moneyMetrics";
import {
  PAYING_BASIS,
  SEAT_HOLDERS_BASIS,
  classifyPayers,
  computeMoneyIn,
  computePaymentHealth,
  firstPaidAtByUser,
  isActiveUnexpired,
  isStaffOrTestAccount,
  rowPaymentIds,
  viennaDay,
} from "@/lib/admin/money-rules";
import { computeTodayMoneyNeeds, viennaStartOfDay } from "@/lib/admin/today-rules";
import { classifySubscriptionCadence } from "@/lib/billing-cadence";
import { loadCronHealth } from "@/lib/admin/cron-health";
import { readMentorConfig } from "@/lib/mentor/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/overview: the Today page (a18, ADM-11 A).
 *
 * One snapshot, read on load and polled every 60 s by the page (admin
 * realtime is off, ADM-20 A). Each block is read on its own: a block that
 * fails comes back null and is named in `failed`, so the page shows
 * "Could not load, Retry" for that block instead of a zero (ADM-Q07),
 * while the other blocks still render.
 *
 * Money uses the shared definitions in src/lib/admin/money-rules.ts (cash in
 * by payment date, paying learners with trials apart, the Payments
 * diagnosis); the Needs-you money rows come from src/lib/admin/today-rules.ts.
 * Days are Vienna days. Counts only: no learner identity leaves this route.
 */
export const GET = adminRouteShell(
  async ({ actor }) => {
    const permissionSnapshot = await loadAdminPermissionSnapshot(actor.userId);
    const canReadRevenue = canAccessAdminPermission(permissionSnapshot, "revenue.read");
    const canReadUsers = canAccessAdminPermission(permissionSnapshot, "users.read");
    const canReadSystem = canAccessAdminPermission(permissionSnapshot, "system.read");
    const canReadFeedback = canAccessAdminPermission(permissionSnapshot, "feedback.read");
    const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
    const now = new Date();
    const startOfDay = viennaStartOfDay(now, (d) => viennaDay(d));
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);
    const failed: string[] = [];

    /** Run one block; a failure becomes null plus its name in `failed`. */
    async function block<T>(name: string, allowed: boolean, run: () => Promise<T>): Promise<T | null> {
      if (!allowed) return null;
      try {
        return await run();
      } catch {
        failed.push(name);
        return null;
      }
    }
    const headCount = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count } = await checkedRead(q);
      if (typeof count !== "number") throw new Error("count unavailable");
      return count;
    };

    const [money, signups, freeLimitHits, crons, telegram, aiChat, activity, feedbackNew] = await Promise.all([
      // Money in, paying learners, payment health and the Needs-you money rows (ADM-01 A, UX-ADM-04, ADM-11 A).
      block("money", canReadRevenue, async () => {
        const [{ ledger }, accounts, subs, deliveries] = await Promise.all([
          loadLedger(sb),
          loadAccounts(sb),
          loadSubscriptions(sb, thirtyDaysAgo.toISOString()),
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
        let newPayers7d = 0;
        for (const [userId, at] of firstPaidAtByUser(ledger)) {
          if (isStaffOrTestAccount(users.get(userId))) continue;
          if (Date.parse(at) >= sevenDaysAgo.getTime()) newPayers7d += 1;
        }
        const realSince = (since: Date) => accounts.filter((a) =>
          !isStaffOrTestAccount(a) && a.created_at && Date.parse(a.created_at) >= since.getTime()).length;
        const moneyIn = computeMoneyIn(ledger, now);
        const health = computePaymentHealth(deliveries, ledger, now);
        return {
          revenue: {
            today_cents: moneyIn.today.cash_cents,
            mtd_cents: moneyIn.month_to_date.cash_cents,
            series_7d: moneyIn.series_7d,
            today: moneyIn.today,
            month_to_date: moneyIn.month_to_date,
            other_currencies: moneyIn.other_currencies,
            basis: moneyIn.basis,
          },
          active_subs: {
            total: payers.paying.size,
            in_trial: payers.inTrial.size,
            // a-seed-seats: beside the paying count, never in it.
            seed_seats: payers.seatHolders.size,
            by_cadence: byCadence,
            basis: `${PAYING_BASIS} ${SEAT_HOLDERS_BASIS}`,
          },
          new_payers_7d: {
            new_payers: newPayers7d,
            signups: realSince(sevenDaysAgo),
            ratio: realSince(sevenDaysAgo) > 0 ? newPayers7d / realSince(sevenDaysAgo) : null,
          },
          real_signups: { d7: realSince(sevenDaysAgo), d30: realSince(thirtyDaysAgo) },
          payment_health: {
            level: health.level,
            diagnosis: health.diagnosis,
            failures_24h: health.failures_24h,
            probes_24h: health.probes_24h,
            unresolved_total: health.unresolved_total,
          },
          needs: computeTodayMoneyNeeds(ledger, subs, payers.paying, now, paymentsById),
        };
      }),

      // New accounts since Vienna midnight (all accounts; the money strip uses real learners only).
      block("signups", true, () => headCount(sb.from("users").select("id", { count: "exact", head: true }).gte("created_at", startOfDay.toISOString()))),

      // Learners who reached the free limit today: the server-side paywall_hit the quota wall writes since a12 (src/lib/free-access.ts).
      block("free_limit", canReadUsers, () => headCount(sb.from("user_events").select("id", { count: "exact", head: true }).eq("event_type", "paywall_hit").gte("created_at", startOfDay.toISOString()))),

      // Each scheduled job judged against its schedule (a19, ADM-12 B, UX-ADM-09).
      block("crons", canReadSystem, async () => {
        const health = await loadCronHealth(sb, now, { mentorEnabled: readMentorConfig().enabled, windowHours: 1, runLimit: 50 });
        return health.jobs.map((j) => ({ key: j.key, label: j.label, state: j.state, tone: j.tone, text: j.text }));
      }),

      // Telegram bot activation (review-2026-04-26-B2).
      block("telegram", canReadSystem, async () => {
        const [registered, confirmed] = await Promise.all([
          headCount(sb.from("users").select("id", { count: "exact", head: true }).not("telegram_id", "is", null)),
          headCount(sb.from("users").select("id", { count: "exact", head: true }).not("telegram_chat_id_confirmed", "is", null)),
        ]);
        return { registered, confirmed };
      }),

      // AI chat health, last 60 minutes (user_events.event_data, review-2026-04-26-A3/A4).
      block("ai_chat", canReadSystem, async () => {
        const [{ data: completed }, failedCount] = await Promise.all([
          checkedRead(sb.from("user_events").select("event_data").eq("event_type", "ai_chat_completed").gte("created_at", oneHourAgo.toISOString()).limit(1000)),
          headCount(sb.from("user_events").select("id", { count: "exact", head: true }).eq("event_type", "ai_chat_failed").gte("created_at", oneHourAgo.toISOString())),
        ]);
        const lats = (completed ?? [])
          .map((e) => ((e.event_data as Record<string, unknown> | null)?.duration_ms as number | undefined) ?? null)
          .filter((n): n is number => typeof n === "number");
        return {
          requests: (completed?.length ?? 0) + failedCount,
          completed: completed?.length ?? 0,
          failed: failedCount,
          avg_latency_ms: lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null,
        };
      }),

      // Learner events in the last 24 hours (count only).
      block("activity", canReadUsers, () => headCount(sb.from("user_events").select("id", { count: "exact", head: true }).gte("created_at", twentyFourHoursAgo.toISOString()))),

      // Feedback nobody has opened yet (status new). Was "flagged_open" (UX-ADM-06).
      block("feedback_new", canReadFeedback, () => headCount(sb.from("user_feedback").select("id", { count: "exact", head: true }).eq("status", "new"))),
    ]);

    return NextResponse.json({
      generated_at: now.toISOString(),
      day: viennaDay(now),
      tiles: {
        revenue: money?.revenue ?? null,
        active_subs: money?.active_subs ?? null,
        new_payers_7d: money?.new_payers_7d ?? null,
        real_signups: money?.real_signups ?? null,
        payment_health: money?.payment_health ?? null,
        signups_today: signups,
        free_limit_hits_today: freeLimitHits,
        ai_chat_1h: aiChat,
        telegram_activation: telegram,
        crons,
        recent_events_aggregate: activity == null ? null : { total_last_24h: activity },
        feedback_new: feedbackNew,
      },
      needs: money?.needs ?? null,
      failed,
      restricted_sections: [
        ...(!canReadRevenue ? ["revenue"] : []),
        ...(!canReadUsers ? ["recent_events"] : []),
        ...(!canReadSystem ? ["system"] : []),
      ],
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
  { route: "/api/admin/overview", rateLimit: { limit: 120, windowMs: 60_000 } }
);
