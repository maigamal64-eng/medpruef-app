import { formatDisplayDate } from "@/lib/exam-formats";
import { GM_FACTS } from "@/lib/exam-calendar";
import { CalendarSourceStamp, FactStatusBadge } from "@/components/exam-calendar/CalendarSurface";
import { CALENDAR_DATA } from "@/lib/exam-calendar";
import { GM_REPORTS_READ_ON, gmCopy, gmLang } from "@/lib/gm-practice/copy";

/**
 * SIM-07 format card: the official Vienna and Innsbruck facts with their
 * status and source stamps (b17 GM_FACTS), then the two Vienna candidate
 * accounts labelled "Berichtet". It never states an official oral format.
 */
export function GmFormatCard({ lang }: { lang: string }) {
  const l = gmLang(lang);
  const c = gmCopy(l);
  const facts = GM_FACTS.filter((f) => f.id === "gm.wien" || f.id === "gm.innsbruck");
  return (
    <section aria-labelledby="gm-format-title" className="mp-card min-w-0 p-5 sm:p-6">
      <h2 id="gm-format-title" className="text-lg font-bold">{c.formatTitle}</h2>
      <ul className="mt-4 space-y-5">
        {facts.map((fact) => (
          <li key={fact.id} data-fact={fact.id} className="min-w-0">
            <FactStatusBadge status={fact.status} lang={l} />
            <h3 className="mt-3 font-semibold">{fact.title[l]}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{fact.text[l]}</p>
            <CalendarSourceStamp source={CALENDAR_DATA.sources[fact.sourceId]} lang={l} />
          </li>
        ))}
        <li data-fact="gm.wien.reported" className="min-w-0">
          <FactStatusBadge status="reported" lang={l} />
          <h3 className="mt-3 font-semibold">{c.reportedTitle}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{c.reportedText}</p>
          <p className="mt-4 border-t border-[var(--mp-border)] pt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
            {c.reportedBasis} <time dateTime={GM_REPORTS_READ_ON}>{formatDisplayDate(GM_REPORTS_READ_ON, l)}</time>.
          </p>
        </li>
      </ul>
    </section>
  );
}
