"use client";

/**
 * History overview (UX-EXM-40): saved exams first (Beste, Letzte, Anzahl from
 * the server count), then, for Pro, the practice statistics labelled
 * "Fragen im Quiz" (exam answers never count there). de-AT number format and
 * units; an unknown value shows a dash, never 0.
 */
import { StatTile } from "@/components/ui";
import { th } from "@/lib/i18n-history";
import { formatNumber, formatPct, streakText, type Overview } from "./history-rules";

export interface QuizStats {
  answered: number | null;
  accuracy: number | null;
  streak: number | null;
}

const DASH = "-";

export default function OverviewStrip({ overview, quiz, lang }: { overview: Overview; quiz: QuizStats | null; lang: string }) {
  return (
    <div className="mb-6 space-y-4">
      <section aria-labelledby="history-exams-overview">
        <h2 id="history-exams-overview" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">
          {th("stat_exams_heading", lang)}
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 [&_.mp-stat]:min-w-0 [&_.mp-stat__value]:text-[20px] sm:[&_.mp-stat__value]:text-[24px]">
          <StatTile label={th("stat_best", lang)} value={overview.best === null ? DASH : formatPct(overview.best, lang)} />
          <StatTile label={th("stat_latest", lang)} value={overview.latest === null ? DASH : formatPct(overview.latest, lang)} />
          <StatTile label={th("stat_count", lang)} value={overview.count === null ? DASH : formatNumber(overview.count, lang)} />
        </div>
      </section>
      {quiz && (
        <section aria-labelledby="history-quiz-overview">
          <h2 id="history-quiz-overview" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">
            {th("stat_quiz_heading", lang)}
          </h2>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 [&_.mp-stat]:min-w-0 [&_.mp-stat__value]:text-[20px] sm:[&_.mp-stat__value]:text-[24px]">
            <StatTile label={th("stat_answered", lang)} value={quiz.answered === null ? DASH : formatNumber(quiz.answered, lang)} />
            <StatTile label={th("stat_accuracy", lang)} value={quiz.accuracy === null ? DASH : formatPct(quiz.accuracy, lang)} />
            <StatTile label={th("stat_streak", lang)} value={streakText(quiz.streak, lang)} />
          </div>
        </section>
      )}
    </div>
  );
}
