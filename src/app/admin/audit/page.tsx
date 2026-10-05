"use client";

/**
 * /admin/audit — admin_audit_log viewer.
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface AuditRow {
  id: string;
  actor_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export default function AdminAuditPage() {
  return <AdminPermissionGate permission="system.read"><AdminAuditPageContent /></AdminPermissionGate>;
}

function AdminAuditPageContent() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/audit");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()).items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAdminRealtime("admin_audit_log", {
    onEvent: () => load(),
  });

  return (
    <AdminPageShell
      title="Audit log"
      description="Every admin mutation, who / what / when."
      freshness={loading ? "cached" : "live"}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading audit log…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<BarChart3 className="w-10 h-10" aria-hidden />}
          title="Audit log empty"
          body="Admin mutations will appear here from the moment they fire."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 200).map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[var(--mp-fg-muted)]">
                    {r.actor_email}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.action}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.target_type && r.target_id
                      ? `${r.target_type}:${r.target_id.slice(0, 8)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] max-w-[400px] truncate">
                    {r.payload ? JSON.stringify(r.payload) : ""}
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
