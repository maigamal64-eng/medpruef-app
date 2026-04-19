"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
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
  MessageCircle,
  Pill,
  Scissors,
  Sparkles,
  Stethoscope,
  Target,
  Users,
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
      de: "— Österreich · Ärztliche Kenntnisprüfung",
      en: "— Austria · Medical Licensing Exams",
    },
    title_pre: { de: "Hör auf,", en: "Stop studying" },
    title_mid: { de: "alles", en: "everything" },
    title_post: { de: "zu lernen.", en: "." },
    title_line2: { de: "Lern das, was drankommt.", en: "Study what's on the exam." },
    subtitle: {
      de: "Lerne gezielt für die österreichische Ärzteprüfung 🇦🇹. 10.993 Fragen, klinische KI-Erklärungen in 7 Sprachen, Lernplan auf dein Prüfungsdatum.",
      en: "Study targeted for the Austrian medical licensing exams 🇦🇹. 10,993 questions, clinical AI explanations in 7 languages, study plan down to your exam date.",
    },
    cta_primary: { de: "Jetzt lernen", en: "Start studying" },
    cta_secondary: { de: "So funktioniert's", en: "How it works" },
    cta_note: {
      de: "Kostenlos · 200 Fragen · Keine Karte",
      en: "Free · 200 questions · No credit card",
    },
  },
  stats: [
    {
      value: "10.993",
      value_en: "10,993",
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
    title: { de: "Fair. Transparent. Kündbar.", en: "Fair. Transparent. Cancel anytime." },
    subtitle: {
      de: "Starte kostenlos. Upgrade, wenn du bereit bist.",
      en: "Start free. Upgrade when you're ready.",
    },
    tiers: [
      {
        name: { de: "Kostenlos", en: "Free" },
        price: "€0",
        period: { de: "immer", en: "forever" },
        pitch: { de: "200 Fragen + 1 Simulation", en: "200 questions + 1 simulation" },
        status: "live",
        cta: { de: "Kostenlos starten", en: "Start free" },
        href: "/login",
      },
      {
        name: "Pro",
        price: "€19",
        period: { de: "Monat", en: "month" },
        pitch: {
          de: "Alle 10.993 Fragen · KI-Chat · Streak-Schutz",
          en: "All 10,993 questions · AI chat · Streak freeze",
        },
        status: "soon",
        cta: { de: "Warteliste", en: "Waitlist" },
        href: "/pricing",
      },
      {
        name: "Group",
        price: "€49",
        period: { de: "Team", en: "team" },
        pitch: {
          de: "5 Sitze · Lerngruppe · Gruppen-Fortschritt",
          en: "5 seats · Study group · Group progress",
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
    eyebrow: { de: "Von Ärzt:innen bewertet", en: "Rated by physicians" },
    title: {
      de: "10.993 Fragen, kuratiert von Ärzt:innen für Ärzt:innen.",
      en: "10,993 questions, curated by physicians for physicians.",
    },
    quote: {
      de: "Jede Frage stammt aus einer dokumentierten offiziellen Prüfung. Nichts erfunden, nichts geraten. 7.567 aus Wien seit 2016, 3.091 aus Innsbruck, 335 aus Pharmakologie.",
      en: "Every question comes from a documented official exam. Nothing invented, nothing guessed. 7,567 from Vienna since 2016, 3,091 from Innsbruck, 335 from Pharmacology.",
    },
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

  useEffect(() => {
    setLangState(getLang());
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  return (
    <div className="min-h-screen bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]">
      <Nav lang={lang} onLangChange={switchLang} />
      <Hero lang={lang} />
      <StatsStrip lang={lang} />
      <HowItWorks lang={lang} />
      <Features lang={lang} />
      <Subjects lang={lang} />
      <PricingPreview lang={lang} />
      <SocialProof lang={lang} />
      <FinalCTA lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Nav — transparent over hero, inverts on scroll past hero
   ───────────────────────────────────────────────────────────── */
function Nav({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 480);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--mp-surface-raised)]/92 backdrop-blur-xl border-b border-[var(--mp-border-subtle)] shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link
          href="/landing"
          className={`flex items-center gap-2.5 ${scrolled ? "" : "text-white"}`}
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

        <div className="flex items-center gap-2">
          {/* Language toggle */}
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

          <Link
            href="/login"
            className={`hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold transition-colors px-3 py-2 ${
              scrolled
                ? "text-[var(--mp-fg-muted)] hover:text-[var(--mp-oxford-blue)]"
                : "text-white/80 hover:text-white"
            }`}
          >
            {COPY.nav.login[lang]}
          </Link>

          <Link
            href="/login"
            className={`inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] ${
              scrolled
                ? "bg-[var(--mp-oxford-blue)] hover:bg-[var(--mp-cta-blue)] text-white"
                : "bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)]"
            }`}
          >
            {COPY.nav.start[lang]}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────
   Hero — dark editorial (Oxford Blue bg, white text, always dark)
   ───────────────────────────────────────────────────────────── */
function Hero({ lang }: { lang: Lang }) {
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
          className="mp-body text-white/75 max-w-2xl mb-9"
          style={{ fontSize: "clamp(16px, 1.8vw, 19px)", lineHeight: 1.55 }}
        >
          {COPY.hero.subtitle[lang]}
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
          <Link
            href="/login"
            className="cta-shimmer inline-flex items-center justify-center gap-2 text-[var(--mp-oxford-blue-dk)] font-extrabold px-7 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)]"
            style={{ fontSize: "15px" }}
          >
            {COPY.hero.cta_primary[lang]}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <a
            href="#how"
            className="inline-flex items-center justify-center gap-2 bg-transparent text-white border border-white/25 hover:border-white/60 hover:bg-white/5 font-semibold px-7 py-4 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)]"
            style={{ fontSize: "15px" }}
          >
            {COPY.hero.cta_secondary[lang]}
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </a>
          <span className="text-white/50 sm:ml-2" style={{ fontSize: "12px" }}>
            {COPY.hero.cta_note[lang]}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Stats strip — quiet KPI row at the edge of the hero
   ───────────────────────────────────────────────────────────── */
function StatsStrip({ lang }: { lang: Lang }) {
  return (
    <section className="relative text-white" style={{ background: "var(--mp-oxford-blue-dk)" }}>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div
          className="grid grid-cols-2 md:grid-cols-4 border-t border-b"
          style={{ borderColor: "rgba(255,255,255,0.1)" }}
        >
          {COPY.stats.map((s, i) => (
            <div
              key={i}
              className="py-6 px-4 md:px-6"
              style={{
                borderRight:
                  i < COPY.stats.length - 1 ? "1px solid rgba(255,255,255,0.1)" : "none",
              }}
            >
              <div
                className="mp-num font-black text-white"
                style={{
                  fontSize: "clamp(26px, 3.5vw, 36px)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  fontFamily: "var(--mp-font-display)",
                }}
              >
                {lang === "en" ? s.value_en : s.value}
              </div>
              <div
                className="mp-caption mt-1.5 text-white/60 font-bold uppercase"
                style={{ fontSize: "10px", letterSpacing: "0.08em" }}
              >
                {s.label[lang]}
              </div>
              {s.sub && (
                <div className="mt-1 text-white/45" style={{ fontSize: "10px" }}>
                  {s.sub[lang]}
                </div>
              )}
            </div>
          ))}
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
    <section id="how" className="py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-14 max-w-2xl">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
    <section id="features" className="py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-12 max-w-2xl">
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
    <section className="py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-12 max-w-2xl">
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
                className="mp-card flex flex-col items-center justify-center text-center gap-2 p-4 hover:border-[var(--mp-viridian)]/40"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(0, 58, 140, 0.08)" }}
                >
                  <Icon className="w-5 h-5 text-[var(--mp-cta-blue)]" aria-hidden="true" />
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
function PricingPreview({ lang }: { lang: Lang }) {
  return (
    <section id="pricing" className="py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-12 max-w-2xl">
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
                  href={t.href}
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
   Social proof — quiet quote band
   ───────────────────────────────────────────────────────────── */
function SocialProof({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 bg-[var(--mp-surface-raised)] border-y border-[var(--mp-border-subtle)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
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
          className="mp-body text-[var(--mp-fg-muted)]"
          style={{ fontSize: "17px", lineHeight: 1.6 }}
        >
          {COPY.proof.quote[lang]}
        </p>
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
      className="relative py-24 text-white overflow-hidden"
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
   Footer
   ───────────────────────────────────────────────────────────── */
function Footer({ lang }: { lang: Lang }) {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[var(--mp-oxford-blue)] text-white pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div className="md:col-span-2">
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
            <a href="mailto:hello@medpruf.com" className="hover:text-white transition-colors">
              hello@medpruf.com
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
