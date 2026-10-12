import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { CalendarShell, GuidanceFacts } from "@/components/exam-calendar/CalendarSurface";
import { calendarLanguage } from "@/lib/exam-calendar";
import { CALENDAR_COPY } from "@/lib/i18n-lb-calendar";
import { GM_FACTS } from "@/lib/exam-calendar";
import InterestForm from "@/components/exam-calendar/InterestForm";
import { gmAvailabilityForPage } from "@/lib/gm-practice/availability";
import { GM_FORMAT_FACT_IDS } from "@/lib/gm-practice";
import { GmPracticeBlock } from "@/app/gm-practice/_parts/GmPracticeBlock";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  const lang = calendarLanguage(params.lang);
  const t = CALENDAR_COPY[lang];
  // a44: practice is offered only with NEXT_PUBLIC_GM_PRACTICE on and the
  // reviewed rows active; until then the availability note and interest form stay.
  const { available } = await gmAvailabilityForPage();

  return <CalendarShell lang={lang} path="/gerichtsmedizin" title={t.gm}><CalendarLanguageSync lang={lang} explicit={params.lang !== undefined} />{available ? <GmPracticeBlock lang={lang} /> : <aside className="mb-8 rounded-xl border border-[var(--mp-border)] p-5 text-sm leading-relaxed">{t.availability}</aside>}<GuidanceFacts facts={available ? GM_FACTS.filter((f) => !GM_FORMAT_FACT_IDS.includes(f.id)) : GM_FACTS} lang={lang} />{!available && <InterestForm lang={lang} />}</CalendarShell>;
}
