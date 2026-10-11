"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, BrandedLoader, EmptyState, useToast } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import type { FeedbackItem } from "../_components/types";

const STATUSES = ["needs_action", "all", "new", "reviewed", "resolved", "dismissed"] as const;

export default function AdminFeedbackPage() {
  const toast = useToast();
  const { can, loading: accessLoading } = useAdminPermissions();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("needs_action");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback?status=${statusFilter}&limit=100`);
      if (!res.ok) throw new Error(`Could not load feedback (HTTP ${res.status})`);
      const payload: unknown = await res.json();
      if (!Array.isArray(payload)) throw new Error("Feedback response was not a list");
      setItems(payload as FeedbackItem[]);
    } catch (e) {
      setError((e as Error).message || "Could not load feedback");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!accessLoading && can("feedback.read")) void fetchFeedback();
  }, [accessLoading, can, fetchFeedback]);

  const updateStatus = async (item: FeedbackItem, status: "reviewed" | "resolved" | "dismissed") => {
    if (!can("feedback.manage") || actingId !== null) return;
    setActingId(item.id);
    try {
      const res = await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Could not update feedback (HTTP ${res.status})`);
      }
      toast.success(`Feedback marked ${status}`);
      await fetchFeedback();
    } catch (e) {
      toast.error((e as Error).message || "Could not update feedback");
    } finally {
      setActingId(null);
    }
  };

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("feedback.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to read feedback.</Alert></div>;

  return (
    <AdminPageShell
      title="Feedback inbox"
      description="Learner messages submitted through the in-app feedback tool. Question reports are handled in Question Reports."
      freshness={loading ? "cached" : error ? "disconnected" : "live"}
      onRefresh={() => void fetchFeedback()}
      actions={
        <div className="max-w-full overflow-x-auto pb-1">
          <div className="mp-tabs w-max" role="tablist" aria-label="Filter feedback by status">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                className={`mp-tabs__tab whitespace-nowrap ${statusFilter === status ? "mp-tabs__tab--active" : ""}`}
              >
                {status === "needs_action" ? "Needs action" : status === "all" ? "All" : status[0].toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {error && <Alert variant="error" title="Feedback could not be loaded">{error}<button className="ml-3 underline" type="button" onClick={() => void fetchFeedback()}>Retry</button></Alert>}
      {loading ? (
        <div className="flex items-center justify-center py-8"><BrandedLoader size={44} label="Loading feedback…" /></div>
      ) : !error && items.length === 0 ? (
        <EmptyState
          tone={statusFilter === "new" ? "success" : "neutral"}
          icon={<MessageSquarePlus className="w-10 h-10" aria-hidden />}
          title={statusFilter === "new" ? "No new feedback" : "No feedback in this filter"}
          body="This list is empty for the selected status. A failed request is shown as an error, never as an empty inbox."
        />
      ) : !error ? (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="card rounded-xl p-4 border-l-4 border-l-[var(--mp-cta-blue)]">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--mp-fg)] whitespace-pre-wrap mb-2">{item.message}</p>
                  <div className="flex flex-wrap gap-2 text-[10px] text-[var(--mp-fg-subtle)]">
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                    {item.user_id ? <span>User: {item.user_id.slice(0, 8)}…</span> : <span>Anonymous</span>}
                    {item.context?.pathname ? <span>Page: {String(item.context.pathname)}</span> : null}
                    {Number.isInteger(Number(item.context?.questionId)) && Number(item.context?.questionId) > 0 ? <span>Question: #{Number(item.context?.questionId)}</span> : null}
                    {item.context?.examType ? <span>Exam: {String(item.context.examType)}</span> : null}
                    {item.context?.screenSize ? <span>Screen: {String(item.context.screenSize)}</span> : null}
                  </div>
                  {item.admin_note && <p className="text-xs text-[var(--mp-viridian)] mt-2 italic">Admin note: {item.admin_note}</p>}
                </div>
                <div className="flex sm:flex-col flex-wrap items-center sm:items-stretch gap-1 sm:min-w-28">
                  <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]">{item.status}</span>
                  {(item.status === "new" || item.status === "reviewed") && can("feedback.manage") && (
                    <>
                      {item.status === "new" && <button type="button" disabled={actingId !== null} onClick={() => void updateStatus(item, "reviewed")} className="text-xs px-2 py-1.5 rounded bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)] disabled:opacity-50">{actingId === item.id ? "Saving…" : "Mark reviewed"}</button>}
                      <button type="button" disabled={actingId !== null} onClick={() => void updateStatus(item, "resolved")} className="text-xs px-2 py-1.5 rounded bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)] disabled:opacity-50">Resolve</button>
                      <button type="button" disabled={actingId !== null} onClick={() => void updateStatus(item, "dismissed")} className="text-xs px-2 py-1.5 rounded bg-[var(--mp-fg-subtle)]/10 text-[var(--mp-fg-subtle)] disabled:opacity-50">Dismiss</button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </AdminPageShell>
  );
}
