"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Alert, BrandedLoader } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface EnvStatus {
  name: string;
  present: boolean;
  /** Masked hint so we know SOMETHING is set without leaking the value. */
  masked?: string;
}

export default function AdminEnvPage() {
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
    load();
  }, [load]);

  return (
    <AdminPageShell
      title="Environment"
      description="Presence-only check — values are never shipped to the client."
      freshness={loading ? "cached" : "cached"}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Checking env…" />
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Variable</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Hint</th>
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
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">
                    {v.masked || ""}
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
