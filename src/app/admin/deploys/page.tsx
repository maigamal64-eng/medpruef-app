"use client";

/**
 * /admin/deploys — recent Vercel deployments (read-only ops surface).
 *
 * Thin client: it fetches GET /api/admin/deploys (adminRouteShell-guarded)
 * and renders the result. It imports ONLY the response TYPE from the
 * server-only lib (`import type`), never the fetcher itself — that keeps the
 * client/server boundary clean (the secrets-reading code stays server-side).
 *
 * Three states, mirroring the API's discriminated union:
 *   - not configured (no VERCEL_TOKEN) → "configure VERCEL_TOKEN" empty-state
 *   - configured but upstream rejected → degraded Alert with the reason
 *   - ok                               → the deployments table
 */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Zap } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { StatusDot, type StatusTone } from "../_components/primitives";
import type { DeploysResult, DeployRow } from "@/lib/admin/opsExternal";

const VERCEL_PROJECT_URL =
  "https://vercel.com/team/medpruef/deployments";

export default function AdminDeploysPage() {
  return <AdminPermissionGate permission="system.read"><AdminDeploysPageContent /></AdminPermissionGate>;
}

function AdminDeploysPageContent() {
  const [result, setResult] = useState<DeploysResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/deploys", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as DeploysResult);
    } catch (e) {
      setError((e as Error).message || "Failed to load deployments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const freshness = loading
    ? "cached"
    : error
      ? "disconnected"
      : result?.configured && result.ok
        ? "live"
        : "disconnected";

  return (
    <AdminPageShell
      title="Deploys"
      description="Recent Vercel deployments for the MedPrüf project."
      freshness={freshness}
      onRefresh={load}
      actions={
        <a
          href={VERCEL_PROJECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5"
        >
          Open in Vercel
          <ExternalLink size={12} />
        </a>
      }
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading deployments…" />
        </div>
      ) : !result ? null : !result.configured ? (
        <EmptyState
          tone="neutral"
          icon={<Zap className="w-10 h-10" aria-hidden />}
          title="Vercel not connected"
          body={`Set ${result.missing} in the project environment to enable this tab. The route reads it server-side only; nothing is hardcoded.`}
        />
      ) : !result.ok ? (
        <Alert variant="warning" title={`Vercel unavailable (HTTP ${result.status})`}>
          {result.reason}
        </Alert>
      ) : result.deployments.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<Zap className="w-10 h-10" aria-hidden />}
          title="No deployments yet"
          body="Vercel has no deployments for this project in range."
        />
      ) : (
        <DeploysTable rows={result.deployments} />
      )}
    </AdminPageShell>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

function DeploysTable({ rows }: { rows: DeployRow[] }) {
  return (
    <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">State</th>
              <th className="text-left px-3 py-2 font-medium">Commit</th>
              <th className="text-left px-3 py-2 font-medium">Target</th>
              <th className="text-left px-3 py-2 font-medium">Branch</th>
              <th className="text-left px-3 py-2 font-medium">Author</th>
              <th className="text-left px-3 py-2 font-medium">When</th>
              <th className="text-right px-3 py-2 font-medium">Inspect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.uid}
                className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
              >
                <td className="px-3 py-2">
                  <StateBadge state={d.state} />
                </td>
                <td className="px-3 py-2 max-w-[320px]">
                  <div className="flex items-center gap-2">
                    {d.shaShort && (
                      <span className="font-mono text-[10px] text-[var(--mp-fg-muted)] flex-shrink-0">
                        {d.shaShort}
                      </span>
                    )}
                    <span className="truncate" title={d.commitSummary ?? undefined}>
                      {d.commitSummary ?? (
                        <span className="text-[var(--mp-fg-muted)]">—</span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <TargetChip target={d.target} />
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">
                  {d.branch ?? "—"}
                </td>
                <td className="px-3 py-2 text-[var(--mp-fg-muted)]">
                  {d.author ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)] whitespace-nowrap">
                  {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {d.inspectorUrl ? (
                    <a
                      href={d.inspectorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--mp-viridian)] hover:underline"
                    >
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const s = state.toUpperCase();
  const tone: StatusTone =
    s === "READY"
      ? "success"
      : s === "ERROR" || s === "CANCELED"
        ? "danger"
        : s === "BUILDING" || s === "QUEUED" || s === "INITIALIZING"
          ? "warn"
          : "neutral";
  const color =
    tone === "success"
      ? "border-emerald-500/40 text-emerald-500"
      : tone === "danger"
        ? "border-red-500/40 text-red-500"
        : tone === "warn"
          ? "border-amber-500/40 text-amber-500"
          : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded border font-mono ${color}`}
    >
      <StatusDot tone={tone} size={6} />
      {s}
    </span>
  );
}

function TargetChip({ target }: { target: string | null }) {
  if (!target) return <span className="text-[var(--mp-fg-muted)]">—</span>;
  const isProd = target === "production";
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
        isProd
          ? "border-[var(--mp-viridian)]/40 text-[var(--mp-viridian)]"
          : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]"
      }`}
    >
      {isProd ? "prod" : target}
    </span>
  );
}
