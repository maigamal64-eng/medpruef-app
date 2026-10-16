"use client";

/**
 * "Heute dran" (UX-STU-19/20/21/26, LX-04). One honest total for today from
 * the server counter, no per-block ticks; every block stays tappable and
 * carries its focus label in text and icon; a simulation day links to /exam.
 */
import Link from "next/link";
import { ArrowRight, Sparkles, RotateCcw, Dumbbell, GraduationCap, Target } from "lucide-react";
import { ts, studyDate, studyNumber } from "@/lib/i18n-study";
import { buildQuizHref } from "@/lib/quiz-links";
import { getStudyPlanPracticeMode, type StudyPlanDay, type StudyFocus } from "@/lib/studyPlan";
import { focusKey, partOfPreset, simulationHref, simulationMeta, todayProgress } from "@/lib/study-plan-view";
import { cpt, cramExamName } from "@/lib/cram-part-plan/copy";
import { CRAM_EXAM_KEY } from "@/lib/cram-part-plan";
import { getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";

export function FocusIcon({ focus, className }: { focus: StudyFocus; className?: string }) {
  if (focus === "review") return <RotateCcw className={className} aria-hidden />;
  if (focus === "weak") return <Dumbbell className={className} aria-hidden />;
  return <Sparkles className={className} aria-hidden />;
}

export function focusClass(focus: StudyFocus): string {
  return focus === "review"
    ? "bg-[var(--mp-warning-bg)] text-[var(--mp-warning-text)]"
    : "bg-[var(--mp-tint-brand)] text-[var(--mp-cta-blue)]";
}

export function SimulationChip({ day, examSource, canMock, lang }: { day: StudyPlanDay; examSource: string; canMock: boolean; lang: "de" | "en" }) {
  const meta = day.simulation ? simulationMeta(day.simulation.presetId) : null;
  if (!meta) return null;
  const hours = meta.durationS / 3600;
  const detail = Number.isInteger(hours)
    ? ts("sim_detail", lang, { n: meta.questions, h: hours })
    : ts("sim_detail_min", lang, { n: meta.questions, m: Math.round(meta.durationS / 60) });
  // a-cram-part-plan: a part preset (kp_sip4 / kp_sip5) opens that part; free accounts keep the gate.
  const part = partOfPreset(day.simulation?.presetId);
  const href = canMock ? simulationHref(examSource, part) : "/pricing?gate=mock_exam";
  const label = part === "all" ? ts("sim_label", lang) : cpt("sim_label_part", lang, { exam: cramExamName(CRAM_EXAM_KEY[part]) });
  return (
    <Link href={href} className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-2.5 min-h-11" data-testid="plan-simulation">
      <GraduationCap className="w-4 h-4 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-[var(--mp-fg)]">
          {label}
          {!canMock && <span className="mp-pro-pill ml-2" aria-hidden>Pro</span>}
        </span>
        <span className="block text-[12.5px] text-[var(--mp-fg-muted)]">{detail}</span>
      </span>
    </Link>
  );
}

/** a-cram-part-plan: the line on the day after a timed part run. */
export function DrillChip({ day, lang }: { day: StudyPlanDay; lang: "de" | "en" }) {
  const d = day.drill;
  if (!d) return null;
  const date = d.runDay ? studyDate(d.runDay, lang, { day: "numeric", month: "long" }) : "";
  const text = d.state === "blocks" ? cpt("drill_blocks", lang, { date }) : d.state === "none_below" ? cpt("drill_none", lang, { date }) : cpt("drill_pending", lang);
  return (
    <p className="mt-2 flex items-start gap-2 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-2.5 text-[13px] text-[var(--mp-fg)]" data-testid="plan-drill" data-drill-state={d.state}>
      <Dumbbell className="w-4 h-4 mt-0.5 shrink-0 text-[var(--mp-warning-text)]" aria-hidden />
      <span>{text}{d.state === "blocks" && <span className="text-[var(--mp-fg-muted)]"> {cpt("no_forecast", lang)}</span>}</span>
    </p>
  );
}

export interface PlanTodayProps {
  lang: "de" | "en";
  day: StudyPlanDay | null;
  examSource: string;
  goal: number;
  answeredToday: number | null | undefined;
  canMock: boolean;
}

export default function PlanToday({ lang, day, examSource, goal, answeredToday, canMock }: PlanTodayProps) {
  const prog = todayProgress(answeredToday, goal);
  const blocks = day?.topics ?? [];
  return (
    <section id="heute" className="relative overflow-hidden mp-card p-4 scroll-mt-24" aria-labelledby="plan-today-title">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "var(--mp-spark)" }} aria-hidden />
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 id="plan-today-title" className="flex items-center gap-2 font-display font-bold text-[15px] text-[var(--mp-fg)]">
          <span className="w-[26px] h-[26px] rounded-lg bg-[var(--mp-tint-teal)] text-[var(--mp-accent-teal)] flex items-center justify-center">
            <Target className="w-[15px] h-[15px]" aria-hidden />
          </span>
          {ts("today_title", lang)}
        </h3>
        <p className="font-mono text-[13px] font-bold text-[var(--mp-fg)] tabular-nums" data-testid="plan-today-total">
          {prog.done === null ? ts("today_total_unknown", lang, { goal }) : ts("today_total", lang, { done: studyNumber(prog.done, lang), goal })}
        </p>
      </div>

      {day?.light && <p className="text-[13px] text-[var(--mp-fg-muted)] mb-2">{ts("today_light", lang)}</p>}
      {day && <SimulationChip day={day} examSource={examSource} canMock={canMock} lang={lang} />}
      {day && <DrillChip day={day} lang={lang} />}

      {blocks.length === 0 ? (
        <p className="text-[13px] text-[var(--mp-fg-muted)]">{ts("today_rest", lang)}</p>
      ) : (
        <ul className="flex flex-col gap-2.5 mt-2">
          {blocks.map((tt) => {
            const tc = getTopicConfig(tt.topic);
            const count = tt.targetCount === 1 ? ts("block_question", lang) : ts("block_questions", lang, { n: tt.targetCount });
            const focus = ts(focusKey(tt.focus), lang);
            const href = buildQuizHref({ topic: tt.topic, examSource, practiceMode: getStudyPlanPracticeMode(tt.focus), limit: tt.targetCount, returnTo: "/study-plan#heute" });
            return (
              <li key={tt.topic}>
                <Link href={href} aria-label={ts("block_aria", lang, { topic: tt.topic, focus, count })} className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] min-h-11">
                  <span className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: tc.color + "22", color: tc.color }}>
                    <TopicIcon name={tc.icon} className="w-[18px] h-[18px]" style={{ color: tc.color }} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span lang="de" className="block text-[14px] font-semibold text-[var(--mp-fg)] break-words hyphens-auto">{tt.topic}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[var(--mp-fg-muted)]">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[12px] font-semibold ${focusClass(tt.focus)}`}>
                        <FocusIcon focus={tt.focus} className="w-3 h-3" />
                        {focus}
                      </span>
                      <span className="tabular-nums">{count}</span>
                    </span>
                  </span>
                  <span className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 text-white bg-[var(--mp-cta-blue)]">
                    <ArrowRight className="w-[15px] h-[15px]" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 pt-3 border-t border-[var(--mp-border)] text-[13px]">
        {prog.reached ? (
          <span className="font-semibold text-[var(--mp-viridian)]">{ts("today_goal_done", lang)}</span>
        ) : prog.toGoal !== null ? (
          <span className="text-[var(--mp-fg-muted)]">{ts("today_to_goal", lang, { n: prog.toGoal })}</span>
        ) : null}
      </div>
    </section>
  );
}
