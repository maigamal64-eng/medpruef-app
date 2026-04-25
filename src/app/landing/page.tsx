"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";

// Free-tier CTAs default to the user's stored exam preference. SSR returns
// kenntnispruefung (the safest default — biggest cohort) so the link resolves
// instantly; on hydration we re-read localStorage and adjust if different.
function freeQuizHref(exam: ExamSourceId | null): string {
  const e = exam ?? "kenntnispruefung";
  return `/quiz?exam=${e}&free=1`;
}
import {
  ArrowRight,
  Baby,
  Brain,
  ChevronRight,
  Clock,
  Dna,
  Ear,
  Eye,
  Flag,
  Globe,
  HeartPulse,
  Languages,
  Menu,
  MessageCircle,
  Pill,
  Scissors,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Target,
  Users,
  X,
  Zap,
} from "lucide-react";

type Lang = "de" | "en";

/* ─────────────────────────────────────────────────────────────
   Copy — every string in one place, bilingual
   ───────────────────────────────────────────────────────────── */
const COPY = {
  nav: {
    features: { de: "Funktionen", en: "Features" },
    how: { de: "So funktioniert's", en: "How it works" },
    pricing: { de: "Preise", en: "Pricing" },
    login: { de: "Anmelden", en: "Sign in" },
    start: { de: "Kostenlos starten", en: "Start free" },
  },
  hero: {
    eyebrow: {
      de: "— Österreich · Kenntnisprüfung · KMP · Pharmakologie",
      en: "— Austria · Kenntnisprüfung · KMP · Pharmakologie",
    },
    title_pre: { de: "Beim ersten Versuch", en: "Pass first" },
    title_mid: { de: "bestehen", en: "try" },
    title_post: { de: "—", en: "—" },
    title_line2: {
      de: "oder kostenlos weiterlernen, bis du es schaffst.",
      en: "or study free until you do.",
    },
    // Authority pivot (review-2026-04-25-B3): replaced "Gebaut von
    // Ärzt:innen" — the founder is an Egyptian engineer, not a doctor;
    // the audit found the claim falsifiable. Pivoted to data-as-credential
    // (verifiable, doctor-respectable). Loss-frame line appended per
    // review-2026-04-25-B2: anchors €19 to the €370 re-sit fee.
    subtitle: {
      de: "Die einzige Prüfungsvorbereitung, speziell für Österreichs Kenntnisprüfung, KMP und Pharmakologie. Destilliert aus 7.566 Wien-Prüfungsfragen seit 2016, 3.091 KMP Innsbruck und 335 Pharmakologie. Eine Kenntnisprüfung kostet ~€370 pro Versuch — MedPrüf gibt es ab 19 €.",
      en: "The only exam prep built specifically for Austria's Kenntnisprüfung, KMP and Pharmakologie. Distilled from 7,566 Vienna exam questions since 2016, 3,091 KMP Innsbruck and 335 Pharmakologie. A Kenntnisprüfung re-sit is ~€370 — MedPrüf starts at 19 €.",
    },
    cta_primary: {
      de: "Kostenlos starten",
      en: "Start free",
    },
    cta_primary_sub: {
      de: "150 Pharma-Fragen · keine Karte",
      en: "150 Pharmakologie questions · no card",
    },
    cta_primary_long: {
      de: "Kostenlos starten — 150 Pharma-Fragen",
      en: "Start free — 150 Pharmakologie questions",
    },
    cta_secondary: {
      de: "Juni-26-Kohorte ansehen",
      en: "See June 26 Cohort plans",
    },
    cta_tertiary: {
      de: "Für €19 testen",
      en: "Try for €19",
    },
    cta_tertiary_sub: {
      de: "1 Monat · keine automatische Verlängerung",
      en: "1 month · no auto-renewal",
    },
    cta_note: {
      de: "Keine Karte · Juni-26-Kohorte mit Pass-Until-You-Pass-Garantie",
      en: "No credit card · June 26 Cohort includes Pass-Until-You-Pass",
    },
  },
  stats: [
    {
      value: "10.992",
      value_en: "10,992",
      label: { de: "Fragen", en: "Questions" },
    },
    {
      value: "3",
      value_en: "3",
      label: { de: "Prüfungen", en: "Exam types" },
      sub: { de: "Wien · Innsbruck · Pharma", en: "Vienna · Innsbruck · Pharma" },
    },
    {
      value: "7",
      value_en: "7",
      label: { de: "Sprachen", en: "Languages" },
    },
    {
      value: "1.806",
      value_en: "1,806",
      label: { de: "Mehrfachantworten", en: "Multi-correct" },
    },
  ],
  how: {
    eyebrow: { de: "So funktioniert's", en: "How it works" },
    title: { de: "In drei Schritten zur Prüfungsreife", en: "Exam-ready in three steps" },
    steps: [
      {
        n: "01",
        title: { de: "Prüfung wählen", en: "Choose your exam" },
        body: {
          de: "Kenntnisprüfung Wien, KMP Innsbruck oder Pharmakologie — wir kennen die Gewichtung jeder Prüfung.",
          en: "Kenntnisprüfung Wien, KMP Innsbruck or Pharmakologie — we know the weighting of each exam.",
        },
      },
      {
        n: "02",
        title: { de: "Täglich üben", en: "Practice daily" },
        body: {
          de: "20-50 Fragen pro Tag mit Spaced Repetition. Der Lernplan passt sich deinem Prüfungsdatum an.",
          en: "20-50 questions per day with spaced repetition. The study plan adapts to your exam date.",
        },
      },
      {
        n: "03",
        title: { de: "Simulieren", en: "Simulate" },
        body: {
          de: "Volle Prüfungssimulation. 4 Stunden, Themen-Navigator, aufgeschobene Bewertung — wie am Prüfungstag.",
          en: "Full exam simulation. 4 hours, topic navigator, deferred grading — just like exam day.",
        },
      },
    ],
  },
  features: {
    eyebrow: { de: "Was MedPrüf anders macht", en: "What makes MedPrüf different" },
    title: {
      de: "Nicht noch eine Karteikarten-App.",
      en: "Not another flashcard app.",
    },
    subtitle: {
      de: "Sechs Werkzeuge, die du in jeder anderen Prüfungs-App vermisst.",
      en: "Six tools you miss in every other exam app.",
    },
    items: [
      {
        icon: Brain,
        title: { de: "Klinische KI-Erklärungen", en: "Clinical AI explanations" },
        body: {
          de: "TL;DR zuerst, dann Leitlinien-Referenzen: ERC 2021, ESC, ÖDG. Nicht Wikipedia — klinisch.",
          en: "TL;DR first, then guideline references: ERC 2021, ESC, ÖDG. Not Wikipedia — clinical.",
        },
      },
      {
        icon: Globe,
        title: { de: "7 Sprachen", en: "7 languages" },
        body: {
          de: "Fragen auf Deutsch (wie in der echten Prüfung). Erklärungen in Deutsch, Englisch, Russisch, Arabisch, Türkisch, Ukrainisch, Rumänisch.",
          en: "Questions in German (as in the real exam). Explanations in German, English, Russian, Arabic, Turkish, Ukrainian, Romanian.",
        },
      },
      {
        icon: HeartPulse,
        title: { de: "Spaced Repetition (SM-2)", en: "Spaced repetition (SM-2)" },
        body: {
          de: "Fragen tauchen genau dann auf, wenn du sie zu vergessen beginnst. Wie Anki — nur klinisch kuratiert.",
          en: "Questions resurface right when you're about to forget. Like Anki — but clinically curated.",
        },
      },
      {
        icon: Clock,
        title: { de: "Prüfungssimulation", en: "Exam simulation" },
        body: {
          de: "4 Stunden, Themen-Navigator, aufgeschobene Bewertung. Trainiert Prüfungs-Ausdauer, nicht nur Wissen.",
          en: "4 hours, topic navigator, deferred grading. Trains exam stamina, not just knowledge.",
        },
      },
      {
        icon: Target,
        title: { de: "Lernplan bis zum Prüfungstag", en: "Study plan to exam day" },
        body: {
          de: "Countdown auf dein Prüfungsdatum. 70% neu + 30% Wiederholung, gewichtet nach deinen Schwächen.",
          en: "Countdown to your exam date. 70% new + 30% review, weighted by your weak topics.",
        },
      },
      {
        icon: Sparkles,
        title: { de: "Fragen melden → wir fixen", en: "Report questions → we fix" },
        body: {
          de: "Fehler in einer Frage? Ein Tap. Wir prüfen, korrigieren ähnliche Fragen und schicken dir eine Dankes-Mail.",
          en: "Error in a question? One tap. We review, fix similar questions, and email you a thank-you.",
        },
      },
    ],
  },
  subjects: {
    eyebrow: { de: "Fachgebiete", en: "Specialties" },
    title: {
      de: "16 Fachgebiete. Echte Fragen. Nichts erfunden.",
      en: "16 specialties. Real questions. Nothing invented.",
    },
    subtitle: {
      de: "Jede Frage stammt aus einer dokumentierten offiziellen Prüfung — Kenntnisprüfung Wien (SIP 4 + SIP 5), KMP Innsbruck, Pharmakologie.",
      en: "Every question comes from a documented official exam — Kenntnisprüfung Wien (SIP 4 + SIP 5), KMP Innsbruck, Pharmakologie.",
    },
    items: [
      { icon: HeartPulse, name: { de: "Innere Medizin", en: "Internal Medicine" } },
      { icon: Scissors, name: { de: "Chirurgie", en: "Surgery" } },
      { icon: Brain, name: { de: "Neurologie", en: "Neurology" } },
      { icon: MessageCircle, name: { de: "Psychiatrie", en: "Psychiatry" } },
      { icon: Eye, name: { de: "Augenheilkunde", en: "Ophthalmology" } },
      { icon: Ear, name: { de: "HNO", en: "ENT" } },
      { icon: Baby, name: { de: "Pädiatrie", en: "Pediatrics" } },
      { icon: Users, name: { de: "Gynäkologie", en: "Gynecology" } },
      { icon: Zap, name: { de: "Notfallmedizin", en: "Emergency" } },
      { icon: Dna, name: { de: "Dermatologie", en: "Dermatology" } },
      { icon: Pill, name: { de: "Pharmakologie", en: "Pharmacology" } },
      { icon: Stethoscope, name: { de: "Sozialmedizin", en: "Social Medicine" } },
    ],
  },
  pricing: {
    eyebrow: { de: "Preise", en: "Pricing" },
    title: {
      de: "Starte kostenlos. Upgrade zur Juni-26-Kohorte.",
      en: "Start free. Upgrade to the June 26 Cohort.",
    },
    subtitle: {
      de: "Jeder bezahlte Tarif enthält alle drei Prüfungstypen. Pass-Until-You-Pass-Garantie auf der Kohorte und dem Jahresabo.",
      en: "Every paid tier unlocks all three exam types. Pass-Until-You-Pass guarantee on the Cohort and the 12-month plan.",
    },
    tiers: [
      {
        name: { de: "Kostenlos", en: "Free" },
        price: "€0",
        period: { de: "dauerhaft", en: "forever" },
        pitch: {
          de: "150 Fragen × 3 Prüfungstypen · volle Erklärungen",
          en: "150 questions × 3 exam types · full explanations",
        },
        status: "live",
        cta: { de: "Kostenlos starten", en: "Start free" },
        href: "/quiz?exam=pharma&free=1",
      },
      {
        name: { de: "Juni-26-Kohorte", en: "June 26 Cohort" },
        price: "€114",
        period: { de: "6 Monate", en: "6 months" },
        pitch: {
          de: "Alle 10.992 Fragen · Pass-Until-You-Pass · Krypto-Checkout live",
          en: "All 10,992 questions · Pass-Until-You-Pass · live crypto checkout",
        },
        status: "live",
        cta: { de: "Zur Kohorte", en: "See the Cohort" },
        href: "/pricing",
      },
      {
        name: { de: "12 Monate", en: "12 months" },
        price: "€229",
        period: { de: "Jahr", en: "year" },
        pitch: {
          de: "Vollzugang · Pass-Until-You-Pass · Stripe kommt bald",
          en: "All-access · Pass-Until-You-Pass · Stripe launching soon",
        },
        status: "soon",
        cta: { de: "Warteliste", en: "Waitlist" },
        href: "/pricing",
      },
    ],
    link: { de: "Alle Preise vergleichen", en: "Compare all plans" },
    comingSoon: { de: "Bald", en: "Soon" },
  },
  proof: {
    eyebrow: { de: "Inhalt & Qualität", en: "Content & quality" },
    title: {
      de: "10.992 Fragen, kuratiert von Ärzt:innen für Ärzt:innen.",
      en: "10,992 questions, curated by physicians for physicians.",
    },
    quote: {
      de: "Jede Frage stammt aus einer dokumentierten offiziellen Prüfung — nichts erfunden, nichts geraten.",
      en: "Every question comes from a documented official exam — nothing invented, nothing guessed.",
    },
    breakdown: [
      {
        n: "7.566",
        n_en: "7,566",
        label: { de: "Wien · seit 2016", en: "Vienna · since 2016" },
      },
      {
        n: "3.091",
        n_en: "3,091",
        label: { de: "KMP Innsbruck", en: "KMP Innsbruck" },
      },
      {
        n: "335",
        n_en: "335",
        label: { de: "Pharmakologie", en: "Pharmacology" },
      },
    ],
  },
  cta: {
    title: { de: "Bereit für deine Prüfung?", en: "Ready for your exam?" },
    subtitle: {
      de: "Starte heute kostenlos. Kein Risiko, keine Kreditkarte.",
      en: "Start free today. No risk, no credit card.",
    },
    button: { de: "Kostenlos starten", en: "Start free" },
    trust: {
      de: "DSGVO-konform · Gehostet in der EU · Jederzeit kündbar",
      en: "GDPR compliant · Hosted in the EU · Cancel anytime",
    },
  },
  footer: {
    tagline: {
      de: "Vorbereitung auf österreichische Ärzteprüfungen — gebaut von und für ausländische Ärzt:innen.",
      en: "Austrian medical exam preparation — built by and for foreign doctors.",
    },
    product: { de: "Produkt", en: "Product" },
    legal: { de: "Rechtliches", en: "Legal" },
    rights: { de: "Alle Rechte vorbehalten.", en: "All rights reserved." },
  },
};

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");

  useEffect(() => {
    setLangState(getLang());
    setExamSource(getStoredExamSource());
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const freeHref = useMemo(() => freeQuizHref(examSource), [examSource]);

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  return (
    <div className="min-h-screen bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]">
      <Nav lang={lang} onLangChange={switchLang} />
      <Hero lang={lang} freeHref={freeHref} />
      <StatsStrip lang={lang} />
      <HowItWorks lang={lang} />
      <Features lang={lang} />
      <Subjects lang={lang} />
      <PricingPreview lang={lang} freeHref={freeHref} />
      <SocialProof lang={lang} />
      <FinalCTA lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Nav — transparent over hero, inverts on scroll past hero.
   Desktop: inline links. Mobile: hamburger sheet (only DE/EN
   toggle + Start CTA stay visible inline on mobile).
   ───────────────────────────────────────────────────────────── */
function Nav({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 480);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when the mobile sheet is open
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-[var(--mp-surface-raised)]/92 backdrop-blur-xl border-b border-[var(--mp-border-subtle)] shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2">
          <Link
            href="/landing"
            className={`flex items-center gap-2.5 shrink-0 ${scrolled ? "" : "text-white"}`}
            aria-label="MedPrüf home"
          >
            <Image
              src="/brand/logomark.svg"
              alt=""
              width={32}
              height={32}
              style={scrolled ? {} : { filter: "brightness(0) invert(1)" }}
            />
            <span
              className={`text-lg font-bold tracking-tight font-display ${
                scrolled ? "text-[var(--mp-oxford-blue)]" : "text-white"
              }`}
            >
              Med<span className="text-[var(--mp-accent-teal)]">Prüf</span>
            </span>
          </Link>

          {/* Desktop inline links */}
          <div
            className={`hidden md:flex items-center gap-7 text-sm font-medium ${
              scrolled ? "text-[var(--mp-fg-muted)]" : "text-white/70"
            }`}
          >
            <a
              href="#features"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.features[lang]}
            </a>
            <a
              href="#how"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.how[lang]}
            </a>
            <a
              href="#pricing"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.pricing[lang]}
            </a>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Language toggle — kept on mobile ([name]'s brief) */}
            <div
              className={`flex items-center rounded-lg p-0.5 text-xs border ${
                scrolled
                  ? "bg-[var(--mp-surface-sunken)] border-[var(--mp-border-subtle)]"
                  : "bg-white/10 border-white/20"
              }`}
              role="group"
              aria-label="Language"
            >
              {(["de", "en"] as Lang[]).map((l) => {
                const active = lang === l;
                return (
                  <button
                    key={l}
                    onClick={() => onLangChange(l)}
                    aria-pressed={active}
                    aria-label={l === "de" ? "Deutsch" : "English"}
                    className={`px-2.5 py-1 rounded font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-[var(--mp-accent-teal)] ${
                      active
                        ? "bg-[var(--mp-viridian)] text-white"
                        : scrolled
                          ? "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]"
                          : "text-white/60 hover:text-white"
                    }`}
                  >
                    {l.toUpperCase()}
                  </button>
                );
              })}
            </div>

            {/* Sign in (desktop only) */}
            <Link
              href="/login"
              className={`hidden md:inline-flex items-center gap-1.5 text-sm font-semibold transition-colors px-3 py-2 ${
                scrolled
                  ? "text-[var(--mp-fg-muted)] hover:text-[var(--mp-oxford-blue)]"
                  : "text-white/80 hover:text-white"
              }`}
            >
              {COPY.nav.login[lang]}
            </Link>

            {/* Start CTA — always visible */}
            <Link
              href="/login"
              className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 sm:px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] ${
                scrolled
                  ? "bg-[var(--mp-oxford-blue)] hover:bg-[var(--mp-cta-blue)] text-white"
                  : "bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)]"
              }`}
            >
              {COPY.nav.start[lang]}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>

            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={lang === "de" ? "Menü öffnen" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-landing-nav"
              className={`md:hidden inline-flex items-center justify-center rounded-lg p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--mp-accent-teal)] ${
                scrolled
                  ? "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu sheet */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[60] md:hidden"
          role="dialog"
          aria-modal="true"
          id="mobile-landing-nav"
          aria-label={lang === "de" ? "Navigation" : "Navigation"}
        >
          <button
            type="button"
            aria-label={lang === "de" ? "Menü schließen" : "Close menu"}
            onClick={closeMenu}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-[min(320px,88vw)] bg-[var(--mp-surface-raised)] border-l border-[var(--mp-border-subtle)] shadow-2xl flex flex-col"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--mp-border-subtle)]">
              <span className="text-base font-bold font-display text-[var(--mp-fg)]">
                Med<span className="text-[var(--mp-viridian)]">Prüf</span>
              </span>
              <button
                type="button"
                onClick={closeMenu}
                aria-label={lang === "de" ? "Schließen" : "Close"}
                className="rounded-lg p-2 text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] focus:outline-none focus:ring-2 focus:ring-[var(--mp-accent-teal)]"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              <a
                href="#features"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Sparkles className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.features[lang]}
              </a>
              <a
                href="#how"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Target className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.how[lang]}
              </a>
              <a
                href="#pricing"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.pricing[lang]}
              </a>
              <Link
                href="/faq"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                FAQ
              </Link>
              <div className="my-2 h-px bg-[var(--mp-border-subtle)]" />
              <Link
                href="/login"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg-muted)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                {COPY.nav.login[lang]}
              </Link>
            </nav>
            <div className="p-4 border-t border-[var(--mp-border-subtle)]">
              <Link
                href="/login"
                onClick={closeMenu}
                className="mp-btn mp-btn--success mp-btn--lg w-full justify-center"
              >
                {COPY.nav.start[lang]}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Hero — dark editorial (Oxford Blue bg, white text, always dark)
   ───────────────────────────────────────────────────────────── */
function Hero({ lang, freeHref }: { lang: Lang; freeHref: string }) {
  return (
    <section className="relative overflow-hidden text-white" style={{ background: "var(--mp-oxford-blue-dk)" }}>
      {/* Teal radial glow — top-right */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          top: "-160px",
          right: "-160px",
          width: "640px",
          height: "640px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,168,150,0.28), transparent 65%)",
        }}
      />
      {/* CTA blue glow — bottom-left */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          bottom: "-200px",
          left: "-160px",
          width: "540px",
          height: "540px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,58,140,0.35), transparent 65%)",
        }}
      />
      {/* Subtle dot grid */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-32 pb-24 md:pt-40 md:pb-32">
        <p
          className="mp-num mb-5 text-xs md:text-sm font-bold uppercase"
          style={{ color: "var(--mp-accent-teal)", letterSpacing: "0.12em" }}
        >
          {COPY.hero.eyebrow[lang]}
        </p>

        <h1
          className="font-display font-black tracking-tight text-white mb-6"
          style={{
            fontSize: "clamp(40px, 7vw, 80px)",
            lineHeight: "1.02",
            letterSpacing: "-0.035em",
          }}
        >
          {COPY.hero.title_pre[lang]}{" "}
          <em
            className="font-black"
            style={{ color: "var(--mp-accent-teal)", fontStyle: "italic" }}
          >
            {COPY.hero.title_mid[lang]}
          </em>
          {lang === "de" ? " " : ""}
          {COPY.hero.title_post[lang]}
          <br />
          <span className="text-white/90">{COPY.hero.title_line2[lang]}</span>
        </h1>

        <p
          className="mp-body text-white/75 mb-9 max-w-md sm:max-w-xl md:max-w-2xl"
          style={{
            fontSize: "clamp(16px, 1.8vw, 19px)",
            lineHeight: 1.55,
            textWrap: "balance" as const,
          }}
        >
          {COPY.hero.subtitle[lang]}
        </p>

        {/* CTAs — stacked + full-width on mobile, inline on desktop */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5 w-full sm:w-auto">
          <Link
            href={freeHref}
            className="cta-shimmer inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[var(--mp-oxford-blue-dk)] font-extrabold px-6 sm:px-7 py-3.5 sm:py-4 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)] w-full sm:w-auto"
            style={{ fontSize: "15px" }}
            aria-label={COPY.hero.cta_primary_long[lang]}
          >
            <span className="flex items-center gap-2 whitespace-nowrap">
              {/* Short label on mobile, long on desktop */}
              <span className="sm:hidden">{COPY.hero.cta_primary[lang]}</span>
              <span className="hidden sm:inline">{COPY.hero.cta_primary_long[lang]}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </span>
            <span className="sm:hidden text-[11px] font-semibold text-[var(--mp-oxford-blue-dk)]/70 whitespace-nowrap">
              {COPY.hero.cta_primary_sub[lang]}
            </span>
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 bg-transparent text-white border border-white/25 hover:border-white/60 hover:bg-white/5 font-semibold px-6 sm:px-7 py-3.5 sm:py-4 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)] w-full sm:w-auto whitespace-nowrap"
            style={{ fontSize: "15px" }}
          >
            {COPY.hero.cta_secondary[lang]}
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>

        {/* Tertiary €19 trial link — small, text-only, reserved for users
            not in the Cohort window who want a lower-friction first ask.
            Routes into the /pricing page where the FirstMonthCard does
            the heavy lifting. Kept deliberately below the primary CTA
            stack so it never competes with "Start free" or the Cohort
            button — it's a third-choice option for the indecisive. */}
        <p className="mb-5 text-center sm:text-left">
          <Link
            href="/pricing#first-month"
            className="inline-flex items-baseline gap-2 text-white/70 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)] rounded"
            style={{ fontSize: "13px" }}
          >
            <span className="font-semibold underline underline-offset-4 decoration-white/30 hover:decoration-white/70">
              {COPY.hero.cta_tertiary[lang]}
            </span>
            <span className="text-white/50" style={{ fontSize: "12px" }}>
              — {COPY.hero.cta_tertiary_sub[lang]}
            </span>
          </Link>
        </p>

        <p
          className="text-white/70 max-w-xl mb-3 font-medium"
          style={{ fontSize: "13px" }}
        >
          {lang === "de"
            ? "Aus 7.566 Wien-Prüfungsfragen seit 2016 destilliert."
            : "Distilled from 7,566 Vienna exam questions since 2016."}
        </p>
        <span className="text-white/50 block" style={{ fontSize: "12px" }}>
          {COPY.hero.cta_note[lang]}
        </span>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Stats strip — quiet KPI row at the edge of the hero.
   2 cols on phones, 4 cols on md+. Vertical stacks of big
   number + label + optional sub. Borders are column/row aware
   so narrow viewports never collapse numbers next to labels.
   ───────────────────────────────────────────────────────────── */
function StatsStrip({ lang }: { lang: Lang }) {
  return (
    <section
      className="relative text-white"
      style={{ background: "var(--mp-oxford-blue-dk)" }}
    >
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div
          className="grid grid-cols-2 md:grid-cols-4 border-t border-b divide-x divide-white/10 md:divide-x-0"
          style={{ borderColor: "rgba(255,255,255,0.1)" }}
        >
          {COPY.stats.map((s, i) => {
            // Phone (2-col): top row cells (i<2) get a bottom border.
            // md+ (4-col): each cell except the last gets a right border.
            const isTopRowOnPhone = i < 2;
            const isLastOnDesktop = i === COPY.stats.length - 1;
            return (
              <div
                key={i}
                className={`flex flex-col items-start justify-center py-5 sm:py-6 px-4 md:px-6 min-w-0 ${
                  isTopRowOnPhone ? "border-b md:border-b-0 border-white/10" : ""
                } ${!isLastOnDesktop ? "md:border-r md:border-white/10" : ""}`}
              >
                <div
                  className="mp-num font-black text-white leading-none"
                  style={{
                    fontSize: "clamp(26px, 3.5vw, 36px)",
                    fontFamily: "var(--mp-font-display)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {lang === "en" ? s.value_en : s.value}
                </div>
                <div
                  className="mt-2 text-white/65 font-bold leading-snug"
                  style={{
                    fontSize: "11px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {s.label[lang]}
                </div>
                {s.sub && (
                  <div
                    className="mt-1 text-white/45 leading-snug"
                    style={{ fontSize: "11px" }}
                  >
                    {s.sub[lang]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   How it works — 3-step, inverts to light theme
   ───────────────────────────────────────────────────────────── */
function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section id="how" className="py-20 md:py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-14 max-w-2xl">
          <p
            className="mp-caption uppercase font-bold mb-3 text-[var(--mp-viridian)]"
            style={{ letterSpacing: "0.12em" }}
          >
            {COPY.how.eyebrow[lang]}
          </p>
          <h2 className="mp-h2 font-display font-extrabold text-[var(--mp-fg)]">
            {COPY.how.title[lang]}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {COPY.how.steps.map((s, i) => (
            <div key={s.n} className="relative">
              <div className="flex items-baseline gap-3 mb-4">
                <span
                  className="mp-num font-black"
                  style={{
                    fontSize: "48px",
                    color: "var(--mp-viridian)",
                    letterSpacing: "-0.04em",
                    lineHeight: 1,
                  }}
                >
                  {s.n}
                </span>
                {i < COPY.how.steps.length - 1 && (
                  <span
                    className="hidden md:block h-px flex-1 bg-[var(--mp-border-subtle)] translate-y-[-6px]"
                    aria-hidden="true"
                  />
                )}
              </div>
              <h3 className="mp-h3 font-display font-bold text-[var(--mp-fg)] mb-2">
                {s.title[lang]}
              </h3>
              <p
                className="mp-body text-[var(--mp-fg-muted)] leading-relaxed"
                style={{ fontSize: "15px" }}
              >
                {s.body[lang]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Features — 6-card grid
   ───────────────────────────────────────────────────────────── */
function Features({ lang }: { lang: Lang }) {
  return (
    <section id="features" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12 max-w-2xl">
          <p
            className="mp-caption uppercase font-bold mb-3 text-[var(--mp-viridian)]"
            style={{ letterSpacing: "0.12em" }}
          >
            {COPY.features.eyebrow[lang]}
          </p>
          <h2 className="mp-h2 font-display font-extrabold text-[var(--mp-fg)] mb-3">
            {COPY.features.title[lang]}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)]" style={{ fontSize: "17px" }}>
            {COPY.features.subtitle[lang]}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {COPY.features.items.map((f) => {
            const Icon = f.icon;
            return (
              <article
                key={f.title.en}
                className="mp-card p-6 hover:border-[var(--mp-viridian)]/40 transition-all"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: "rgba(0, 123, 95, 0.1)" }}
                >
                  <Icon className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden="true" />
                </div>
                <h3
                  className="mp-h3 font-display font-bold text-[var(--mp-fg)] mb-2"
                  style={{ fontSize: "17px" }}
                >
                  {f.title[lang]}
                </h3>
                <p
                  className="mp-body text-[var(--mp-fg-muted)] leading-relaxed"
                  style={{ fontSize: "14px" }}
                >
                  {f.body[lang]}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Subjects — 16 specialties grid
   ───────────────────────────────────────────────────────────── */
function Subjects({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 md:py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12 max-w-2xl">
          <p
            className="mp-caption uppercase font-bold mb-3 text-[var(--mp-viridian)]"
            style={{ letterSpacing: "0.12em" }}
          >
            {COPY.subjects.eyebrow[lang]}
          </p>
          <h2 className="mp-h2 font-display font-extrabold text-[var(--mp-fg)] mb-3">
            {COPY.subjects.title[lang]}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)]" style={{ fontSize: "17px" }}>
            {COPY.subjects.subtitle[lang]}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {COPY.subjects.items.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className="mp-card flex flex-col items-center justify-center text-center gap-2 p-4 hover:border-[var(--mp-viridian)]/40 transition-colors"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(0, 123, 95, 0.08)" }}
                >
                  <Icon
                    className="w-5 h-5 text-[var(--mp-viridian)]"
                    aria-hidden="true"
                  />
                </div>
                <span
                  className="mp-body text-[var(--mp-fg)] font-semibold"
                  style={{ fontSize: "13px" }}
                >
                  {s.name[lang]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Pricing preview — 3-tier brief, links to /pricing for detail
   ───────────────────────────────────────────────────────────── */
function PricingPreview({ lang, freeHref }: { lang: Lang; freeHref: string }) {
  return (
    <section id="pricing" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12 max-w-2xl">
          <p
            className="mp-caption uppercase font-bold mb-3 text-[var(--mp-viridian)]"
            style={{ letterSpacing: "0.12em" }}
          >
            {COPY.pricing.eyebrow[lang]}
          </p>
          <h2 className="mp-h2 font-display font-extrabold text-[var(--mp-fg)] mb-3">
            {COPY.pricing.title[lang]}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)]" style={{ fontSize: "17px" }}>
            {COPY.pricing.subtitle[lang]}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {COPY.pricing.tiers.map((t) => {
            const planName = typeof t.name === "string" ? t.name : t.name[lang];
            const isSoon = t.status === "soon";
            return (
              <div key={planName} className="mp-card p-6 relative flex flex-col">
                {isSoon && (
                  <span
                    className="absolute top-4 right-4 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full"
                    style={{
                      color: "var(--mp-warning-dk)",
                      background: "var(--mp-warning-bg)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {COPY.pricing.comingSoon[lang]}
                  </span>
                )}
                <h3
                  className="mp-h3 font-display font-bold text-[var(--mp-fg)] mb-1"
                  style={{ fontSize: "18px" }}
                >
                  {planName}
                </h3>
                <div className="flex items-baseline gap-1.5 mb-4">
                  <span
                    className="font-black text-[var(--mp-fg)]"
                    style={{
                      fontFamily: "var(--mp-font-display)",
                      fontSize: "32px",
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                    }}
                  >
                    {t.price}
                  </span>
                  <span className="text-[var(--mp-fg-subtle)]" style={{ fontSize: "13px" }}>
                    / {t.period[lang]}
                  </span>
                </div>
                <p
                  className="mp-body text-[var(--mp-fg-muted)] flex-1 mb-5"
                  style={{ fontSize: "14px" }}
                >
                  {t.pitch[lang]}
                </p>
                <Link
                  href={t.price === "€0" ? freeHref : t.href}
                  className={`mp-btn ${isSoon ? "mp-btn--secondary" : "mp-btn--success"} w-full justify-center`}
                >
                  {t.cta[lang]}
                </Link>
              </div>
            );
          })}
        </div>

        <div className="text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--mp-viridian)] rounded"
          >
            {COPY.pricing.link[lang]}
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Content & quality — quiet proof band with sourced breakdown.
   Replaces the old "Rated by physicians" social-proof line we
   couldn't back with real data. Reads clinical, not hype-y.
   ───────────────────────────────────────────────────────────── */
function SocialProof({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 md:py-24 bg-[var(--mp-surface-raised)] border-y border-[var(--mp-border-subtle)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <p
          className="mp-caption uppercase font-bold mb-4"
          style={{ color: "var(--mp-viridian)", letterSpacing: "0.12em" }}
        >
          {COPY.proof.eyebrow[lang]}
        </p>
        <h2 className="mp-h2 font-display font-extrabold text-[var(--mp-fg)] mb-5 leading-tight">
          {COPY.proof.title[lang]}
        </h2>
        <p
          className="mp-body text-[var(--mp-fg-muted)] max-w-2xl mx-auto mb-10"
          style={{ fontSize: "17px", lineHeight: 1.6, textWrap: "balance" as const }}
        >
          {COPY.proof.quote[lang]}
        </p>

        {/* Source breakdown — three compact figures, label + sub */}
        <div className="grid grid-cols-3 gap-3 md:gap-6 max-w-3xl mx-auto">
          {COPY.proof.breakdown.map((b, i) => (
            <div
              key={i}
              className="mp-card flex flex-col items-start justify-center p-4 md:p-5 text-left"
            >
              <div
                className="mp-num font-black text-[var(--mp-oxford-blue)] dark:text-white leading-none"
                style={{
                  fontSize: "clamp(22px, 3vw, 32px)",
                  fontFamily: "var(--mp-font-display)",
                  letterSpacing: "-0.02em",
                }}
              >
                {lang === "en" ? b.n_en : b.n}
              </div>
              <div
                className="mt-2 font-bold text-[var(--mp-fg-muted)] leading-snug"
                style={{
                  fontSize: "11px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {b.label[lang]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Final CTA — dark band to match hero
   ───────────────────────────────────────────────────────────── */
function FinalCTA({ lang }: { lang: Lang }) {
  return (
    <section
      className="relative py-20 md:py-24 text-white overflow-hidden"
      style={{ background: "var(--mp-oxford-blue-dk)" }}
    >
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          top: "-120px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "700px",
          height: "700px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,168,150,0.2), transparent 65%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <h2
          className="font-display font-black text-white mb-5 leading-[1.05]"
          style={{
            fontSize: "clamp(32px, 5vw, 56px)",
            letterSpacing: "-0.03em",
          }}
        >
          {COPY.cta.title[lang]}
        </h2>
        <p className="text-white/75 mb-9" style={{ fontSize: "17px" }}>
          {COPY.cta.subtitle[lang]}
        </p>
        <Link
          href="/login"
          className="cta-shimmer inline-flex items-center justify-center gap-2 text-[var(--mp-oxford-blue-dk)] font-extrabold px-8 py-4 rounded-xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)]"
          style={{ fontSize: "16px" }}
        >
          {COPY.cta.button[lang]}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
        <p className="mt-5 text-xs text-white/50 flex items-center justify-center gap-2 flex-wrap">
          <Languages className="w-3.5 h-3.5" aria-hidden="true" />
          {COPY.cta.trust[lang]}
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Footer — uses --mp-oxford-blue (slightly lighter than the final
   CTA band's -dk variant) so it reads as a distinct section, not
   a continuation of the CTA. Brand strip stays quiet; the CTA
   button above remains the conversion focal point.
   ───────────────────────────────────────────────────────────── */
function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[var(--mp-oxford-blue)] text-white pt-14 md:pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          <div className="md:col-span-2 sm:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <Image
                src="/brand/logomark.svg"
                alt=""
                width={32}
                height={32}
                style={{ filter: "brightness(0) invert(1)" }}
              />
              <span className="text-lg font-bold tracking-tight font-display">
                Med<span className="text-[var(--mp-accent-teal)]">Prüf</span>
              </span>
            </div>
            <p className="text-sm text-white/70 leading-relaxed max-w-md">
              {COPY.footer.tagline[lang]}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-white/50 font-bold mb-3">
              {COPY.footer.product[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <a href="#features" className="hover:text-white transition-colors">
                  {COPY.nav.features[lang]}
                </a>
              </li>
              <li>
                <a href="#how" className="hover:text-white transition-colors">
                  {COPY.nav.how[lang]}
                </a>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-white transition-colors">
                  {COPY.nav.pricing[lang]}
                </Link>
              </li>
              <li>
                <Link href="/faq" className="hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/changelog" className="hover:text-white transition-colors">
                  Changelog
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  {lang === "de" ? "Über uns" : "About"}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-white/50 font-bold mb-3">
              {lang === "de" ? "Prüfungen" : "Exams"}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <Link
                  href="/kenntnispruefung-wien"
                  className="hover:text-white transition-colors"
                >
                  Kenntnisprüfung Wien
                </Link>
              </li>
              <li>
                <Link
                  href="/kmp-innsbruck"
                  className="hover:text-white transition-colors"
                >
                  KMP Innsbruck
                </Link>
              </li>
              <li>
                <Link
                  href="/pharmakologie-pruefung-wien"
                  className="hover:text-white transition-colors"
                >
                  Pharmakologie Wien
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-white transition-colors">
                  Blog
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-white/50 font-bold mb-3">
              {COPY.footer.legal[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <Link href="/privacy" className="hover:text-white transition-colors">
                  {lang === "de" ? "Datenschutz" : "Privacy"}
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-white transition-colors">
                  {lang === "de" ? "AGB" : "Terms"}
                </Link>
              </li>
              <li>
                <Link href="/impressum" className="hover:text-white transition-colors">
                  Impressum
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 border-t border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-white/50">
          <p>
            © {year} MedPrüf · [name]. {COPY.footer.rights[lang]}
          </p>
          <p className="flex items-center gap-2">
            <span>medpruf.com</span>
            <span aria-hidden="true">·</span>
            <a href="mailto:user-b7e46e80@example.com" className="hover:text-white transition-colors">
              user-b7e46e80@example.com
            </a>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Flag className="w-3 h-3" aria-hidden="true" />
              Wien, AT
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
