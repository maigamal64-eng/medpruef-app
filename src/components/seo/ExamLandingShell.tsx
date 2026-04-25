"use client";

/**
 * ExamLandingShell — shared hero/breakdown/FAQ/CTA surface for the
 * three SEO landing pages:
 *   /kenntnispruefung-wien
 *   /kmp-innsbruck
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
import { getLang, setLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";

export interface ExamLandingBreakdownRow {
  label: { de: string; en: string };
  value: string;
  sub?: { de: string; en: string };
}

export interface ExamLandingFaqItem {
  q: { de: string; en: string };
  a: { de: string; en: string };
}

export interface ExamLandingContent {
  /** Human-readable exam name — "Kenntnisprüfung Wien", "KMP Innsbruck", etc. */
  examName: { de: string; en: string };
  /** Short-form chip that sits above the hero title (e.g. "Österreich · Wien") */
  eyebrow: { de: string; en: string };
  /** Hero H1 text. Default copy pattern: "Bestehe die [Exam] beim ersten Versuch." */
  heroTitle: { de: string; en: string };
  /** Hero sub-headline, ~20–30 words, plain prose. */
  heroSubtitle: { de: string; en: string };
  /** Primary CTA deep-link (e.g. `/quiz?exam=kenntnispruefung&free=1`) */
  primaryCtaHref: string;
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
    setLang(l);
    setLangState(l);
  };

  // While SSR is resolving, still render the DE text so crawlers get
  // a full document. Once mounted we swap to whatever the user chose.
  const L: Lang = mounted ? lang : "de";

  const dayWord = daysLeft === 1 ? "Tag" : "Tage";

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
                  ? `Noch ${daysLeft} ${dayWord} bis zum 26. Juni 2026`
                  : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} until 26 June 2026`}
              </span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Link
              href={content.primaryCtaHref}
              className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[48px] px-5"
            >
              {content.primaryCtaLabel[L]}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
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
              ? `Was du über die ${content.examName.de} wissen musst.`
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
                  {row.value}
                </dd>
                {row.sub && (
                  <p className="text-xs text-[var(--mp-fg-muted)] mt-1.5">
                    {row.sub[L]}
                  </p>
                )}
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* What you'll learn */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 pb-12">
        <div className="grid md:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="mp-h2 text-[28px] mb-3">
              {L === "de" ? "Was du mit MedPrüf lernst" : "What you'll learn on MedPrüf"}
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
                  {L === "de" ? "10.992 Fragen" : "10.992 questions"}
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
                    ? "Aus offiziellen Prüfungen"
                    : "From official exams"}
                </p>
                <p className="text-xs text-[var(--mp-fg-muted)]">
                  {L === "de"
                    ? "10.992 dokumentierte Fragen, nichts erfunden"
                    : "10,992 documented questions, nothing invented"}
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
                    ? "auf der Juni-26-Kohorte"
                    : "on the June 26 Cohort"}
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
            ? `Die wichtigsten Fragen zur ${content.examName.de} — kurz und faktenbasiert beantwortet.`
            : `Key questions about the ${content.examName.en} — short, factual answers.`}
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
              ? "Starte mit 150 kostenlosen Fragen. Keine Kreditkarte, kein Abo. Nur echte Prüfungsvorbereitung."
              : "Start with 150 free questions. No credit card, no subscription. Just real exam prep."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link
              href={content.primaryCtaHref}
              className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[48px] px-6"
            >
              {content.primaryCtaLabel[L]}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
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
            <span>MedPrüf · [name] · Wien, Österreich</span>
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
