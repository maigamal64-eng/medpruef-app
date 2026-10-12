"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, BrandedLoader } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface EnvStatus {
  name: string;
  present: boolean;
}

export default function AdminEnvPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
  const [items, setItems] = useState<EnvStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/env");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()).items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load env");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessLoading && can("system.read")) void load();
  }, [accessLoading, can, load]);

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("system.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to view system configuration status.</Alert></div>;

  return (
    <AdminPageShell
      title="Environment"
      description="Presence-only check: values are never shipped to the client."
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
          <BrandedLoader size={48} label="Checking env…" />
        </div>
      ) : error ? null : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Variable</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Value handling</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr
                  key={v.name}
                  className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
                >
                  <td className="px-3 py-2 font-mono">{v.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                        v.present
                          ? "border-emerald-500/40 text-emerald-500"
                          : "border-red-500/40 text-red-500"
                      }`}
                    >
                      {v.present ? "set" : "MISSING"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[var(--mp-fg-muted)]">
                    Values are never displayed
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
