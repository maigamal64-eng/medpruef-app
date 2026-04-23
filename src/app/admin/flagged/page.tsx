"use client";

/**
 * /admin/flagged — user-reported question flags awaiting review.
 *
 * Scaffold: hydrates from user_feedback (status='new') and listens on
 * Realtime. Full approve/reject/auto-fix actions land in a follow-up.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import {
  Alert,
  BrandedLoader,
  EmptyState,
} from "@/components/ui";
import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

interface FeedbackRow {
  id: number;
  user_id: string | null;
  message: string;
  context: Record<string, unknown> | null;
  status: string;
  admin_note: string | null;
  created_at: string | null;
}

export default function AdminFlaggedPage() {
  const [items, setItems] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback?status=new&limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // /api/feedback returns { items: [...] } or an array; handle either.
      setItems(Array.isArray(data) ? data : data.items || data.feedback || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAdminRealtime("user_feedback", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (!row) return;
      if (payload.eventType === "INSERT" && row.status === "new") {
        load();
      }
    },
  });

  return (
    <AdminPageShell
      title="Flagged questions"
      description="User-reported flags waiting for review."
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
          <BrandedLoader size={48} label="Loading…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<ShieldAlert className="w-10 h-10" aria-hidden />}
          title="Inbox clear"
          body="No open flags right now. New ones appear here in real time."
        />
      ) : (
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
                  <div className="text-sm text-[var(--mp-fg)] mt-1 whitespace-pre-line">
                    {it.message}
                  </div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-500 font-mono">
                  {it.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ComingSoonCard title="One-click auto-fix">
        Flag → AI-suggest fix → approve/reject in the same row ships in a
        follow-up. For now, edit the underlying question in{" "}
        <code>/admin/questions</code> and mark the flag resolved.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
