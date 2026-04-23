"use client";

/**
 * /admin/subscriptions — tier breakdown, churn, LTV.
 *
 * Scaffold only this sprint. Hydrates from /api/admin/subscriptions
 * (served by /api/admin/overview for now) and subscribes to Realtime
 * so new active subs pop in without a refresh.
 */

import { useCallback, useEffect, useState } from "react";
import { Ticket } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

interface SubsSummary {
  total_active: number;
  by_tier: Record<string, number>;
  recent: Array<{
    id: string;
    tier: string;
    status: string;
    started_at: string | null;
    amount_cents: number | null;
  }>;
}

export default function AdminSubscriptionsPage() {
  const [data, setData] = useState<SubsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscriptions");
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      /* surface via freshness badge */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAdminRealtime("subscriptions", {
    onEvent: () => {
      // simplest re-hydrate — full churn math lands in a follow-up
      load();
    },
  });

  return (
    <AdminPageShell
      title="Subscriptions"
      description="Active paid tiers + recent activity."
      freshness={loading ? "cached" : "live"}
      onRefresh={load}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
            <Ticket size={12} />
            Active subscriptions
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-[var(--mp-fg)]">
            {data?.total_active ?? "—"}
          </div>
          <div className="mt-3 space-y-1 text-xs">
            {data && Object.keys(data.by_tier).length === 0 && (
              <span className="text-[var(--mp-fg-muted)]">No active tiers yet</span>
            )}
            {data &&
              Object.entries(data.by_tier)
                .sort((a, b) => b[1] - a[1])
                .map(([tier, n]) => (
                  <div key={tier} className="flex items-center justify-between">
                    <span className="text-[var(--mp-fg)]">{tier}</span>
                    <span className="font-mono text-[var(--mp-fg)]">{n}</span>
                  </div>
                ))}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
          <div className="text-[11px] uppercase tracking-wider text-[var(--mp-fg-muted)] mb-2">
            Recent activity
          </div>
          {!data || data.recent.length === 0 ? (
            <div className="text-xs text-[var(--mp-fg-muted)]">
              No subscriptions in the last 30 days.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--mp-border-subtle)] text-xs">
              {data.recent.slice(0, 12).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between py-1.5 gap-3"
                >
                  <span className="font-mono text-[var(--mp-fg-muted)] text-[10px]">
                    {r.started_at
                      ? new Date(r.started_at).toLocaleDateString()
                      : "—"}
                  </span>
                  <span className="text-[var(--mp-fg)] flex-1">{r.tier}</span>
                  <span className="text-[var(--mp-fg)] font-mono">
                    €{((r.amount_cents ?? 0) / 100).toFixed(2)}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      r.status === "active"
                        ? "border-emerald-500/40 text-emerald-500"
                        : "border-amber-500/40 text-amber-500"
                    }`}
                  >
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ComingSoonCard title="Churn, LTV, MRR trend">
        Cohort-over-cohort retention and lifetime value land in a follow-up.
        This sprint ships the Realtime counters + recent-activity view.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
