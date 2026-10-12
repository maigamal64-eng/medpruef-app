"use client";

/**
 * /admin/crons (a19, ADM-12 B, UX-ADM-09): did the jobs run?
 *
 * Top: one row per scheduled job, judged against its schedule (OK, Late,
 * Overdue, Stuck, Failed) from the evidence each job leaves. Below: the
 * runs of the last 48 hours (cron_runs rows plus heartbeat events), with
 * the error text expandable and copyable.
 */

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { ResponsiveTable } from "../_components/ResponsiveTable";
import { ListFooter } from "../_components/ListFooter";
import { StatusDot, type StatusTone } from "../_components/primitives";
import type { CronJobHealth, CronRunRow } from "@/lib/admin/cron-health";

const PAGE_ROWS = 200;

const TONE: Record<CronJobHealth["tone"], StatusTone> = { ok: "success", warn: "warn", danger: "danger", neutral: "neutral" };

function viennaTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Vienna" });
}

export default function AdminCronsPage() {
  return <AdminPermissionGate permission="system.read"><AdminCronsPageContent /></AdminPermissionGate>;
}

function AdminCronsPageContent() {
  const [jobs, setJobs] = useState<CronJobHealth[]>([]);
  const [items, setItems] = useState<CronRunRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crons", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error || `HTTP ${res.status}`);
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      setItems(body.items);
      setTotal(typeof body.total === "number" ? body.total : null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError((e as Error).message || "Failed to load cron runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const attention = jobs.filter((j) => j.tone === "danger" || j.tone === "warn");

  return (
    <AdminPageShell
      title="Cron health"
      description="Did each scheduled job run on time? Judged against its schedule."
      loadState={{ loading, error, updatedAt }}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error} <button type="button" className="ml-3 underline" onClick={() => void load()}>Retry</button>
        </Alert>
      )}
      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading cron health…" />
        </div>
      ) : error ? null : (
        <div className="space-y-4">
          <section aria-labelledby="cron-jobs-h" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
            <h2 id="cron-jobs-h" className="border-b border-[var(--mp-border-subtle)] px-4 py-3 text-sm font-semibold text-[var(--mp-fg)]">
              {jobs.length === 0 ? "Jobs: no schedule data" : attention.length === 0 ? "Jobs: nothing late or failing" : `Jobs: ${attention.length} need${attention.length === 1 ? "s" : ""} attention`}
            </h2>
            <ul className="divide-y divide-[var(--mp-border-subtle)]" data-testid="cron-jobs">
              {jobs.map((j) => (
                <li key={j.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`cron-job-${j.key}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--mp-fg)]">{j.label}</p>
                    <p className="text-xs text-[var(--mp-fg-muted)]">
                      <span className="font-mono">{j.key}</span>, {j.every}. Evidence: {j.evidence}.
                      {j.last_started_at ? ` Last: ${viennaTime(j.last_started_at)}` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-[var(--mp-fg)]">
                    <StatusDot tone={TONE[j.tone]} size={8} />
                    <span>{j.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {items.length === 0 ? (
            <EmptyState
              tone="neutral"
              icon={<Gauge className="w-10 h-10" aria-hidden />}
              title="No runs in the last 48 hours"
              body="Heartbeat events and cron_runs rows appear here when a job fires."
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
                  { key: "started", header: "Started", className: "font-mono text-[10px] text-[var(--mp-fg-muted)]", cell: (r) => viennaTime(r.started_at) },
                  { key: "status", header: "Status", cell: (r) => (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                        r.status === "succeeded" || r.status === "fired"
                          ? "border-emerald-500/40 text-emerald-600"
                          : r.status === "failed"
                            ? "border-red-500/40 text-red-600"
                            : "border-amber-500/40 text-amber-700"
                      }`}
                    >
                      {r.status}
                    </span>
                  ) },
                  { key: "rows", header: "Rows", align: "right", className: "font-mono tabular-nums", cell: (r) => r.rows_affected ?? "--" },
                  { key: "error", header: "Error", className: "max-w-[320px] text-[11px]", cell: (r) => (r.error ? <ErrorCell text={r.error} /> : "--") },
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
        </div>
      )}
    </AdminPageShell>
  );
}

/** UX-ADM-09: the error is never cut off; long text folds open and can be copied. */
function ErrorCell({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const short = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <details className="text-red-600 dark:text-red-400">
      <summary className="cursor-pointer [overflow-wrap:anywhere]">{short}</summary>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--mp-fg)]">{text}</pre>
      <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm mt-1" onClick={() => void copy()}>{copied ? "Copied" : "Copy error"}</button>
    </details>
  );
}
