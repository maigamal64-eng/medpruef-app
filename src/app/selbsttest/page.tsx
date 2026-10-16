/**
 * /selbsttest (a-public-selftest): a no-account, timed self-check of curated
 * practice questions for the Stichprobentest or the Vienna SIP bank.
 *
 * Off unless PUBLIC_SELFTEST_ENABLED is the literal "true": the middleware
 * answers 404 and this page calls notFound() too. Questions come only from
 * GET /api/selftest (fixed allowlist inside the free set); the score stays in
 * the browser until the visitor saves it into a free account.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { SELFTEST_BANKS, SELFTEST_PATH, SELFTEST_SIZE, asSelftestBank, selftestDurationS, type SelftestBank } from "@/lib/public-selftest";
import { publicSelftestEnabled } from "@/lib/public-selftest/flag";
import { selftestCopy, type SelftestLang } from "@/lib/public-selftest/copy";
import SelftestClient from "./_parts/SelftestClient";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const langOf = (v: string | string[] | undefined): SelftestLang => (one(v) === "en" ? "en" : "de");

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  if (!publicSelftestEnabled()) return {};
  const lang = langOf((await searchParams).lang);
  return {
    title: selftestCopy("meta_title", lang),
    description: selftestCopy("meta_description", lang),
    alternates: {
      canonical: lang === "en" ? `${SELFTEST_PATH}?lang=en` : SELFTEST_PATH,
      languages: { de: SELFTEST_PATH, en: `${SELFTEST_PATH}?lang=en` },
    },
  };
}

/** Entry surfaces that may tag the start event (anything else is dropped). */
const SOURCES = new Set(["landing", "stichprobentest", "kenntnispruefung-wien", "lernplan", "find-your-path", "answer-page", "sitting-page"]);

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  if (!publicSelftestEnabled()) notFound();
  const params = await searchParams;
  const lang = langOf(params.lang);
  const bank: SelftestBank | null = asSelftestBank(one(params.bank));
  const from = one(params.from);
  const source = from && SOURCES.has(from) ? from : "direct";
  const bankLabels = Object.fromEntries(SELFTEST_BANKS.map((b) => [b, getExamLabel(b, "full", lang)])) as Record<SelftestBank, string>;
  const minutes = Math.round(selftestDurationS(SELFTEST_SIZE) / 60);

  return (
    <main lang={lang} className="mx-auto min-w-0 max-w-3xl px-4 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8" data-testid="selftest-page">
      <nav className="mb-8 flex flex-wrap items-center justify-between gap-4" aria-label={selftestCopy("language", lang)}>
        <Link href="/" className="text-lg font-bold">{selftestCopy("home", lang)}</Link>
        <div className="flex gap-3">
          {(["de", "en"] as const).map((l) => (
            <Link
              key={l}
              lang={l}
              hrefLang={l}
              href={`${SELFTEST_PATH}?${new URLSearchParams({ ...(bank ? { bank } : {}), ...(l === "en" ? { lang: "en" } : { lang: "de" }) })}`}
              aria-current={l === lang ? "page" : undefined}
              className="mp-btn mp-btn--secondary mp-btn--sm"
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </div>
      </nav>
      <header className="mb-6">
        <p className="mb-3 font-mono text-xs tracking-widest text-[var(--mp-fg-muted)]">{selftestCopy("eyebrow", lang)}</p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{selftestCopy("title", lang, { n: SELFTEST_SIZE })}</h1>
        <p className="mt-3 leading-relaxed text-[var(--mp-fg-muted)]">{selftestCopy("intro", lang, { n: SELFTEST_SIZE, minutes })}</p>
      </header>
      <SelftestClient lang={lang} explicitLang={one(params.lang) !== undefined} initialBank={bank} bankLabels={bankLabels} source={source} />
    </main>
  );
}
