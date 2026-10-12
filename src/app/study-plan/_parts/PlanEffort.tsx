"use client";

/**
 * What the date implies (LX-02, UX-STU-23): the reachable-volume line, the
 * honest verdict with the stated 1.5-minute basis, the daily-goal stepper
 * and, when it is too much, the offer to narrow the plan to weaker subjects.
 * Neutral wording, never red, no shame framing.
 */
import { ts, studyDate, studyNumber } from "@/lib/i18n-study";
import type { EffortSummary } from "@/lib/master-learning/plan-effort";
import { targetShare } from "@/lib/master-learning/plan-effort";
import { GOAL_PRESETS } from "@/lib/study-plan-view";

export interface PlanEffortProps {
  lang: "de" | "en";
  effort: EffortSummary | undefined;
  goal: number;
  targetDate: string;
  reach: number;
  unseen: number | null;
  bankTotal: number | null;
  focus: "all" | "weak";
  weakAvailable: boolean;
  goalSaving: boolean;
  goalError: boolean;
  onGoal: (n: number) => void;
  onFocus: (f: "all" | "weak") => void;
}

export default function PlanEffort(p: PlanEffortProps) {
  const { lang, effort } = p;
  const verdictKey = !effort ? null : effort.unseen === 0 ? "effort_none_open" : effort.verdict === "fits" ? "effort_fits" : effort.verdict === "tight" ? "effort_tight" : "effort_too_much";
  const share =
    effort && p.bankTotal && effort.verdict !== "fits"
      ? targetShare({ sharePct: 80, pool: p.bankTotal, daysLeft: effort.daysLeft, alreadyCovered: Math.max(0, p.bankTotal - (p.unseen ?? p.bankTotal)) })
      : null;

  return (
    <section className="mp-card p-4 space-y-3" aria-labelledby="plan-effort-title" aria-busy={p.goalSaving}>
      <h3 id="plan-effort-title" className="sr-only">{ts("goal_label", lang)}</h3>
      {p.unseen !== null && (
        <p className="text-[14px] leading-relaxed text-[var(--mp-fg)]">
          {ts("effort_reach", lang, {
            goal: p.goal,
            date: studyDate(p.targetDate, lang, { day: "numeric", month: "short" }),
            reach: studyNumber(p.reach, lang),
            unseen: studyNumber(p.unseen, lang),
          })}
        </p>
      )}
      {effort && verdictKey && (
        <p className="text-[14px] leading-relaxed text-[var(--mp-fg)]" data-testid="plan-effort-verdict" data-verdict={effort.verdict}>
          {ts(verdictKey, lang, { q: studyNumber(effort.questionsPerDay, lang), m: studyNumber(effort.minutesPerDay, lang) })}
          {share && share.questionsPerDay > 0 && share.questionsPerDay < effort.questionsPerDay && <> {ts("effort_share", lang, { q: studyNumber(share.questionsPerDay, lang) })}</>}
        </p>
      )}
      {effort && effort.unseen > 0 && <p className="text-[12px] text-[var(--mp-fg-muted)]">{ts("effort_basis", lang)}</p>}

      <div role="group" aria-label={ts("goal_label", lang)} className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--mp-fg-muted)] mr-1">{ts("goal_label", lang)}</span>
        {GOAL_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={p.goal === n}
            disabled={p.goalSaving}
            onClick={() => p.goal !== n && p.onGoal(n)}
            className={`min-h-11 min-w-11 px-3 rounded-full border text-[14px] font-semibold tabular-nums ${p.goal === n ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)] text-white" : "border-[var(--mp-border-control)] text-[var(--mp-fg)] bg-[var(--mp-surface)]"}`}
          >
            {n}
          </button>
        ))}
      </div>
      {p.goalSaving && <p className="text-[12px] text-[var(--mp-fg-muted)]" role="status">{ts("goal_saving", lang)}</p>}
      {p.goalError && <p className="text-[13px] text-[var(--mp-status-error)]" role="alert">{ts("goal_error", lang)}</p>}

      {(p.focus === "weak" || (p.weakAvailable && effort && effort.verdict === "too_much")) && (
        <div className="flex flex-wrap items-center gap-2">
          {p.focus === "weak" && <p className="text-[13px] text-[var(--mp-fg-muted)]">{ts("focus_weak_active", lang)}</p>}
          <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => p.onFocus(p.focus === "weak" ? "all" : "weak")}>
            {ts(p.focus === "weak" ? "focus_weak_off" : "focus_weak_on", lang)}
          </button>
        </div>
      )}
    </section>
  );
}
