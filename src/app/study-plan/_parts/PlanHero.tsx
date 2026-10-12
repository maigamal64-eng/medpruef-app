"use client";

/**
 * Lernplan hero (UX-STU-18, LX-01, LX-03). One countdown, no decorative ring
 * (there is no stored plan start to measure elapsed time against), the date,
 * the provisional label, and the expired one-tap switch to the next sitting.
 */
import { CalendarDays, AlertTriangle } from "lucide-react";
import { ts, studyDate } from "@/lib/i18n-study";
import type { StudyPlan } from "@/lib/studyPlan";

export interface PlanHeroProps {
  lang: "de" | "en";
  plan: StudyPlan;
  daysLeft: number;
  targetDate: string;
  targetSource: "user_exam_date" | "next_official_sitting" | "fallback_horizon";
  provisional: boolean;
  expired: boolean;
  ownDate: string | null;
  switching: boolean;
  switchError: boolean;
  onSwitch: (iso: string) => void;
  onChooseDate: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export default function PlanHero(p: PlanHeroProps) {
  const { lang, plan, daysLeft } = p;
  const headline =
    p.targetSource === "fallback_horizon"
      ? ts("hero_horizon", lang, { n: daysLeft })
      : daysLeft <= 0
        ? ts("hero_today", lang)
        : p.provisional
          ? ts(daysLeft === 1 ? "hero_day_provisional" : "hero_days_provisional", lang, { n: daysLeft })
          : ts(daysLeft === 1 ? "hero_day" : "hero_days", lang, { n: daysLeft });
  const showSplit = plan.status === "normal" || plan.status === "far_future";
  const shortWindow = plan.phaseBreak === plan.dailySchedule[0]?.day;

  return (
    <section
      className="relative overflow-hidden rounded-[var(--mp-r-card)] p-5 text-white"
      style={{ background: "linear-gradient(118deg, var(--mp-hero-from, var(--mp-fg)), var(--mp-hero-to, var(--mp-cta-blue)))", boxShadow: "var(--mp-shadow-hover)" }}
      aria-labelledby="plan-hero-title"
    >
      <div className="relative flex items-start gap-4">
        <div className="w-[74px] h-[74px] flex-shrink-0 rounded-2xl bg-white/10 border border-white/20 flex flex-col items-center justify-center" aria-hidden>
          <b className="font-display font-black text-2xl leading-none text-white tabular-nums">{Math.max(0, daysLeft)}</b>
          <span className="text-[12px] font-semibold text-white mt-1">{ts(daysLeft === 1 ? "hero_unit_day" : "hero_unit_days", lang)}</span>
        </div>
        <div className="min-w-0 flex-1">
          {p.provisional && (
            <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[12px] font-semibold text-white mb-1">
              {ts("provisional_badge", lang)}
            </span>
          )}
          <h2 id="plan-hero-title" ref={p.headingRef} tabIndex={-1} className="font-display font-extrabold text-lg leading-tight text-white">
            {headline}
          </h2>
          <p className="text-[13px] text-white/85 mt-1 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {p.targetSource === "next_official_sitting"
              ? ts("hero_target_official", lang, { date: studyDate(p.targetDate, lang) })
              : p.targetSource === "fallback_horizon"
                ? ts("hero_target_horizon", lang)
                : studyDate(p.targetDate, lang)}
          </p>
          {p.provisional && !p.expired && <p className="text-[13px] text-white/85 mt-1">{ts("provisional_body", lang)}</p>}
          {!p.expired && (
            <button type="button" onClick={p.onChooseDate} className="mt-1 inline-flex items-center min-h-11 text-[13px] text-white underline underline-offset-4">
              {ts(p.ownDate ? "hero_change_date" : "hero_set_date", lang)}
            </button>
          )}
        </div>
      </div>

      {p.expired && (
        <div className="relative mt-4 rounded-xl bg-white/10 border border-white/20 p-3.5" role="group" aria-label={ts("expired_title", lang)}>
          <p className="text-sm font-semibold text-white flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
            {ts("expired_title", lang)}
          </p>
          {p.targetSource === "next_official_sitting" ? (
            <>
              <p className="text-[13px] text-white/90 mt-1">{ts("expired_next", lang, { date: studyDate(p.targetDate, lang) })}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="mp-btn mp-btn--primary min-h-11" disabled={p.switching} aria-busy={p.switching} onClick={() => p.onSwitch(p.targetDate)}>
                  {ts(p.switching ? "switch_saving" : "expired_switch", lang)}
                </button>
                <button type="button" className="mp-btn mp-btn--ghost min-h-11 text-white" onClick={p.onChooseDate}>{ts("expired_other", lang)}</button>
              </div>
              {p.switchError && <p role="alert" className="mt-2 text-[13px] text-white">{ts("switch_error", lang)}</p>}
            </>
          ) : (
            <>
              <p className="text-[13px] text-white/90 mt-1">{ts("expired_none", lang)}</p>
              <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-3" onClick={p.onChooseDate}>{ts("expired_other", lang)}</button>
            </>
          )}
        </div>
      )}

      {!p.expired && showSplit && !shortWindow && (
        <p className="relative mt-4 text-[13px] text-white/85">{ts("hero_split", lang, { date: studyDate(plan.phaseBreak, lang, { day: "numeric", month: "long" }) })}</p>
      )}
      {!p.expired && plan.status === "far_future" && <p className="relative mt-2 text-[13px] text-white/80">{ts("hero_far", lang)}</p>}
      {!p.expired && shortWindow && plan.dailySchedule.length > 0 && <p className="relative mt-3 text-[13px] text-white/85">{ts("hero_short", lang)}</p>}
    </section>
  );
}
