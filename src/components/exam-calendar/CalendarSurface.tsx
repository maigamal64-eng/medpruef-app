import Link from "next/link";
import { CalendarDays, ArrowUpRight } from "lucide-react";
import { formatDisplayDate, type FormatLanguage, type FormatSource, type FactStatus } from "@/lib/exam-formats";
import { CALENDAR_COPY } from "@/lib/i18n-lb-calendar";
import { CALENDAR_DATA, type CalendarEntry, type GuidanceFact } from "@/lib/exam-calendar";

export function CalendarShell({ lang, path, title, children }: { lang: FormatLanguage; path: string; title: string; children: React.ReactNode }) {
  const t = CALENDAR_COPY[lang];
  return <main lang={lang} data-calendar-surface className="mx-auto min-w-0 max-w-6xl px-5 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8">
    <nav className="mb-12 flex flex-wrap items-center justify-between gap-4" aria-label={t.language}>
      <Link href="/" className="text-lg font-bold">{t.home}</Link>
      <div className="flex gap-3">{(["de", "en"] as const).map((l) => <Link key={l} lang={l} hrefLang={l} href={`${path}?lang=${l}`} aria-current={l === lang ? "page" : undefined} className="mp-btn mp-btn--secondary mp-btn--sm">{l.toUpperCase()}</Link>)}</div>
    </nav>
    <header className="mb-10 max-w-3xl"><p className="mb-4 font-mono text-xs tracking-widest text-[var(--mp-fg-muted)]">{t.eyebrow}</p><h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{title}</h1><p className="mt-5 leading-relaxed text-[var(--mp-fg-muted)]">{t.intro}</p></header>
    {children}
    <nav aria-label={t.calendarLink} className="mt-12 flex flex-wrap gap-5 border-t border-[var(--mp-border)] pt-6 text-sm font-semibold">
      {[["/pruefungskalender", t.calendarLink], ["/graz-innsbruck", t.guide], ["/gerichtsmedizin", t.gmLink]].map(([href, label]) => <Link key={href} href={`${href}?lang=${lang}`} className="underline underline-offset-4">{label}</Link>)}
    </nav>
  </main>;
}
export function FactStatusBadge({ status, lang }: { status: FactStatus; lang: FormatLanguage }) {
  return <span data-fact-status={status} className="inline-flex rounded-full border border-[var(--mp-border)] px-3 py-1 text-xs font-semibold">{CALENDAR_COPY[lang].status[status]}</span>;
}
export function CalendarSourceStamp({ source, lang }: { source: FormatSource; lang: FormatLanguage }) {
  const t = CALENDAR_COPY[lang];
  return <p data-source-stamp className="mt-4 break-words border-t border-[var(--mp-border)] pt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]">{t.checked} <time dateTime={source.verifiedOn}>{formatDisplayDate(source.verifiedOn, lang)}</time> {t.against} <a href={source.url} className="underline underline-offset-4">{source.label}</a>. {t.edition}: {source.edition}.</p>;
}
export function CalendarCard({ entry, lang }: { entry: CalendarEntry; lang: FormatLanguage }) {
  const t = CALENDAR_COPY[lang];
  return <article data-sitting={entry.id} className="mp-card min-w-0 p-5 sm:p-6">
    <CalendarDays className="mb-4 size-5" aria-hidden="true" />
    <h2 className="text-lg font-bold">{entry.sitting.learner_label[lang]}</h2>
    <p className="mt-2 font-semibold"><time dateTime={entry.sitting.date}>{formatDisplayDate(entry.sitting.date, lang)}</time>{entry.sitting.date_end && <> {t.closes} <time dateTime={entry.sitting.date_end}>{formatDisplayDate(entry.sitting.date_end, lang)}</time></>}</p>
    <FactStatusBadge status="official" lang={lang} />
    <div className="mt-5 text-sm"><p className="font-semibold">{t.format}: {t.formats[entry.format?.format ?? "not_announced"]}</p><FactStatusBadge status={entry.format?.status ?? "not_confirmed"} lang={lang} />{entry.format && <><p className="mt-2 leading-relaxed text-[var(--mp-fg-muted)]">{entry.format.note[lang]}</p><CalendarSourceStamp source={CALENDAR_DATA.sources[entry.format.sourceId] ?? { url: entry.format.sourceUrl, label: entry.format.sourceLabel, edition: entry.format.sourceLabel, verifiedOn: entry.format.verifiedOn, sha256: null }} lang={lang} /></>}</div>
    {entry.deadlines.map((row) => <div key={row.id} data-deadline className="mt-5 border-t border-[var(--mp-border)] pt-4 text-sm leading-relaxed">
      <p className="font-semibold">{row.sitting.publisher}</p>
      {row.windowConfirmed ? <><p>{row.sitting.deadline_type === "filing_cutoff" ? t.filing : t.registration}</p>{row.registrationOpens && <p>{t.opens}: {formatDisplayDate(row.registrationOpens, lang)}</p>}<p>{t.closes}: {formatDisplayDate(row.registrationCloses!, lang)}{row.closesAtTime && <> {row.closesAtTime} ({t.vienna})</>}</p></> : <p className="font-semibold">{t.windowUnknown}</p>}
      <FactStatusBadge status={row.windowConfirmed ? "official" : "not_confirmed"} lang={lang} /><CalendarSourceStamp source={row.source} lang={lang} />
    </div>)}
    <Link href={`/exam-formats/${entry.sitting.exam_key}?lang=${lang}`} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">{t.rules}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
  </article>;
}
export function GuidanceFacts({ facts, lang }: { facts: readonly GuidanceFact[]; lang: FormatLanguage }) {
  return <div className="grid gap-5 md:grid-cols-2">{facts.map((fact) => <article key={fact.id} data-fact={fact.id} className="mp-card min-w-0 p-5 sm:p-6"><FactStatusBadge status={fact.status} lang={lang} /><h2 className="mt-4 text-lg font-bold">{fact.title[lang]}</h2><p className="mt-3 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{fact.text[lang]}</p><CalendarSourceStamp source={CALENDAR_DATA.sources[fact.sourceId]} lang={lang} /></article>)}</div>;
}
