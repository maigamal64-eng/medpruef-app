"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { QUESTIONS } from "@/lib/content-truth";
import UpcomingExams from "@/components/UpcomingExams";

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
   MedPrüf landing — "clinical exam-record" direction (2026-06-04
   brand sweep). The design language is a doctor's exam record: a
   mono lab-header voice, hairline rules, a provenance stamp, big
   tabular figures, precision cards with a registration-tick, and
   quiet reveal-on-scroll. All visual primitives live in the
   `.lp-*` layer in globals.css; this page consumes them inside a
   single `.lp-root` scope. The two-tone wordmark SVGs replace the
   old logomark + invert-filter pattern.

   Copy is product-first and recalibrated-honest: confident on the
   product, every number sourced from content-truth.ts, no metric
   pinned to a refutable named claim. Currency is "X €" throughout
   (content-truth voice guardrail). Founder is an engineer, so the
   credential is the DATA — documented official exams since 2016,
   never "built by doctors."
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
      de: "Österreich · Kenntnisprüfung · Stichprobentest · Pharmakologie",
      en: "Austria · Kenntnisprüfung · Stichprobentest · Pharmakologie",
    },
    // Provenance stamp — the unrefutable credential. The corpus is
    // built from documented official exams; "seit 2016" is sourced,
    // not a metric pinned to a named customer.
    stamp: {
      de: "Aus dokumentierten Prüfungen · seit 2016",
      en: "From documented exams · since 2016",
    },
    title_pre: { de: "Beim ersten Versuch", en: "Pass first" },
    title_mid: { de: "bestehen", en: "try" },
    title_line2: {
      de: "oder kostenlos weiterlernen, bis du es schaffst.",
      en: "or study free until you do.",
    },
    // Price floor reconciled 2026-06-04: the live, buyable entry is
    // the 3-month starter at 27 € (first_3mo_27, available:true in
    // content-truth). The old "ab 79 €" line quoted three_month,
    // which is available:false (waitlisted) — and contradicted the
    // 27 € CTA in the same viewport. Now both agree.
    subtitle: {
      de: "Die einzige Prüfungsvorbereitung, speziell für Österreichs Kenntnisprüfung, Stichprobentest und Pharmakologie. Destilliert aus 7.566 Wien-Prüfungsfragen seit 2016, 3.091 Fragen aus dem Innsbruck-Curriculum (Stichprobentest) und 335 Pharmakologie. Eine Kenntnisprüfung kostet ~370 € pro Versuch, MedPrüf gibt es ab 27 € für 3 Monate.",
      en: "The only exam prep built specifically for Austria's Kenntnisprüfung, Stichprobentest and Pharmakologie. Distilled from 7,566 Vienna exam questions since 2016, 3,091 questions from the Innsbruck curriculum (Stichprobentest) and 335 Pharmakologie. A Kenntnisprüfung re-sit is ~370 €, and MedPrüf starts at 27 € for 3 months.",
    },
    cta_primary: { de: "Kostenlos starten", en: "Start free" },
    cta_primary_sub: {
      de: "150 Fragen je Prüfung · keine Karte",
      en: "150 questions per exam · no card",
    },
    cta_primary_long: {
      de: "Kostenlos starten: 150 Fragen je Prüfung",
      en: "Start free: 150 questions per exam",
    },
    cta_secondary: {
      de: "Prüfungs-Kohorte ansehen",
      en: "See the Exam Cohort",
    },
    cta_tertiary: {
      de: "3-Monats-Einstieg · 27 € (≈ 9 €/Monat)",
      en: "3-Month Starter · 27 € (≈ 9 €/month)",
    },
    cta_tertiary_sub: {
      de: "Vollzugang · einmalig · keine Verlängerung",
      en: "Full access · one-time · no renewal",
    },
    cta_note: {
      de: "Keine Karte · Prüfungs-Kohorte mit Pass-Until-You-Pass-Garantie",
      en: "No credit card · Exam Cohort includes Pass-Until-You-Pass",
    },
  },
  stats: [
    {
      // Question count sourced live from content-truth.ts SSoT (the same
      // QUESTIONS.total the progress + curriculum pages use). Prevents the
      // hero-vs-DB question-count drift caught 2026-06-02.
      // SOT-REF: medpruef_question_count@DB:medpruef.questions
      value: QUESTIONS.total.toLocaleString("de-DE"),
      value_en: QUESTIONS.total.toLocaleString("en-US"),
      label: { de: "Fragen", en: "Questions" },
      sub: { de: "alle aktiv", en: "all active" },
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
      sub: { de: "in Erklärungen", en: "in explanations" },
    },
    {
      value: "1.806",
      value_en: "1,806",
      label: { de: "Mehrfachantworten", en: "Multi-correct" },
      sub: { de: "streng bewertet", en: "strictly graded" },
    },
  ],
  how: {
    index: "01 / 04",
    eyebrow: { de: "So funktioniert's", en: "How it works" },
    title: { de: "In drei Schritten zur Prüfungsreife", en: "Exam-ready in three steps" },
    steps: [
      {
        n: "01",
        title: { de: "Prüfung wählen", en: "Choose your exam" },
        body: {
          de: "Kenntnisprüfung Wien, Stichprobentest (Innsbruck) oder Pharmakologie: wir kennen die Gewichtung jeder Prüfung.",
          en: "Kenntnisprüfung Wien, Stichprobentest (Innsbruck) or Pharmakologie: we know the weighting of each exam.",
        },
      },
      {
        n: "02",
        title: { de: "Täglich üben", en: "Practice daily" },
        body: {
          de: "20–50 Fragen pro Tag mit Spaced Repetition. Der Lernplan passt sich deinem Prüfungsdatum an.",
          en: "20–50 questions per day with spaced repetition. The study plan adapts to your exam date.",
        },
      },
      {
        n: "03",
        title: { de: "Simulieren", en: "Simulate" },
        body: {
          de: "Volle Prüfungssimulation. 4 Stunden, Themen-Navigator, aufgeschobene Bewertung, wie am Prüfungstag.",
          en: "Full exam simulation. 4 hours, topic navigator, deferred grading, just like exam day.",
        },
      },
    ],
  },
  features: {
    index: "02 / 04",
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
        tag: "AI",
        title: { de: "Klinische KI-Erklärungen", en: "Clinical AI explanations" },
        body: {
          de: "TL;DR zuerst, dann Leitlinien-Referenzen: ERC 2021, ESC, ÖDG. Nicht Wikipedia, sondern klinisch.",
          en: "TL;DR first, then guideline references: ERC 2021, ESC, ÖDG. Not Wikipedia, clinical.",
        },
      },
      {
        icon: Globe,
        tag: "i18n",
        title: { de: "7 Sprachen", en: "7 languages" },
        body: {
          de: "Fragen auf Deutsch (wie in der echten Prüfung). Erklärungen in Deutsch, Englisch, Russisch, Arabisch, Türkisch, Ukrainisch, Rumänisch.",
          en: "Questions in German (as in the real exam). Explanations in German, English, Russian, Arabic, Turkish, Ukrainian, Romanian.",
        },
      },
      {
        icon: HeartPulse,
        tag: "SM-2",
        title: { de: "Spaced Repetition", en: "Spaced repetition" },
        body: {
          de: "Fragen tauchen genau dann auf, wenn du sie zu vergessen beginnst. Wie Anki, nur klinisch kuratiert.",
          en: "Questions resurface right when you're about to forget. Like Anki, but clinically curated.",
        },
      },
      {
        icon: Clock,
        tag: "SIM",
        title: { de: "Prüfungssimulation", en: "Exam simulation" },
        body: {
          de: "4 Stunden, Themen-Navigator, aufgeschobene Bewertung. Trainiert Prüfungs-Ausdauer, nicht nur Wissen.",
          en: "4 hours, topic navigator, deferred grading. Trains exam stamina, not just knowledge.",
        },
      },
      {
        icon: Target,
        tag: "PLAN",
        title: { de: "Lernplan bis zum Prüfungstag", en: "Study plan to exam day" },
        body: {
          de: "Countdown auf dein Prüfungsdatum. 70 % neu + 30 % Wiederholung, gewichtet nach deinen Schwächen.",
          en: "Countdown to your exam date. 70% new + 30% review, weighted by your weak topics.",
        },
      },
      {
        icon: Sparkles,
        tag: "QA",
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
      de: "Jede Frage stammt aus dokumentierten offiziellen Prüfungsmaterialien: Kenntnisprüfung Wien (SIP 4 + SIP 5), Stichprobentest (Fragen aus dem Innsbruck-Curriculum), Pharmakologie.",
      en: "Every question comes from documented official exam materials: Kenntnisprüfung Wien (SIP 4 + SIP 5), Stichprobentest (questions from the Innsbruck curriculum), Pharmakologie.",
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
    index: "03 / 04",
    eyebrow: { de: "Preise", en: "Pricing" },
    title: {
      de: "Starte kostenlos. Upgrade zur Prüfungs-Kohorte.",
      en: "Start free. Upgrade to the Exam Cohort.",
    },
    subtitle: {
      de: "Jeder bezahlte Tarif enthält alle drei Prüfungstypen. Pass-Until-You-Pass-Garantie auf der Kohorte und dem Jahresabo.",
      en: "Every paid tier unlocks all three exam types. Pass-Until-You-Pass guarantee on the Cohort and the 12-month plan.",
    },
    tiers: [
      {
        name: { de: "Kostenlos", en: "Free" },
        price: "0 €",
        period: { de: "dauerhaft", en: "forever" },
        pitch: {
          de: "150 Fragen × 3 Prüfungstypen · Erklärungen, wo vorhanden",
          en: "150 questions × 3 exam types · explanations where available",
        },
        status: "live",
        cta: { de: "Kostenlos starten", en: "Start free" },
        href: "/quiz?exam=pharma&free=1",
        featured: false,
      },
      {
        name: { de: "Prüfungs-Kohorte", en: "Exam Cohort" },
        price: "114 €",
        period: { de: "6 Monate", en: "6 months" },
        pitch: {
          de: "Alle 10.992 Fragen · Pass-Until-You-Pass · Karten-Checkout live",
          en: "All 10,992 questions · Pass-Until-You-Pass · live card checkout",
        },
        status: "live",
        cta: { de: "Zur Kohorte", en: "See the Cohort" },
        href: "/pricing",
        featured: true,
      },
      {
        name: { de: "12 Monate", en: "12 months" },
        price: "229 €",
        period: { de: "Jahr", en: "year" },
        pitch: {
          de: "Vollzugang · Pass-Until-You-Pass · Stripe kommt bald",
          en: "All-access · Pass-Until-You-Pass · Stripe launching soon",
        },
        status: "soon",
        cta: { de: "Warteliste", en: "Waitlist" },
        href: "/pricing",
        featured: false,
      },
    ],
    link: { de: "Alle Preise vergleichen", en: "Compare all plans" },
    comingSoon: { de: "Bald", en: "Soon" },
    featuredTag: { de: "Empfohlen", en: "Recommended" },
  },
  proof: {
    index: "04 / 04",
    eyebrow: { de: "Inhalt & Qualität", en: "Content & quality" },
    // Reframed 2026-06-04: the prior "kuratiert von Ärzt:innen für
    // Ärzt:innen / curated by physicians for physicians" claim is
    // falsifiable (the founder is an engineer, not a doctor). The
    // honest, equally strong credential is the SOURCE: every question
    // traces to a documented official exam. We credit provenance, not
    // an invented curator.
    title: {
      de: "10.992 Fragen, jede aus einer dokumentierten Prüfung.",
      en: "10,992 questions, each from a documented exam.",
    },
    quote: {
      de: "Nichts erfunden, nichts geraten. Jede Frage ist gegen ihre Quell-Prüfung referenziert: Wien-Tertials, KoalaMed Innsbruck, Rezeptierkunde Pharma.",
      en: "Nothing invented, nothing guessed. Every question is referenced against its source exam: Vienna tertials, KoalaMed Innsbruck, Rezeptierkunde Pharma.",
    },
    breakdown: [
      {
        n: "7.566",
        n_en: "7,566",
        label: { de: "Wien", en: "Vienna" },
        sub: { de: "seit 2016", en: "since 2016" },
      },
      {
        n: "3.091",
        n_en: "3,091",
        label: { de: "Stichprobentest", en: "Stichprobentest" },
        sub: { de: "Innsbruck-Curriculum", en: "Innsbruck curriculum" },
      },
      {
        n: "335",
        n_en: "335",
        label: { de: "Pharmakologie", en: "Pharmacology" },
        sub: { de: "Rezeptierkunde", en: "Rezeptierkunde" },
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
    // Reframed 2026-06-04: was "gebaut von und für ausländische
    // Ärzt:innen / built by and for foreign doctors" — the "von …
    // Ärzt:innen / by … doctors" half is falsifiable (engineer
    // founder). "Für ausländische Ärzt:innen / for foreign doctors"
    // is true and stays.
    tagline: {
      de: "Vorbereitung auf österreichische Ärzteprüfungen, für ausländische Ärzt:innen, aus dokumentierten offiziellen Prüfungen.",
      en: "Austrian medical exam preparation for foreign doctors, built from documented official exams.",
    },
    product: { de: "Produkt", en: "Product" },
    legal: { de: "Rechtliches", en: "Legal" },
    rights: { de: "Alle Rechte vorbehalten.", en: "All rights reserved." },
  },
};

/* ─────────────────────────────────────────────────────────────
   Wordmark — drop-in two-tone SVG. `variant="dark"` on ink
   grounds (nav-over-hero, footer); `variant="light"` (tight crop)
   on paper. Replaces the old logomark + brightness(0) invert(1)
   filter, which flattened the teal "Prüf".
   ───────────────────────────────────────────────────────────── */
function Wordmark({
  variant,
  className = "",
  height = 22,
}: {
  variant: "dark" | "light";
  className?: string;
  height?: number;
}) {
  const src = variant === "dark" ? "/brand/wordmark-dark.svg" : "/brand/wordmark-tight.svg";
  // viewBox is 393×86 → keep aspect ratio when sizing by height.
  const width = Math.round((393 / 86) * height);
  return (
    <Image
      src={src}
      alt="MedPrüf"
      width={width}
      height={height}
      priority
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   Reveal-on-scroll hook — CRITICAL: `.lp-reveal` is opacity:0 in
   CSS and only `.is-in` (or reduced-motion) reveals it. Without
   this observer the page builds green but renders blank. We add
   `.is-in` as elements enter the viewport; reduced-motion users
   are already handled by the CSS media query, but we also reveal
   immediately on mount as a belt-and-braces fallback so nothing
   can ever stay hidden (e.g. if IO is unavailable).
   ───────────────────────────────────────────────────────────── */
function useReveal(active: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // `active` flips true only after the page mounts and renders the REAL
    // tree (the pre-mount return is an empty shell with no ref attached).
    // Gating on it guarantees this effect re-runs once ref.current points
    // at the live DOM — otherwise it runs once against a null ref and the
    // whole page stays opacity:0 (the blank-page trap).
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".lp-reveal"));
    if (targets.length === 0) return;

    // Fallback: if IntersectionObserver is missing, reveal everything now.
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((t) => t.classList.add("is-in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));

    // Any element already in view on first paint (above the fold) should
    // reveal without waiting for a scroll.
    requestAnimationFrame(() => {
      targets.forEach((t) => {
        const r = t.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) t.classList.add("is-in");
      });
    });

    return () => io.disconnect();
  }, [active]);
  return ref;
}

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  const revealRoot = useReveal(mounted);

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
    <div
      ref={revealRoot as React.RefObject<HTMLDivElement>}
      className="lp-root min-h-screen bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]"
    >
      <Nav lang={lang} onLangChange={switchLang} />
      <Hero lang={lang} freeHref={freeHref} />
      <StatsStrip lang={lang} />
      <HowItWorks lang={lang} />
      <Features lang={lang} />
      <Subjects lang={lang} />
      <UpcomingExams lang={lang} />
      <PricingPreview lang={lang} freeHref={freeHref} />
      <SourceProof lang={lang} />
      <FinalCTA lang={lang} freeHref={freeHref} />
      <Footer lang={lang} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Nav — transparent over hero, inverts to paper on scroll.
   Wordmark swaps dark→light variant on scroll. Desktop inline
   links; mobile hamburger sheet.
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
            className="flex items-center shrink-0"
            aria-label="MedPrüf home"
          >
            {/* Wordmark swaps dark→light on scroll. Two nodes, one
                visible at a time, so there's no filter flash. */}
            <Wordmark variant="dark" height={22} className={scrolled ? "hidden" : "block"} />
            <Wordmark variant="light" height={22} className={scrolled ? "block" : "hidden"} />
          </Link>

          {/* Desktop inline links */}
          <div
            className={`hidden md:flex items-center gap-7 text-sm font-medium ${
              scrolled ? "text-[var(--mp-fg-muted)]" : "text-white/70"
            }`}
          >
            <a
              href="#how"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.how[lang]}
            </a>
            <a
              href="#features"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.features[lang]}
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
              className={`lp-cta inline-flex items-center gap-1.5 text-sm font-bold px-3 sm:px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] ${
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
              <Wordmark variant="light" height={20} />
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
                href="#how"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Target className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.how[lang]}
              </a>
              <a
                href="#features"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Sparkles className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.features[lang]}
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
   Hero — clinical exam-record ground. Deep navy, lab-header
   eyebrow, provenance stamp, big tabular headline, dashed ruler
   baseline. Right rail = a stylized "exam record" card.
   ───────────────────────────────────────────────────────────── */
function Hero({ lang, freeHref }: { lang: Lang; freeHref: string }) {
  return (
    <section
      className="relative overflow-hidden text-white"
      style={{ background: "var(--mp-oxford-blue-dk)" }}
    >
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
          background: "radial-gradient(circle, rgba(0,168,150,0.26), transparent 65%)",
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
          background: "radial-gradient(circle, rgba(0,58,140,0.32), transparent 65%)",
        }}
      />
      {/* Faint grid — like ruled exam paper */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-32 pb-20 md:pt-36 md:pb-24">
        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-10 items-center">
          {/* ── Left column ── */}
          <div className="lp-reveal">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-7">
              <p className="lp-eyebrow" style={{ color: "var(--lp-teal-br)" }}>
                {COPY.hero.eyebrow[lang]}
              </p>
              <span className="lp-stamp">
                <span className="lp-stamp__pulse" aria-hidden="true" />
                {COPY.hero.stamp[lang]}
              </span>
            </div>

            <h1
              className="font-display font-black tracking-tight text-white mb-6"
              style={{
                fontSize: "clamp(38px, 6.4vw, 74px)",
                lineHeight: "1.02",
                letterSpacing: "-0.035em",
              }}
            >
              {COPY.hero.title_pre[lang]}{" "}
              <em
                className="font-black"
                style={{ color: "var(--lp-teal-br)", fontStyle: "italic" }}
              >
                {COPY.hero.title_mid[lang]}
              </em>{" "}
              —
              <br />
              <span className="text-white/90">{COPY.hero.title_line2[lang]}</span>
            </h1>

            <p
              className="text-white/75 mb-9 max-w-xl"
              style={{
                fontSize: "clamp(15px, 1.7vw, 18px)",
                lineHeight: 1.6,
                textWrap: "balance" as const,
              }}
            >
              {COPY.hero.subtitle[lang]}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4 w-full sm:w-auto">
              <Link
                href={freeHref}
                className="lp-cta inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)] font-extrabold px-6 sm:px-7 py-3.5 sm:py-4 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)] w-full sm:w-auto"
                style={{ fontSize: "15px" }}
                aria-label={COPY.hero.cta_primary_long[lang]}
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
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

            {/* Tertiary 27 € entry link */}
            <p className="mb-6">
              <Link
                href="/pricing#first-month"
                className="lp-link text-white/70 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)] rounded"
                style={{ fontSize: "13px" }}
              >
                <span className="font-semibold">{COPY.hero.cta_tertiary[lang]}</span>
                <span className="text-white/50" style={{ fontSize: "12px" }}>
                  — {COPY.hero.cta_tertiary_sub[lang]}
                </span>
              </Link>
            </p>

            <div className="lp-ruler max-w-md mb-4" aria-hidden="true" />
            <span className="text-white/55 block" style={{ fontSize: "12px", letterSpacing: "0.01em" }}>
              {COPY.hero.cta_note[lang]}
            </span>
          </div>

          {/* ── Right column — "exam record" card ── */}
          <div className="lp-reveal hidden lg:block">
            <ExamRecordCard lang={lang} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* A decorative, on-brand "exam record" card — reinforces the
   clinical-record concept. Not a real screenshot; a designed
   abstraction (a question stem, four options, one correct,
   a mono record header). */
function ExamRecordCard({ lang }: { lang: Lang }) {
  const options = [
    { k: "A", t: { de: "Aortendissektion", en: "Aortic dissection" }, correct: false },
    { k: "B", t: { de: "Lungenembolie", en: "Pulmonary embolism" }, correct: true },
    { k: "C", t: { de: "Pneumothorax", en: "Pneumothorax" }, correct: false },
    { k: "D", t: { de: "Perikarditis", en: "Pericarditis" }, correct: false },
  ];
  return (
    <div
      className="rounded-2xl border p-5 shadow-2xl"
      style={{
        background: "linear-gradient(180deg, rgba(6,41,79,0.92), rgba(0,16,40,0.92))",
        borderColor: "var(--lp-line-ink)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Record header */}
      <div
        className="flex items-center justify-between pb-3 mb-4 border-b"
        style={{ borderColor: "var(--lp-line-ink)" }}
      >
        <span className="lp-examtab" style={{ color: "var(--lp-teal-br)" }}>
          Kenntnisprüfung · Innere
        </span>
        <span className="lp-examtab text-white/45">№ 4127</span>
      </div>

      {/* Stem */}
      <p className="text-white/90 mb-4" style={{ fontSize: "14px", lineHeight: 1.5 }}>
        {lang === "de"
          ? "Akute Dyspnoe, Tachykardie und einseitiger Pleuraschmerz nach Langstreckenflug. Wahrscheinlichste Diagnose?"
          : "Acute dyspnea, tachycardia and unilateral pleuritic pain after a long-haul flight. Most likely diagnosis?"}
      </p>

      {/* Options */}
      <div className="space-y-2 mb-4">
        {options.map((o) => (
          <div
            key={o.k}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors"
            style={{
              borderColor: o.correct ? "rgba(31,194,166,0.55)" : "var(--lp-line-ink)",
              background: o.correct ? "rgba(31,194,166,0.10)" : "rgba(255,255,255,0.02)",
            }}
          >
            <span
              className="lp-examtab flex items-center justify-center rounded-md shrink-0"
              style={{
                width: 22,
                height: 22,
                color: o.correct ? "var(--mp-oxford-blue-dk)" : "rgba(255,255,255,0.6)",
                background: o.correct ? "var(--lp-teal-br)" : "rgba(255,255,255,0.06)",
              }}
            >
              {o.k}
            </span>
            <span
              className="text-white/85"
              style={{ fontSize: "13px", fontWeight: o.correct ? 600 : 400 }}
            >
              {o.t[lang]}
            </span>
            {o.correct && (
              <span
                className="ml-auto lp-examtab"
                style={{ color: "var(--lp-teal-br)", fontSize: "10px" }}
              >
                ✓ {lang === "de" ? "richtig" : "correct"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* AI explanation peek */}
      <div
        className="rounded-lg p-3 border"
        style={{ borderColor: "var(--lp-line-ink)", background: "rgba(255,255,255,0.02)" }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <Brain className="w-3.5 h-3.5" style={{ color: "var(--lp-teal-br)" }} aria-hidden="true" />
          <span className="lp-examtab" style={{ color: "var(--lp-teal-br)" }}>
            TL;DR
          </span>
        </div>
        <p className="text-white/60" style={{ fontSize: "11.5px", lineHeight: 1.5 }}>
          {lang === "de"
            ? "Wells-Score hoch → CTPA. D-Dimer nur bei niedriger Vortest­wahrscheinlichkeit. Ref: ESC 2019."
            : "High Wells score → CTPA. D-dimer only at low pretest probability. Ref: ESC 2019."}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Stats strip — quiet KPI row at the edge of the hero, mono
   labels. 2 cols on phones, 4 on md+.
   ───────────────────────────────────────────────────────────── */
function StatsStrip({ lang }: { lang: Lang }) {
  return (
    <section className="relative text-white" style={{ background: "var(--mp-oxford-blue-dk)" }}>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div
          className="grid grid-cols-2 md:grid-cols-4 border-t border-b divide-x divide-white/10 md:divide-x-0"
          style={{ borderColor: "rgba(255,255,255,0.1)" }}
        >
          {COPY.stats.map((s, i) => {
            const isTopRowOnPhone = i < 2;
            const isLastOnDesktop = i === COPY.stats.length - 1;
            return (
              <div
                key={i}
                className={`flex flex-col items-start justify-center py-5 sm:py-7 px-4 md:px-6 min-w-0 ${
                  isTopRowOnPhone ? "border-b md:border-b-0 border-white/10" : ""
                } ${!isLastOnDesktop ? "md:border-r md:border-white/10" : ""}`}
              >
                <div
                  className="lp-figure text-white"
                  style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}
                >
                  {lang === "en" ? s.value_en : s.value}
                </div>
                <div
                  className="mt-2 text-white/70 font-bold leading-snug"
                  style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}
                >
                  {s.label[lang]}
                </div>
                {s.sub && (
                  <div
                    className="mt-1 text-white/40 leading-snug"
                    style={{
                      fontSize: "10.5px",
                      fontFamily: "var(--lp-mono)",
                      letterSpacing: "0.04em",
                    }}
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

/* Section header — shared lab-header treatment: mono index, a
   hairline rule, eyebrow + heading. */
function SectionHead({
  index,
  eyebrow,
  title,
  subtitle,
  center = false,
}: {
  index?: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <div className={`lp-reveal max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {index && (
        <div
          className={`flex items-center gap-3 mb-4 ${center ? "justify-center" : ""}`}
        >
          <span className="lp-index">{index}</span>
          <span
            className="h-px w-10 bg-[var(--mp-border-subtle)]"
            aria-hidden="true"
            style={{ opacity: 0.8 }}
          />
        </div>
      )}
      <p
        className={`lp-eyebrow mb-3 text-[var(--mp-viridian)] ${center ? "lp-eyebrow--center" : ""}`}
      >
        {eyebrow}
      </p>
      <h2
        className="font-display font-extrabold text-[var(--mp-fg)]"
        style={{ fontSize: "clamp(26px, 3.4vw, 38px)", letterSpacing: "-0.02em", lineHeight: 1.1 }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className="mt-3 text-[var(--mp-fg-muted)]"
          style={{ fontSize: "17px", lineHeight: 1.55 }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   How it works — 3-step, paper theme
   ───────────────────────────────────────────────────────────── */
function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section id="how" className="py-20 md:py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-14">
          <SectionHead
            index={COPY.how.index}
            eyebrow={COPY.how.eyebrow[lang]}
            title={COPY.how.title[lang]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {COPY.how.steps.map((s, i) => (
            <div key={s.n} className="lp-reveal relative" style={{ transitionDelay: `${i * 70}ms` }}>
              <div className="flex items-baseline gap-3 mb-4">
                <span className="lp-figure" style={{ fontSize: "44px", color: "var(--mp-viridian)" }}>
                  {s.n}
                </span>
                {i < COPY.how.steps.length - 1 && (
                  <span
                    className="hidden md:block h-px flex-1 bg-[var(--mp-border-subtle)] translate-y-[-6px]"
                    aria-hidden="true"
                  />
                )}
              </div>
              <h3 className="font-display font-bold text-[var(--mp-fg)] mb-2" style={{ fontSize: "19px" }}>
                {s.title[lang]}
              </h3>
              <p className="text-[var(--mp-fg-muted)] leading-relaxed" style={{ fontSize: "15px" }}>
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
   Features — 6 precision cards with corner tick + mono tag
   ───────────────────────────────────────────────────────────── */
function Features({ lang }: { lang: Lang }) {
  return (
    <section id="features" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12">
          <SectionHead
            index={COPY.features.index}
            eyebrow={COPY.features.eyebrow[lang]}
            title={COPY.features.title[lang]}
            subtitle={COPY.features.subtitle[lang]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {COPY.features.items.map((f, i) => {
            const Icon = f.icon;
            return (
              <article
                key={f.title.en}
                className="lp-reveal lp-card lp-card--tick p-6"
                style={{ transitionDelay: `${(i % 3) * 70}ms` }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(0, 123, 95, 0.1)" }}
                  >
                    <Icon className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden="true" />
                  </div>
                  <span
                    className="lp-examtab text-[var(--mp-fg-faint)]"
                    style={{ color: "var(--lp-fg-faint)" }}
                  >
                    {f.tag}
                  </span>
                </div>
                <h3
                  className="font-display font-bold text-[var(--mp-fg)] mb-2"
                  style={{ fontSize: "17px" }}
                >
                  {f.title[lang]}
                </h3>
                <p
                  className="text-[var(--mp-fg-muted)] leading-relaxed"
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
        <div className="mb-10 md:mb-12">
          <SectionHead
            eyebrow={COPY.subjects.eyebrow[lang]}
            title={COPY.subjects.title[lang]}
            subtitle={COPY.subjects.subtitle[lang]}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {COPY.subjects.items.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className="lp-reveal lp-card flex flex-col items-center justify-center text-center gap-2 p-4 hover:border-[var(--mp-viridian)]/40 transition-colors"
                style={{ transitionDelay: `${(i % 6) * 40}ms` }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(0, 123, 95, 0.08)" }}
                >
                  <Icon className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden="true" />
                </div>
                <span className="text-[var(--mp-fg)] font-semibold" style={{ fontSize: "13px" }}>
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
   Pricing preview — 3-tier brief, featured card highlighted
   ───────────────────────────────────────────────────────────── */
function PricingPreview({ lang, freeHref }: { lang: Lang; freeHref: string }) {
  return (
    <section id="pricing" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12">
          <SectionHead
            index={COPY.pricing.index}
            eyebrow={COPY.pricing.eyebrow[lang]}
            title={COPY.pricing.title[lang]}
            subtitle={COPY.pricing.subtitle[lang]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {COPY.pricing.tiers.map((t, i) => {
            const planName = t.name[lang];
            const isSoon = t.status === "soon";
            const featured = t.featured;
            return (
              <div
                key={planName}
                className={`lp-reveal lp-card p-6 relative flex flex-col ${
                  featured ? "lp-card--tick" : ""
                }`}
                style={{
                  transitionDelay: `${i * 70}ms`,
                  ...(featured
                    ? { borderColor: "rgba(0,123,95,0.55)", boxShadow: "var(--mp-shadow-hover)" }
                    : {}),
                }}
              >
                {featured && (
                  <span
                    className="absolute -top-2.5 left-6 lp-examtab px-2 py-0.5 rounded-full text-white"
                    style={{ background: "var(--mp-viridian)", fontSize: "10px" }}
                  >
                    {COPY.pricing.featuredTag[lang]}
                  </span>
                )}
                {isSoon && (
                  <span
                    className="absolute top-4 right-4 lp-examtab px-2 py-0.5 rounded-full"
                    style={{
                      color: "var(--mp-warning-dk)",
                      background: "var(--mp-warning-bg)",
                      fontSize: "10px",
                    }}
                  >
                    {COPY.pricing.comingSoon[lang]}
                  </span>
                )}
                <h3
                  className="font-display font-bold text-[var(--mp-fg)] mb-1"
                  style={{ fontSize: "18px" }}
                >
                  {planName}
                </h3>
                <div className="flex items-baseline gap-1.5 mb-4">
                  <span className="lp-figure text-[var(--mp-fg)]" style={{ fontSize: "34px" }}>
                    {t.price}
                  </span>
                  <span className="text-[var(--mp-fg-subtle)]" style={{ fontSize: "13px" }}>
                    / {t.period[lang]}
                  </span>
                </div>
                <p className="text-[var(--mp-fg-muted)] flex-1 mb-5" style={{ fontSize: "14px" }}>
                  {t.pitch[lang]}
                </p>
                <Link
                  href={t.price === "0 €" ? freeHref : t.href}
                  className={`mp-btn ${
                    isSoon ? "mp-btn--secondary" : "mp-btn--success"
                  } w-full justify-center ${!isSoon ? "lp-cta" : ""}`}
                >
                  {t.cta[lang]}
                </Link>
              </div>
            );
          })}
        </div>

        <div className="lp-reveal text-center">
          <Link
            href="/pricing"
            className="lp-link inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] focus:outline-none focus:ring-2 focus:ring-[var(--mp-viridian)] rounded"
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
   Source proof — provenance band. Credits the documented source
   exams (honest credential) with a sourced breakdown. Reads
   clinical, not hype-y; no claim of physician authorship.
   ───────────────────────────────────────────────────────────── */
function SourceProof({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 md:py-24 bg-[var(--mp-surface-raised)] border-y border-[var(--mp-border-subtle)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <SectionHead
            index={COPY.proof.index}
            eyebrow={COPY.proof.eyebrow[lang]}
            title={COPY.proof.title[lang]}
            subtitle={COPY.proof.quote[lang]}
            center
          />
        </div>

        {/* Source breakdown — three precision cards, figure + label + provenance sub */}
        <div className="grid grid-cols-3 gap-3 md:gap-6 max-w-3xl mx-auto">
          {COPY.proof.breakdown.map((b, i) => (
            <div
              key={i}
              className="lp-reveal lp-card flex flex-col items-start justify-center p-4 md:p-5 text-left"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <div
                className="lp-figure text-[var(--mp-oxford-blue)] dark:text-white"
                style={{ fontSize: "clamp(24px, 3vw, 34px)" }}
              >
                {lang === "en" ? b.n_en : b.n}
              </div>
              <div
                className="mt-2 font-bold text-[var(--mp-fg-muted)] leading-snug"
                style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                {b.label[lang]}
              </div>
              <div
                className="mt-0.5 text-[var(--mp-fg-faint)] leading-snug"
                style={{ fontSize: "10.5px", fontFamily: "var(--lp-mono)", color: "var(--lp-fg-faint)" }}
              >
                {b.sub[lang]}
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
function FinalCTA({ lang, freeHref }: { lang: Lang; freeHref: string }) {
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
        className="absolute inset-0 opacity-[0.045] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center lp-reveal">
        <p className="lp-eyebrow lp-eyebrow--center mb-5" style={{ color: "var(--lp-teal-br)" }}>
          {COPY.hero.eyebrow[lang]}
        </p>
        <h2
          className="font-display font-black text-white mb-5 leading-[1.05]"
          style={{ fontSize: "clamp(32px, 5vw, 56px)", letterSpacing: "-0.03em" }}
        >
          {COPY.cta.title[lang]}
        </h2>
        <p className="text-white/75 mb-9" style={{ fontSize: "17px" }}>
          {COPY.cta.subtitle[lang]}
        </p>
        <Link
          href={freeHref}
          className="lp-cta inline-flex items-center justify-center gap-2 bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)] font-extrabold px-8 py-4 rounded-xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)]"
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
   Footer — uses --mp-oxford-blue (lighter than the CTA band's -dk
   variant) so it reads as a distinct section. Dark wordmark.
   ───────────────────────────────────────────────────────────── */
function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[var(--mp-oxford-blue)] text-white pt-14 md:pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          <div className="md:col-span-2 sm:col-span-2">
            <div className="mb-4">
              <Wordmark variant="dark" height={24} />
            </div>
            <p className="text-sm text-white/70 leading-relaxed max-w-md">
              {COPY.footer.tagline[lang]}
            </p>
          </div>

          <div>
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
              {COPY.footer.product[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <a href="#how" className="hover:text-white transition-colors">
                  {COPY.nav.how[lang]}
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors">
                  {COPY.nav.features[lang]}
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
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
              {lang === "de" ? "Prüfungen" : "Exams"}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <Link href="/kenntnispruefung-wien" className="hover:text-white transition-colors">
                  Kenntnisprüfung Wien
                </Link>
              </li>
              <li>
                <Link href="/kmp-innsbruck" className="hover:text-white transition-colors">
                  Stichprobentest (Innsbruck)
                </Link>
              </li>
              <li>
                <Link href="/pharmakologie-pruefung-wien" className="hover:text-white transition-colors">
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
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
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

        <div className="lp-ruler mb-6" aria-hidden="true" style={{ opacity: 0.4 }} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-white/50">
          <p className="font-[var(--lp-mono)]" style={{ fontFamily: "var(--lp-mono)" }}>
            © {year} MedPrüf · [name]. {COPY.footer.rights[lang]}
          </p>
          <p className="flex items-center gap-2" style={{ fontFamily: "var(--lp-mono)" }}>
            <span>medpruf.com</span>
            <span aria-hidden="true">·</span>
            <a href="mailto:user-b7e46e80@example.com" className="hover:text-white transition-colors">
              user-b7e46e80@example.com
            </a>
            <span aria-hidden="true">·</span>
            <span>Wien · AT</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
