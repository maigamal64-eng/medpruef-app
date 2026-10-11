import Link from "next/link";
import { EXAM_FORMAT_DATA, formatLanguage, upcomingFormatCards } from "@/lib/exam-formats";
import { FORMAT_COPY } from "@/lib/i18n-lb-formats";
import { RulesShell, SittingCard } from "@/components/exam-rules/RulesSurface";
import FormatLanguageSync from "@/components/exam-rules/FormatLanguageSync";

export const dynamic = "force-dynamic";
export default async function ExamFormatsPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const query = await searchParams;
  const lang = formatLanguage(query.lang);
  const t = FORMAT_COPY[lang];
  const now = new Date();
  const cards = upcomingFormatCards(now);
  return <RulesShell lang={lang} path="/exam-formats" title={t.title}>
    <FormatLanguageSync lang={lang} explicit={query.lang === "de" || query.lang === "en"} />
    <section aria-labelledby="exam-navigation" className="mb-10">
      <h2 id="exam-navigation" className="mb-4 text-xl font-bold">{t.overview}</h2>
      <div className="flex flex-wrap gap-3">{EXAM_FORMAT_DATA.exams.map((exam) => <Link key={exam.key} href={`/exam-formats/${exam.key}?lang=${lang}`} className="mp-btn mp-btn--secondary">{exam.label[lang]}</Link>)}</div>
      <p className="mt-5 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{t.fsp}</p>
    </section>
    <section aria-labelledby="upcoming-sittings">
      <h2 id="upcoming-sittings" className="mb-5 text-xl font-bold">{t.sittings}</h2>
      {cards.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{cards.map((card) => <SittingCard key={`${card.sitting.exam_key}:${card.sitting.date}`} card={card} lang={lang} now={now} />)}</div> : <p>{t.noSittings}</p>}
    </section>
  </RulesShell>;
}
