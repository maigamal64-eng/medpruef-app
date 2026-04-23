"use client";

/**
 * Admin / Feedback tab.
 *
 * User feedback inbox with status-filter .mp-tabs strip. Each item
 * shows the message, submitter, captured context, admin note, and
 * status-change buttons (new → reviewed / resolved / dismissed).
 */

import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { EmptyState, BrandedLoader } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import type { FeedbackItem } from "../_components/types";

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchFeedback = useCallback(async (status = "all") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feedback?status=${status}&limit=100`);
      if (res.ok) setItems(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFeedback(statusFilter); }, [fetchFeedback, statusFilter]);

  const updateStatus = async (id: number, status: string, note?: string) => {
    await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, admin_note: note }),
    });
    fetchFeedback(statusFilter);
  };

  return (
    <AdminPageShell
      title="User Feedback"
      description="Inbox of everything that came in via the floating widget."
      freshness={loading ? "cached" : "live"}
      onRefresh={() => fetchFeedback(statusFilter)}
      actions={
        <div className="mp-tabs" role="tablist">
          {["all", "new", "reviewed", "resolved", "dismissed"].map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`mp-tabs__tab ${statusFilter === s ? "mp-tabs__tab--active" : ""}`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      }
    >

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <BrandedLoader size={60} label="Loading feedback…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone={statusFilter === "new" ? "success" : "neutral"}
          icon={<MessageSquarePlus className="w-10 h-10" aria-hidden />}
          title={statusFilter === "new" ? "No new feedback" : "No feedback in this filter"}
          body={statusFilter === "new" ? "Your inbox is empty. New user feedback will show up here." : "Try another filter to see feedback in different statuses."}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card rounded-xl p-4 border-l-4 border-l-[var(--mp-cta-blue)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--mp-fg)] whitespace-pre-wrap mb-2">{item.message}</p>
                  <div className="flex flex-wrap gap-2 text-[10px] text-[var(--mp-fg-subtle)]">
                    <span>{new Date(item.created_at).toLocaleString("en-GB")}</span>
                    {item.user_id && <span>User: {item.user_id.slice(0, 8)}...</span>}
                    {!item.user_id && <span className="text-[var(--mp-error)]">Anonymous</span>}
                    {item.context?.pathname ? <span>Page: {String(item.context.pathname)}</span> : null}
                    {item.context?.examType ? <span>Exam: {String(item.context.examType)}</span> : null}
                    {item.context?.screenSize ? <span>Screen: {String(item.context.screenSize)}</span> : null}
                  </div>
                  {item.admin_note && (
                    <p className="text-xs text-[var(--mp-viridian)] mt-2 italic">Note: {item.admin_note}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
                    item.status === "new" ? "bg-[var(--mp-error)]/15 text-[var(--mp-error)]" :
                    item.status === "reviewed" ? "bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]" :
                    item.status === "resolved" ? "bg-[var(--mp-accent-teal)]/15 text-[var(--mp-accent-teal)]" :
                    "bg-[var(--mp-fg-subtle)]/15 text-[var(--mp-fg-subtle)]"
                  }`}>{item.status}</span>
                  {item.status === "new" && (
                    <>
                      <button onClick={() => updateStatus(item.id, "reviewed")}
                        className="text-[9px] px-2 py-1 bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)] rounded hover:bg-[var(--mp-status-warning)]/20">
                        Mark Reviewed
                      </button>
                      <button onClick={() => updateStatus(item.id, "resolved")}
                        className="text-[9px] px-2 py-1 bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)] rounded hover:bg-[var(--mp-accent-teal)]/20">
                        Resolve
                      </button>
                      <button onClick={() => updateStatus(item.id, "dismissed")}
                        className="text-[9px] px-2 py-1 bg-[var(--mp-fg-subtle)]/10 text-[var(--mp-fg-subtle)] rounded hover:bg-[var(--mp-fg-subtle)]/20">
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}
