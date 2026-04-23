"use client";

/**
 * /admin/waitlist — non-crypto waitlist (Stripe-pending cohort).
 *
 * §2.4 — CSV export button (audit-logged).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Inbox } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import {
  Alert,
  BrandedLoader,
  EmptyState,
  Select,
  useToast,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { getStoredSession } from "@/lib/auth";

interface WaitlistRow {
  id: string;
  email: string;
  user_id: string | null;
  exam_type: string | null;
  exam_date: string | null;
  tier_interest: string | null;
  source: string | null;
  note: string | null;
  created_at: string | null;
}

export default function AdminWaitlistPage() {
  const toast = useToast();
  const [items, setItems] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [examType, setExamType] = useState("");
  const [source, setSource] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (examType) params.set("exam_type", examType);
      if (source) params.set("source", source);
      const res = await fetch(`/api/admin/waitlist?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }, [examType, source]);

  useEffect(() => {
    load();
  }, [load]);

  useAdminRealtime("waitlist", {
    onEvent: () => load(),
  });

  async function exportCsv() {
    const params = new URLSearchParams({ format: "csv" });
    if (examType) params.set("exam_type", examType);
    if (source) params.set("source", source);
    // Use the session header manually since <a href> can't add x-user-id.
    const session = getStoredSession();
    const res = await fetch(`/api/admin/waitlist?${params.toString()}`, {
      headers: session?.user?.id ? { "x-user-id": session.user.id } : undefined,
    });
    if (!res.ok) {
      toast.error("CSV export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `medpruef-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Exported", `${items.length} rows downloaded`);
  }

  const sources = useMemo(() => {
    const set = new Set<string>();
    items.forEach((r) => r.source && set.add(r.source));
    return Array.from(set).sort();
  }, [items]);

  return (
    <AdminPageShell
      title="Waitlist"
      description="Stripe-pending tier signups waiting for Stripe Atlas cutover."
      freshness={loading ? "cached" : "live"}
      onRefresh={load}
      actions={
        <button
          type="button"
          onClick={exportCsv}
          disabled={items.length === 0}
          className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5"
        >
          <Download size={12} />
          Export CSV
        </button>
      }
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}

      <div className="flex items-center gap-3 text-xs">
        <Select
          label="Exam type"
          value={examType}
          onChange={(e) => setExamType(e.target.value)}
          options={[
            { value: "", label: "All" },
            { value: "kenntnispruefung", label: "Kenntnisprüfung" },
            { value: "kmp_innsbruck", label: "KMP Innsbruck" },
            { value: "pharma", label: "Pharmakologie" },
          ]}
        />
        <Select
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          options={[
            { value: "", label: "All" },
            ...sources.map((s) => ({ value: s, label: s })),
          ]}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading waitlist…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<Inbox className="w-10 h-10" aria-hidden />}
          title="No waitlist signups yet"
          body="Waitlist entries appear here once the /pricing or Stripe-pending CTAs go live."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Created</th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Exam type</th>
                <th className="text-left px-3 py-2">Exam date</th>
                <th className="text-left px-3 py-2">Tier</th>
                <th className="text-left px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 500).map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.exam_type || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.exam_date || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.tier_interest || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.source || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 500 && (
            <div className="border-t border-[var(--mp-border-subtle)] p-2 text-center text-[10px] text-[var(--mp-fg-muted)]">
              Showing first 500 rows — export CSV for the full list
              ({items.length} total).
            </div>
          )}
        </div>
      )}
    </AdminPageShell>
  );
}
