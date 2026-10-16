"use client";

/**
 * Result of a self-check: score with the strict-grading note, the result by
 * subject area, the visitor's own answers (no explanations), then
 * "Für welchen Termin lernen Sie?" (official sittings of the bank or "Noch
 * offen") and "Ergebnis und Plan speichern", which opens the free signup with
 * intent selftest. The answers wait in this browser for one hour and land in
 * the account after sign-in (carry.ts).
 */
import { useEffect, useState } from "react";
import { ResultCard } from "@/components/ui/ResultCard";
import { Option, optionStateFor } from "@/components/ui/Option";
import ExamSittingPicker from "@/components/ExamSittingPicker";
import { buildAuthHref, persistAuthEntry } from "@/lib/auth-entry";
import { getSessionToken, getStoredSession } from "@/lib/auth";
import { safeStorage } from "@/lib/safe-storage";
import { trackFunnelEvent } from "@/lib/funnel-events";
import {
  SELFTEST_PENDING_KEY,
  isSelftestSitting,
  pendingRecord,
  selftestNext,
  type SelftestBank,
  type SelftestItem,
  type SelftestPendingAnswer,
  type SelftestScore,
} from "@/lib/public-selftest";
import { carrySelftest } from "@/lib/public-selftest/carry";
import { fieldLabel, selftestCopy, type SelftestLang } from "@/lib/public-selftest/copy";

export interface FinishedRun {
  bank: SelftestBank;
  items: SelftestItem[];
  selections: Record<number, number[]>;
  spentMs: Record<number, number>;
  timedOut: boolean;
  score: SelftestScore;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The answers as /api/answer records them (selected option texts, the strict verdict, the served key). Exported for tests. */
export function pendingAnswers(run: FinishedRun, ids: Record<number, string>): SelftestPendingAnswer[] {
  return run.items.flatMap((it) => {
    const picks = run.selections[it.id] ?? [];
    if (!picks.length) return [];
    const graded = run.score.items.find((g) => g.id === it.id);
    return [{
      id: it.id,
      requestId: ids[it.id],
      userAnswer: picks.map((i) => it.options[i]?.text).filter(Boolean).join(" | ").slice(0, 2000),
      isCorrect: graded?.isCorrect === true,
      timeSpentMs: Math.min(3_600_000, Math.max(0, Math.round(run.spentMs[it.id] ?? 0))),
      keyFingerprint: it.keyFingerprint,
    }];
  });
}

export default function SelftestResult({ lang, run, source, onRestart }: { lang: SelftestLang; run: FinishedRun; source: string; onRestart: () => void }) {
  const { score } = run;
  const [sitting, setSitting] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  // One request id per answer for the life of this result: a second tap or a replay is a duplicate on the server.
  const [requestIds] = useState<Record<number, string>>(() => Object.fromEntries(run.items.map((it) => [it.id, newRequestId()])));

  useEffect(() => {
    const user = getStoredSession()?.user;
    setSignedIn(!!user && !user.id.startsWith("guest_") && !!getSessionToken());
  }, []);

  const named = !!sitting && isSelftestSitting(run.bank, sitting);
  const next = selftestNext(run.bank, named ? (sitting as string) : "");
  const answers = pendingAnswers(run, requestIds);

  const save = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (saving) { e.preventDefault(); return; }
    trackFunnelEvent("selftest_register_click", { exam: run.bank, sitting: named ? "named" : "open", source });
    if (answers.length) {
      safeStorage.setItem(SELFTEST_PENDING_KEY, pendingRecord({ bank: run.bank, sitting: named ? (sitting as string) : "", answers }, Date.now()));
    } else {
      // Nothing answered: an older record of an earlier run must not ride along.
      safeStorage.removeItem(SELFTEST_PENDING_KEY);
    }
    if (!signedIn) {
      persistAuthEntry({ intent: answers.length ? "selftest" : "free", exam: run.bank, next });
      return; // the link opens the signup
    }
    e.preventDefault();
    setSaving(true);
    try { await carrySelftest(); } catch { /* the plan page still opens */ }
    window.location.assign(next);
  };

  const href = signedIn ? next : buildAuthHref({ intent: answers.length ? "selftest" : "free", exam: run.bank, next });

  return (
    <div className="min-w-0 space-y-5" data-testid="selftest-result">
      <h2 id="selftest-result-title" tabIndex={-1} className="sr-only">{selftestCopy("result_label", lang)}</h2>
      {run.timedOut && <p role="status" className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3 text-sm" data-testid="selftest-timeout">{selftestCopy("timeout", lang)}</p>}
      <ResultCard
        label={selftestCopy("result_label", lang)}
        value={selftestCopy("result_value", lang, { c: score.correct, n: score.total })}
        status="practice"
        statusLabel={selftestCopy("result_status", lang)}
        note={selftestCopy("result_note", lang)}
      >
        <h3 className="text-base font-bold">{selftestCopy("fields_title", lang)}</h3>
        <ul className="mt-2 divide-y divide-[var(--mp-border)]" data-testid="selftest-fields">
          {score.fields.map((f) => (
            <li key={f.field} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{fieldLabel(f.field, lang)}</span>
              <span className="text-[var(--mp-fg-muted)]">{selftestCopy("field_line", lang, { c: f.correct, n: f.total })}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="mp-btn mp-btn--secondary mt-4 min-h-11" aria-expanded={showReview} onClick={() => setShowReview((v) => !v)} data-testid="selftest-review-toggle">
          {selftestCopy(showReview ? "review_hide" : "review_show", lang)}
        </button>
      </ResultCard>

      {showReview && (
        <section className="space-y-4" aria-labelledby="selftest-review-title" data-testid="selftest-review">
          <h3 id="selftest-review-title" className="text-lg font-bold">{selftestCopy("review_title", lang)}</h3>
          {run.items.map((it, n) => {
            const picks = run.selections[it.id] ?? [];
            return (
              <article key={it.id} className="mp-card min-w-0 space-y-2.5 p-4 sm:p-5">
                <p className="text-[13px] font-semibold text-[var(--mp-fg-muted)]">{n + 1}. {fieldLabel(it.field, lang)}{picks.length ? "" : ` · ${selftestCopy("review_open", lang)}`}</p>
                <p lang="de" className="font-semibold leading-snug [overflow-wrap:anywhere]">{it.question}</p>
                <div className="space-y-2" lang="de">
                  {it.options.map((o, i) => (
                    <Option key={i} static letter={LETTERS[i]} state={optionStateFor({ answered: true, selected: picks.includes(i), correct: o.correct })} className="[overflow-wrap:anywhere]">
                      {o.text}
                    </Option>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="mp-card min-w-0 space-y-3 p-5 sm:p-6" aria-labelledby="selftest-sitting-title" data-testid="selftest-sitting">
        <h3 id="selftest-sitting-title" className="text-lg font-bold">{selftestCopy("sitting_title", lang)}</h3>
        <p id="selftest-sitting-hint" className="text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{selftestCopy("sitting_hint", lang)}</p>
        <ExamSittingPicker
          examType={run.bank}
          value={sitting}
          onChange={setSitting}
          lang={lang}
          allowCustom={false}
          noneLabel={selftestCopy("sitting_open", lang)}
          noneNote={selftestCopy("sitting_open_note", lang)}
          describedBy="selftest-sitting-hint"
        />
      </section>

      <section className="mp-card min-w-0 space-y-3 border-[var(--mp-viridian)] p-5 sm:p-6" aria-labelledby="selftest-save-title" data-testid="selftest-save">
        <h3 id="selftest-save-title" className="text-lg font-bold">{selftestCopy("save_title", lang)}</h3>
        <p className="text-sm leading-relaxed text-[var(--mp-fg-muted)]">{selftestCopy(named ? "save_body_named" : "save_body_open", lang)}</p>
        <a href={href} onClick={save} aria-busy={saving || undefined} className="mp-btn mp-btn--primary min-h-11 w-full sm:w-auto" data-testid="selftest-save-cta">
          {saving ? selftestCopy("save_saving", lang) : selftestCopy(signedIn ? "save_cta_signed_in" : "save_cta", lang)}
        </a>
        {!signedIn && <p className="text-[13px] text-[var(--mp-fg-muted)]">{selftestCopy("save_terms", lang)}</p>}
      </section>

      <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={onRestart} data-testid="selftest-restart">{selftestCopy("restart", lang)}</button>
    </div>
  );
}
