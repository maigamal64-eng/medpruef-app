import React from "react";
import Link from "next/link";
import { ArrowUpRight, BookOpen, ClipboardCheck } from "lucide-react";
import FormatLanguageSync from "@/components/exam-rules/FormatLanguageSync";
import { formatDisplayDate } from "@/lib/exam-formats";
import { EXAM_EXTRAS, EXTRA_PAGES, PRACTICE_BANKS, extraFacts, getPracticeInventory, subjectPracticeCount, unmappedTopics, type ExtraLanguage, type ExtraPage, type ExtraFact, type PracticeInventory } from "@/lib/exam-extras";
import { EXTRAS_COPY } from "@/lib/i18n-lb-exam-extras";

const DATE_LOCALE = { de: "de-AT", en: "en-GB" } as const;

function FactCard({ fact, lang }: { fact: ExtraFact; lang: ExtraLanguage }) {
  const t = EXTRAS_COPY[lang];
  const sources = [fact.sourceId, ...fact.relatedSourceIds].map((id) => EXAM_EXTRAS.sources[id as keyof typeof EXAM_EXTRAS.sources]);
  return <article className="mp-card min-w-0 p-5 sm:p-6" data-extra-fact={fact.id}>
    <span className="inline-block rounded-full border border-[var(--mp-border)] px-3 py-1 text-xs font-semibold" data-fact-status={fact.status}>{t.status[fact.status as keyof typeof t.status]}</span>
    <h2 className="mt-4 text-xl font-bold leading-snug">{fact.title[lang]}</h2>
    <p className="mt-3 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{fact.text[lang]}</p>
    <p className="mt-4 text-xs font-medium">{t.scope}: {fact.scope[lang]}</p>
    {sources.map((source) => <p key={source.url} className="mt-4 break-words border-t border-[var(--mp-border)] pt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]" data-source-stamp>
      {t.checked} <time dateTime={source.read_on}>{formatDisplayDate(source.read_on, lang)}</time> {t.against} <a className="underline underline-offset-4" href={source.url}>{source.label}</a>. {t.edition}: {source.edition}.
    </p>)}
  </article>;
}
function InventoryStamp({ inventory, lang }: { inventory: PracticeInventory; lang: ExtraLanguage }) {
  const t = EXTRAS_COPY[lang];
  return <div className="mb-6 text-sm leading-relaxed text-[var(--mp-fg-muted)]" data-inventory-status={inventory.status}>
    <p>{t.snapshot}: <time dateTime={inventory.checkedAt}>{new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Vienna" }).format(new Date(inventory.checkedAt))} (Europe/Vienna)</time></p>
    <p className="mt-2">{t.cache}</p>
    {inventory.status === "unavailable" && <p className="mt-4 rounded-xl border border-[var(--mp-border)] p-4 font-semibold text-[var(--mp-fg)]" role="status">{t.unavailable}</p>}
  </div>;
}
function Inventory({ inventory, lang, subjects }: { inventory: PracticeInventory; lang: ExtraLanguage; subjects: boolean }) {
  const t = EXTRAS_COPY[lang];
  return <section className="mt-12" aria-labelledby="inventory-title">
    <h2 id="inventory-title" className="mb-4 text-2xl font-bold">{t.inventory}</h2>
    <InventoryStamp inventory={inventory} lang={lang} />
    <p className="mb-6 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{subjects ? t.mapping : t.shapeNote}</p>
    {subjects && <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {EXAM_EXTRAS.subjectMap.map((subject) => <article key={subject.id} className="mp-card min-w-0 p-5">
        <h3 className="text-lg font-bold">{subject.label[lang]}</h3>
        <p className="mt-3 text-sm">{t.officialQuestions}: <strong data-official-count={subject.id}>{subject.officialQuestions}</strong></p>
        <dl className="mt-3 space-y-3 border-t border-[var(--mp-border)] pt-3 text-sm">
          {PRACTICE_BANKS.filter((bank) => bank !== "pharma").map((bank) => <div key={bank}>
            <dt className="text-[var(--mp-fg-muted)]">{EXAM_EXTRAS.bankLabels[bank][lang]}</dt>
            <dd className="mt-1 font-semibold" data-subject-count={`${bank}:${subject.id}`}>{subjectPracticeCount(subject.id, inventory, bank) ?? t.unavailable}</dd>
          </div>)}
        </dl>
      </article>)}
    </div>}
    {inventory.status === "available" && <div className="grid gap-5 lg:grid-cols-3">
      {PRACTICE_BANKS.map((bank) => {
        const counts = inventory.banks[bank];
        return <article key={bank} className="mp-card min-w-0 p-5" data-bank={bank}>
          <h3 className="text-lg font-bold">{EXAM_EXTRAS.bankLabels[bank][lang]}</h3>
          <dl className="mt-5 space-y-3 text-sm">
            {(["active", "mc", "withoutMc", "sipShape", "outsideSipShape"] as const).filter((key) => !subjects || key === "active").map((key) => <div key={key} className="flex items-baseline justify-between gap-3"><dt>{t[key]}</dt><dd className="shrink-0 font-mono font-bold" data-count={key}>{counts[key]}</dd></div>)}
          </dl>
          {subjects && <div className="mt-6 border-t border-[var(--mp-border)] pt-4">
            <h4 className="text-sm font-semibold">{t.unmapped}</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--mp-fg-muted)]">{unmappedTopics(inventory, bank).map((topic) => <li key={topic.topic} className="flex justify-between gap-3"><span className="min-w-0 break-words">{topic.topic || t.noTopic}</span><span className="shrink-0 font-mono">{topic.active}</span></li>)}</ul>
          </div>}
          <Link href={`/quiz?setup=1&examSource=${bank}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4">{t.practice}<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
        </article>;
      })}
    </div>}
  </section>;
}
export default async function ExtrasSurface({ page, lang, explicit }: { page: ExtraPage; lang: ExtraLanguage; explicit: boolean }) {
  const t = EXTRAS_COPY[lang];
  const path = `/exam-formats/${page}`;
  const inventory = page === "faecher" || page === "praxis-vs-pruefung" ? await getPracticeInventory() : null;
  return <main lang={lang} className="mx-auto min-w-0 max-w-6xl px-5 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8" data-extras-surface>
    <FormatLanguageSync lang={lang} explicit={explicit} />
    <nav className="mb-10 flex flex-wrap items-center justify-between gap-4" aria-label={t.back}>
      <Link href={`/exam-formats?lang=${lang}`} className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"><BookOpen className="size-5" aria-hidden="true" />{t.back}</Link>
      <div className="flex gap-2" aria-label={t.language}>{(["de", "en"] as const).map((language) => <Link key={language} href={`${path}?lang=${language}`} hrefLang={language} lang={language} aria-current={lang === language ? "true" : undefined} className={`mp-btn mp-btn--sm ${lang === language ? "mp-btn--primary" : "mp-btn--secondary"}`}>{language.toUpperCase()}</Link>)}</div>
    </nav>
    <header className="mb-8 max-w-3xl"><p className="mb-4 font-mono text-xs font-semibold tracking-widest text-[var(--mp-fg-muted)]">{t.eyebrow}</p><h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{EXAM_EXTRAS.pages[page].title[lang]}</h1><p className="mt-5 leading-relaxed text-[var(--mp-fg-muted)]">{t.intro}</p></header>
    <aside className="mb-8 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-5 text-sm leading-relaxed"><ClipboardCheck className="mb-3 size-5" aria-hidden="true" />{t.officialNotice}</aside>
    {page === "aenderungen" && <p className="mb-6 text-sm leading-relaxed">{t.changeNotice}</p>}
    <div className="grid items-start gap-5 md:grid-cols-2">{extraFacts(page).map((fact) => <FactCard key={fact.id} fact={fact} lang={lang} />)}</div>
    {page === "aenderungen" && <section className="mt-8 rounded-xl border border-[var(--mp-border)] p-5"><h2 className="text-lg font-bold">{t.unconfirmed}</h2><ul className="mt-4 space-y-4 text-sm">{EXAM_EXTRAS.unconfirmedWindows.map((window) => <li key={window.exam_key}><strong>{window.exam_key.toUpperCase()}</strong>: <time dateTime={window.date}>{formatDisplayDate(window.date, lang)}</time>. {t.windowUnknown}. <a className="underline underline-offset-4" href={window.source_url}>{t.source}</a>: {t.checked} {formatDisplayDate(window.read_on, lang)}.</li>)}</ul></section>}
    {inventory && <Inventory inventory={inventory} lang={lang} subjects={page === "faecher"} />}
    <nav aria-label={t.navigation} className="mt-12 border-t border-[var(--mp-border)] pt-6"><h2 className="mb-4 text-lg font-bold">{t.navigation}</h2><ul className="grid gap-3 sm:grid-cols-2">{EXTRA_PAGES.filter((key) => key !== page).map((key) => <li key={key}><Link href={`/exam-formats/${key}?lang=${lang}`} className="inline-block py-2 text-sm font-semibold underline underline-offset-4">{EXAM_EXTRAS.pages[key].title[lang]}</Link></li>)}</ul></nav>
  </main>;
}
