"use client";

/**
 * /admin/flagged — user-reported question flags awaiting review.
 *
 * Loads only pending question flags from question_suggestions. Resolution
 * actions stay in Questions → Reviews so both routes share one workflow.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import {
  Alert,
  BrandedLoader,
  EmptyState,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface QuestionFlag {
  id: number;
  user_id: string | null;
  question_id: number;
  question_text: string;
  question_topic: string;
  user_name: string;
  reason: string | null;
  details: string | null;
  context: Record<string, unknown> | null;
  status: string;
  created_at: string | null;
}

export default function AdminFlaggedPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
  const [items, setItems] = useState<QuestionFlag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggestions?status=pending&type=flag&limit=50&offset=${page * 50}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setTotal(Number.isFinite(data?.total) ? data.total : 0);
    } catch (e) {
      setError((e as Error).message || "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!accessLoading && can("content.read")) void load();
  }, [accessLoading, can, load]);

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("content.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to read question reports.</Alert></div>;

  return (
    <AdminPageShell
      title="Question reports"
      description="Learner-reported question issues. Open a report in the Questions review workspace to record a decision."
      freshness={loading ? "cached" : error ? "disconnected" : "live"}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error} <button type="button" className="ml-3 underline" onClick={() => void load()}>Retry</button>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading…" />
        </div>
      ) : !error && items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<ShieldAlert className="w-10 h-10" aria-hidden />}
          title="Inbox clear"
          body="No open question reports were found for this page."
        />
      ) : !error ? (
        <ul className="space-y-2">
          {items.slice(0, 50).map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-[var(--mp-fg-muted)] font-mono">
                    {it.created_at ? new Date(it.created_at).toLocaleString() : ""}
                  </div>
                  <div className="text-sm text-[var(--mp-fg)] mt-1">Question #{it.question_id} · {it.question_topic}</div>
                  <p className="text-sm text-[var(--mp-fg-muted)] mt-1 line-clamp-3">{it.question_text}</p>
                  <div className="text-xs text-[var(--mp-fg-muted)] mt-2">Reported by {it.user_name}{it.reason ? ` · ${it.reason}` : ""}</div>
                  {it.details && <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 whitespace-pre-line">{it.details}</p>}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-500 font-mono">{it.status}</span>
                  <Link href="/admin/questions?tab=reviews" className="text-xs text-[var(--mp-cta-blue)] underline underline-offset-2">Open review queue</Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {total > 50 && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--mp-border-subtle)] pt-3 text-sm">
          <span className="text-[var(--mp-fg-muted)]">{total.toLocaleString()} open reports</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))} className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40">Previous</button>
            <button type="button" disabled={(page + 1) * 50 >= total || loading} onClick={() => setPage((value) => value + 1)} className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </AdminPageShell>
  );
}
