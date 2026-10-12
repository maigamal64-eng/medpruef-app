import Link from "next/link";
import { correctionsLog, correctionsCopy } from "@/lib/corrections-log";
import { guidanceLang } from "@/lib/guidance/facts";
import type { Bank } from "@/lib/bank-coverage";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const lang = guidanceLang((await searchParams).lang);
  const c = correctionsCopy[lang];
  return <main lang={lang} className="min-h-screen bg-[#f5f4ef] px-5 py-10 text-[#182d2c] sm:px-10 sm:py-16">
    <div className="mx-auto max-w-4xl">
      <nav aria-label={lang === "de" ? "Seitennavigation" : "Page navigation"} className="mb-12 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
        <Link href="/landing" className="underline underline-offset-4">{c.home}</Link>
        <Link href={`/wien-route?lang=${lang}`} className="underline underline-offset-4">{c.guide}</Link>
        <Link href={`/korrekturen?lang=${lang === "de" ? "en" : "de"}`} hrefLang={lang === "de" ? "en" : "de"} className="ml-auto underline underline-offset-4">{c.language}</Link>
      </nav>
      <p className="mb-4 text-sm font-semibold uppercase tracking-widest">MedPrüf</p>
      <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">{c.title}</h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed">{c.intro}</p>
      <div className="mt-8 max-w-3xl border-l-4 border-[#30605c] pl-5 text-sm leading-relaxed">
        <p>{c.scope}</p>
        <p className="mt-3">{c.checked}{" "}<time dateTime={correctionsLog.read_on}>{correctionsLog.read_on}</time>{" "}{c.against}{" "}{correctionsLog.source_label}{". "}{correctionsLog.edition}{". "}{c.reported}{"."}</p>
        <p className="mt-3">{c.stale}</p>
      </div>
      <section aria-label={c.title} className="mt-12 grid gap-5">
        {!correctionsLog.entries.length && <p>{c.empty}</p>}
        {correctionsLog.entries.map((entry) => <article key={`${entry.month}-${entry.bank}`} className="rounded-2xl border border-[#c8d4d0] bg-white p-6 sm:p-8">
          <p className="text-sm font-semibold">{c.date}{": "}<time dateTime={entry.month}>{entry.month}</time></p>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold">{c.banks[entry.bank as Bank]}</h2>
            <p className="text-2xl font-semibold" data-correction-count>{entry.count}{" "}<span className="text-sm font-normal">{c.questions}</span></p>
          </div>
          <ul className="mt-5 space-y-2 text-sm leading-relaxed">
            {entry.reasons.map((reason) => <li key={reason.key}>{c.reasons[reason.key as keyof typeof c.reasons]}{": "}{reason.count}</li>)}
          </ul>
        </article>)}
      </section>
    </div>
  </main>;
}
