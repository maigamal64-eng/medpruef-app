import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { CalendarShell, GuidanceFacts } from "@/components/exam-calendar/CalendarSurface";
import { calendarLanguage } from "@/lib/exam-calendar";
import { CALENDAR_COPY } from "@/lib/i18n-lb-calendar";
import { GI_FACTS } from "@/lib/exam-calendar";
import { guidanceMetadataFor } from "@/lib/seo/gsc";

// a-seo-from-gsc: own canonical (the root default pointed at /landing).
export const generateMetadata = guidanceMetadataFor("/graz-innsbruck");
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  const lang = calendarLanguage(params.lang);
  const t = CALENDAR_COPY[lang];
  
  return <CalendarShell lang={lang} path="/graz-innsbruck" title={t.gi}><CalendarLanguageSync lang={lang} explicit={params.lang !== undefined} /><GuidanceFacts facts={GI_FACTS} lang={lang} /><aside className="mp-card mt-8 p-5 text-sm leading-relaxed">{t.scope}</aside></CalendarShell>;
}
