"use client";

/**
 * /admin/flags — feature flag management.
 *
 * Scaffold: lists flags from the `flags` table (§2.9). Toggle + rollout
 * editing lands in a follow-up.
 */

import { useCallback, useEffect, useState } from "react";
import { Flag as FlagIcon } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface FlagRow {
  key: string;
  description: string | null;
  env: string;
  enabled: boolean;
  rollout_pct: number;
  updated_at: string;
}

export default function AdminFlagsPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
  const [items, setItems] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/flags");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()).items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessLoading && can("system.read")) void load();
  }, [accessLoading, can, load]);

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("system.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to view feature-flag configuration.</Alert></div>;

  return (
    <AdminPageShell
      title="Feature flags"
      description="Current feature-flag records. This view is read-only because code-level consumers and rollout safety are not yet tied to a controlled change workflow."
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
          <BrandedLoader size={48} label="Loading flags…" />
        </div>
      ) : error ? null : items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<FlagIcon className="w-10 h-10" aria-hidden />}
          title="No flags yet"
          body="No feature-flag records are configured. This empty state does not imply that all application features are disabled."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Key</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2">Env</th>
                <th className="text-right px-3 py-2">Rollout</th>
                <th className="text-left px-3 py-2">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr
                  key={f.key}
                  className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
                >
                  <td className="px-3 py-2 font-mono">{f.key}</td>
                  <td className="px-3 py-2 text-[var(--mp-fg-muted)]">
                    {f.description || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">{f.env}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {f.rollout_pct}%
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                        f.enabled
                          ? "border-emerald-500/40 text-emerald-500"
                          : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {f.enabled ? "on" : "off"}
                    </span>
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
