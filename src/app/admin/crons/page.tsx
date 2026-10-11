"use client";

/**
 * /admin/crons — cron_runs health grid.
 */

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface CronRow {
  id: string;
  cron_name: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_affected: number | null;
  error: string | null;
}

export default function AdminCronsPage() {
  return <AdminPermissionGate permission="system.read"><AdminCronsPageContent /></AdminPermissionGate>;
}

function AdminCronsPageContent() {
  const [items, setItems] = useState<CronRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crons");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()).items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load cron runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAdminRealtime("cron_runs", {
    onEvent: () => load(),
  });

  return (
    <AdminPageShell
      title="Cron health"
      description="Scheduled task runs in the last 48 hours."
      freshness={loading ? "cached" : error ? "disconnected" : "live"}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error} <button type="button" className="ml-3 underline" onClick={() => void load()}>Retry</button>
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading cron runs…" />
        </div>
      ) : error ? null : items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<Gauge className="w-10 h-10" aria-hidden />}
          title="No cron runs yet"
          body="Scheduled tasks write rows to public.cron_runs when they fire."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Started</th>
                <th className="text-left px-3 py-2">Cron</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Rows</th>
                <th className="text-left px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 200).map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">
                    {new Date(r.started_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.cron_name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                        r.status === "succeeded"
                          ? "border-emerald-500/40 text-emerald-500"
                          : r.status === "failed"
                            ? "border-red-500/40 text-red-500"
                            : "border-amber-500/40 text-amber-500"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.rows_affected ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-red-500 truncate max-w-[200px]">
                    {r.error || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPageShell>
  );
}
