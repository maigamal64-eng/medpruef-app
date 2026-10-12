"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Clock, Map as MapIcon } from "lucide-react";
import { AppLayout, Dialog, QuestionImage } from "@/components/ui";
import ImageLightbox from "@/components/ImageLightbox";
import { remainingSeconds } from "@/lib/examSession";
import { wallClockRemaining } from "@/lib/practice-exam-state";
import { fill, type KafCopy } from "@/lib/i18n-kaf";
import { cleanTyped, formatClock, KAF_ANSWER_MAX_CHARS, type KafSession } from "@/lib/kaf-run";

export interface KafRunnerProps {
  copy: KafCopy;
  session: KafSession;
  online: boolean;
  autosaveFailed: boolean;
  onAnswer: (id: number, slot: number, text: string) => void;
  onNavigate: (idx: number) => void;
  /** expired = the practice clock reached zero. */
  onSubmit: (expired: boolean) => void;
  onLeave: () => void;
}

export function KafRunner({ copy, session, online, autosaveFailed, onAnswer, onNavigate, onSubmit, onLeave }: KafRunnerProps) {
  const { items, currentIdx, startedAt, durationS } = session;
  const item = items[currentIdx];
  const total = items.length;
  const answered = items.filter((it) => cleanTyped(session.answers[String(it.id)], it.required).length > 0).length;
  const [timeLeft, setTimeLeft] = useState(() => remainingSeconds(startedAt, durationS));
  const [notice, setNotice] = useState("");
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [confirm, setConfirm] = useState<"submit" | "leave" | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef(onSubmit);
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);

  // Wall-clock timer (same helpers as /exam): survives reload, sleep and
  // background tabs; resyncs when the page becomes visible again.
  useEffect(() => {
    let previous = remainingSeconds(startedAt, durationS);
    const milestones = new Set<number>();
    const tick = () => {
      previous = wallClockRemaining(startedAt, durationS, Date.now(), previous);
      setTimeLeft(previous);
      for (const minutes of [30, 10, 5]) {
        if (previous > 0 && previous <= minutes * 60 && !milestones.has(minutes)) {
          milestones.add(minutes);
          setNotice(fill(copy.timeNotice, { n: minutes }));
        }
      }
      if (previous === 0) submitRef.current(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", tick);
      window.removeEventListener("focus", tick);
    };
  }, [startedAt, durationS, copy.timeNotice]);

  useLayoutEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [currentIdx]);

  if (!item) return null;
  const typed = session.answers[String(item.id)] ?? [];
  const slots = Array.from({ length: item.required }, (_, i) => i);

  return (
    <AppLayout variant="focus">
      <main id="main" className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]">
        <header className="px-3 py-2 border-b border-[var(--mp-border)] flex-shrink-0 bg-[var(--mp-surface-raised)]">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="mp-btn mp-btn--ghost min-h-11 px-1 text-sm" onClick={() => setConfirm("leave")}>{copy.leave}</button>
            <span dir="ltr" aria-label={`${copy.timeLeft} ${formatClock(timeLeft)}`} className={`inline-flex gap-1 items-center font-mono tabular-nums font-bold ${timeLeft <= 300 ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg)]"}`}>
              <Clock className="w-4 h-4" aria-hidden />{formatClock(timeLeft)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setOverviewOpen(true)}>
              <MapIcon className="w-4 h-4" aria-hidden />{copy.overview} <bdi>{answered}/{total}</bdi>
            </button>
            <span className="font-mono text-xs">{fill(copy.questionOf, { i: currentIdx + 1, n: total })}</span>
          </div>
          <p className="sr-only" aria-live="polite">{notice}</p>
          {notice && <p className="text-xs text-[var(--mp-fg-muted)] mt-1" aria-hidden>{notice}</p>}
          {!online && <p className="text-xs text-[var(--mp-fg-muted)] mt-1" role="status">{copy.offline}</p>}
          {autosaveFailed && <p className="text-xs text-[var(--mp-error-text)] mt-1" role="alert">{copy.autosaveFailed}</p>}
        </header>

        <div ref={paneRef} className="mp-exam-pane flex-1 px-4 py-4 lg:px-10">
          <div className="max-w-2xl mx-auto space-y-4">
            <p className="text-xs uppercase tracking-wide text-[var(--mp-fg-subtle)]">{item.topic}</p>
            <h2 ref={headingRef} tabIndex={-1} data-question-heading className="text-base lg:text-lg leading-relaxed text-[var(--mp-fg)] whitespace-pre-line outline-none" lang="de" dir="ltr">
              {item.stem}
            </h2>
            {item.image_url && (
              <QuestionImage src={item.image_url} alt={copy.imageAlt} onOpen={() => setLightbox(item.image_url)} />
            )}
            {item.required > 1 && <p className="text-sm text-[var(--mp-fg-muted)]">{fill(copy.requiredHint, { n: item.required })}</p>}
            <div className="space-y-3">
              {slots.map((slot) => {
                const id = `kaf-answer-${item.id}-${slot}`;
                return (
                  <div key={id} className="space-y-1">
                    <label htmlFor={id} className="text-sm font-semibold">
                      {item.required > 1 ? fill(copy.answerN, { i: slot + 1 }) : copy.answerSingle}
                    </label>
                    <input
                      id={id}
                      type="text"
                      lang="de"
                      dir="ltr"
                      className="mp-field w-full min-h-11 px-3 py-2 rounded-md border border-[var(--mp-border-control)] bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]"
                      style={{ fontSize: 16 }}
                      value={typed[slot] ?? ""}
                      maxLength={KAF_ANSWER_MAX_CHARS}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      enterKeyHint={currentIdx < total - 1 ? "next" : "done"}
                      onChange={(e) => onAnswer(item.id, slot, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <footer className="flex-shrink-0 border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2 safe-area-bottom">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => onNavigate(currentIdx - 1)} disabled={currentIdx === 0}>{copy.prev}</button>
            {currentIdx < total - 1 ? (
              <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => onNavigate(currentIdx + 1)}>{copy.next}</button>
            ) : (
              <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => setConfirm("submit")}>{copy.submit}</button>
            )}
          </div>
        </footer>
      </main>

      <Dialog open={overviewOpen} onOpenChange={setOverviewOpen} title={copy.overview} description={fill(copy.answeredOf, { a: answered, n: total })} placement="auto" kind="content">
        <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
          {items.map((it, idx) => {
            const done = cleanTyped(session.answers[String(it.id)], it.required).length > 0;
            return (
              <button
                key={it.id}
                type="button"
                aria-label={fill(copy.goToQuestion, { i: idx + 1, state: done ? copy.answeredState : copy.openState })}
                aria-current={idx === currentIdx ? "step" : undefined}
                className={`min-h-11 rounded-md font-mono text-sm border ${done ? "bg-[var(--mp-viridian)] text-white border-transparent" : "border-[var(--mp-border)] text-[var(--mp-fg)]"} ${idx === currentIdx ? "ring-2 ring-[var(--mp-focus-color)]" : ""}`}
                onClick={() => { onNavigate(idx); setOverviewOpen(false); }}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
        <button type="button" className="mp-btn mp-btn--primary min-h-11 w-full mt-4" onClick={() => { setOverviewOpen(false); setConfirm("submit"); }}>{copy.submit}</button>
      </Dialog>

      <Dialog
        open={confirm === "submit"}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={copy.submitTitle}
        description={fill(copy.submitBody, { a: answered, n: total })}
        kind="confirm"
        footer={
          <>
            <button type="button" data-dialog-safe className="mp-btn mp-btn--secondary min-h-11" onClick={() => setConfirm(null)}>{copy.cancel}</button>
            <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => { setConfirm(null); onSubmit(false); }}>{copy.submit}</button>
          </>
        }
      />

      <Dialog
        open={confirm === "leave"}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={copy.leaveTitle}
        description={copy.leaveBody}
        kind="confirm"
        footer={
          <>
            <button type="button" data-dialog-safe className="mp-btn mp-btn--primary min-h-11" onClick={() => setConfirm(null)}>{copy.stay}</button>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => { setConfirm(null); onLeave(); }}>{copy.leave}</button>
          </>
        }
      />

      {lightbox && <ImageLightbox src={lightbox} alt={copy.imageAlt} onClose={() => setLightbox(null)} />}
    </AppLayout>
  );
}
