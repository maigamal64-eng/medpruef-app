"use client";

/**
 * /admin/flagged: the Reports inbox (a15).
 *
 * Pending question reports (flags and edits), each deep-linked to its row
 * in Questions > Reviews (?report=<id>, UX-ADM-02 step A), plus the open
 * community note reports and the explanations with 2 or more down-votes
 * (TR-13). Decisions stay in Questions > Reviews so there is one workflow.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, ThumbsDown, NotebookPen } from "lucide-react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import {
  Alert,
  BrandedLoader,
  EmptyState,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface DownvotedItem {
  question_id: number;
  down_votes: number;
  votes: number;
  topic: string | null;
  exam_type: string | null;
  is_active: boolean | null;
  question: string;
}

interface QuestionFlag {
  type?: string;
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
  const [noteReports, setNoteReports] = useState<number | null>(null);
  const [downvoted, setDownvoted] = useState<{ measured: boolean; items: DownvotedItem[] } | null>(null);
  const [downvotedError, setDownvotedError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggestions?status=pending&limit=50&offset=${page * 50}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.suggestions)) throw new Error(data?.error || `Could not load reports (HTTP ${res.status})`);
      setItems(data.suggestions);
      setTotal(Number.isFinite(data?.total) ? data.total : 0);
    } catch (e) {
      setError((e as Error).message || "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadSide = useCallback(async () => {
    setDownvotedError(null);
    const [inboxRes, votesRes] = await Promise.allSettled([fetch("/api/admin/inbox"), fetch("/api/stats/admin/explanations/downvoted")]);
    if (inboxRes.status === "fulfilled" && inboxRes.value.ok) {
      const body = await inboxRes.value.json().catch(() => null);
      setNoteReports(typeof body?.note_reports === "number" ? body.note_reports : null);
    }
    if (votesRes.status === "fulfilled" && votesRes.value.ok) {
      const body = await votesRes.value.json().catch(() => null);
      if (body && Array.isArray(body.items)) setDownvoted({ measured: body.measured !== false, items: body.items });
      else setDownvotedError("Unexpected response");
    } else {
      setDownvotedError("Could not load explanation ratings");
    }
  }, []);

  useEffect(() => {
    if (!accessLoading && can("content.read")) void load();
  }, [accessLoading, can, load]);
  useEffect(() => {
    if (!accessLoading && can("content.read")) void loadSide();
  }, [accessLoading, can, loadSide]);

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("content.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to read question reports.</Alert></div>;

  return (
    <AdminPageShell
      title="Question reports"
      description="Learner-reported question issues. Open a report to see the full question and record a decision; the reporter sees the outcome in My reports."
      loadState={{ loading, error }}
      onRefresh={() => { void load(); void loadSide(); }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/admin/note-reports" className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-sm">
          <NotebookPen className="h-5 w-5 text-[var(--mp-fg-muted)]" aria-hidden />
          <span className="flex-1 text-[var(--mp-fg)]">Community note reports</span>
          <span className="font-mono font-semibold text-[var(--mp-fg)]">{noteReports === null ? "?" : noteReports} open</span>
        </Link>
        <a href="#downvoted" className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-sm">
          <ThumbsDown className="h-5 w-5 text-[var(--mp-fg-muted)]" aria-hidden />
          <span className="flex-1 text-[var(--mp-fg)]">Explanations with 2+ down-votes</span>
          <span className="font-mono font-semibold text-[var(--mp-fg)]">{downvoted ? (downvoted.measured ? downvoted.items.length : "not measured") : "?"}</span>
        </a>
      </div>
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
          body="No pending question reports."
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
                  <div className="text-xs text-[var(--mp-fg-muted)] font-mono">
                    {it.created_at ? new Date(it.created_at).toLocaleString() : ""}
                  </div>
                  <div className="text-sm text-[var(--mp-fg)] mt-1">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${it.type === "edit" ? "bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]" : "bg-[var(--mp-error)]/10 text-[var(--mp-error)]"}`}>{it.type === "edit" ? "Edit" : "Flag"}</span>
                    <Link href={`/admin/questions?tab=browse&questionId=${it.question_id}`} className="font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">Question #{it.question_id}</Link> · {it.question_topic}
                  </div>
                  <p className="text-sm text-[var(--mp-fg-muted)] mt-1 line-clamp-3">{it.question_text}</p>
                  <div className="text-xs text-[var(--mp-fg-muted)] mt-2">Reported by {it.user_name}{it.reason ? ` · ${it.reason}` : ""}</div>
                  {it.details && <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 whitespace-pre-line">{it.details}</p>}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Link href={`/admin/questions?tab=reviews&report=${it.id}`} className="mp-btn mp-btn--primary mp-btn--sm min-h-11">Open report</Link>
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
      <section id="downvoted" aria-labelledby="downvoted-title" className="space-y-2 scroll-mt-20">
        <h2 id="downvoted-title" className="text-sm font-semibold text-[var(--mp-fg)]">Explanations with 2 or more down-votes</h2>
        <p className="text-xs text-[var(--mp-fg-muted)]">One vote per learner and question (explanation ratings ledger). Votes reset when the explanation text changes.</p>
        {downvotedError ? (
          <Alert variant="error" title="Explanation ratings unavailable">{downvotedError} <button type="button" className="ml-3 underline" onClick={() => void loadSide()}>Retry</button></Alert>
        ) : !downvoted ? (
          <p className="text-sm text-[var(--mp-fg-muted)]" role="status">Loading…</p>
        ) : !downvoted.measured ? (
          <p className="text-sm text-[var(--mp-fg-muted)]">Not measured yet: the one-vote ratings table is not live in this database.</p>
        ) : downvoted.items.length === 0 ? (
          <p className="text-sm text-[var(--mp-fg-muted)]">No explanation has 2 or more down-votes.</p>
        ) : (
          <ul className="space-y-2">
            {downvoted.items.map((d) => (
              <li key={d.question_id} className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/admin/questions?tab=browse&questionId=${d.question_id}`} className="font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">Question #{d.question_id}</Link>
                  <span className="font-mono text-xs text-[var(--mp-fg)]">{d.down_votes} down of {d.votes}</span>
                </div>
                <p className="text-xs text-[var(--mp-fg-muted)]">{[d.exam_type, d.topic].filter(Boolean).join(" · ")}{d.is_active === false ? " · hidden from learners" : ""}</p>
                {d.question ? <p className="mt-1 text-[var(--mp-fg-muted)] line-clamp-2">{d.question}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminPageShell>
  );
}
