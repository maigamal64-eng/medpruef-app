"use client";

/**
 * The three choices of the public plan (bank, official sitting, hours a week).
 * A plain GET form, so it works before hydration; with JavaScript the sitting
 * list follows the chosen bank without a round trip. Every sitting comes from
 * the server (OFFICIAL_SITTINGS) with its publisher.
 */
import { useState } from "react";
import { PUBLIC_PLAN_BANKS, PUBLIC_PLAN_HOURS, PUBLIC_PLAN_PATH, defaultSitting, type PublicSittingOption } from "@/lib/study-plan-public";
import { MINUTES_PER_QUESTION } from "@/lib/master-learning/plan-effort";
import { pc, type PublicPlanLang } from "@/lib/study-plan-public/copy";
import { studyDate, studyLocale } from "@/lib/i18n-study";
import type { PuypExamType } from "@/lib/exam-dates";

export interface PlanFormProps {
  lang: PublicPlanLang;
  bank: PuypExamType;
  sitting: string | null;
  hours: number;
  bankLabels: Record<PuypExamType, string>;
  optionsByBank: Record<PuypExamType, PublicSittingOption[]>;
}

function sittingLabel(o: PublicSittingOption, lang: PublicPlanLang): string {
  const names = o.labels.map((l) => l[lang]).join(", ");
  const date = o.dateEnd
    ? pc("week_range", lang, { from: studyDate(o.date, lang, { day: "numeric", month: "long" }), to: studyDate(o.dateEnd, lang) })
    : studyDate(o.date, lang);
  const label = `${names}: ${date}`;
  return o.registrationClosed ? pc("sitting_closed", lang, { label }) : label;
}

export default function PlanForm(props: PlanFormProps) {
  const { lang, optionsByBank, bankLabels } = props;
  const [bank, setBank] = useState<PuypExamType>(props.bank);
  const options = optionsByBank[bank] ?? [];
  const [sitting, setSitting] = useState<string>(
    options.some((o) => o.date === props.sitting) ? (props.sitting as string) : defaultSitting(options) ?? "",
  );
  const chosen = options.find((o) => o.date === sitting) ?? options[0];

  function changeBank(next: PuypExamType) {
    setBank(next);
    setSitting(defaultSitting(optionsByBank[next] ?? []) ?? "");
  }

  return (
    <form method="get" action={`${PUBLIC_PLAN_PATH}#plan`} className="mp-card min-w-0 p-5 sm:p-6 space-y-5" aria-labelledby="plan-form-title" data-testid="public-plan-form">
      <h2 id="plan-form-title" className="text-lg font-bold">{pc("form_title", lang)}</h2>
      <input type="hidden" name="lang" value={lang} />
      <div className="space-y-1.5">
        <label htmlFor="plan-bank" className="block text-sm font-semibold">{pc("field_bank", lang)}</label>
        <select id="plan-bank" name="bank" value={bank} onChange={(e) => changeBank(e.target.value as PuypExamType)} className="mp-field w-full min-h-11">
          {PUBLIC_PLAN_BANKS.map((b) => (
            <option key={b} value={b}>{bankLabels[b]}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="plan-sitting" className="block text-sm font-semibold">{pc("field_sitting", lang)}</label>
        {options.length === 0 ? (
          <p className="text-sm text-[var(--mp-fg-muted)]" role="note">{pc("sitting_none", lang)}</p>
        ) : (
          <>
            <select id="plan-sitting" name="sitting" value={sitting} onChange={(e) => setSitting(e.target.value)} className="mp-field w-full min-h-11" aria-describedby="plan-sitting-publisher">
              {options.map((o) => (
                <option key={o.date} value={o.date}>{sittingLabel(o, lang)}</option>
              ))}
            </select>
            {chosen && (
              <p id="plan-sitting-publisher" className="text-[13px] text-[var(--mp-fg-muted)]" data-testid="plan-sitting-publisher">
                {pc("sitting_publisher", lang, { publishers: chosen.publishers.join(pc("and", lang)) })}
              </p>
            )}
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="plan-hours" className="block text-sm font-semibold">{pc("field_hours", lang)}</label>
        <select id="plan-hours" name="hours" defaultValue={String(props.hours)} className="mp-field w-full min-h-11" aria-describedby="plan-hours-hint">
          {PUBLIC_PLAN_HOURS.map((h) => (
            <option key={h} value={h}>{pc("hours_option", lang, { n: h })}</option>
          ))}
        </select>
        <p id="plan-hours-hint" className="text-[13px] text-[var(--mp-fg-muted)]">{pc("hours_hint", lang, { min: MINUTES_PER_QUESTION.toLocaleString(studyLocale(lang)) })}</p>
      </div>
      <button type="submit" className="mp-btn mp-btn--primary w-full min-h-11" disabled={options.length === 0}>{pc("submit", lang)}</button>
    </form>
  );
}
