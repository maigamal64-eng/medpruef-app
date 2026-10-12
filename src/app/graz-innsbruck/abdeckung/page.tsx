import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { COPY, COVERAGE, type CoverageLanguage } from "./model";
import { getCoverage } from "./server";

const NUMBER_LOCALE: Record<CoverageLanguage, string> = { de: "de-AT", en: "en-GB" };

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const metadata: Metadata = {
  title: "Übungsabdeckung: Graz und Innsbruck | MedPrüf",
  description: "Aktueller Übungsbestand nach Fachbereich, ausstehende Zuordnungen und Grenzen für den österreichischen Stichprobentest.",
  alternates: { canonical: "https://medpruf.com/graz-innsbruck/abdeckung" },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  const lang: CoverageLanguage = params.lang === "en" ? "en" : "de";
  const t = COPY[lang];
  const snapshot = await getCoverage();
  const format = new Intl.NumberFormat(NUMBER_LOCALE[lang]);
  const checkedAt = snapshot && new Intl.DateTimeFormat(NUMBER_LOCALE[lang], { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Vienna" }).format(new Date(snapshot.checkedAt));
  return <main lang={lang} data-coverage-surface className="mx-auto min-w-0 max-w-6xl px-5 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8">
    <CalendarLanguageSync lang={lang} explicit={params.lang !== undefined} />
    <nav aria-label={t.language} className="mb-10 flex flex-wrap items-center justify-between gap-4">
      <Link href={`/graz-innsbruck?lang=${lang}`} className="font-semibold underline underline-offset-4">{t.back}</Link>
      <div className="flex gap-4">{(["de", "en"] as const).map((language) => <Link key={language} href={`?lang=${language}`} hrefLang={language} lang={language} aria-current={lang === language ? "page" : undefined} className="mp-btn mp-btn--secondary mp-btn--sm">{language.toUpperCase()}</Link>)}</div>
    </nav>
    <header className="max-w-3xl"><p className="mb-4 font-mono text-xs tracking-widest">{t.eyebrow}</p><h1 className="text-3xl font-bold leading-tight sm:text-5xl">{t.title}</h1><p className="mt-5 leading-relaxed">{t.intro}</p></header>
    <aside className="mp-card mt-8 p-5 leading-relaxed">{t.scope}</aside>
    <section aria-label={t.classified} className="mt-8">
      <p data-fact-status="reported" className="text-sm font-semibold">{t.countsStatus}</p>
      {snapshot ? <>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">{[[t.active, snapshot.active, "active"], [t.classified, snapshot.classified, "classified"], [t.pending, snapshot.pendingReview, "pending"]].map(([label, value, id]) => <div key={id} className="mp-card p-5"><dt className="text-sm">{label}</dt><dd data-count={id} className="mt-2 text-3xl font-bold tabular-nums">{format.format(value as number)}</dd></div>)}</dl>
        <p data-pending-review className="mt-5 leading-relaxed">{t.pendingBefore} <strong>{format.format(snapshot.pendingReview)}</strong> {t.pendingAfter}</p>
        {snapshot.invalidFieldTags > 0 && <p data-invalid-tags className="mt-3 leading-relaxed">{t.invalidBefore} <strong>{format.format(snapshot.invalidFieldTags)}</strong> {t.invalidAfter}</p>}
        <p data-inventory-stamp className="mt-4 text-sm">{t.readAt} <time dateTime={snapshot.checkedAt}>{checkedAt} (Europe/Vienna)</time>, {t.against} {COVERAGE.bankSource.label}. {t.edition}: {COVERAGE.bankSource.edition}.</p>
      </> : <p role="status" data-coverage-unavailable className="mp-card mt-4 p-5 leading-relaxed">{t.unavailable}</p>}
      <p className="mt-4 text-sm leading-relaxed">{t.cacheBefore} {format.format(COVERAGE.cacheSeconds)} {t.cacheAfter}</p>
    </section>
    <section className="mt-8 text-sm leading-relaxed" aria-label={t.field}>
      <p data-fact-status="official" className="font-semibold">{t.officialStatus}</p>
      <p data-source-stamp className="mt-3 break-words">{t.checked} <time dateTime={COVERAGE.source.readOn}>{COVERAGE.source.readOn}</time> {t.against} <a href={COVERAGE.source.url} className="underline underline-offset-4">{COVERAGE.source.label}</a>. {t.edition}: {COVERAGE.source.edition}.</p>
      <p className="mt-4">{t.method}</p>
    </section>
    {snapshot && COVERAGE.venues.map((venue) => <section key={venue.key} data-venue={venue.key} className="mt-10" aria-labelledby={`venue-${venue.key}`}>
      <h2 id={`venue-${venue.key}`} className="text-2xl font-bold">{venue.label}</h2>
      <p data-fact-status="not_confirmed" className="mt-3 text-sm">{t.unknownStatus}</p>
      <ul className="mt-5 grid gap-4 md:grid-cols-2">{COVERAGE.fields.map((field) => {
        const count = snapshot.fields.find((row) => row.key === field.key)!.count;
        return <li key={field.key} data-field={field.key} className="mp-card min-w-0 p-5">
          <h3 className="text-lg font-bold">{field.label[lang]}</h3>
          <p className="mt-3 text-sm">{t.count}: <strong data-field-count className="text-xl tabular-nums">{format.format(count)}</strong></p>
          <p className="mt-4 text-sm font-semibold">{t.gaps}</p><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">{count === 0 && <li data-gap="unclassified">{t.empty}</li>}<li data-gap="venue-unconfirmed">{t.unconfirmed}</li></ul>
        </li>;
      })}</ul>
    </section>)}
    <nav className="mt-10 border-t border-[var(--mp-border)] pt-6"><Link href={`/stichprobentest?lang=${lang}`} className="font-semibold underline underline-offset-4">{t.practice}</Link></nav>
  </main>;
}
