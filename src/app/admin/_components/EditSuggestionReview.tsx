"use client";

import { useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Alert, Dialog, DialogFooter, useToast } from "@/components/ui";

type Values = Partial<Record<"question" | "explanation" | "topic", string | null>>;

export interface EditSuggestionRow {
  id: string | number;
  question_id: number;
  status: string;
  proposed?: Values;
  current?: Values;
  asks_key_change?: boolean;
  applied_edit?: { before?: Values; after?: Values } | null;
}

const LABELS: Record<string, string> = { question: "Question text", explanation: "Explanation", topic: "Topic" };

/**
 * ADM-05: an edit suggestion is never applied blind. The admin sees the live
 * text next to the learner's proposal, applies it explicitly, and can revert
 * an applied edit while the question still shows it.
 */
export function EditSuggestionReview({ row, canModerate, onDone }: { row: EditSuggestionRow; canModerate: boolean; onDone: () => Promise<void> | void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const changed = Object.keys(row.current ?? {}) as Array<keyof Values>;

  async function send(payload: Record<string, unknown>, success: string, close: () => void) {
    setBusy(true);
    try {
      const res = await fetch("/api/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: String(row.id), ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      toast.success(success);
      close();
      await onDone();
    } catch (e) {
      toast.error((e as Error).message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canModerate) return null;
  if (row.status === "approved" && row.applied_edit?.after && Object.keys(row.applied_edit.after).length > 0) {
    return (
      <>
        <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" onClick={() => setRevertOpen(true)}>Revert edit</button>
        <Dialog
          open={revertOpen}
          onOpenChange={(next) => { if (!busy) setRevertOpen(next); }}
          title={`Revert the edit on Q#${row.question_id}?`}
          description="The question gets back the text it had before this edit. This only works while the question still shows the applied text."
          footer={(
            <DialogFooter>
              <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={busy} onClick={() => setRevertOpen(false)}>Cancel</button>
              <button type="button" className="mp-btn mp-btn--destructive min-h-11" disabled={busy} onClick={() => void send({ action: "revert" }, "Edit reverted", () => setRevertOpen(false))}>
                {busy ? "Reverting…" : "Revert edit"}
              </button>
            </DialogFooter>
          )}
        >
          <DiffList before={row.applied_edit.after} after={row.applied_edit.before ?? {}} beforeLabel="Now" afterLabel="After revert" />
        </Dialog>
      </>
    );
  }
  if (row.status !== "pending") return null;

  return (
    <>
      <button type="button" className="mp-btn mp-btn--primary mp-btn--sm" onClick={() => setOpen(true)}>Review edit</button>
      <Dialog
        open={open}
        onOpenChange={(next) => { if (!busy) setOpen(next); }}
        title={`Suggested edit for Q#${row.question_id}`}
        description="Compare the live text with the learner's proposal. Nothing changes until you apply it."
        footer={(
          <DialogFooter>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={busy} onClick={() => void send({ action: "reject", outcome: "not_an_error", notifyReporter: false }, "Report dismissed", () => setOpen(false))}>Dismiss</button>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={busy} onClick={() => void send({ action: "approve", outcome: "accepted", notifyReporter: false }, "Report closed, question unchanged", () => setOpen(false))}>Close without applying</button>
            <button
              type="button"
              className="mp-btn mp-btn--primary min-h-11"
              disabled={busy || changed.length === 0}
              onClick={() => void send({ action: "approve", applyEdit: true, expectedBefore: row.current ?? {}, notifyReporter: false }, "Edit applied", () => setOpen(false))}
            >
              {busy ? "Applying…" : "Apply edit"}
            </button>
          </DialogFooter>
        )}
      >
        <div className="space-y-3">
          {row.asks_key_change && (
            <Alert variant="warning" title="Answer or choices not applied">
              This suggestion also asks to change the answer key or choices. Those are never applied from a report; change them by hand in Browse after checking the source.
            </Alert>
          )}
          {changed.length === 0
            ? <p className="text-sm text-[var(--mp-fg-muted)]">The live question already matches this suggestion. There is nothing to apply.</p>
            : <DiffList before={row.current ?? {}} after={row.proposed ?? {}} beforeLabel="Live now" afterLabel="Proposed" />}
        </div>
      </Dialog>
    </>
  );
}

function DiffList({ before, after, beforeLabel, afterLabel }: { before: Values; after: Values; beforeLabel: string; afterLabel: string }) {
  const fields = Object.keys(before) as Array<keyof Values>;
  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field} className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)]">{LABELS[field] ?? field}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--mp-error)]/30 bg-[var(--mp-error)]/5 p-2">
              <p className="mb-1 text-[10px] text-[var(--mp-fg-subtle)]">{beforeLabel}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-[var(--mp-fg)]">{before[field] || <em className="text-[var(--mp-fg-subtle)]">empty</em>}</p>
            </div>
            <div className="rounded-lg border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5 p-2">
              <p className="mb-1 text-[10px] text-[var(--mp-fg-subtle)]">{afterLabel}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-[var(--mp-fg)]">{after[field] || <em className="text-[var(--mp-fg-subtle)]">empty</em>}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
