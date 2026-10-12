"use client";

/**
 * /admin/crons — cron_runs health grid.
 */

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { ResponsiveTable } from "../_components/ResponsiveTable";
import { ListFooter } from "../_components/ListFooter";

const PAGE_ROWS = 200;

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
  const [total, setTotal] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crons");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setItems(body.items || []);
      setTotal(typeof body.total === "number" ? body.total : null);
    } catch (e) {
      setError((e as Error).message || "Failed to load cron runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminPageShell
      title="Cron health"
      description="Scheduled task runs in the last 48 hours."
      loadState={{ loading, error }}
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
          <ResponsiveTable
            label="Cron runs"
            minWidth={560}
            rows={showAll ? items : items.slice(0, PAGE_ROWS)}
            rowKey={(r) => r.id}
            columns={[
              { key: "cron", header: "Cron", card: "title", className: "font-mono", cell: (r) => r.cron_name },
              { key: "started", header: "Started", className: "font-mono text-[10px] text-[var(--mp-fg-muted)]", cell: (r) => new Date(r.started_at).toLocaleString("en-GB", { timeZone: "Europe/Vienna" }) },
              { key: "status", header: "Status", cell: (r) => (
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
              ) },
              { key: "rows", header: "Rows", align: "right", className: "font-mono tabular-nums", cell: (r) => r.rows_affected ?? "--" },
              { key: "error", header: "Error", className: "max-w-[260px] text-[10px] text-red-500 [overflow-wrap:anywhere]", cell: (r) => r.error || "--" },
            ]}
          />
          <ListFooter
            shown={showAll ? items.length : Math.min(items.length, PAGE_ROWS)}
            total={total ?? items.length}
            noun="runs from the last 48 hours"
            note={total !== null && total > items.length ? `The source returns the newest ${items.length}.` : null}
          />
          {!showAll && items.length > PAGE_ROWS && (
            <div className="border-t border-[var(--mp-border-subtle)] p-2 text-center">
              <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" onClick={() => setShowAll(true)}>Show all {items.length} loaded runs</button>
            </div>
          )}
        </div>
      )}
    </AdminPageShell>
  );
}
