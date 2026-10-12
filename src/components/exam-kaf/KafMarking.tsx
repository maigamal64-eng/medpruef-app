"use client";

import { useLayoutEffect, useRef } from "react";
import { AppLayout } from "@/components/ui";
import { fill, type KafCopy } from "@/lib/i18n-kaf";
import { cleanTyped, suggestMark, type KafSession } from "@/lib/kaf-run";

export type KafKeysState = "loading" | "ready" | "error";

export interface KafMarkingProps {
  copy: KafCopy;
  session: KafSession;
  keysState: KafKeysState;
  onRetryKeys: () => void;
  /** The learner's own decision; it is final for the score. */
  onMark: (id: number, right: boolean) => void;
  onFinish: () => void;
}

/**
 * Self-marking: the learner's text next to the reviewed model answer, its key
 * points and a suggestion from suggestMark. Only the learner's tap decides.
 * Unanswered items count as not right and need no decision.
 */
export function KafMarking({ copy, session, keysState, onRetryKeys, onMark, onFinish }: KafMarkingProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const answeredIds = session.items.filter((it) => cleanTyped(session.answers[String(it.id)], it.required).length > 0).map((it) => it.id);
  const decided = answeredIds.filter((id) => typeof session.marks[String(id)] === "boolean").length;
  const allDecided = decided === answeredIds.length;

  return (
    <AppLayout variant="focus">
      <main id="main" className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]">
        <div className="mp-exam-pane flex-1 px-4 py-4 lg:px-10">
          <div className="max-w-2xl mx-auto space-y-4">
            <header className="space-y-2">
              <h1 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold text-[var(--mp-fg)] outline-none">{copy.markingTitle}</h1>
              <p className="text-sm text-[var(--mp-fg-muted)]">{copy.markingIntro}</p>
              {session.timeExpired && <p className="text-sm text-[var(--mp-fg-muted)]" role="status">{copy.timeUp}</p>}
            </header>

            {keysState === "loading" && <p role="status" className="text-sm">{copy.keysLoading}</p>}
            {keysState === "error" && (
              <div className="mp-card p-4 space-y-3" role="alert">
                <p className="text-sm">{copy.keysError}</p>
                <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onRetryKeys}>{copy.retry}</button>
              </div>
            )}

            {keysState === "ready" && (
              <ol className="space-y-4">
                {session.items.map((item, idx) => {
                  const key = session.keys?.[String(item.id)];
                  const typed = cleanTyped(session.answers[String(item.id)], item.required);
                  const suggestion = key ? suggestMark(key.accepted, typed, key.key_points) : typed.length === 0 ? "empty" : "compare";
                  const mark = session.marks[String(item.id)];
                  const others = key ? key.accepted.flat().filter((a) => a !== key.model_answer && !key.key_points.includes(a)) : [];
                  const groupId = `kaf-mark-${item.id}`;
                  return (
                    <li key={item.id} className="mp-card p-4 space-y-3">
                      <p className="text-xs font-mono text-[var(--mp-fg-subtle)]">{fill(copy.questionOf, { i: idx + 1, n: session.items.length })} · {item.topic}</p>
                      <p className="text-sm whitespace-pre-line" lang="de" dir="ltr">{item.stem}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{copy.yourAnswer}</p>
                          {typed.length > 0
                            ? <ul className="text-sm" lang="de" dir="ltr">{typed.map((t, i) => <li key={i}>{t}</li>)}</ul>
                            : <p className="text-sm italic text-[var(--mp-fg-subtle)]">{copy.noAnswer}</p>}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{copy.modelAnswer}</p>
                          {key ? <p className="text-sm font-semibold" lang="de" dir="ltr">{key.model_answer}</p> : <p className="text-sm">{copy.keyMissing}</p>}
                          {key && key.key_points.length > 0 && (
                            <>
                              <p className="text-xs font-semibold text-[var(--mp-fg-muted)] mt-2">{copy.keyPoints}</p>
                              <ul className="text-sm list-disc ps-5" lang="de" dir="ltr">{key.key_points.map((k) => <li key={k}>{k}</li>)}</ul>
                            </>
                          )}
                          {others.length > 0 && (
                            <details className="mt-2 text-sm">
                              <summary className="cursor-pointer text-[var(--mp-fg-muted)]">{copy.alsoAccepted}</summary>
                              <ul className="list-disc ps-5" lang="de" dir="ltr">{others.map((o) => <li key={o}>{o}</li>)}</ul>
                            </details>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[var(--mp-fg-muted)]">
                        {suggestion === "matches" ? copy.suggestMatches : suggestion === "empty" ? copy.suggestEmpty : copy.suggestCompare}
                      </p>
                      {typed.length > 0 && (
                        <div role="radiogroup" aria-labelledby={`${groupId}-label`} className="flex flex-wrap gap-2">
                          <span id={`${groupId}-label`} className="sr-only">{fill(copy.questionOf, { i: idx + 1, n: session.items.length })}</span>
                          <button type="button" role="radio" aria-checked={mark === true} className={`mp-btn min-h-11 ${mark === true ? "mp-btn--primary" : "mp-btn--secondary"}`} onClick={() => onMark(item.id, true)}>{copy.markRight}</button>
                          <button type="button" role="radio" aria-checked={mark === false} className={`mp-btn min-h-11 ${mark === false ? "mp-btn--primary" : "mp-btn--secondary"}`} onClick={() => onMark(item.id, false)}>{copy.markWrong}</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <footer className="flex-shrink-0 border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2 safe-area-bottom">
          <div className="max-w-2xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--mp-fg-muted)]" aria-live="polite">{fill(copy.markedCount, { d: decided, n: answeredIds.length })}</span>
            <button type="button" className="mp-btn mp-btn--primary min-h-11" aria-disabled={!allDecided || keysState !== "ready"} onClick={() => { if (allDecided && keysState === "ready") onFinish(); }}>
              {copy.finish}
            </button>
          </div>
          {!allDecided && keysState === "ready" && <p className="max-w-2xl mx-auto text-xs text-[var(--mp-fg-subtle)] mt-1">{copy.finishNeedAll}</p>}
        </footer>
      </main>
    </AppLayout>
  );
}
