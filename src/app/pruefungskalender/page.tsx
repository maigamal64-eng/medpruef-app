import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { CalendarShell, CalendarCard, FactStatusBadge, CalendarSourceStamp } from "@/components/exam-calendar/CalendarSurface";
import { calendarLanguage } from "@/lib/exam-calendar";
import { CALENDAR_COPY } from "@/lib/i18n-lb-calendar";
import { CALENDAR_DATA, selectCalendarEntries } from "@/lib/exam-calendar";
import { formatDisplayDate } from "@/lib/exam-formats";
import CalendarFeedBlock from "@/components/exam-calendar/CalendarFeedBlock";
import { calendarFeedEnabled } from "@/lib/exam-calendar/feed";
import { guidanceMetadataFor } from "@/lib/seo/gsc";

// a-seo-from-gsc: own canonical (the root default pointed at /landing).
export const generateMetadata = guidanceMetadataFor("/pruefungskalender");
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  const lang = calendarLanguage(params.lang);
  const t = CALENDAR_COPY[lang];
  const entries = selectCalendarEntries();
  return <CalendarShell lang={lang} path="/pruefungskalender" title={t.calendar}><CalendarLanguageSync lang={lang} explicit={params.lang !== undefined} /><p className="mb-5 text-sm font-semibold">{t.through} {formatDisplayDate(CALENDAR_DATA.through, lang)}</p><aside className="mb-8 rounded-xl border border-[var(--mp-border)] p-5 text-sm leading-relaxed">{t.deadlineNotice}</aside>{calendarFeedEnabled() && <CalendarFeedBlock lang={lang === "en" ? "en" : "de"} />}<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{entries.map((entry) => <CalendarCard key={entry.id} entry={entry} lang={lang} />)}</div>{entries.length === 0 && <p>{t.empty}</p>}<aside className="mp-card mt-8 p-5 text-sm leading-relaxed"><FactStatusBadge status="not_confirmed" lang={lang} /><p className="mt-3">{t.unknownWeeks}</p><CalendarSourceStamp source={CALENDAR_DATA.sources["source-12"]} lang={lang} /></aside></CalendarShell>;
}
