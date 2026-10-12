"use client";
/**
 * Plans and the sitting date (LX-28). A signed-in learner with an exam date
 * sees "N Monate bis zu Ihrem Termin" and what each plan costs to cover it;
 * visitors see the 3, 4 and 6 month totals. Totals from src/lib/plan-cover.ts
 * (prices from TIERS). Nothing is recommended by it: the cheapest total is
 * marked as a fact, all three stay visible.
 */
import { billingAmount, type BillingLang } from "@/lib/billing-copy";
import { coverCost, coverUntil, type CoverComparison, type CoverPlan } from "@/lib/plan-cover";
import { longDate } from "./plans";

const NAME: Record<CoverPlan, { de: string; en: string }> = {
  first_month_19: { de: "Monatsabo", en: "Monthly plan" },
  first_3mo_27: { de: "3 Monate", en: "3 months" },
  premium_pass_guaranteed: { de: "Prüfungs-Kohorte", en: "Exam Cohort" },
};

function Row({ c, lang, label }: { c: CoverComparison; lang: BillingLang; label: string }) {
  return (
    <tr className="border-t border-[var(--mp-border-subtle)]">
      <th scope="row" className="text-start py-2 pe-3 font-semibold text-[var(--mp-fg)]">{label}</th>
      {c.covers.map((cover) => (
        <td key={cover.plan} className="py-2 pe-3 tabular-nums">
          {billingAmount(cover.totalCents, lang)}
          {cover.plan === c.cheapest && <span className="block text-xs text-[var(--mp-fg-muted)]">{lang === "de" ? "günstigste Summe" : "lowest total"}</span>}
        </td>
      ))}
    </tr>
  );
}

export default function PlanCoverBlock({ lang, examDate, now = new Date() }: { lang: BillingLang; examDate: string | null; now?: Date }) {
  const de = lang === "de";
  const mine = examDate ? coverUntil(examDate, now) : null;
  const rows: Array<{ c: CoverComparison; label: string }> = mine
    ? [{ c: mine, label: de ? `${mine.months} ${mine.months === 1 ? "Monat" : "Monate"}` : `${mine.months} ${mine.months === 1 ? "month" : "months"}` }]
    : [3, 4, 6].map((m) => ({ c: coverCost(m), label: de ? `${m} Monate` : `${m} months` }));
  return (
    <section aria-labelledby="plan-cover-title" className="mp-card p-5">
      <h2 id="plan-cover-title" className="mp-h3 mb-1">
        {mine
          ? de ? `${mine.months} ${mine.months === 1 ? "Monat" : "Monate"} bis zu Ihrem Termin` : `${mine.months} ${mine.months === 1 ? "month" : "months"} until your exam`
          : de ? "Was kostet Ihre Vorbereitung insgesamt?" : "What does your preparation cost in total?"}
      </h2>
      <p className="text-sm text-[var(--mp-fg-muted)] mb-3">
        {mine
          ? de ? `Ihr eingetragener Termin: ${longDate(examDate, lang)}. So viel kostet jeder Tarif, damit Ihr Zugang bis dahin reicht.` : `Your saved exam date: ${longDate(examDate, lang)}. This is what each plan costs to keep access until then.`
          : de ? "Gesamtkosten für 3, 4 und 6 Monate Vorbereitung. Abos gerechnet bis zur Kündigung nach diesem Zeitraum." : "Total cost for 3, 4 and 6 months of preparation. Subscriptions counted until you cancel after that period."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className="text-start pb-2 pe-3 font-semibold">{de ? "Zeitraum" : "Period"}</th>
              {(["first_month_19", "first_3mo_27", "premium_pass_guaranteed"] as CoverPlan[]).map((plan) => (
                <th key={plan} scope="col" className="text-start pb-2 pe-3 font-semibold">{NAME[plan][lang]}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map((row) => <Row key={row.label} c={row.c} lang={lang} label={row.label} />)}</tbody>
        </table>
      </div>
      <p className="mp-small text-[var(--mp-fg-muted)] mt-2 mb-0">{de ? "Die Garantie gilt nur für die Prüfungs-Kohorte." : "The guarantee applies to the Exam Cohort only."}</p>
    </section>
  );
}
