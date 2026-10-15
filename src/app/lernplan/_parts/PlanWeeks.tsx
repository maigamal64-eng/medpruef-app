/**
 * Week-by-week view of the public plan. Server-rendered; the first weeks are
 * open, the rest sit behind a native disclosure (no script needed).
 */
import { CalendarCheck, Coffee } from "lucide-react";
import { studyDate, studyNumber } from "@/lib/i18n-study";
import type { PlanWeek } from "@/lib/study-plan-public";
import { pc, type PublicPlanLang } from "@/lib/study-plan-public/copy";

const OPEN_WEEKS = 6;
const TOPICS_SHOWN = 3;

function WeekRow({ week, lang }: { week: PlanWeek; lang: PublicPlanLang }) {
  const short = (iso: string) => studyDate(iso, lang, { day: "numeric", month: "short" });
  const shown = week.topics.slice(0, TOPICS_SHOWN);
  const more = week.topics.length - shown.length;
  const phaseKey = week.phase === "new" ? "phase_new" : week.phase === "consolidation" ? "phase_consolidation" : "phase_mixed";
  return (
    <li className="mp-card min-w-0 p-4" data-testid="public-plan-week" data-phase={week.phase}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold">
          {pc("week_label", lang, { n: week.index })}
          <span className="ml-2 text-[13px] font-semibold text-[var(--mp-fg-muted)]">{pc("week_range", lang, { from: short(week.from), to: short(week.to) })}</span>
        </h3>
        <span className="text-[13px] font-semibold tabular-nums text-[var(--mp-fg-muted)]">{pc("week_questions", lang, { n: studyNumber(week.questions, lang) })}</span>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-[var(--mp-viridian)]">{pc(phaseKey, lang)}</p>
      {shown.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((t) => (
            <li key={t.topic} className="inline-flex max-w-full items-center rounded-full border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-2.5 py-1 text-[12.5px] font-medium break-words">
              <span lang="de">{t.topic}</span>
              <span className="ml-1 tabular-nums text-[var(--mp-fg-muted)]">{studyNumber(t.count, lang)}</span>
            </li>
          ))}
          {more > 0 && <li className="self-center text-[12.5px] text-[var(--mp-fg-muted)]">{more === 1 ? pc("week_more_one", lang) : pc("week_more", lang, { n: more })}</li>}
        </ul>
      )}
      {week.simulations > 0 && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold">
          <CalendarCheck className="size-4 shrink-0" aria-hidden />
          {pc("week_simulation", lang)}
        </p>
      )}
      {week.lightDays > 0 && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-[var(--mp-fg-muted)]">
          <Coffee className="size-4 shrink-0" aria-hidden />
          {pc("week_light", lang)}
        </p>
      )}
    </li>
  );
}

export default function PlanWeeks({ weeks, lang }: { weeks: PlanWeek[]; lang: PublicPlanLang }) {
  const open = weeks.slice(0, OPEN_WEEKS);
  const rest = weeks.slice(OPEN_WEEKS);
  return (
    <section aria-labelledby="plan-weeks-title" className="min-w-0">
      <h2 id="plan-weeks-title" className="mb-3 text-lg font-bold">{pc("weeks_title", lang)}</h2>
      <ol className="space-y-2.5">
        {open.map((w) => <WeekRow key={w.index} week={w} lang={lang} />)}
      </ol>
      {rest.length > 0 && (
        <details className="mt-2.5 group">
          <summary className="mp-btn mp-btn--secondary min-h-11 cursor-pointer list-none">{pc("weeks_show_all", lang, { n: weeks.length })}</summary>
          <ol className="mt-2.5 space-y-2.5" start={OPEN_WEEKS + 1}>
            {rest.map((w) => <WeekRow key={w.index} week={w} lang={lang} />)}
          </ol>
        </details>
      )}
    </section>
  );
}
