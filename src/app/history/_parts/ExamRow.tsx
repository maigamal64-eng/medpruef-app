"use client";

/**
 * One saved exam in the History list (UX-EXM-41): two lines, at least 56 px,
 * the whole row one tap target when the detail is available. Score as a
 * number plus a viridian bar with a 60 percent tick; at most one status chip,
 * only for runs with a threshold verdict. Summary rows (free, lapsed) are
 * read-only and never link to the detail (pick-ux-exm-38 B).
 */
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import { th, historyLang } from "@/lib/i18n-history";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { formatDurationLabel } from "@/lib/exam-run";
import {
  clampPct,
  formatDateTime,
  formatPct,
  thresholdChip,
  type AttemptRow,
  type ThresholdChip,
} from "./history-rules";

export function ScoreBar({ pct, lang }: { pct: number; lang: string }) {
  const value = clampPct(pct);
  return (
    <div
      role="img"
      aria-label={th("bar_label", lang, { pct: formatPct(value, lang) })}
      className="relative mt-2 h-1.5 w-full rounded-full bg-[var(--mp-border-subtle)]"
    >
      <div className="h-full rounded-full bg-[var(--mp-viridian)]" style={{ width: `${value}%` }} />
      <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 rounded bg-[var(--mp-fg-muted)]" style={{ left: "60%" }} />
    </div>
  );
}

export function StatusChip({ chip, lang }: { chip: ThresholdChip; lang: string }) {
  if (!chip) return null;
  const over = chip === "over";
  const Icon = over ? CheckCircle2 : AlertCircle;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${
        over ? "bg-[var(--mp-success-bg)] text-[var(--mp-success-text)]" : "bg-[var(--mp-warning-bg)] text-[var(--mp-warning-text)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {th(over ? "chip_over" : "chip_under", lang)}
    </span>
  );
}

export function attemptTitle(row: Pick<AttemptRow, "title" | "exam_type">, lang: string): string {
  return row.title ?? getExamLabel(row.exam_type, "full", historyLang(lang));
}

export default function ExamRow({ row, lang, linked }: { row: AttemptRow; lang: string; linked: boolean }) {
  const hl = historyLang(lang);
  const pct = clampPct(row.score_pct);
  const durationMs = typeof row.duration_ms === "number" && row.duration_ms >= 1000 ? row.duration_ms : null;
  const title = attemptTitle(row, lang);
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-[15px] text-[var(--mp-fg)] break-words">{title}</span>
          <StatusChip chip={thresholdChip(row)} lang={lang} />
        </div>
        {/* Items wrap whole; gaps instead of separator dots (no orphan dots). */}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-[var(--mp-fg-muted)]">
          {row.title && <span>{getExamLabel(row.exam_type, "full", hl)}</span>}
          <span>{formatDateTime(row.completed_at, lang)}</span>
          {durationMs !== null && <span>{th("row_duration", lang, { d: formatDurationLabel(durationMs / 1000, hl) })}</span>}
          <span>{th("row_correct", lang, { correct: row.correct_count, total: row.total_count })}</span>
        </div>
        <ScoreBar pct={pct} lang={lang} />
      </div>
      <span className="shrink-0 self-center font-mono text-lg font-black text-[var(--mp-fg)]">{formatPct(pct, lang)}</span>
      {linked && <ChevronRight className="h-5 w-5 shrink-0 self-center text-[var(--mp-fg-subtle)]" aria-hidden />}
    </>
  );
  const base = "flex min-h-14 w-full items-start gap-3 p-3.5 text-left";
  if (linked) {
    return (
      <Link href={`/history/${row.id}`} className={`card card-interactive ${base}`}>
        {body}
        <span className="sr-only">{th("row_open", lang)}</span>
      </Link>
    );
  }
  return <div className={`card ${base}`}>{body}</div>;
}
