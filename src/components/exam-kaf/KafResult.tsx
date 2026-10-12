"use client";

import Link from "next/link";
import { ResultCard } from "@/components/ui";
import { fill, type KafCopy } from "@/lib/i18n-kaf";
import { cleanTyped, kafResultCounts, type KafSession } from "@/lib/kaf-run";

export type KafSaveState = "idle" | "saving" | "saved" | "failed" | "rejected";

export interface KafResultProps {
  copy: KafCopy;
  session: KafSession;
  saveState: KafSaveState;
  authExpired: boolean;
  onRetrySave: () => void;
  onDiscard: () => void;
  onNewRun: () => void;
}

/** Self-marked score, labelled practice; no pass or fail word (no confirmed KAF rule applies here). */
export function KafResult({ copy, session, saveState, authExpired, onRetrySave, onDiscard, onNewRun }: KafResultProps) {
  const counts = kafResultCounts(session.items, session.answers, session.marks);
  const cardSave = saveState === "saved" ? "saved" : saveState === "saving" || saveState === "idle" ? "saving" : "failed";
  const saveLabel = saveState === "saved" ? copy.saved : saveState === "rejected" ? copy.saveRejected : saveState === "failed" ? copy.saveFailed : copy.saving;
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10 space-y-4">
      <h1 className="font-display text-2xl font-bold text-[var(--mp-fg)]">{copy.resultHeading}</h1>
      <ResultCard
        value={fill(copy.resultValue, { r: counts.right, n: counts.total })}
        label={copy.resultLabel}
        status="practice"
        statusLabel={copy.practiceLabel}
        note={copy.resultNote}
        thresholdNote={session.timeExpired ? copy.timeoutLine : undefined}
        saveState={cardSave}
        saveLabel={saveLabel}
        primary={
          saveState === "saved"
            ? <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={onNewRun}>{copy.newRun}</button>
            : saveState === "rejected"
              ? <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onDiscard}>{copy.discardResult}</button>
              : <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onRetrySave} disabled={saveState === "saving"}>{copy.retrySave}</button>
        }
      >
        <p className="text-sm text-[var(--mp-fg-muted)]">{fill(copy.answeredLine, { a: counts.answered, n: counts.total })}</p>
        {authExpired && (
          <p className="text-sm mt-2" role="alert">
            {copy.authExpired} <Link className="underline" href="/login?next=%2Fexam%2Fkaf">{copy.signIn}</Link>
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          {saveState === "saved" && <Link href="/history" className="mp-btn mp-btn--secondary min-h-11 inline-flex">{copy.toHistory}</Link>}
          <Link href="/exam" className="mp-btn mp-btn--ghost min-h-11 inline-flex">{copy.backToExam}</Link>
        </div>
      </ResultCard>

      <ol className="space-y-2">
        {session.items.map((item, idx) => {
          const typed = cleanTyped(session.answers[String(item.id)], item.required);
          const right = typed.length > 0 && session.marks[String(item.id)] === true;
          const key = session.keys?.[String(item.id)];
          return (
            <li key={item.id} className="mp-card p-3 text-sm space-y-1">
              <p className="text-xs font-mono text-[var(--mp-fg-subtle)]">{fill(copy.questionOf, { i: idx + 1, n: session.items.length })} · {right ? copy.itemRight : copy.itemNotRight}</p>
              <p lang="de" dir="ltr" className="line-clamp-3">{item.stem}</p>
              <p><span className="text-[var(--mp-fg-muted)]">{copy.yourAnswer}: </span><span lang="de" dir="ltr">{typed.length > 0 ? typed.join("; ") : copy.noAnswer}</span></p>
              {key && <p><span className="text-[var(--mp-fg-muted)]">{copy.modelAnswer}: </span><span lang="de" dir="ltr">{key.model_answer}</span></p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
