"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui";
import { Clock, Info, PenLine } from "lucide-react";
import { EXAM_FORMAT_DATA } from "@/lib/exam-formats";
import { fill, type KafCopy } from "@/lib/i18n-kaf";
import { countChoices } from "@/lib/kaf-run";

export type KafPoolState = "loading" | "ready" | "unavailable" | "error" | "pro";

const KAF_RULE = EXAM_FORMAT_DATA.rules.find((r) => r.id === "sip.kaf");
const KAF_SOURCE = KAF_RULE ? EXAM_FORMAT_DATA.sources[KAF_RULE.sourceId] : undefined;

export interface KafEntryProps {
  copy: KafCopy;
  formatLang: "de" | "en";
  poolState: KafPoolState;
  poolCount: number;
  count: number;
  onCount: (n: number) => void;
  onStart: () => void;
  starting: boolean;
  startError: boolean;
  onRetry: () => void;
  resumable: { answered: number; total: number } | null;
  onResume: () => void;
  onDiscard: () => void;
  pendingCount: number;
  onOpenPending: () => void;
}

export function KafEntry(props: KafEntryProps) {
  const { copy, formatLang, poolState, poolCount, count } = props;
  const choices = countChoices(poolCount);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10 space-y-4">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold text-[var(--mp-fg)] flex items-center gap-2">
          <PenLine className="w-6 h-6 text-[var(--mp-viridian)]" aria-hidden />
          {copy.title}
        </h1>
        <p className="text-[var(--mp-fg-muted)]">{copy.intro}</p>
        <p className="text-sm text-[var(--mp-fg-subtle)]">{copy.bankNote}</p>
      </header>

      {props.pendingCount > 0 && (
        <div className="mp-card p-4 flex flex-wrap items-center justify-between gap-3" role="status">
          <p className="text-sm">{copy.pendingTitle}</p>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={props.onOpenPending}>{copy.pendingAction}</button>
        </div>
      )}

      {props.resumable && (
        <div className="mp-card p-4 space-y-3">
          <p className="font-semibold">{copy.resumeTitle}</p>
          <p className="text-sm text-[var(--mp-fg-muted)]">{fill(copy.resumeBody, { a: props.resumable.answered, n: props.resumable.total })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={props.onResume}>{copy.resume}</button>
            <button type="button" className="mp-btn mp-btn--ghost min-h-11" onClick={() => setConfirmDiscard(true)}>{copy.discard}</button>
          </div>
          <Dialog
            open={confirmDiscard}
            onOpenChange={setConfirmDiscard}
            title={copy.discardTitle}
            description={copy.discardBody}
            kind="confirm"
            footer={
              <>
                <button type="button" data-dialog-safe className="mp-btn mp-btn--secondary min-h-11" onClick={() => setConfirmDiscard(false)}>{copy.cancel}</button>
                <button type="button" className="mp-btn mp-btn--destructive min-h-11" onClick={() => { setConfirmDiscard(false); props.onDiscard(); }}>{copy.discard}</button>
              </>
            }
          />
        </div>
      )}

      <section className="mp-card p-4 space-y-3" aria-labelledby="kaf-rule-title">
        <h2 id="kaf-rule-title" className="font-semibold flex items-center gap-2">
          <Info className="w-4 h-4" aria-hidden />
          {KAF_RULE?.title[formatLang] ?? copy.title}
        </h2>
        {KAF_RULE && <p className="text-sm text-[var(--mp-fg-muted)]">{KAF_RULE.text[formatLang]}</p>}
        {KAF_SOURCE && (
          <p className="text-xs">
            <a href={KAF_SOURCE.url} target="_blank" rel="noopener noreferrer" className="underline text-[var(--mp-fg-muted)]">
              {fill(copy.ruleSource, { label: KAF_SOURCE.label })}
            </a>
          </p>
        )}
        <p className="text-sm text-[var(--mp-fg)]">{copy.scopeNote}</p>
        <p className="text-sm flex items-center gap-2 text-[var(--mp-fg-muted)]">
          <Clock className="w-4 h-4" aria-hidden />
          {copy.clock}
        </p>
      </section>

      {poolState === "loading" && <p className="text-sm text-[var(--mp-fg-muted)]" role="status">{copy.loading}</p>}

      {poolState === "pro" && (
        <div className="mp-card p-4 space-y-3">
          <p className="font-semibold">{copy.proTitle}</p>
          <p className="text-sm text-[var(--mp-fg-muted)]">{copy.proBody}</p>
          <Link href="/pricing?gate=mock_exam" className="mp-btn mp-btn--primary min-h-11 inline-flex">{copy.proCta}</Link>
        </div>
      )}

      {poolState === "unavailable" && (
        <div className="mp-card p-4 space-y-3" role="status">
          <p className="font-semibold">{copy.unavailableTitle}</p>
          <p className="text-sm text-[var(--mp-fg-muted)]">{copy.unavailableBody}</p>
          <Link href="/exam" className="mp-btn mp-btn--secondary min-h-11 inline-flex">{copy.backToExam}</Link>
        </div>
      )}

      {(poolState === "error" || props.startError) && (
        <div className="mp-card p-4 space-y-3" role="alert">
          <p>{copy.loadError}</p>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={props.onRetry}>{copy.retry}</button>
        </div>
      )}

      {poolState === "ready" && choices.length > 0 && (
        <section className="mp-card p-4 space-y-4">
          <fieldset>
            <legend className="font-semibold mb-2">{copy.countLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {choices.map((n) => (
                <label key={n} className={`mp-btn min-h-11 cursor-pointer ${count === n ? "mp-btn--primary" : "mp-btn--secondary"}`}>
                  <input type="radio" name="kaf-count" value={n} checked={count === n} onChange={() => props.onCount(n)} className="sr-only" />
                  {fill(copy.countOption, { n })}
                </label>
              ))}
            </div>
            <p className="text-xs text-[var(--mp-fg-subtle)] mt-2">{fill(copy.poolCount, { n: poolCount })}</p>
          </fieldset>
          <button type="button" className="mp-btn mp-btn--primary min-h-11 w-full sm:w-auto" onClick={props.onStart} disabled={props.starting || !!props.resumable} aria-busy={props.starting}>
            {props.starting ? copy.starting : copy.start}
          </button>
        </section>
      )}

      <p className="text-sm">
        <Link href="/exam" className="underline text-[var(--mp-fg-muted)]">{copy.backToExam}</Link>
      </p>
    </div>
  );
}
