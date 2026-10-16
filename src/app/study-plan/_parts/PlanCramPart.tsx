"use client";

/**
 * Part card of the cram plan (a-cram-part-plan, CRAM_PART_PLAN_ENABLED).
 * Shown only when the saved sitting names exactly one SIP4a or SIP5a row:
 * which subjects the plan covers (weighted by the split of MedPrüf's own
 * mock exam, never official weights), the announced format of that sitting (SittingFormatNote), the
 * timed part runs in the plan, the SIP4a block rule quoted with its source
 * as ExamResults does (SIP5a: the 60 percent practice mark), the newest part
 * run's subjects below 60 percent, and timed KAF practice only while it is
 * live. Mock exams stay Pro: free accounts get the Pro pill and the gate.
 */
import Link from "next/link";
import { ExternalLink, GraduationCap, Layers } from "lucide-react";
import { SittingFormatNote } from "@/components/exam/SittingFormatNote";
import { te } from "@/lib/i18n-exam";
import { studyDate } from "@/lib/i18n-study";
import { joinList } from "@/lib/i18n-dates";
import { partTopics, type CramView } from "@/lib/cram-part-plan";
import { cpt, cramExamName, sip4aRuleHref } from "@/lib/cram-part-plan/copy";
import type { StudyPlan } from "@/lib/studyPlan";

type PartView = Exclude<CramView, { part: "all" }>;

export default function PlanCramPart({ cram, plan, todayISO, canMock, lang }: {
  cram: PartView;
  plan: StudyPlan;
  todayISO: string;
  canMock: boolean;
  lang: "de" | "en";
}) {
  const exam = cramExamName(cram.examKey);
  const subjects = joinList([...partTopics(cram.part)], lang);
  const runDays = plan.dailySchedule.filter((d) => d.simulation && d.day >= todayISO).map((d) => d.day);
  const dates = joinList(runDays.map((d) => studyDate(d, lang, { day: "numeric", month: "long" })), lang);
  const latest = cram.latestRun;
  return (
    <section className="mp-card p-4 space-y-2 text-[13.5px] text-[var(--mp-fg)]" aria-labelledby="plan-cram-title" data-testid="plan-cram-part">
      <h3 id="plan-cram-title" className="flex items-center gap-2 font-display font-bold text-[15px]">
        <span className="w-[26px] h-[26px] rounded-lg bg-[var(--mp-tint-brand)] text-[var(--mp-cta-blue)] flex items-center justify-center">
          <Layers className="w-[15px] h-[15px]" aria-hidden />
        </span>
        {cpt("part_title", lang, { exam })}
      </h3>
      <p className="m-0">{cpt("part_body", lang, { exam, list: subjects })}</p>
      <p className="m-0 text-[var(--mp-fg-muted)]" data-testid="plan-cram-weights">{cpt("part_weights", lang)}</p>
      <SittingFormatNote examKey={cram.examKey} date={cram.date} lang={lang} />
      {runDays.length > 0 && (
        <p className="m-0 flex items-start gap-2" data-testid="plan-cram-runs">
          <GraduationCap className="w-4 h-4 mt-0.5 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
          <span>
            {cpt(runDays.length === 1 ? "part_runs_one" : "part_runs", lang, { exam, dates })}
            {!canMock && <span className="mp-pro-pill ml-2" aria-hidden>Pro</span>}
          </span>
        </p>
      )}
      {cram.part === "sip4" ? (
        <div className="space-y-1" data-testid="plan-cram-rule">
          <p className="m-0">{te("result_blocks_rule", lang)}</p>
          <Link href={sip4aRuleHref(lang)} className="inline-flex items-center gap-1 min-h-11 underline underline-offset-2 text-[var(--mp-cta-blue)]">
            {te("result_rule_source", lang)}<ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <p className="m-0" data-testid="plan-cram-rule">{cpt("rule_sip5", lang)}</p>
      )}
      {latest && (
        <p className="m-0" data-testid="plan-cram-latest">
          {latest.weak.length > 0
            ? cpt("latest_blocks", lang, { exam, date: studyDate(latest.day, lang, { day: "numeric", month: "long" }), list: joinList(latest.weak, lang) })
            : cpt("latest_none", lang, { exam, date: studyDate(latest.day, lang, { day: "numeric", month: "long" }) })}
          {" "}<span className="text-[var(--mp-fg-muted)]">{cpt("no_forecast", lang)}</span>
        </p>
      )}
      {cram.kaf && (
        <Link href={canMock ? "/exam/kaf" : "/pricing?gate=mock_exam"} className="inline-flex items-center gap-2 min-h-11 font-semibold underline underline-offset-2 text-[var(--mp-cta-blue)]" data-testid="plan-cram-kaf">
          {cpt("kaf_link", lang)}
          {!canMock && <span className="mp-pro-pill" aria-hidden>Pro</span>}
        </Link>
      )}
    </section>
  );
}
