"use client";

/**
 * a-topic-reset-selfserve-1019: the quiet "reset progress in a subject" action
 * on /curriculum. Renders nothing until GET /api/user/topic-progress/reset
 * says the reset is on (TOPIC_RESET_ENABLED). One dialog: pick a subject with
 * progress, read what goes back to zero, what stays and that the old progress
 * is saved, then confirm. After a reset the device caches of topic progress
 * are cleared and the page reloads its numbers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { Button, Dialog, DialogFooter, Select, useToast } from "@/components/ui";
import { topicResetCopy } from "@/lib/topic-reset/copy";
import { clearTopicProgressCaches } from "@/lib/topic-reset/client";

export interface TopicResetSubject {
  topic: string;
  answered: number;
}

let enabledPromise: Promise<boolean> | null = null;
function readEnabled(): Promise<boolean> {
  enabledPromise ??= authFetch("/api/user/topic-progress/reset", { timeoutMs: 8_000 })
    .then(async (r) => (r.ok ? Boolean((await r.json())?.enabled) : false))
    .catch(() => false)
    .then((on) => {
      if (!on) enabledPromise = null; // ask again on the next mount
      return on;
    });
  return enabledPromise;
}

export function TopicResetAction({
  lang,
  examType,
  subjects,
  freeAccount,
  onDone,
}: {
  lang: string;
  examType: string;
  subjects: TopicResetSubject[];
  freeAccount: boolean;
  onDone: () => void;
}) {
  const copy = topicResetCopy(lang);
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    void readEnabled().then((on) => { if (live) setEnabled(on); });
    return () => { live = false; };
  }, []);

  const withProgress = useMemo(
    () => subjects.filter((s) => s.answered > 0).sort((a, b) => a.topic.localeCompare(b.topic, "de")),
    [subjects],
  );

  useEffect(() => {
    if (!open) { setError(""); return; }
    if (!withProgress.some((s) => s.topic === topic)) setTopic(withProgress.length === 1 ? withProgress[0].topic : "");
  }, [open, withProgress, topic]);

  if (!enabled || !examType) return null;

  const submit = async () => {
    if (!topic || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/user/topic-progress/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exam_type: examType, topic }),
        timeoutMs: 25_000,
      });
      const body = await res.json().catch(() => null) as { code?: string } | null;
      if (res.ok && body?.code === "reset") {
        clearTopicProgressCaches();
        setOpen(false);
        toast.success(copy.done(topic));
        onDone();
      } else if (res.ok && body?.code === "empty") {
        setError(copy.empty);
      } else if (res.status === 429) {
        setError(copy.rateLimited);
      } else if (res.status >= 500) {
        // The transaction may have committed after the answer was lost.
        setError(copy.unconfirmed);
        onDone();
      } else {
        setError(copy.failed);
      }
    } catch {
      setError(copy.unconfirmed);
      onDone();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1" data-topic-reset>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-sm text-[var(--mp-fg-muted)] underline-offset-4 hover:text-[var(--mp-fg)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {copy.entry}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => { if (!busy) setOpen(next); }}
        title={copy.title}
        kind="form"
        placement="auto"
        busy={busy}
        footer={
          <DialogFooter>
            <Button variant="secondary" className="shrink-0 whitespace-nowrap [hyphens:none]" data-dialog-safe onClick={() => setOpen(false)} disabled={busy}>
              {copy.cancel}
            </Button>
            <Button
              variant="destructive"
              className="min-w-0 [hyphens:none]"
              loading={busy}
              loadingLabel={copy.busy}
              aria-disabled={!topic || busy || undefined}
              onClick={() => { void submit(); }}
            >
              {busy ? copy.busy : copy.confirm}
            </Button>
          </DialogFooter>
        }
      >
        <div className="space-y-3 text-sm text-[var(--mp-fg)]">
          {withProgress.length === 0 ? (
            <p>{copy.noneYet}</p>
          ) : (
            <Select
              label={copy.subjectLabel}
              value={topic}
              onChange={(e) => { setTopic(e.target.value); setError(""); }}
              disabled={busy}
              options={[
                { value: "", label: copy.subjectPlaceholder, disabled: true },
                ...withProgress.map((s) => ({ value: s.topic, label: s.topic })),
              ]}
            />
          )}
          <p>{copy.body}</p>
          <p>{copy.kept}</p>
          <p>{copy.saved}</p>
          {freeAccount && <p className="text-[var(--mp-fg-muted)]">{copy.freeNote}</p>}
          {error && (
            <p role="alert" className="rounded-lg border border-[var(--mp-error)]/40 bg-[var(--mp-surface-sunken)] p-2 text-[var(--mp-error-text)]">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
