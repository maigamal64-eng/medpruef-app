"use client";

/**
 * Exam results (UX-EXM-28/29/30, SIM-02, CNT-13). One hero number, one status
 * chip from the run's own pass rule, the breakdown tiles, subjects weakest
 * first with a 60 percent mark, then the next step. A practice threshold is
 * never called a pass mark; the SIP block rule is quoted with its source.
 */
import Link from "next/link";
import { Clock, ExternalLink } from "lucide-react";
import { ResultCard } from "@/components/ui/ResultCard";
import { StatTile } from "@/components/ui/StatTile";
import { STP_POSITIVE_FIELDS_REQUIRED, type SubjectResult } from "@/lib/master-exam";
import { formatDurationLabel, formatMinSec, practiseIdsHref, weakestSubject, type RunVerdict } from "@/lib/exam-run";
import { examLang, te } from "@/lib/i18n-exam";
import ReferralInviteLine from "@/components/referrals/ReferralInviteLine";

export interface ExamResultsProps {
  lang: string;
  examSource: string;
  isPart: boolean;
  verdict: RunVerdict;
  subjects: readonly SubjectResult[];
  counts: { total: number; correct: number; wrong: number; open: number; flagged: number };
  durationMs: number | null;
  timeExpired: boolean;
  missedIds: readonly number[];
  daysToExam: number | null;
  isPaid: boolean;
  saveState: "idle" | "saving" | "saved" | "failed" | "rejected";
  savedAttemptId: string | null;
  saveError: React.ReactNode;
  formatExamKey: string | null;
  onReview: (filter: "wrong" | "all", topic?: string) => void;
  onNewExam: () => void;
}

const SMALL_N = 5;

function statusFor(v: RunVerdict): { status: "above" | "below" | "practice"; emphasise: boolean } {
  if (v.kind === "practice" || !v.evaluation) return { status: "practice", emphasise: false };
  const ok = v.kind === "threshold" ? v.evaluation.overallPct >= 0.6 : v.evaluation.passed;
  return { status: ok ? "above" : "below", emphasise: ok };
}

function chipLabel(v: RunVerdict, lang: string): string {
  const e = v.evaluation;
  if (v.kind === "practice" || !e) return te("result_practice", lang);
  if (v.kind === "threshold") return te(e.overallPct >= 0.6 ? "result_above" : "result_below", lang);
  if (v.kind === "fields") {
    return te("result_fields", lang, { n: e.positiveUnits.length, total: e.positiveUnits.length + e.negativeUnits.length, need: STP_POSITIVE_FIELDS_REQUIRED });
  }
  if (e.passed) return te("result_blocks_all", lang);
  if (e.overallPct < 0.6) return te("result_blocks_overall_low", lang);
  return te("result_blocks_some", lang, { n: e.negativeUnits.length, total: e.positiveUnits.length + e.negativeUnits.length });
}

export function ExamResults(p: ExamResultsProps) {
  const { lang, verdict } = p;
  const pct = p.counts.total > 0 ? Math.round((p.counts.correct / p.counts.total) * 100) : 0;
  const { status, emphasise } = statusFor(verdict);
  const weakest = weakestSubject(p.subjects, SMALL_N);
  const sorted = [...p.subjects].sort((a, b) => a.pct - b.pct || b.total - a.total);
  const answered = p.counts.correct + p.counts.wrong;
  const avg = p.durationMs !== null && answered > 0 ? p.durationMs / 1000 / answered : null;
  const missed = p.missedIds.length;

  const primary = missed > 0
    ? <Link href={practiseIdsHref(p.missedIds, p.examSource)} className="mp-btn mp-btn--primary w-full min-h-12 justify-center">{te("cta_practise_misses", lang, { n: missed })}</Link>
    : weakest
      ? <Link href={`/quiz?${new URLSearchParams({ examSource: p.examSource, topic: weakest.topic })}`} className="mp-btn mp-btn--primary w-full min-h-12 justify-center">{te("cta_practise_weakest", lang, { topic: weakest.topic })}</Link>
      : null;

  return (
    <div>
      <h1 className="mp-h2 mb-2">{te("result_title", lang)}</h1>
      {status === "below" || p.timeExpired ? <p className="mb-4 text-sm text-[var(--mp-fg-muted)]">{te("result_calm", lang)}</p> : null}

      <ResultCard
        className="mb-4"
        label={p.isPart || verdict.kind === "practice" ? te("result_selection_label", lang) : te("result_label", lang)}
        value={`${pct} %`}
        status={status}
        statusLabel={chipLabel(verdict, lang)}
        emphasise={emphasise}
        thresholdNote={verdict.kind === "threshold" ? te("result_threshold_note", lang) : undefined}
        note={te("result_note", lang)}
        saveState={p.saveState === "saved" ? "saved" : p.saveState === "failed" ? "failed" : p.saveState === "saving" ? "saving" : "none"}
        saveLabel={te(p.saveState === "saved" ? "saved" : p.saveState === "failed" ? "not_saved" : "saving", lang)}
        primary={primary}
      >
        {p.timeExpired && <p role="status" className="mb-2 inline-flex items-center gap-1.5 text-sm text-[var(--mp-fg)]"><Clock className="w-4 h-4" aria-hidden />{te("result_time_up", lang)}</p>}
        {p.daysToExam !== null && p.daysToExam >= 0 && <p className="text-sm text-[var(--mp-fg-muted)]">{p.daysToExam === 1 ? te("days_to_exam_one", lang) : te("days_to_exam", lang, { n: p.daysToExam })}</p>}
      </ResultCard>

      {verdict.kind === "blocks" && verdict.evaluation && (
        <div className="mp-card p-4 mb-4 text-sm text-[var(--mp-fg)] space-y-2">
          <p>{te("result_blocks_rule", lang)}</p>
          {!verdict.evaluation.passed && verdict.evaluation.overallPct >= 0.6 && verdict.evaluation.negativeUnits.length > 0 && (
            <p className="font-semibold">{te("result_blocks_repeat", lang, { list: verdict.evaluation.negativeUnits.join(", ") })}</p>
          )}
          {p.formatExamKey && (
            <Link href={`/exam-formats/${p.formatExamKey}`} className="inline-flex items-center gap-1 underline min-h-11">
              {te("result_rule_source", lang)}<ExternalLink className="w-3.5 h-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}

      {p.saveError}

      {/* a-referral-surface: invite line only above the run's own threshold (never on practice or below). */}
      {status === "above" && <ReferralInviteLine lang={lang} surface="mock_exam" className="mb-6" />}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
        <StatTile label={te("tile_correct", lang)} value={p.counts.correct} />
        <StatTile label={te("tile_wrong", lang)} value={p.counts.wrong} />
        <StatTile label={te("tile_open", lang)} value={p.counts.open} />
        <StatTile label={te("tile_flagged", lang)} value={p.counts.flagged} />
        {p.durationMs !== null && <StatTile label={te("tile_time", lang)} value={formatDurationLabel(p.durationMs / 1000, examLang(lang))} />}
        {avg !== null && <StatTile label={te("tile_avg", lang)} value={formatMinSec(avg)} />}
      </div>

      <h2 className="text-base font-semibold text-[var(--mp-fg)] mb-1">{te("subjects_title", lang)}</h2>
      <p className="text-[13px] text-[var(--mp-fg-muted)] mb-2">{te("subjects_threshold", lang)}</p>
      <ul className="space-y-1 mb-6">
        {sorted.map((s) => {
          const sp = Math.round(s.pct * 100);
          const small = s.total < SMALL_N;
          const ok = s.pct >= 0.6;
          const tone = small ? "var(--mp-fg-muted)" : ok ? "var(--mp-viridian)" : "var(--mp-error-text)";
          return (
            <li key={s.topic}>
              <button type="button" onClick={() => p.onReview("wrong", s.topic)} className="w-full min-h-11 rounded-lg px-3 py-2 text-left hover:bg-[var(--mp-surface-sunken)] focus-visible:outline focus-visible:outline-2" aria-label={te("subject_open_review", lang, { topic: s.topic })}>
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--mp-fg)] min-w-0 break-words">{s.topic}</span>
                  <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: tone }}>
                    {small ? te("subject_small_n", lang, { n: s.total }) : `${sp} %`} <span className="text-[var(--mp-fg-muted)]">{s.correct}/{s.total}</span>
                  </span>
                </span>
                <span className="relative mt-1.5 block h-2 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden" aria-hidden>
                  <span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${sp}%`, background: tone }} />
                  <span className="absolute inset-y-0 w-0.5 bg-[var(--mp-fg)]" style={{ insetInlineStart: "60%" }} />
                </span>
                {s.avgSecondsPerQuestion !== null && <span className="mt-1 block text-[13px] text-[var(--mp-fg-muted)]">{te("subject_avg", lang, { time: formatMinSec(s.avgSecondsPerQuestion) })}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2">
        {p.counts.wrong + p.counts.open > 0 && <button type="button" className="mp-btn mp-btn--secondary min-h-12" onClick={() => p.onReview("wrong")}>{te("cta_review_wrong", lang)}</button>}
        <button type="button" className="mp-btn mp-btn--secondary min-h-12" onClick={() => p.onReview("all")}>{te("cta_review_all", lang)}</button>
        {missed > 0 && weakest && <Link className="mp-btn mp-btn--ghost min-h-11" href={`/quiz?${new URLSearchParams({ examSource: p.examSource, topic: weakest.topic })}`}>{te("cta_practise_weakest", lang, { topic: weakest.topic })}</Link>}
        <Link className="mp-btn mp-btn--ghost min-h-11" href="/study-plan">{te("cta_study_plan", lang)}</Link>
        {p.savedAttemptId && p.isPaid && <Link className="mp-btn mp-btn--ghost min-h-11" href={`/history/${p.savedAttemptId}`}>{te("cta_history", lang)}</Link>}
        {p.saveState === "saved" && !p.isPaid && <p className="text-sm text-[var(--mp-fg-muted)]">{te("saved_free", lang)}</p>}
        <Link className="mp-btn mp-btn--ghost min-h-11" href="/dashboard/exam-result">{te("cta_real_result", lang)}</Link>
        <button type="button" className="mp-btn mp-btn--ghost min-h-11 underline" onClick={p.onNewExam}>{te("cta_new_exam", lang)}</button>
      </div>
    </div>
  );
}
