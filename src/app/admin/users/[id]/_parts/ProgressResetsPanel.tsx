"use client";

/**
 * a-topic-reset-selfserve-1019: the learner's subject resets with a Restore
 * button. Restore merges the saved rows back in one transaction and writes an
 * audit row (topic_progress_restore). List needs users.read, Restore users.write.
 */
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { ConfirmAction } from "@/components/ui";
import type { ProgressResetSummary } from "@/lib/topic-reset";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Vienna", dateStyle: "medium", timeStyle: "short" });
const n = (v: unknown) => (typeof v === "number" ? v : 0);

export function ProgressResetsPanel({ userId, canRestore }: { userId: string; canRestore: boolean }) {
  const [resets, setResets] = useState<ProgressResetSummary[] | null>(null);
  const [installed, setInstalled] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<ProgressResetSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await authFetch(`/api/admin/users/${userId}/progress-resets`);
      if (!r.ok) throw new Error("Could not load progress resets. Retry.");
      const body = await r.json();
      setInstalled(body.installed !== false);
      setResets(Array.isArray(body.resets) ? body.resets : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const restore = async (reason?: string) => {
    if (!target) return;
    setPending(true);
    try {
      const r = await authFetch(`/api/admin/users/${userId}/progress-resets/${target.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason ?? null }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        const c = body.counts ?? {};
        setNotice(`Restored ${target.topic}: ${n(c.answer_history)} answers back, ${n(c.answer_history_skipped)} skipped, ${n(c.user_question_progress_kept_newer)} newer review schedules kept.`);
      } else if (body.code === "already_restored") {
        setNotice("This reset was already restored.");
      } else {
        setNotice("Restore failed. Nothing was changed.");
      }
      setTarget(null);
      await load();
    } finally {
      setPending(false);
    }
  };

  if (!installed) return null;
  return (
    <section id="progress-resets" className="rounded-xl border border-[var(--mp-border-subtle)] p-4 space-y-3">
      <h2 className="font-semibold">Subject progress resets</h2>
      {error ? (
        <p role="alert" className="text-xs">{error} <button type="button" className="underline min-h-[44px]" onClick={() => void load()}>Retry</button></p>
      ) : resets === null ? (
        <p role="status" className="text-xs">Loading resets…</p>
      ) : resets.length === 0 ? (
        <p className="text-xs text-[var(--mp-fg-muted)]">No subject resets.</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {resets.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-[var(--mp-surface-sunken)] p-3">
              <span className="min-w-0 flex-1">
                <strong className="break-words">{r.topic}</strong> · {r.exam_type} · reset {fmt(r.created_at)}
                <br />
                {n(r.counts?.answer_history)} answers, {n(r.counts?.user_question_progress) + n(r.counts?.user_question_progress_bookmark_kept)} review rows, {n(r.counts?.flashcard_reviews)} card ratings saved
                {r.restored_at && <><br />Restored {fmt(r.restored_at)}</>}
              </span>
              {!r.restored_at && canRestore && (
                <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm min-h-[44px]" onClick={() => { setNotice(""); setTarget(r); }}>
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && <p role="status" className="text-xs">{notice}</p>}
      <ConfirmAction
        open={target !== null}
        onOpenChange={(o) => { if (!o && !pending) setTarget(null); }}
        title="Restore this subject's progress?"
        consequence={target ? `The saved answers and review schedule for ${target.topic} come back. Answers given since the reset stay; a review schedule the learner built since is kept. This is logged in the audit.` : ""}
        confirmLabel="Restore"
        cancelLabel="Cancel"
        pendingLabel="Restoring"
        reasonLabel="Reason"
        pending={pending}
        onConfirm={(reason) => { void restore(reason); }}
      />
    </section>
  );
}
