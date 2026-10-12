import { assertReadSucceeded } from "@/lib/admin/read-result";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { accountsById, loadAccounts, loadLedger, loadSubscriptions, type SubscriptionRow } from "@/lib/admin/moneyMetrics";
import {
  PAYING_BASIS,
  REAL_RAILS,
  classifyPayers,
  computeMoneyIn,
  countsAsMoneyIn,
  daysLeft,
  durationLabel,
  isActiveUnexpired,
  isStaffOrTestAccount,
  rowHasPositivePayment,
  rowPaymentIds,
} from "@/lib/admin/money-rules";
import { classifySubscriptionCadence, type BillingCadence } from "@/lib/billing-cadence";
import { tierDurationMonths } from "@/lib/whop";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

interface RosterRow {
  user_id: string;
  /** Name and email, only for viewers who also hold users.read. */
  label: string | null;
  status: "paying" | "trial" | "ended";
  plan: string;
  tier: string | null;
  cadence: BillingCadence;
  /** Gross EUR of every counted, granted payment by this learner. */
  paid_to_date_cents: number;
  access_ends: string | null;
  days_left: number | null;
}

/**
 * GET /api/admin/subscriptions — the paid roster behind /admin/subscriptions
 * (ADM-10 option A, a14 2026-10-12). One row per learner, not per
 * subscription row: who pays, whether it renews by itself, paid to date
 * (gross), access end (latest end across active rows) and days left. Plus
 * learners in a trial, learners whose access ended in the last 30 days and
 * pending checkout rows (UX-ADM-08: ?status=pending lands here).
 *
 * Paying uses the shared definition in src/lib/admin/money-rules.ts. Cadence
 * comes from classifySubscriptionCadence (plan id of the row's payments).
 * Whop cancel-at-period-end is not stored, so a renewing member who
 * cancelled at Whop still reads as renewing until the row ends.
 */
export const GET = adminRouteShell(
  async ({ actor }) => {
    const snapshot = await loadAdminPermissionSnapshot(actor.userId);
    const canReadUsers = canAccessAdminPermission(snapshot, "users.read");
    const sb = getServiceClient();
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();

    const [{ ledger }, accounts, subs, pendingRes] = await Promise.all([
      loadLedger(sb),
      loadAccounts(sb),
      loadSubscriptions(sb, since30),
      sb
        .from("subscriptions")
        .select("id, user_id, tier, payment_provider, amount_cents, currency, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(200),
    ]);
    assertReadSucceeded(pendingRes);

    const users = accountsById(accounts);
    const paymentsById = new Map(ledger.payments.map((p) => [p.payment_id, p]));
    const payers = classifyPayers(subs, users, now, paymentsById);

    const paidByUser = new Map<string, number>();
    for (const p of ledger.payments) {
      if (!p.user_id || !p.granted || !countsAsMoneyIn(p) || p.currency !== "EUR") continue;
      paidByUser.set(p.user_id, (paidByUser.get(p.user_id) ?? 0) + (p.gross_cents ?? 0));
    }

    const label = (id: string): string | null => {
      if (!canReadUsers) return null;
      const u = users.get(id);
      if (!u) return null;
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      return name ? `${name}${u.email ? ` (${u.email})` : ""}` : u.email ?? null;
    };
    const planIdOf = (s: SubscriptionRow) =>
      rowPaymentIds(s).map((id) => paymentsById.get(id)?.plan_id).find((v): v is string => Boolean(v)) ?? null;
    const cadenceOf = (s: SubscriptionRow): BillingCadence =>
      classifySubscriptionCadence({ tier: s.tier ?? "", payment_provider: s.payment_provider, plan_id: planIdOf(s) });

    const byUser = new Map<string, SubscriptionRow[]>();
    for (const s of subs) {
      if (!s.user_id || !REAL_RAILS.has(s.payment_provider ?? "")) continue;
      if (isStaffOrTestAccount(users.get(s.user_id))) continue;
      const list = byUser.get(s.user_id) ?? [];
      list.push(s);
      byUser.set(s.user_id, list);
    }

    const rows: RosterRow[] = [];
    for (const [userId, list] of byUser) {
      const active = list.filter((s) => isActiveUnexpired(s, now));
      const status: RosterRow["status"] | null = payers.paying.has(userId)
        ? "paying"
        : payers.inTrial.has(userId)
          ? "trial"
          : null;
      let basisRows = active;
      let finalStatus: RosterRow["status"] | null = status;
      if (!finalStatus) {
        // Ended in the last 30 days, with money having changed hands.
        const ended = list.filter((s) => s.expires_at && Date.parse(s.expires_at) <= now.getTime() && Date.parse(s.expires_at) >= Date.parse(since30));
        if (ended.length === 0 || !ended.some((s) => rowHasPositivePayment(s, paymentsById))) continue;
        basisRows = ended;
        finalStatus = "ended";
      }
      const latest = [...basisRows].sort((a, b) => Date.parse(b.expires_at ?? "9999") - Date.parse(a.expires_at ?? "9999"))[0];
      const cadences = basisRows.map(cadenceOf);
      const cadence: BillingCadence = cadences.includes("auto_renews") ? "auto_renews" : cadences.includes("unknown") ? "unknown" : "one_time";
      const end = basisRows.some((s) => !s.expires_at) ? null : latest.expires_at;
      rows.push({
        user_id: userId,
        label: label(userId),
        status: finalStatus as RosterRow["status"],
        plan: durationLabel(latest.tier ? tierDurationMonths(latest.tier) : null, latest.tier),
        tier: latest.tier,
        cadence,
        paid_to_date_cents: paidByUser.get(userId) ?? 0,
        access_ends: end,
        days_left: daysLeft(end, now),
      });
    }
    rows.sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9));

    const paying = rows.filter((r) => r.status === "paying");
    const willNotRenew = (r: RosterRow) => r.cadence !== "auto_renews";
    const within = (r: RosterRow, d: number) => r.days_left != null && r.days_left <= d;
    const moneyIn = computeMoneyIn(ledger, now);

    const pending = ((pendingRes.data ?? []) as Array<{ id: string; user_id: string | null; tier: string | null; payment_provider: string | null; amount_cents: number | null; currency: string | null; created_at: string }>).map((p) => ({
      id: p.id,
      user_id: p.user_id,
      label: p.user_id ? label(p.user_id) : null,
      tier: p.tier,
      provider: p.payment_provider,
      amount_cents: p.amount_cents,
      currency: p.currency,
      created_at: p.created_at,
      age_hours: Math.floor((now.getTime() - Date.parse(p.created_at)) / 3_600_000),
    }));

    return NextResponse.json({
      generated_at: now.toISOString(),
      names_visible: canReadUsers,
      kpis: {
        paying: paying.length,
        paying_by_cadence: {
          renews: paying.filter((r) => r.cadence === "auto_renews").length,
          one_time: paying.filter((r) => r.cadence === "one_time").length,
          unknown: paying.filter((r) => r.cadence === "unknown").length,
        },
        in_trial: rows.filter((r) => r.status === "trial").length,
        lose_7d: paying.filter((r) => willNotRenew(r) && within(r, 7)).length,
        lose_30d: paying.filter((r) => willNotRenew(r) && within(r, 30)).length,
        renew_30d: paying.filter((r) => !willNotRenew(r) && within(r, 30)).length,
        ended_30d: rows.filter((r) => r.status === "ended").length,
        lifetime_gross_cents: moneyIn.lifetime_gross_cents,
        stuck_pending_24h: pending.filter((p) => p.age_hours >= 24).length,
      },
      rows,
      pending,
      basis: {
        paying: PAYING_BASIS,
        paid_to_date: "Paid to date is the gross charge of every granted EUR payment by the learner (list price as Whop charged it, before Whop fees and refunds). Payments marked test or not ours are excluded.",
        access_ends: "Access end is the latest end date across the learner's active rows; a stacked future month is included.",
        cadence: "Renews means at least one active row is on a plan that charges again by itself. Whop does not tell us when a member cancels at period end, so such a member still reads as renewing until the row ends.",
      },
    });
  },
  { route: "/api/admin/subscriptions" }
);
