"use client";

/**
 * /admin/subscriptions — tier breakdown, churn, LTV.
 *
 * Scaffold only this sprint. Hydrates from /api/admin/subscriptions
 * (served by /api/admin/overview for now) and subscribes to Realtime
 * so new active subs pop in without a refresh.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Ticket } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
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
  const { can, loading: accessLoading } = useAdminPermissions();
  const [data, setData] = useState<SubsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!can("revenue.read")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subscriptions");
      if (!res.ok) throw new Error(`Could not load subscriptions (HTTP ${res.status}).`);
      setData(await res.json());
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message || "Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => {
    if (accessLoading) return;
    if (can("revenue.read")) void load();
    else setLoading(false);
  }, [accessLoading, can, load]);

  useAdminRealtime("subscriptions", {
    onEvent: () => {
      // simplest re-hydrate — full churn math lands in a follow-up
      load();
    },
  });

  return (
    <AdminPageShell
      title="Subscriptions"
      description="Active records returned by the source, plus the latest 12 activity records shown from up to 50 returned. These lists are not paginated."
      freshness={error ? (data ? "cached" : "disconnected") : loading ? "cached" : "live"}
      onRefresh={load}
    >
      {error && (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] px-4 py-3 text-sm text-[var(--mp-error)]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            {data && <p className="mt-1 text-xs">Showing the last successful snapshot from {updatedAt ? new Date(updatedAt).toLocaleString() : "an earlier load"}.</p>}
          </div>
          <button type="button" onClick={load} className="mp-btn mp-btn--secondary mp-btn--sm inline-flex shrink-0 items-center gap-1" disabled={loading}>
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      )}
      {!accessLoading && !can("revenue.read") && (
        <div role="alert" className="rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] px-4 py-3 text-sm text-[var(--mp-error)]">
          You do not have permission to view subscription operations.
        </div>
      )}
      {can("revenue.read") && !data && loading && (
        <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">Loading subscription data…</div>
      )}
      {can("revenue.read") && !data && !loading && !error && (
        <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">No subscription data is available.</div>
      )}
      {can("revenue.read") && data && <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
            <Ticket size={12} />
            Active subscription records returned
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
            Recent activity (latest 12 shown from up to 50 returned)
          </div>
          {data.recent.length === 0 ? (
            <div className="text-xs text-[var(--mp-fg-muted)]">
              No recent subscription records were returned by the source.
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
        This view does not yet calculate churn, lifetime value, or monthly recurring revenue.
      </ComingSoonCard>
      </>}
    </AdminPageShell>
  );
}
