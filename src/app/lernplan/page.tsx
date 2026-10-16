/**
 * Public study-plan generator (M8, a-study-plan-magnet). No login.
 *
 * Off unless STUDY_PLAN_PUBLIC_ENABLED is the literal "true" (unset = 404).
 * The visitor picks bank, official sitting and hours a week (GET form); the
 * server builds the plan with the same engine as /study-plan. Dates come only
 * from OFFICIAL_SITTINGS; bank totals from the shared topic-count cache. The
 * narrative shows only for a Lektor-approved template; there is no live model
 * call on this page.
 */
import type { Metadata } from "next";
import Link from "next/link";
import SelftestEntryLink from "@/components/selftest/SelftestEntryLink";
import { asSelftestBank } from "@/lib/public-selftest";
import { publicSelftestEnabled } from "@/lib/public-selftest/flag";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { calendarLanguage } from "@/lib/exam-calendar";
import { viennaToday, type PuypExamType } from "@/lib/exam-dates";
import { getTopicCountsCached } from "@/lib/free-tier";
import { getServiceClient } from "@/lib/supabase";
import { studyDate, studyNumber } from "@/lib/i18n-study";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import {
  PUBLIC_PLAN_BANKS,
  PUBLIC_PLAN_PATH,
  buildPublicPlan,
  parsePublicPlanQuery,
  publicPlanEnabled,
  publicSittingOptions,
  resolveNarrative,
  type PublicPlan,
  type PublicSittingOption,
} from "@/lib/study-plan-public";
import { loadApprovedNarratives } from "@/lib/study-plan-public/narratives.server";
import { pc, type PublicPlanLang } from "@/lib/study-plan-public/copy";
import PlanForm from "./_parts/PlanForm";
import PlanWeeks from "./_parts/PlanWeeks";
import SavePlanCta from "./_parts/SavePlanCta";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  if (!publicPlanEnabled()) return {};
  const lang = calendarLanguage((await searchParams).lang);
  return {
    title: pc("meta_title", lang),
    description: pc("meta_description", lang),
    alternates: { canonical: PUBLIC_PLAN_PATH },
  };
}

function Registration({ plan, option, lang }: { plan: PublicPlan; option: PublicSittingOption | undefined; lang: PublicPlanLang }) {
  const rows = plan.registration;
  const two = new Set(rows.map((r) => r.publisher)).size > 1;
  return (
    <section className="mp-card min-w-0 p-5 sm:p-6" aria-labelledby="plan-reg-title" data-testid="public-plan-registration">
      <h2 id="plan-reg-title" className="text-lg font-bold">{pc("registration_title", lang)}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm">{pc(option?.windowUnconfirmed ? "registration_unconfirmed" : "registration_none", lang)}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {rows.map((r) => {
            const day = studyDate(r.closes, lang);
            const date = r.closesAtTime ? pc("closes_at", lang, { date: day, time: r.closesAtTime }) : day;
            const kind = pc(r.deadlineType === "filing_cutoff" ? "kind_filing" : "kind_registration", lang);
            return (
              <li key={`${r.closes}-${r.publisher}-${r.deadlineType}`} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="public-plan-deadline">
                <span className="font-semibold">{pc("registration_line", lang, { kind, publisher: r.publisher, date })}</span>
                {r.passed && <span className="text-[var(--mp-fg-muted)]">{pc("registration_passed", lang)}</span>}
                <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[var(--mp-cta-blue)] underline underline-offset-2">
                  {pc("source", lang)}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {two && <p className="mt-2 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{pc("registration_two", lang)}</p>}
      {rows.length > 0 && option && option.publishers.length > new Set(rows.map((r) => r.publisher)).size && (
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{pc("registration_other_unconfirmed", lang)}</p>
      )}
      {rows.length === 0 && option?.sourceUrls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm text-[var(--mp-cta-blue)] underline underline-offset-2">
          {pc("source", lang)}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ))}
    </section>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  if (!publicPlanEnabled()) notFound();
  const params = await searchParams;
  const lang = calendarLanguage(params.lang);
  const now = new Date();
  const todayISO = viennaToday(now);
  const { form, query } = parsePublicPlanQuery(params, now);

  const optionsByBank = Object.fromEntries(PUBLIC_PLAN_BANKS.map((b) => [b, publicSittingOptions(b, now)])) as Record<PuypExamType, PublicSittingOption[]>;
  const bankLabels = Object.fromEntries(PUBLIC_PLAN_BANKS.map((b) => [b, getExamLabel(b, "full", lang)])) as Record<PuypExamType, string>;

  let plan: PublicPlan | null = null;
  let failed = false;
  if (query) {
    try {
      const { data, error } = await getTopicCountsCached(getServiceClient(), query.bank);
      if (error || !data || data.length === 0) failed = true;
      else plan = buildPublicPlan({ query, topicCounts: data, todayISO, now });
    } catch {
      failed = true;
    }
  }

  const option = query ? optionsByBank[query.bank].find((o) => o.date === query.sitting) : undefined;
  const sittingText = option ? `${option.labels.map((l) => l[lang]).join(", ")}, ${studyDate(option.date, lang)}` : "";
  const perWeek = plan ? Math.round(plan.dailyGoal * 6.5) : 0;
  const reviewFrom = plan && plan.plan.phaseBreak > plan.todayISO ? studyDate(plan.plan.phaseBreak, lang, { day: "numeric", month: "long" }) : null;
  const weeksLeft = plan ? Math.floor(plan.daysLeft / 7) : 0;
  // {weeks} reads "weeks until the sitting"; below two weeks no narrative shows (no "0 Wochen", no singular).
  const narrative = plan && weeksLeft >= 2
    ? resolveNarrative(loadApprovedNarratives(), plan, lang, {
        exam: getExamLabel(plan.query.bank, "full", lang),
        sitting: sittingText,
        weeks: String(weeksLeft),
        hours: String(plan.query.hours),
        per_week: studyNumber(perWeek, lang),
        review_from: reviewFrom ?? studyDate(plan.query.sitting, lang, { day: "numeric", month: "long" }),
      })
    : null;
  const readOn = Object.values(optionsByBank).flat().map((o) => o.readOn).sort().at(-1);

  return (
    <main lang={lang} className="mx-auto min-w-0 max-w-5xl px-4 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8" data-testid="public-plan-page">
      <CalendarLanguageSync lang={lang} explicit={params.lang !== undefined} />
      <nav className="mb-10 flex flex-wrap items-center justify-between gap-4" aria-label={pc("language", lang)}>
        <Link href="/" className="text-lg font-bold">{pc("home", lang)}</Link>
        <div className="flex gap-3">
          {(["de", "en"] as const).map((l) => (
            <Link key={l} lang={l} hrefLang={l} href={`${PUBLIC_PLAN_PATH}?${new URLSearchParams({ ...(query ? { bank: query.bank, sitting: query.sitting, hours: String(query.hours) } : {}), lang: l })}`} aria-current={l === lang ? "page" : undefined} className="mp-btn mp-btn--secondary mp-btn--sm">
              {l.toUpperCase()}
            </Link>
          ))}
        </div>
      </nav>

      <header className="mb-8 max-w-3xl">
        <p className="mb-3 font-mono text-xs tracking-widest text-[var(--mp-fg-muted)]">{pc("eyebrow", lang)}</p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{pc("title", lang)}</h1>
        <p className="mt-4 leading-relaxed text-[var(--mp-fg-muted)]">{pc("intro", lang)}</p>
      </header>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-6">
          <PlanForm lang={lang} bank={form.bank} sitting={form.sitting} hours={form.hours} bankLabels={bankLabels} optionsByBank={optionsByBank} />
        </div>

        <div className="min-w-0 space-y-5">
          {failed && (
            <section role="alert" className="mp-card p-5 sm:p-6" data-testid="public-plan-error">
              <h2 className="text-lg font-bold">{pc("error_title", lang)}</h2>
              <p className="mt-2 text-sm text-[var(--mp-fg-muted)]">{pc("error_body", lang)}</p>
              {query && (
                <a href={`${PUBLIC_PLAN_PATH}?${new URLSearchParams({ bank: query.bank, sitting: query.sitting, hours: String(query.hours), lang })}`} className="mp-btn mp-btn--secondary mt-3 min-h-11">
                  {pc("retry", lang)}
                </a>
              )}
            </section>
          )}

          {plan && (
            <>
              <section id="plan" className="mp-card min-w-0 scroll-mt-6 p-5 sm:p-6" aria-labelledby="plan-summary-title" data-testid="public-plan-summary" data-verdict={plan.verdict ?? "none"}>
                <p className="text-[13px] font-semibold text-[var(--mp-fg-muted)]">{option ? option.labels.map((l) => l[lang]).join(", ") : bankLabels[plan.query.bank]}</p>
                <h2 id="plan-summary-title" className="mt-1 text-2xl font-bold leading-snug">{pc("plan_title", lang, { date: studyDate(plan.query.sitting, lang) })}</h2>
                {narrative && <p className="mt-3 leading-relaxed" data-testid="public-plan-narrative">{narrative}</p>}
                <ul className="mt-4 space-y-1.5 text-sm">
                  <li className="font-semibold">{plan.daysLeft === 1 ? pc("summary_day", lang) : pc("summary_days", lang, { days: studyNumber(plan.daysLeft, lang) })}</li>
                  <li>{pc("summary_pace", lang, { perDay: plan.dailyGoal, perWeek: studyNumber(perWeek, lang) })}</li>
                  <li>
                    {plan.reachable >= plan.bankTotal
                      ? pc("summary_all", lang, { total: studyNumber(plan.bankTotal, lang) })
                      : pc("summary_reach", lang, { reach: studyNumber(plan.reachable, lang), total: studyNumber(plan.bankTotal, lang) })}
                  </li>
                  {plan.verdict && <li>{pc(plan.verdict === "fits" ? "verdict_fits" : plan.verdict === "tight" ? "verdict_tight" : "verdict_too_much", lang)}</li>}
                  <li>{reviewFrom ? pc("review_from", lang, { date: reviewFrom }) : pc("review_all", lang)}</li>
                </ul>
              </section>

              <Registration plan={plan} option={option} lang={lang} />

              <SavePlanCta lang={lang} plan={{ exam: plan.query.bank, examDate: plan.query.sitting, dailyGoal: plan.dailyGoal }} hours={plan.query.hours} />

              <PlanWeeks weeks={plan.weeks} lang={lang} />
            </>
          )}

          {/* a-public-selftest: the no-account self-check for this bank (only while the self-check is on). */}
          <SelftestEntryLink lang={lang} bank={asSelftestBank(plan?.query.bank ?? form.bank) ?? undefined} from="lernplan" enabled={publicSelftestEnabled()} />

          <aside className="mp-card min-w-0 p-5 sm:p-6 text-sm leading-relaxed" aria-labelledby="plan-note-title">
            <h2 id="plan-note-title" className="font-bold">{pc("disclaimer_title", lang)}</h2>
            <p className="mt-2">{pc("disclaimer_scope", lang)}</p>
            <p className="mt-2">{pc("disclaimer_questions", lang)}</p>
            {readOn && <p className="mt-2">{pc("disclaimer_dates", lang, { date: studyDate(readOn, lang) })}</p>}
            <Link href={`/pruefungskalender?lang=${lang}`} className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{pc("calendar_link", lang)}</Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
