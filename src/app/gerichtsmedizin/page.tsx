import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { CalendarShell, GuidanceFacts } from "@/components/exam-calendar/CalendarSurface";
import { calendarLanguage } from "@/lib/exam-calendar";
import { CALENDAR_COPY } from "@/lib/i18n-lb-calendar";
import { GM_FACTS } from "@/lib/exam-calendar";
import InterestForm from "@/components/exam-calendar/InterestForm";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  const lang = calendarLanguage(params.lang);
  const t = CALENDAR_COPY[lang];
  
  return <CalendarShell lang={lang} path="/gerichtsmedizin" title={t.gm}><CalendarLanguageSync lang={lang} explicit={params.lang !== undefined} /><aside className="mb-8 rounded-xl border border-[var(--mp-border)] p-5 text-sm leading-relaxed">{t.availability}</aside><GuidanceFacts facts={GM_FACTS} lang={lang} /><InterestForm lang={lang} /></CalendarShell>;
}
