import Link from "next/link";
import { notFound } from "next/navigation";
import { EXAM_FORMAT_KEYS, formatLanguage, getExamFormatProfile, rulesForExam, upcomingFormatCards } from "@/lib/exam-formats";
import { FORMAT_COPY } from "@/lib/i18n-lb-formats";
import { RuleCard, RulesShell, SittingCard } from "@/components/exam-rules/RulesSurface";
import FormatLanguageSync from "@/components/exam-rules/FormatLanguageSync";

// searchParams keeps DE/EN request-rendered.
export const dynamic = "auto";
// Limit generated paths to known exam keys; runtime validation below calls notFound for every other key.
export const dynamicParams = false;
// Only known exam keys. Sibling names reserved for b14 are intentionally excluded.
export function generateStaticParams() {
  return EXAM_FORMAT_KEYS.map((exam) => ({ exam }));
}
export default async function ExamRulesPage({ params, searchParams }: { params: Promise<{ exam: string }>; searchParams: Promise<{ lang?: string | string[] }> }) {
  const [{ exam }, query] = await Promise.all([params, searchParams]);
  const profile = getExamFormatProfile(exam);
  if (!profile) notFound();
  const lang = formatLanguage(query.lang);
  const t = FORMAT_COPY[lang];
  const now = new Date();
  const cards = upcomingFormatCards(now, exam);
  return <RulesShell lang={lang} path={`/exam-formats/${exam}`} title={profile.label[lang]}>
    <FormatLanguageSync lang={lang} explicit={query.lang === "de" || query.lang === "en"} />
    <Link href={`/exam-formats?lang=${lang}`} className="mb-8 inline-block text-sm font-semibold underline underline-offset-4">{t.back}</Link>
    <section aria-labelledby="exam-rules">
      <h2 id="exam-rules" className="mb-5 text-xl font-bold">{t.details}</h2>
      <div className="grid gap-5 md:grid-cols-2">{rulesForExam(exam).map((rule) => <RuleCard key={rule.id} rule={rule} lang={lang} />)}</div>
    </section>
    <section aria-labelledby="exam-sittings" className="mt-10">
      <h2 id="exam-sittings" className="mb-5 text-xl font-bold">{t.sittings}</h2>
      {cards.length ? <div className="grid gap-5 md:grid-cols-2">{cards.map((card) => <SittingCard key={`${card.sitting.exam_key}:${card.sitting.date}`} card={card} lang={lang} now={now} />)}</div> : <p className="text-sm text-[var(--mp-fg-muted)]">{t.noSittings}</p>}
    </section>
  </RulesShell>;
}
