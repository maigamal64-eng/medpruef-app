"use client";

/**
 * /admin/feedback: the feedback inbox (UX-ADM-15, ADM-Q09, a15).
 *
 * Opens on Needs action (new plus reviewed). Resolve and Dismiss work on
 * new and reviewed rows; an inline note is saved with the status change.
 * With users.read the sender links to their profile and can be reached:
 * Copy email, or a Telegram link for Telegram accounts. "Mark replied"
 * records the first reply once (pick-support-measure A); the header shows
 * the 30-day median first reply from those stamps.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, BrandedLoader, EmptyState, useToast } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { ListFooter } from "../_components/ListFooter";
import { UserLink } from "../_components/UserLink";
import type { FeedbackItem } from "../_components/types";

const STATUSES = ["needs_action", "all", "new", "reviewed", "resolved", "dismissed"] as const;
type NextStatus = "reviewed" | "resolved" | "dismissed";

interface Sender { id: string; name: string | null; email: string | null; telegram_username: string | null }
type Row = FeedbackItem & { sender?: Sender | null; first_replied_at?: string | null };
interface FirstReply { median_hours: number | null; replied: number; received: number; window_days: number }

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" }) : "";
}

export default function AdminFeedbackPage() {
  const toast = useToast();
  const { can, loading: accessLoading } = useAdminPermissions();
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("needs_action");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [firstReply, setFirstReply] = useState<FirstReply | null>(null);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedback?status=${statusFilter}&limit=100`);
      if (!res.ok) throw new Error(`Could not load feedback (HTTP ${res.status})`);
      const payload: unknown = await res.json();
      if (!Array.isArray(payload)) throw new Error("Feedback response was not a list");
      setItems(payload as Row[]);
      const header = Number(res.headers.get("X-Total-Count"));
      setTotal(res.headers.has("X-Total-Count") && Number.isFinite(header) ? header : null);
    } catch (e) {
      setError((e as Error).message || "Could not load feedback");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback?summary=1");
      const body = await res.json().catch(() => null);
      setFirstReply(res.ok && body?.first_reply ? body.first_reply : null);
    } catch {
      setFirstReply(null);
    }
  }, []);

  useEffect(() => {
    if (!accessLoading && can("feedback.read")) void fetchFeedback();
  }, [accessLoading, can, fetchFeedback]);
  useEffect(() => {
    if (!accessLoading && can("feedback.read")) void fetchSummary();
  }, [accessLoading, can, fetchSummary]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/feedback", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || `Could not update feedback (HTTP ${res.status})`);
    }
  };

  const updateStatus = async (item: Row, status: NextStatus) => {
    if (!can("feedback.manage") || actingId !== null) return;
    setActingId(item.id);
    try {
      const note = notes[item.id];
      await patch({ id: item.id, status, ...(note !== undefined ? { admin_note: note } : {}) });
      toast.success(`Feedback marked ${status}`);
      setNotes((current) => { const next = { ...current }; delete next[item.id]; return next; });
      await fetchFeedback();
    } catch (e) {
      toast.error((e as Error).message || "Could not update feedback");
    } finally {
      setActingId(null);
    }
  };

  const markReplied = async (item: Row) => {
    if (!can("feedback.manage") || actingId !== null) return;
    setActingId(item.id);
    try {
      await patch({ id: item.id, replied: true });
      toast.success("Reply recorded");
      await Promise.all([fetchFeedback(), fetchSummary()]);
    } catch (e) {
      toast.error((e as Error).message || "Could not record the reply");
    } finally {
      setActingId(null);
    }
  };

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Email address copied");
    } catch {
      toast.error("Could not copy. Select the address instead.");
    }
  };

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("feedback.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to read feedback.</Alert></div>;

  const canManage = can("feedback.manage");
  const canUsers = can("users.read");

  return (
    <AdminPageShell
      title="Feedback inbox"
      description="Learner messages submitted through the in-app feedback tool. Question reports are handled in Question reports."
      freshness={loading ? "cached" : error ? "disconnected" : "live"}
      onRefresh={() => { void fetchFeedback(); void fetchSummary(); }}
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
      <p className="text-sm text-[var(--mp-fg-muted)]" data-testid="feedback-first-reply">
        {firstReply && firstReply.median_hours !== null
          ? `Median first reply, last ${firstReply.window_days} days: ${firstReply.median_hours} h (${firstReply.replied} of ${firstReply.received} messages marked replied). Only replies recorded with Mark replied count.`
          : "Median first reply: not measured yet. Use Mark replied after you answer a learner."}
      </p>
      {error && <Alert variant="error" title="Feedback could not be loaded">{error}<button className="ml-3 underline" type="button" onClick={() => void fetchFeedback()}>Retry</button></Alert>}
      {loading ? (
        <div className="flex items-center justify-center py-8"><BrandedLoader size={44} label="Loading feedback…" /></div>
      ) : !error && items.length === 0 ? (
        <EmptyState
          tone={statusFilter === "new" || statusFilter === "needs_action" ? "success" : "neutral"}
          icon={<MessageSquarePlus className="w-10 h-10" aria-hidden />}
          title={statusFilter === "needs_action" ? "Nothing needs action" : "No feedback in this filter"}
          body="This list is empty for the selected status. A failed request is shown as an error, never as an empty inbox."
        />
      ) : !error ? (
        <div className="space-y-3">
          {items.map((item) => {
            const open = item.status === "new" || item.status === "reviewed";
            const questionId = Number(item.context?.questionId);
            const sender = item.sender ?? null;
            const busy = actingId === item.id;
            return (
              <article key={item.id} className="card rounded-xl p-4 border-l-4 border-l-[var(--mp-cta-blue)]">
                <p className="text-sm text-[var(--mp-fg)] whitespace-pre-wrap break-words mb-2">{item.message}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--mp-fg-muted)]">
                  <span>{formatDate(item.created_at)}</span>
                  <span className="font-semibold text-[var(--mp-fg)]">{item.status}</span>
                  {item.user_id ? (
                    canUsers ? (
                      <UserLink id={item.user_id} label={sender?.name || null} />
                    ) : <span>Signed-in learner</span>
                  ) : <span>Anonymous</span>}
                  {item.context?.pathname ? <span>Page: {String(item.context.pathname).slice(0, 80)}</span> : null}
                  {Number.isInteger(questionId) && questionId > 0 ? (
                    <Link href={`/admin/questions?tab=browse&questionId=${questionId}`} className="text-[var(--mp-cta-blue)] underline underline-offset-2">Question #{questionId}</Link>
                  ) : null}
                  {item.context?.examType ? <span>Exam: {String(item.context.examType)}</span> : null}
                  {item.context?.screenSize ? <span>Screen: {String(item.context.screenSize)}</span> : null}
                  {item.first_replied_at ? <span className="text-[var(--mp-viridian)]">Replied {formatDate(item.first_replied_at)}</span> : null}
                </div>
                {item.admin_note && <p className="text-xs text-[var(--mp-fg)] mt-2 italic">Note: {item.admin_note}</p>}

                {canUsers && sender && (sender.email || sender.telegram_username) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sender.email ? (
                      <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm min-h-11" onClick={() => void copyEmail(sender.email as string)}>Copy email</button>
                    ) : null}
                    {sender.telegram_username ? (
                      <a className="mp-btn mp-btn--secondary mp-btn--sm min-h-11" href={`https://t.me/${encodeURIComponent(sender.telegram_username)}`} target="_blank" rel="noopener noreferrer">Open Telegram</a>
                    ) : null}
                  </div>
                ) : null}

                {canManage && (
                  <div className="mt-3 space-y-2">
                    {open && (
                      <label className="block text-xs text-[var(--mp-fg-muted)]">
                        Note (saved with the next status change)
                        <textarea
                          value={notes[item.id] ?? item.admin_note ?? ""}
                          onChange={(e) => setNotes((current) => ({ ...current, [item.id]: e.target.value }))}
                          maxLength={2000}
                          rows={2}
                          className="mp-field__input mt-1 w-full text-sm"
                        />
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {item.status === "new" && <button type="button" disabled={actingId !== null} onClick={() => void updateStatus(item, "reviewed")} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11 disabled:opacity-50">{busy ? "Saving…" : "Mark reviewed"}</button>}
                      {open && <button type="button" disabled={actingId !== null} onClick={() => void updateStatus(item, "resolved")} className="mp-btn mp-btn--primary mp-btn--sm min-h-11 disabled:opacity-50">Resolve</button>}
                      {open && <button type="button" disabled={actingId !== null} onClick={() => void updateStatus(item, "dismissed")} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11 disabled:opacity-50">Dismiss</button>}
                      {item.user_id && !item.first_replied_at && <button type="button" disabled={actingId !== null} onClick={() => void markReplied(item)} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11 disabled:opacity-50">Mark replied</button>}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
            <ListFooter shown={items.length} total={total} noun="messages in this filter" note={total !== null && total > items.length ? "Narrow the status filter to see older messages." : null} />
          </div>
        </div>
      ) : null}
    </AdminPageShell>
  );
}
