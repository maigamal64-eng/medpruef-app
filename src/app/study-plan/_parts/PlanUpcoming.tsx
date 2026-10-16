"use client";

/**
 * "Kommende Tage" (UX-STU-27/26/28, LX-04): starts tomorrow, writes the unit,
 * titles by content ("Chirurgische Fächer und 2 weitere"), wraps instead of
 * truncating, keeps free and light days as quiet rows so dates do not jump,
 * and shows a scheduled mock exam on its day.
 */
import { useState } from "react";
import Link from "next/link";
import { ts, studyDate } from "@/lib/i18n-study";
import { buildQuizHref } from "@/lib/quiz-links";
import { getStudyPlanPracticeMode, type StudyPlanDay } from "@/lib/studyPlan";
import { focusKey } from "@/lib/study-plan-view";
import { DrillChip, FocusIcon, SimulationChip, focusClass } from "./PlanToday";

function title(day: StudyPlanDay, lang: "de" | "en"): string {
  if (day.topics.length === 0) return ts("upcoming_free", lang);
  const first = day.topics[0].topic;
  const more = day.topics.length - 1;
  if (more <= 0) return first;
  return more === 1 ? ts("upcoming_more_one", lang, { first }) : ts("upcoming_more", lang, { first, n: more });
}

export default function PlanUpcoming({ days, lang, examSource, canMock }: { days: StudyPlanDay[]; lang: "de" | "en"; examSource: string; canMock: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="plan-upcoming-title">
      <h3 id="plan-upcoming-title" className="font-display font-bold text-base text-[var(--mp-fg)] mb-3 px-0.5">{ts("upcoming_title", lang)}</h3>
      {days.length === 0 ? (
        <p className="mp-card p-4 text-[13px] text-[var(--mp-fg-muted)]">{ts("upcoming_empty", lang)}</p>
      ) : (
        <ol className="space-y-2.5">
          {days.map((d) => {
            const quiet = d.topics.length === 0 || d.light;
            const expanded = open === d.day;
            return (
              <li key={d.day} className={`mp-card p-3 ${quiet ? "opacity-90" : ""}`}>
                <button type="button" className="w-full text-left flex items-start justify-between gap-3 min-h-11" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : d.day)}>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-[var(--mp-fg-muted)]">{studyDate(d.day, lang, { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span lang="de" className="block text-[14px] font-semibold text-[var(--mp-fg)] break-words hyphens-auto">{title(d, lang)}</span>
                    {d.light && <span className="block text-[12.5px] text-[var(--mp-fg-muted)]">{ts("upcoming_light", lang)}</span>}
                  </span>
                  {d.totalQuestions > 0 && (
                    <span className="shrink-0 text-[13px] font-semibold text-[var(--mp-fg-muted)] tabular-nums">
                      {d.totalQuestions === 1 ? ts("block_question", lang) : ts("block_questions", lang, { n: d.totalQuestions })}
                    </span>
                  )}
                </button>
                {d.topics.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {d.topics.map((tt) => (
                      <span key={tt.topic} className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-[3px] rounded-full ${focusClass(tt.focus)}`}>
                        <FocusIcon focus={tt.focus} className="w-3 h-3" />
                        <span className="sr-only">{ts(focusKey(tt.focus), lang)}: </span>
                        <span lang="de">{tt.topic}</span>
                      </span>
                    ))}
                  </div>
                )}
                <SimulationChip day={d} examSource={examSource} canMock={canMock} lang={lang} />
                <DrillChip day={d} lang={lang} />
                {expanded && d.topics.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {d.topics.map((tt) => (
                      <li key={tt.topic}>
                        <Link
                          href={buildQuizHref({ topic: tt.topic, examSource, practiceMode: getStudyPlanPracticeMode(tt.focus), limit: tt.targetCount, returnTo: "/study-plan" })}
                          className="inline-flex items-center min-h-11 text-[13px] font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
                        >
                          {ts("upcoming_practice_now", lang)}: <span lang="de" className="ml-1">{tt.topic}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
