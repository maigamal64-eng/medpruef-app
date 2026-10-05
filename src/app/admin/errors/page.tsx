"use client";

/**
 * /admin/errors — recent unresolved Sentry issues (read-only ops surface).
 *
 * Thin client: fetches GET /api/admin/errors (adminRouteShell-guarded) and
 * renders the result. Imports ONLY the response TYPE from the server-only lib
 * (`import type`) — never the fetcher — so the secrets-reading code stays
 * server-side and the client/server boundary is clean.
 *
 * Three states, mirroring the API's discriminated union:
 *   - not configured (no SENTRY_AUTH_TOKEN) → "configure" empty-state
 *   - configured but rejected (e.g. token lacks issue-read scope) → degraded Alert
 *   - ok                                    → the issues table
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { StatusDot, type StatusTone } from "../_components/primitives";
import type { ErrorsResult, IssueRow } from "@/lib/admin/opsExternal";

// Region-host org issues view (DSN region is de.sentry.io). Per-issue deep
// links come from the API `permalink`; this is just the "see everything" jump.
const SENTRY_PROJECT_URL =
  "https://medpruf.sentry.io/organizations/medpruf/issues/?project=javascript-nextjs";

export default function AdminErrorsPage() {
  return <AdminPermissionGate permission="system.read"><AdminErrorsPageContent /></AdminPermissionGate>;
}

function AdminErrorsPageContent() {
  const [result, setResult] = useState<ErrorsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/errors", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as ErrorsResult);
    } catch (e) {
      setError((e as Error).message || "Failed to load issues");
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
      title="Errors"
      description="Unresolved Sentry issues for medpruf (javascript-nextjs), last 14 days."
      freshness={freshness}
      onRefresh={load}
      actions={
        <a
          href={SENTRY_PROJECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5"
        >
          Open in Sentry
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
          <BrandedLoader size={48} label="Loading issues…" />
        </div>
      ) : !result ? null : !result.configured ? (
        <EmptyState
          tone="neutral"
          icon={<AlertTriangle className="w-10 h-10" aria-hidden />}
          title="Sentry not connected"
          body={`Set ${result.missing} in the project environment to enable this tab. The route reads it server-side only; nothing is hardcoded.`}
        />
      ) : !result.ok ? (
        <Alert variant="warning" title={`Sentry unavailable (HTTP ${result.status})`}>
          {result.reason}
        </Alert>
      ) : result.issues.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<AlertTriangle className="w-10 h-10" aria-hidden />}
          title="No unresolved issues"
          body="Sentry has no unresolved issues for this project in the last 14 days."
        />
      ) : (
        <IssuesTable rows={result.issues} />
      )}
    </AdminPageShell>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

function IssuesTable({ rows }: { rows: IssueRow[] }) {
  return (
    <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Level</th>
              <th className="text-left px-3 py-2 font-medium">Issue</th>
              <th className="text-right px-3 py-2 font-medium">Events</th>
              <th className="text-right px-3 py-2 font-medium">Users</th>
              <th className="text-left px-3 py-2 font-medium">Last seen</th>
              <th className="text-right px-3 py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr
                key={i.id}
                className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)] align-top"
              >
                <td className="px-3 py-2">
                  <LevelBadge level={i.level} />
                </td>
                <td className="px-3 py-2 max-w-[420px]">
                  <div className="flex items-center gap-2">
                    {i.shortId && (
                      <span className="font-mono text-[10px] text-[var(--mp-fg-muted)] flex-shrink-0">
                        {i.shortId}
                      </span>
                    )}
                    <span
                      className="font-medium truncate"
                      title={i.title}
                    >
                      {i.title}
                    </span>
                  </div>
                  {i.culprit && (
                    <div
                      className="font-mono text-[10px] text-[var(--mp-fg-muted)] truncate mt-0.5"
                      title={i.culprit}
                    >
                      {i.culprit}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {i.count.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--mp-fg-muted)]">
                  {i.userCount.toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)] whitespace-nowrap">
                  {i.lastSeen ? new Date(i.lastSeen).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {i.permalink ? (
                    <a
                      href={i.permalink}
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

function LevelBadge({ level }: { level: string | null }) {
  const l = (level ?? "error").toLowerCase();
  const tone: StatusTone =
    l === "fatal" || l === "error"
      ? "danger"
      : l === "warning"
        ? "warn"
        : l === "info" || l === "debug"
          ? "info"
          : "neutral";
  const color =
    tone === "danger"
      ? "border-red-500/40 text-red-500"
      : tone === "warn"
        ? "border-amber-500/40 text-amber-500"
        : tone === "info"
          ? "border-sky-500/40 text-sky-500"
          : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded border font-mono ${color}`}
    >
      <StatusDot tone={tone} size={6} />
      {l}
    </span>
  );
}
