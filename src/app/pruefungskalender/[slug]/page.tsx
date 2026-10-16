import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import CalendarLanguageSync from "@/components/exam-calendar/CalendarLanguageSync";
import { CalendarShell } from "@/components/exam-calendar/CalendarSurface";
import FreeSampleLink from "./FreeSampleLink";
import SelftestEntryLink from "@/components/selftest/SelftestEntryLink";
import { asSelftestBank } from "@/lib/public-selftest";
import { publicSelftestEnabled } from "@/lib/public-selftest/flag";
import { calendarLanguage } from "@/lib/exam-calendar";
import { calendarFeedEnabled } from "@/lib/exam-calendar/feed";
import { formatDisplayDate } from "@/lib/exam-formats";
import { guidanceLink } from "@/lib/guidance/public-links";
import { daysLeftText } from "@/lib/i18n-dates";
import {
  SITTING_PAGES_PATH,
  resolveSittingSlug,
  rowWindowState,
  siblingPage,
  sittingDatesFrozen,
  sittingJsonLd,
  sittingPagesEnabled,
  type SittingPage,
} from "@/lib/sitting-pages";
import { SITTING_COPY, SITTING_READ_LINKS } from "@/lib/sitting-pages/copy";

export const dynamic = "force-dynamic";

const SITE = "https://medpruf.com";
type Params = { slug: string };
type Search = { lang?: string | string[] };

const withLang = (path: string, lang: "de" | "en") => (lang === "en" ? `${path}?lang=en` : path);

function dateLine(page: SittingPage, lang: "de" | "en") {
  const c = SITTING_COPY[lang];
  return page.dateEnd && page.dateEnd !== page.date
    ? c.examWeek(formatDisplayDate(page.date, lang), formatDisplayDate(page.dateEnd, lang))
    : c.examDay(formatDisplayDate(page.date, lang));
}

export async function generateMetadata({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }): Promise<Metadata> {
  if (!sittingPagesEnabled()) return {};
  const { slug } = await params;
  const res = resolveSittingSlug(slug);
  if (res.kind !== "page") return {};
  const lang = calendarLanguage((await searchParams).lang);
  const c = SITTING_COPY[lang];
  const frozen = sittingDatesFrozen();
  const when = frozen ? null : formatDisplayDate(res.page.date, lang);
  const path = `${SITTING_PAGES_PATH}/${res.page.slug}`;
  return {
    title: c.metaTitle(res.page.label[lang], when),
    description: c.metaDescription(res.page.label[lang], when),
    alternates: {
      canonical: `${SITE}${withLang(path, lang)}`,
      languages: { de: `${SITE}${path}`, en: `${SITE}${path}?lang=en`, "x-default": `${SITE}${path}` },
    },
  };
}

export default async function Page({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  if (!sittingPagesEnabled()) notFound();
  const { slug } = await params;
  const sp = await searchParams;
  const lang = calendarLanguage(sp.lang);
  const now = new Date();
  const res = resolveSittingSlug(slug, now);
  if (res.kind === "missing") notFound();
  if (res.kind === "redirect") redirect(withLang(res.to, lang));
  const page = res.page;
  const c = SITTING_COPY[lang];
  const frozen = sittingDatesFrozen();
  const path = `${SITTING_PAGES_PATH}/${page.slug}`;
  const ld = sittingJsonLd(page, lang, `${SITE}${withLang(path, lang)}`, frozen);
  const sibling = siblingPage(page, now);
  const readLinks = SITTING_READ_LINKS[page.examKey].map((p) => guidanceLink(p)).filter((l): l is NonNullable<typeof l> => !!l);
  const showPlan = page.bank !== null && process.env.STUDY_PLAN_PUBLIC_ENABLED === "true" && !frozen;
  const showFeed = calendarFeedEnabled();
  const selftestBank = asSelftestBank(page.bank);
  const sourceUrls = [...new Set(page.rows.map((r) => r.source_url))];
  const title = frozen ? page.label[lang] : `${page.label[lang]}, ${formatDisplayDate(page.date, lang)}`;
  const link = "font-semibold underline underline-offset-4";
  return (
    <CalendarShell lang={lang} path={path} title={title}>
      <CalendarLanguageSync lang={lang} explicit={sp.lang !== undefined} />
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}
      <div className="grid max-w-3xl gap-6" data-sitting-page={page.slug}>
        <p className="text-sm leading-relaxed">{c.lede}</p>
        {frozen ? (
          <aside className="mp-card p-5 text-sm leading-relaxed" data-date-freeze>
            <p>{c.frozen}</p>
            <ul className="mt-3 grid gap-2">
              {sourceUrls.map((u) => (
                <li key={u}><a className={`${link} inline-flex min-h-11 items-center break-all`} href={u} target="_blank" rel="noopener noreferrer">{c.official}</a></li>
              ))}
            </ul>
          </aside>
        ) : (
          <>
            <section aria-labelledby="sitting-h" className="mp-card p-5">
              <h2 id="sitting-h" className="text-lg font-bold">{c.sittingHeading}</h2>
              <p className="mt-2 font-semibold">{dateLine(page, lang)}</p>
            </section>
            <section aria-labelledby="reg-h" className="mp-card p-5">
              <h2 id="reg-h" className="text-lg font-bold">{c.registrationHeading}</h2>
              {page.rows.length > 1 && <p className="mt-2 text-sm leading-relaxed">{c.twoPublishers}</p>}
              {page.rows.map((r) => {
                const state = rowWindowState(r, now);
                return (
                  <div key={`${r.publisher}-${r.deadline_type}`} data-window-row className="mt-4 border-t border-[var(--mp-border)] pt-4 text-sm leading-relaxed">
                    <p className="font-semibold">{r.publisher}</p>
                    <p>{r.deadline_type === "filing_cutoff" ? c.kind.filing : c.kind.registration}</p>
                    {r.registration_opens && <p>{c.opens}: {formatDisplayDate(r.registration_opens, lang)}</p>}
                    {r.registration_closes ? (
                      <p>
                        {c.closes}: {formatDisplayDate(r.registration_closes, lang)}
                        {r.closes_at_time ? `, ${c.closesAt(r.closes_at_time)}` : ""} ({c.viennaTime})
                      </p>
                    ) : (
                      <p>{c.noClose}</p>
                    )}
                    {state && <p className="mt-1 font-semibold">{c.state[state]}{(state === "open" || state === "running") && r.registration_closes ? ` ${daysLeftText(r.registration_closes, lang, now)}` : ""}</p>}
                    <p className="mt-2 break-words text-xs text-[var(--mp-fg-muted)]">{c.sourceStamp(r.publisher, formatDisplayDate(r.read_on, lang))}</p>
                    <a className={`${link} mt-1 inline-flex min-h-11 items-center break-all`} href={r.source_url} target="_blank" rel="noopener noreferrer">{c.official}</a>
                  </div>
                );
              })}
            </section>
          </>
        )}
        <section aria-labelledby="next-h" className="mp-card p-5">
          <h2 id="next-h" className="text-lg font-bold">{c.nextHeading}</h2>
          <p className="mt-2 text-sm leading-relaxed">{c.next[page.examKey]}</p>
          {sibling && (
            <p className="mt-3 text-sm">{c.siblingLead} <Link className={`${link} inline-flex min-h-11 items-center`} href={withLang(`${SITTING_PAGES_PATH}/${sibling.slug}`, lang)}>{sibling.label[lang]}</Link></p>
          )}
        </section>
        {readLinks.length > 0 && (
          <section aria-labelledby="read-h">
            <h2 id="read-h" className="text-lg font-bold">{c.readHeading}</h2>
            <ul className="mt-3 grid gap-3 text-sm">
              {readLinks.map((l) => (
                <li key={l.href}><Link className={`${link} inline-flex min-h-11 items-center`} href={withLang(l.href, lang)}>{l.label[lang]}</Link></li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="prep-h" className="mp-card p-5">
          <h2 id="prep-h" className="text-lg font-bold">{c.prepareHeading}</h2>
          <ul className="mt-3 grid gap-4 text-sm leading-relaxed">
            {showPlan && (
              <li>
                <a className={`${link} inline-flex min-h-11 items-center`} data-sitting-plan href={`/lernplan?bank=${page.bank}&sitting=${page.date}`}>{c.plan}</a>
                <p>{c.planNote}</p>
              </li>
            )}
            {showFeed && !frozen && (
              <li>
                <a className={`${link} inline-flex min-h-11 items-center`} data-sitting-feed href={`/api/calendar/${page.examKey}.ics${lang === "en" ? "?lang=en" : ""}`}>{c.calendar}</a>
                <p>{c.calendarNote}</p>
              </li>
            )}
            {page.bank && (
              <li>
                <FreeSampleLink bank={page.bank} className={`${link} inline-flex min-h-11 items-center`}>{c.sample}</FreeSampleLink>
                <p>{page.examKey === "gerichtsmedizin" ? c.sampleNoteGm : c.sampleNote}</p>
              </li>
            )}
            {selftestBank && (
              <li>
                <SelftestEntryLink lang={lang} bank={selftestBank} from="sitting-page" enabled={publicSelftestEnabled()} variant="inline" />
              </li>
            )}
          </ul>
        </section>
        <p className="text-xs leading-relaxed text-[var(--mp-fg-muted)]">{c.disclaimer}</p>
        <p className="text-sm"><Link className={`${link} inline-flex min-h-11 items-center`} href={withLang(SITTING_PAGES_PATH, lang)}>{c.allSittings}</Link></p>
      </div>
    </CalendarShell>
  );
}
