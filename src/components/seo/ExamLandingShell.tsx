"use client";

/**
 * ExamLandingShell — shared hero/breakdown/FAQ/CTA surface for the
 * three SEO landing pages:
 *   /kenntnispruefung-wien
 *   /stichprobentest
 *   /pharmakologie-pruefung-wien
 *
 * Each route passes its own content (title, sub-copy, breakdown rows,
 * FAQ Q&A, CTA targets) so each page renders exam-specific text —
 * this component only owns layout + i18n + language toggle.
 *
 * The server route files (layout.tsx) own the static <title> + meta
 * description + OpenGraph tags + JSON-LD Course schema — so the crawl
 * works even with JS disabled.
 *
 * Cohort countdown banner — rendered by the global
 * <CohortCountdownBanner> mounted in root layout. The Pharma landing
 * page ALSO renders a local, always-visible date chip so that even
 * users who have dismissed the banner still see the countdown on the
 * page itself (`showCountdownChip` prop).
 *
 * Design — MPDS v2 semantic tokens + primitives. Kept intentionally
 * low-JS: no auth/session/context reads, no FeedbackWidget mounting.
 * A crawler hitting this page with JS disabled sees the full text
 * content in the pre-rendered HTML.
 */

import PublicStudyLink from "@/components/PublicStudyLink";
import FreeOfferDisclosure from "@/components/FreeOfferDisclosure";
import PharmaExamWindow from "@/components/PharmaExamWindow";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  Globe,
  Languages,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getLang } from "@/lib/i18n";
import { COMPANY, FREE_TIER } from "@/lib/content-truth";
import { getFutureSittings, type PuypExamType } from "@/lib/exam-dates";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import ExamOrientation from "@/components/seo/ExamOrientation";

type Bank = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

type Lang = "de" | "en";

export interface ExamLandingBreakdownRow {
  label: { de: string; en: string };
  value: string | { de: string; en: string };
  sub?: { de: string; en: string };
}

export interface ExamLandingFaqItem {
  q: { de: string; en: string };
  a: { de: string; en: string };
}

export interface ExamLandingContent {
  /** Human-readable exam name, e.g. "Kenntnisprüfung Wien", "Stichprobentest (Innsbruck)". */
  examName: { de: string; en: string };
  /** Short-form chip that sits above the hero title (e.g. "Österreich · Wien") */
  eyebrow: { de: string; en: string };
  /** Hero H1 text (no pass or first-attempt promise). */
  heroTitle: { de: string; en: string };
  /** Hero sub-headline, ~20–30 words, plain prose. */
  heroSubtitle: { de: string; en: string };
  /** Primary CTA deep-link (e.g. `/quiz?exam=kenntnispruefung&free=1`) */
  primaryCtaHref: string;
  officialPharmaWeek?: boolean;
  primaryCtaLabel: { de: string; en: string };
  /** Secondary CTA (typically /pricing) */
  secondaryCtaHref: string;
  secondaryCtaLabel: { de: string; en: string };
  /**
   * "10 specialties" / "7,566 questions" row — key/value table that
   * appears directly under the hero. Keep 2–6 rows.
   */
  breakdown: ExamLandingBreakdownRow[];
  /**
   * Whether to render an always-visible "N days to next exam" chip
   * near the hero. Used by the Pharmakologie page — the global cohort
   * banner fades after user dismissal, but THIS chip is page-local and
   * non-dismissible.
   */
  showCountdownChip?: boolean;
  /** ISO date for the countdown chip ("2026-06-26T09:00:00+02:00"). */
  countdownTargetIso?: string;
  /**
   * When set, renders the venue-rotation table for this exam type
   * directly from `EXAM_SITTINGS` (the code owner of exam dates). The
   * Stichprobentest rotates its venue every sitting, so seeing the next
   * several dates + cities together is the fact readers actually want.
   * Future-only, so it self-ages exactly like the rest of the calendar.
   */
  sittingsExamType?: PuypExamType;
  /** Bank behind this page: renders the freshness stamp and the other-bank strip. */
  bank?: Bank;
  /** Sourced rules pages for this exam (e.g. /exam-formats/rezeptierkunde). */
  rulesPaths?: string[];
  /** Optional link to the official registration guidance for this exam. */
  guidanceLink?: { href: string; label: { de: string; en: string } };
  /** What's this exam going to cover? 3–5 bullets, DE/EN. */
  whatYouLearn: Array<{ de: string; en: string }>;
  /** FAQ — 5 to 8 exam-specific questions. */
  faq: ExamLandingFaqItem[];
  /**
   * Optional JSON-LD Course metadata that was already emitted by the
   * route's layout. Not rendered here — used for debug only.
   */
  __debugSchema?: Record<string, unknown>;
}

/**
 * Day-precise date label for the sittings table. Parses the ISO date as
 * a LOCAL calendar date so the day never shifts across time zones (the
 * same trick <UpcomingExams> uses).
 */
function formatSittingDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(
    lang === "de" ? "de-AT" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" }
  );
}

function getDaysUntil(targetIso: string): number {
  const now = Date.now();
  const then = new Date(targetIso).getTime();
  const ms = then - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function ExamLandingShell({ content }: { content: ExamLandingContent }) {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    setLangState(getLang());
    setMounted(true);
    if (content.showCountdownChip && content.countdownTargetIso) {
      const d = getDaysUntil(content.countdownTargetIso);
      setDaysLeft(d > 0 ? d : null);
    }
  }, [content.showCountdownChip, content.countdownTargetIso]);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  // While SSR is resolving, still render the DE text so crawlers get
  // a full document. Once mounted we swap to whatever the user chose.
  const L: Lang = mounted ? lang : "de";

  const dayWord = daysLeft === 1 ? "Tag" : "Tage";

  // Future-only sittings for the optional venue-rotation table. Computed
  // during render (pure, day-granularity) exactly like the rest of the
  // calendar surfaces.
  const sittings = content.sittingsExamType
    ? getFutureSittings(content.sittingsExamType)
    : [];

  // Format the countdown target date from the ISO prop so the label can
  // never drift from the actual target (the old hardcoded "26. Juni 2026"
  // string went stale independently of the date the chip counted to).
  const countdownDateLabel = content.countdownTargetIso
    ? new Date(content.countdownTargetIso).toLocaleDateString(
        L === "de" ? "de-AT" : "en-GB",
        { day: "numeric", month: "long", year: "numeric" }
      )
    : "";

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      {/* Top bar — minimalist, no auth gating */}
      <header className="sticky top-0 z-30 bg-[var(--mp-surface-raised)] border-b border-[var(--mp-border-subtle)]">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
          <Link
            href="/landing"
            className="flex items-center gap-2 text-[var(--mp-fg)] hover:opacity-80 transition-opacity"
            aria-label="MedPrüf"
          >
            <Image
              src="/brand/logomark.svg"
              width={28}
              height={28}
              alt=""
              aria-hidden
              className="flex-shrink-0"
            />
            <span className="font-display font-bold text-lg tracking-tight">MedPrüf</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors hidden sm:inline"
            >
              {L === "de" ? "Preise" : "Pricing"}
            </Link>
            <ThemeToggle />
            <LanguageToggle lang={L} onChange={switchLang} />
          </div>
        </div>
      </header>

      {/* Breadcrumb-style back link */}
      <div className="max-w-6xl mx-auto px-4 lg:px-8 pt-5">
        <Link
          href="/landing"
          className="inline-flex items-center gap-1 text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {L === "de" ? "Startseite" : "Home"}
        </Link>
      </div>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 pt-8 pb-12 lg:pt-14 lg:pb-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-[var(--mp-success-bg)] border border-[var(--mp-viridian)]/20 px-3 py-1 mb-5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--mp-viridian)]" aria-hidden />
            <span className="text-xs font-medium text-[var(--mp-viridian)]">
              {content.eyebrow[L]}
            </span>
          </div>

          <h1 className="mp-h1 leading-[1.05] mb-5 text-[36px] sm:text-[44px] lg:text-[56px]">
            {content.heroTitle[L]}
          </h1>

          <p className="mp-body text-lg text-[var(--mp-fg-muted)] max-w-2xl mb-7">
            {content.heroSubtitle[L]}
          </p>

          {content.showCountdownChip && daysLeft !== null && (
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--mp-cta-blue)]/10 border border-[var(--mp-cta-blue)]/20 px-3 py-1.5 mb-6">
              <Calendar
                className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]"
                aria-hidden
              />
              <span className="text-xs font-semibold text-[var(--mp-cta-blue)]">
                {L === "de"
                  ? `Noch ${daysLeft} ${dayWord} bis zum ${countdownDateLabel}`
                  : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} until ${countdownDateLabel}`}
              </span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <PublicStudyLink
              href={content.primaryCtaHref}
              className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[48px] px-5"
            >
              {content.primaryCtaLabel[L]}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </PublicStudyLink>
            <FreeOfferDisclosure lang={L} className="w-full" />
            <Link
              href={content.secondaryCtaHref}
              className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 min-h-[48px] px-5"
            >
              {content.secondaryCtaLabel[L]}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {content.officialPharmaWeek && <div className="max-w-5xl mx-auto px-4 lg:px-8 pb-8"><PharmaExamWindow lang={L} /></div>}

      {/* Breakdown section */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 pb-12">
        <div
          className="rounded-[var(--mp-r-card)] p-6 md:p-8 mp-card"
          style={{ border: "1px solid var(--mp-border-subtle)" }}
        >
          <h2 className="mp-h2 text-[24px] mb-1">
            {L === "de" ? "Auf einen Blick" : "At a glance"}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] mb-6 text-sm">
            {L === "de"
              ? `Was Sie über die ${content.examName.de} wissen sollten.`
              : `What you need to know about the ${content.examName.en}.`}
          </p>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {content.breakdown.map((row, i) => (
              <div
                key={i}
                className="rounded-lg p-4"
                style={{
                  background: "var(--mp-surface-sunken)",
                  border: "1px solid var(--mp-border-subtle)",
                }}
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)] mb-1">
                  {row.label[L]}
                </dt>
                <dd className="text-2xl font-display font-bold text-[var(--mp-fg)] leading-none">
                  {typeof row.value === "string" ? row.value : row.value[L]}
                </dd>
                {row.sub && (
                  <p className="text-xs text-[var(--mp-fg-muted)] mt-1.5">
                    {row.sub[L]}
                  </p>
                )}
              </div>
            ))}
          </dl>
          {content.guidanceLink && (
            <Link
              href={content.guidanceLink.href}
              className="mt-5 inline-block text-sm font-semibold text-[var(--mp-viridian)] underline-offset-4 hover:underline"
            >
              {content.guidanceLink.label[L]}
            </Link>
          )}
        </div>
      </section>

      {content.bank && <ExamOrientation bank={content.bank} rulesPaths={content.rulesPaths} lang={L} />}

      {/* Venue rotation / upcoming sittings — opt-in per page, read
          straight from the self-aging calendar so it can never go stale. */}
      {sittings.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 lg:px-8 pb-12">
          <div
            className="rounded-[var(--mp-r-card)] p-6 md:p-8 mp-card"
            style={{ border: "1px solid var(--mp-border-subtle)" }}
          >
            <h2 className="mp-h2 text-[24px] mb-1">
              {L === "de" ? "Termine und Standorte" : "Dates and venues"}
            </h2>
            <p className="mp-body text-[var(--mp-fg-muted)] mb-6 text-sm">
              {L === "de"
                ? "Der Standort wechselt bei jedem Termin. Vergangene Termine fallen automatisch heraus."
                : "The venue rotates with every sitting. Past dates drop off automatically."}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <caption className="sr-only">
                  {L === "de"
                    ? `Kommende Termine: ${content.examName.de}`
                    : `Upcoming sittings: ${content.examName.en}`}
                </caption>
                <thead>
                  <tr className="text-left">
                    <th
                      scope="col"
                      className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)] whitespace-nowrap"
                    >
                      {L === "de" ? "Termin" : "Date"}
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)] whitespace-nowrap"
                    >
                      {L === "de" ? "Standort" : "Venue"}
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)] whitespace-nowrap"
                    >
                      {L === "de" ? "Anmeldeschluss" : "Registration deadline"}
                    </th>
                    <th
                      scope="col"
                      className="py-2 text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)] whitespace-nowrap"
                    >
                      {L === "de" ? "Quelle" : "Source"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sittings.map((s) => (
                    <tr
                      key={s.date}
                      className="border-t border-[var(--mp-border-subtle)] align-top"
                    >
                      <td className="py-3 pr-4 font-semibold text-[var(--mp-fg)] whitespace-nowrap tabular-nums">
                        {formatSittingDate(s.date, L)}
                      </td>
                      <td className="py-3 pr-4 text-[var(--mp-fg)] whitespace-nowrap">
                        {s.location ?? "—"}
                      </td>
                      <td className="py-3 pr-4 text-[var(--mp-fg-muted)] whitespace-nowrap">
                        {s.registrationDeadline
                          ? formatSittingDate(s.registrationDeadline, L)
                          : L === "de"
                            ? "über Ihre Universität"
                            : "via your university"}
                      </td>
                      <td className="py-3">
                        <a
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--mp-viridian)] hover:underline underline-offset-2"
                        >
                          {s.sourceLabel ??
                            (L === "de" ? "Offizielle Quelle" : "Official source")}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--mp-fg-muted)] mt-4 leading-relaxed">
              {L === "de"
                ? "Verbindlich sind immer Ihr Bescheid und die Seite Ihrer Nostrifizierungs-Universität. Wo kein Anmeldeschluss steht, ist er für diesen Termin noch nicht veröffentlicht."
                : "Your decision letter and your nostrification university's page are always the binding reference. Where no deadline is listed, it has not been published for that sitting yet."}
            </p>
          </div>
        </section>
      )}

      {/* What you'll learn */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 pb-12">
        <div className="grid md:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="mp-h2 text-[28px] mb-3">
              {L === "de" ? "Was Sie mit MedPrüf üben" : "What you'll learn on MedPrüf"}
            </h2>
            <p className="mp-body text-[var(--mp-fg-muted)]">
              {L === "de"
                ? `Jede Frage ist speziell für die ${content.examName.de} kuratiert. Keine generischen Medizin-Karten, keine füllerartigen Inhalte.`
                : `Every question is curated specifically for the ${content.examName.en}. No generic medicine flashcards, no filler content.`}
            </p>
          </div>
          <ul className="space-y-3">
            {content.whatYouLearn.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--mp-success-bg)] flex items-center justify-center mt-0.5">
                  <Check className="w-3.5 h-3.5 text-[var(--mp-viridian)]" aria-hidden />
                </span>
                <span className="text-[var(--mp-fg)] leading-relaxed">{item[L]}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Social proof */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 pb-12">
        <div
          className="rounded-[var(--mp-r-card)] p-6 md:p-8 bg-gradient-to-br from-[var(--mp-viridian)]/5 to-[var(--mp-cta-blue)]/5"
          style={{ border: "1px solid var(--mp-border-subtle)" }}
        >
          <div className="grid sm:grid-cols-3 gap-6 text-center sm:text-left">
            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <BookOpen className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0" aria-hidden />
              <div>
                <p className="font-display font-bold text-[var(--mp-fg)]">
                  {L === "de" ? "über 10.000 Fragen" : "over 10,000 questions"}
                </p>
                <p className="text-xs text-[var(--mp-fg-muted)]">
                  {L === "de" ? "insgesamt im Qbank" : "in the Qbank"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <Globe className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0" aria-hidden />
              <div>
                <p className="font-display font-bold text-[var(--mp-fg)]">
                  {L === "de"
                    ? "Kuratierte Übungsfragen"
                    : "Curated practice questions"}
                </p>
                <p className="text-xs text-[var(--mp-fg-muted)]">
                  {L === "de"
                    ? "Quellen und Formate je nach Prüfungsbank"
                    : "Sources and formats vary by question bank"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 justify-center sm:justify-start">
              <ShieldCheck
                className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0"
                aria-hidden
              />
              <div>
                <p className="font-display font-bold text-[var(--mp-fg)]">
                  {L === "de" ? "Pass-Until-You-Pass" : "Pass-Until-You-Pass"}
                </p>
                <p className="text-xs text-[var(--mp-fg-muted)]">
                  {L === "de"
                    ? "auf der Prüfungs-Kohorte"
                    : "on the Exam Cohort"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-4xl mx-auto px-4 lg:px-8 pb-16">
        <h2 className="mp-h2 text-[28px] mb-2">
          {L === "de" ? "Häufige Fragen" : "Frequently asked questions"}
        </h2>
        <p className="mp-body text-[var(--mp-fg-muted)] mb-8 text-sm">
          {L === "de"
            ? `Die wichtigsten Fragen zur ${content.examName.de}: kurz und faktenbasiert beantwortet.`
            : `Key questions about the ${content.examName.en}: short, factual answers.`}
        </p>
        <div className="space-y-3">
          {content.faq.map((item, i) => (
            <details
              key={i}
              className="rounded-lg group"
              style={{
                background: "var(--mp-surface-raised)",
                border: "1px solid var(--mp-border-subtle)",
              }}
            >
              <summary
                className="px-4 py-3 cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold text-[var(--mp-fg)]"
                style={{ userSelect: "none" }}
              >
                <span>{item.q[L]}</span>
                <ChevronDown
                  className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)] transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="px-4 pb-4 text-sm leading-relaxed text-[var(--mp-fg-muted)]">
                {item.a[L]}
              </div>
            </details>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link
            href="/faq"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] hover:underline"
          >
            {L === "de" ? "Alle FAQ ansehen" : "See all FAQ"}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-4 lg:px-8 pb-20">
        <div
          className="rounded-[var(--mp-r-card)] p-6 md:p-10 text-center"
          style={{
            background: "var(--mp-surface-raised)",
            border: "1px solid var(--mp-border-subtle)",
          }}
        >
          <h2 className="mp-h2 text-[28px] mb-3">
            {L === "de"
              ? `Bereit für die ${content.examName.de}?`
              : `Ready for the ${content.examName.en}?`}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] mb-6 max-w-xl mx-auto">
            {L === "de"
              ? `Starten Sie mit ${FREE_TIER.questions_per_exam_type} kostenlosen Fragen pro Fragenbank. Ohne Karte, ohne Abo.`
              : `Start with ${FREE_TIER.questions_per_exam_type} free questions per question bank. No card, no subscription.`}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <PublicStudyLink
              href={content.primaryCtaHref}
              className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[48px] px-6"
            >
              {content.primaryCtaLabel[L]}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </PublicStudyLink>
            <Link
              href={content.secondaryCtaHref}
              className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 min-h-[48px] px-6"
            >
              {content.secondaryCtaLabel[L]}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </div>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-4 flex items-center justify-center gap-1">
            <Languages className="w-3 h-3" aria-hidden />
            {L === "de"
              ? "Verfügbar auf Deutsch, Englisch, Arabisch, Russisch, Französisch, Türkisch, Ukrainisch, Serbisch."
              : "Available in German, English, Arabic, Russian, French, Turkish, Ukrainian, Serbian."}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 text-xs text-[var(--mp-fg-muted)] flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Image src="/brand/logomark.svg" width={20} height={20} alt="" aria-hidden />
            <span>{COMPANY.one_line[L]}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/impressum" className="hover:text-[var(--mp-fg)]">
              Impressum
            </Link>
            <Link href="/privacy" className="hover:text-[var(--mp-fg)]">
              {L === "de" ? "Datenschutz" : "Privacy"}
            </Link>
            <Link href="/terms" className="hover:text-[var(--mp-fg)]">
              {L === "de" ? "AGB" : "Terms"}
            </Link>
            <Link href="/faq" className="hover:text-[var(--mp-fg)]">
              FAQ
            </Link>
            <Link href="/blog" className="hover:text-[var(--mp-fg)]">
              Blog
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
