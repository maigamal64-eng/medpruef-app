import React from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, CalendarDays, ClipboardCheck } from "lucide-react";
import { EXAM_FORMAT_DATA, formatDisplayDate, isFormatWindowConfirmed, type ExamRule, type FactStatus, type FormatCard, type FormatLanguage, type FormatSource } from "@/lib/exam-formats";
import { viennaToday } from "@/lib/exam-dates";
import { FORMAT_COPY } from "@/lib/i18n-lb-formats";

export function Status({ status, lang }: { status: FactStatus; lang: FormatLanguage }) {
  return <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${status === "official" ? "border-emerald-700/30 text-[var(--mp-fg)]" : "border-[var(--mp-border)] text-[var(--mp-fg)]"}`} data-fact-status={status}>{FORMAT_COPY[lang].status[status]}</span>;
}
export function SourceStamp({ source, lang }: { source: FormatSource; lang: FormatLanguage }) {
  const t = FORMAT_COPY[lang];
  return <p className="mt-4 break-words border-t border-[var(--mp-border)] pt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]" data-source-stamp>
    {t.checked} <time dateTime={source.verifiedOn}>{formatDisplayDate(source.verifiedOn, lang)}</time> {t.against} <a className="underline underline-offset-4" href={source.url}>{source.label}</a>. {t.edition}: {source.edition}.
  </p>;
}
export function RulesShell({ lang, path, title, children }: { lang: FormatLanguage; path: string; title: string; children: React.ReactNode }) {
  const t = FORMAT_COPY[lang];
  return <main lang={lang} className="mx-auto min-w-0 max-w-6xl px-5 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8" data-format-surface>
    <nav className="mb-10 flex flex-wrap items-center justify-between gap-4" aria-label={t.home}>
      <Link href="/" className="text-lg font-bold tracking-tight">{t.home}<span className="text-[var(--mp-fg-muted)]"> / </span><BookOpen className="inline size-5" aria-hidden="true" /></Link>
      <div className="flex gap-2" aria-label={t.language}>
        {(["de", "en"] as const).map((language) => <Link key={language} href={`${path}?lang=${language}`} hrefLang={language} lang={language} aria-current={lang === language ? "true" : undefined} className={`mp-btn mp-btn--sm ${lang === language ? "mp-btn--primary" : "mp-btn--secondary"}`}>{language.toUpperCase()}</Link>)}
      </div>
    </nav>
    <header className="mb-10 max-w-3xl">
      <p className="mb-4 font-mono text-xs font-semibold tracking-widest text-[var(--mp-fg-muted)]">{t.eyebrow}</p>
      <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-5 text-base leading-relaxed text-[var(--mp-fg-muted)]">{t.intro}</p>
    </header>
    <aside className="mb-10 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-5 text-sm leading-relaxed">
      <ClipboardCheck className="mb-3 size-5" aria-hidden="true" />{t.officialNotice}
    </aside>
    {children}
    <p className="mt-12 max-w-3xl border-t border-[var(--mp-border)] pt-6 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{t.footer}</p>
  </main>;
}
export function SittingCard({ card, lang, now = new Date() }: { card: FormatCard; lang: FormatLanguage; now?: Date }) {
  const { sitting, format, deadlines } = card;
  const t = FORMAT_COPY[lang];
  const source = format ? EXAM_FORMAT_DATA.sources[format.sourceId] : { url: sitting.source_url, label: sitting.publisher, edition: t.calendarSource, verifiedOn: sitting.read_on, sha256: null };
  return <article className="mp-card flex min-w-0 flex-col p-5 sm:p-6" data-sitting={`${sitting.exam_key}:${sitting.date}`}>
    <div className="mb-5 flex items-start justify-between gap-3"><CalendarDays className="size-5 shrink-0" aria-hidden="true" /><Status status={format?.status ?? "not_confirmed"} lang={lang} /></div>
    <h3 className="text-lg font-bold">{sitting.learner_label[lang]}</h3>
    <p className="mt-1 text-sm text-[var(--mp-fg-muted)]"><time dateTime={sitting.date}>{formatDisplayDate(sitting.date, lang)}</time>{sitting.date_end && <> {t.closes} <time dateTime={sitting.date_end}>{formatDisplayDate(sitting.date_end, lang)}</time></>}</p>
    <p className="mt-5 text-base font-semibold">{t.format[format?.format ?? "not_announced"]}</p>
    <p className="mt-2 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{format?.note[lang] ?? t.noFormat}</p>
    {format?.format === "not_announced" && <p className="mt-3 text-sm">{format.expectedBy ? <>{t.expected}: <time dateTime={format.expectedBy}>{formatDisplayDate(format.expectedBy, lang)}</time>{format.expectedBy < viennaToday(now) && <span className="mt-1 block font-semibold">{t.overdue}</span>}</> : t.expectedMissing}</p>}
    <p className="mt-3 text-sm"><strong>{t.duration}:</strong> {format?.durationMin ? `${format.durationMin} ${t.minutes}` : t.durationUnknown}</p>
    <div className="mt-4 space-y-3 border-t border-[var(--mp-border)] pt-4">
      {deadlines.map((deadline) => <div key={`${deadline.publisher}:${deadline.deadline_type}`} className="text-xs leading-relaxed" data-deadline>
        <p className="font-semibold">{deadline.publisher}</p>
        <p>{isFormatWindowConfirmed(deadline) ? <>{deadline.deadline_type === "filing_cutoff" ? t.filing : t.registration}: {deadline.registration_opens && <>{t.opens} {formatDisplayDate(deadline.registration_opens, lang)} </>}{t.closes} {formatDisplayDate(deadline.registration_closes!, lang)}{deadline.closes_at_time && <> {deadline.closes_at_time} ({t.vienna})</>}</> : <strong>{t.windowUnknown}</strong>}</p>
        <p className="mt-1"><a className="underline underline-offset-4" href={deadline.source_url}>{t.calendarSource}</a>: {t.checked} {formatDisplayDate(deadline.read_on, lang)}</p>
      </div>)}
    </div>
    <SourceStamp source={source} lang={lang} />
    <Link href={`/exam-formats/${sitting.exam_key}?lang=${lang}`} className="mt-5 inline-flex items-center gap-2 self-start text-sm font-semibold underline underline-offset-4">{t.rules}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
  </article>;
}
export function RuleCard({ rule, lang }: { rule: ExamRule; lang: FormatLanguage }) {
  const t = FORMAT_COPY[lang];
  return <article className="mp-card min-w-0 p-5 sm:p-6" data-rule={rule.id}>
    <Status status={rule.status} lang={lang} />
    <h3 className="mt-4 text-lg font-bold">{rule.title[lang]}</h3>
    <p className="mt-3 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{rule.text[lang]}</p>
    <p className="mt-4 text-xs font-medium">{t.scope}: {rule.scope[lang]}</p>
    <SourceStamp source={EXAM_FORMAT_DATA.sources[rule.sourceId]} lang={lang} />
    {rule.relatedSourceIds?.map((id) => <SourceStamp key={id} source={EXAM_FORMAT_DATA.sources[id]} lang={lang} />)}
  </article>;
}
