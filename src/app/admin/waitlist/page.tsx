"use client";

/**
 * /admin/waitlist — recorded pricing and exam-intent signups.
 *
 * §2.4 — CSV export button (audit-logged).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Inbox } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import {
  Alert,
  BrandedLoader,
  EmptyState,
  Select,
  useToast,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { getSessionToken } from "@/lib/auth";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";

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
  const { can, loading: accessLoading } = useAdminPermissions();
  const toast = useToast();
  const [items, setItems] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [examType, setExamType] = useState("");
  const [source, setSource] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!can("revenue.read")) return;
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
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message || "Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }, [can, examType, source]);

  useEffect(() => {
    if (accessLoading) return;
    if (can("revenue.read")) void load();
    else setLoading(false);
  }, [accessLoading, can, load]);

  async function exportCsv() {
    if (!can("revenue.read")) return;
    const params = new URLSearchParams({ format: "csv" });
    if (examType) params.set("exam_type", examType);
    if (source) params.set("source", source);
    // Carry the auth credential manually — this blob download doesn't go
    // through authFetch. Send the signed session token (S-1).
    const token = getSessionToken();
    const res = await fetch(`/api/admin/waitlist?${params.toString()}`, {
      headers: token ? { "x-session-token": token } : undefined,
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
      description="Pricing and exam-intent signups recorded by the waitlist source."
      loadState={{ loading, error }}
      onRefresh={load}
      actions={
        can("revenue.read") ? <button
          type="button"
          onClick={exportCsv}
          disabled={items.length === 0}
          className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5"
        >
          <Download size={12} />
          Export CSV
        </button> : null
      }
    >
      {!accessLoading && !can("revenue.read") && (
        <Alert variant="error" title="Access restricted">
          You do not have permission to view waitlist records.
        </Alert>
      )}
      {can("revenue.read") && <>
      {error && (
        <Alert variant="error" title={items.length ? "Showing saved results" : "Could not load waitlist"}>
          {error}{items.length > 0 && updatedAt ? ` Last successful load: ${new Date(updatedAt).toLocaleString()}.` : ""}
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
            { value: "kmp_innsbruck", label: "Stichprobentest (Innsbruck)" },
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

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading waitlist…" />
        </div>
      ) : !loading && !error && items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<Inbox className="w-10 h-10" aria-hidden />}
          title="No matching signups"
          body="No waitlist records match the selected filters. Clear a filter or check again later."
        />
      ) : items.length > 0 ? (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
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
          </div>
          {items.length > 500 && (
            <div className="border-t border-[var(--mp-border-subtle)] p-2 text-center text-[10px] text-[var(--mp-fg-muted)]">
              Showing the first 500 rows. The source returns up to 5,000 rows, and CSV export has the same 5,000-row cap ({items.length} returned).
            </div>
          )}
        </div>
      ) : null}
      </>}
    </AdminPageShell>
  );
}
