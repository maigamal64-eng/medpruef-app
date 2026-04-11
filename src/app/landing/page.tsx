"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ClipboardList,
  Clock,
  GraduationCap,
  Layers,
  LineChart,
  Mail,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
} from "lucide-react";

type Lang = "de" | "en";

/* ─────────────────────────────────────────────────────────────
   Copy — every string in one place, bilingual, no placeholders
   ───────────────────────────────────────────────────────────── */

const COPY = {
  nav: {
    features: { de: "Funktionen", en: "Features" },
    sample: { de: "Beispielfrage", en: "Sample question" },
    pricing: { de: "Preise", en: "Pricing" },
    faq: { de: "FAQ", en: "FAQ" },
    login: { de: "Anmelden", en: "Sign in" },
    start: { de: "Kostenlos starten", en: "Start free" },
  },
  hero: {
    badge: { de: "Wien · Kenntnisprüfung", en: "Vienna · Kenntnisprüfung" },
    title_l1: { de: "Bestehe die", en: "Pass the" },
    title_l2: { de: "Kenntnisprüfung", en: "Kenntnisprüfung" },
    title_l3: { de: "beim ersten Mal.", en: "on your first attempt." },
    subtitle: {
      de: "7.725 echte Klinikfragen aus SIP 4 und SIP 5 — strukturiert wie die echte Wiener Prüfung. Auf Deutsch oder Englisch lernen, KI-Erklärungen freischalten, mit Spaced Repetition trainieren.",
      en: "7,725 real clinical questions from SIP 4 and SIP 5 — structured exactly like the live Vienna exam. Study in German or English, unlock AI explanations, train with spaced repetition.",
    },
    cta_primary: { de: "Kostenlos starten", en: "Start free" },
    cta_secondary: { de: "Beispielfrage ansehen", en: "See a sample question" },
    trust: {
      de: "Keine Kreditkarte · Sofortiger Zugriff · DSGVO-konform",
      en: "No credit card · Instant access · GDPR compliant",
    },
  },
  stats: [
    { value: "7.725", label: { de: "Klinikfragen", en: "Clinical questions" } },
    { value: "10", label: { de: "Fachgebiete", en: "Specialties" } },
    { value: "SIP 4+5", label: { de: "Wiener Format", en: "Vienna format" } },
    { value: "DE / EN", label: { de: "Zweisprachig", en: "Bilingual" } },
  ],
  why: {
    eyebrow: { de: "Warum MedPrüf", en: "Why MedPrüf" },
    title: {
      de: "Die Prüfung ist hart. Dein Training muss härter sein.",
      en: "The exam is hard. Your training has to be harder.",
    },
    body: {
      de: "Die österreichische Kenntnisprüfung entscheidet über deine Approbation in Wien. Wir haben jede SIP-4- und SIP-5-Frage seit 2016 katalogisiert, korrigiert, erklärt und in ein Trainingssystem gepackt, das sich an deine Schwächen anpasst.",
      en: "The Austrian Kenntnisprüfung decides whether you can practice medicine in Vienna. We have catalogued, corrected, explained and packaged every SIP 4 and SIP 5 question since 2016 into a training system that adapts to your weak spots.",
    },
  },
  features: {
    eyebrow: { de: "Funktionen", en: "Features" },
    title: { de: "Alles, was du zum Bestehen brauchst", en: "Everything you need to pass" },
    items: [
      {
        icon: ClipboardList,
        title: { de: "Echte Prüfungssimulation", en: "Real exam simulation" },
        body: {
          de: "250 Fragen, 4 Stunden, exakt wie SIP 4 + 5. Inklusive 2-3 EKG-Fragen pro Durchlauf, gruppiert nach Fach.",
          en: "250 questions, 4 hours, exactly like SIP 4 + 5. Includes 2-3 ECG questions per run, grouped by subject.",
        },
      },
      {
        icon: Brain,
        title: { de: "Adaptives Lernen (SM-2)", en: "Adaptive learning (SM-2)" },
        body: {
          de: "Spaced Repetition zeigt dir Fragen genau dann wieder, wenn du sie zu vergessen beginnst.",
          en: "Spaced repetition resurfaces each question right when you are about to forget it.",
        },
      },
      {
        icon: Sparkles,
        title: { de: "KI-Erklärungen auf Abruf", en: "AI explanations on demand" },
        body: {
          de: "Verstehst du eine Antwort nicht? GPT-4o erklärt dir den klinischen Hintergrund auf Deutsch oder Englisch.",
          en: "Don't understand an answer? GPT-4o explains the clinical reasoning in German or English.",
        },
      },
      {
        icon: LineChart,
        title: { de: "Schwächen-Analyse", en: "Weakness analytics" },
        body: {
          de: "Radar-Chart, Topic-Heatmap, Pass-Wahrscheinlichkeit — du weißt jederzeit, wo du stehst.",
          en: "Radar chart, topic heatmap, pass probability — always know exactly where you stand.",
        },
      },
      {
        icon: Layers,
        title: { de: "Karteikarten-Modus", en: "Flashcard mode" },
        body: {
          de: "3D-Karten mit Confidence-Buttons. Perfekt für die letzten Tage vor der Prüfung.",
          en: "3D flip cards with confidence buttons. Perfect for the final days before the exam.",
        },
      },
      {
        icon: Stethoscope,
        title: { de: "10 Fachgebiete", en: "10 specialties" },
        body: {
          de: "Innere, Chirurgie, Neurologie, Psychiatrie, Gynäkologie, Pädiatrie, HNO, Augen, Notfall, Dermatologie.",
          en: "Internal, Surgery, Neurology, Psychiatry, Gynecology, Pediatrics, ENT, Ophthalmology, Emergency, Dermatology.",
        },
      },
    ],
  },
  how: {
    eyebrow: { de: "So funktioniert's", en: "How it works" },
    title: { de: "In drei Schritten zur Prüfungsreife", en: "Exam-ready in three steps" },
    steps: [
      {
        n: "1",
        title: { de: "Anmelden", en: "Sign up" },
        body: {
          de: "Per E-Mail oder Telegram. Sofortiger Zugriff auf 200 freie Fragen.",
          en: "By email or Telegram. Instant access to 200 free questions.",
        },
      },
      {
        n: "2",
        title: { de: "Lernen", en: "Study" },
        body: {
          de: "Quiz, Karteikarten oder Curriculum — täglich 20-50 Fragen mit Erklärung.",
          en: "Quiz, flashcards, or curriculum — 20-50 questions with explanations every day.",
        },
      },
      {
        n: "3",
        title: { de: "Prüfen", en: "Simulate" },
        body: {
          de: "Volle Prüfungssimulation, sobald du bereit bist. Teste, wo du stehst.",
          en: "Run a full exam simulation when you're ready. Find out where you stand.",
        },
      },
    ],
  },
  sample: {
    eyebrow: { de: "Beispielfrage", en: "Sample question" },
    title: { de: "So sieht eine MedPrüf-Frage aus", en: "What a MedPrüf question looks like" },
    topic: { de: "Innere Medizin", en: "Internal Medicine" },
    question: {
      de: "Eine 68-jährige Patientin stellt sich mit akuter Dyspnoe und Brustschmerzen vor. Im EKG zeigen sich tiefe S-Zacken in I, Q-Zacke und negatives T in III. Welche Verdachtsdiagnose ist am wahrscheinlichsten?",
      en: "A 68-year-old female presents with acute dyspnea and chest pain. The ECG shows deep S waves in lead I, Q waves and inverted T in lead III. What is the most likely diagnosis?",
    },
    options: [
      { letter: "A", text: { de: "Akuter Myokardinfarkt der Hinterwand", en: "Acute inferior wall myocardial infarction" }, correct: false },
      { letter: "B", text: { de: "Lungenembolie", en: "Pulmonary embolism" }, correct: true },
      { letter: "C", text: { de: "Perikarditis", en: "Pericarditis" }, correct: false },
      { letter: "D", text: { de: "Aortendissektion", en: "Aortic dissection" }, correct: false },
    ],
    explanation: {
      de: "Das SI-QIII-TIII-Muster (McGinn-White-Zeichen) ist ein klassisches, wenn auch unspezifisches EKG-Zeichen einer akuten Lungenembolie mit Rechtsherzbelastung. Es findet sich nur bei ca. 20 % der Patienten mit gesicherter LE.",
      en: "The S1-Q3-T3 pattern (McGinn-White sign) is a classic but non-specific ECG finding in acute pulmonary embolism with right heart strain. It is present in only ~20% of confirmed PE cases.",
    },
  },
  coming: {
    eyebrow: { de: "Bald verfügbar", en: "Coming soon" },
    title: { de: "Mehr Prüfungen sind in Arbeit", en: "More exams are on the way" },
    body: {
      de: "MedPrüf startet mit der Wiener Kenntnisprüfung. In den kommenden Monaten erweitern wir die Plattform um weitere medizinische Prüfungen für ausländische Ärzt:innen in Österreich und Deutschland.",
      en: "MedPrüf is launching with the Vienna Kenntnisprüfung. Over the coming months we are expanding to additional medical exams for foreign doctors in Austria and Germany.",
    },
    upcoming: [
      { de: "Approbation Deutschland — Fachsprachenprüfung", en: "Approbation Germany — Fachsprachenprüfung" },
      { de: "Approbation Deutschland — Kenntnisprüfung", en: "Approbation Germany — Kenntnisprüfung" },
      { de: "Österreichische Ärztekammer-Diplome", en: "Austrian Ärztekammer diplomas" },
    ],
    notify: { de: "Benachrichtige mich", en: "Notify me" },
  },
  pricing: {
    eyebrow: { de: "Preise", en: "Pricing" },
    title: { de: "Fair und transparent", en: "Fair and transparent" },
    plans: [
      {
        name: { de: "Kostenlos", en: "Free" },
        price: "€0",
        period: { de: "/ immer", en: "/ forever" },
        features: [
          { de: "200 Fragen", en: "200 questions" },
          { de: "1 vollständige Prüfungssimulation", en: "1 full exam simulation" },
          { de: "Karteikarten-Modus", en: "Flashcard mode" },
          { de: "Gespeicherte KI-Erklärungen", en: "Cached AI explanations" },
        ],
        cta: { de: "Kostenlos starten", en: "Start free" },
        href: "/login",
        highlight: false,
      },
      {
        name: "Pro",
        price: "€19",
        period: { de: "/ Monat", en: "/ month" },
        features: [
          { de: "Alle 7.725 Fragen freigeschaltet", en: "All 7,725 questions unlocked" },
          { de: "Unbegrenzte Prüfungssimulationen", en: "Unlimited exam simulations" },
          { de: "Eigene KI-Folgefragen", en: "Custom AI follow-up questions" },
          { de: "Streak-Schutz", en: "Streak freeze" },
          { de: "Schwächen-Analyse + Pass-Wahrscheinlichkeit", en: "Weakness analytics + pass probability" },
        ],
        cta: { de: "Pro starten", en: "Get Pro" },
        href: "/login",
        highlight: true,
      },
    ],
  },
  faq: {
    eyebrow: { de: "Häufige Fragen", en: "FAQ" },
    title: { de: "Du fragst, wir antworten", en: "You ask, we answer" },
    items: [
      {
        q: { de: "Sind die Fragen echt?", en: "Are the questions real?" },
        a: {
          de: "Ja. Alle 7.725 Fragen stammen aus dokumentierten SIP-4- und SIP-5-Prüfungen seit 2016, manuell validiert und mit Erklärungen ergänzt.",
          en: "Yes. All 7,725 questions come from documented SIP 4 and SIP 5 exams since 2016, manually validated and enriched with explanations.",
        },
      },
      {
        q: { de: "Kann ich auf Englisch lernen?", en: "Can I study in English?" },
        a: {
          de: "Die Fragen selbst sind auf Deutsch (so wie in der echten Prüfung). Die Oberfläche, Erklärungen und KI-Antworten kannst du jederzeit auf Englisch umstellen.",
          en: "The questions themselves are in German (as in the real exam). The interface, explanations, and AI answers can be switched to English at any time.",
        },
      },
      {
        q: { de: "Funktioniert das Mobile?", en: "Does it work on mobile?" },
        a: {
          de: "Ja. MedPrüf ist eine Progressive Web App — installierbar auf iOS und Android, funktioniert offline für gespeicherte Inhalte.",
          en: "Yes. MedPrüf is a Progressive Web App — installable on iOS and Android, works offline for cached content.",
        },
      },
      {
        q: { de: "Wie aktuell sind die Fragen?", en: "How current are the questions?" },
        a: {
          de: "Letzter Import: Februar 2025. Wir aktualisieren das Fragebank-Set nach jeder neuen offiziellen Prüfung.",
          en: "Last import: February 2025. We refresh the question bank after every new official exam release.",
        },
      },
      {
        q: { de: "Wie sicher sind meine Daten?", en: "How safe is my data?" },
        a: {
          de: "DSGVO-konform, gehostet in der EU (Vercel + Supabase EU-Region). Du kannst dein Konto jederzeit selbst löschen.",
          en: "GDPR compliant, hosted in the EU (Vercel + Supabase EU region). You can delete your account at any time yourself.",
        },
      },
      {
        q: { de: "Gibt es eine Geld-zurück-Garantie?", en: "Is there a money-back guarantee?" },
        a: {
          de: "Pro ist monatlich kündbar. Kein Vertrag, keine Mindestlaufzeit. Schreib uns, wenn du nicht zufrieden bist.",
          en: "Pro is monthly and cancellable any time. No contract, no minimum commitment. Reach out if you're not happy.",
        },
      },
    ],
  },
  cta: {
    title: { de: "Bereit für Wien?", en: "Ready for Vienna?" },
    subtitle: {
      de: "Starte heute kostenlos. Kein Risiko, keine Kreditkarte.",
      en: "Start free today. No risk, no credit card.",
    },
    button: { de: "Konto anlegen", en: "Create account" },
  },
  footer: {
    tagline: {
      de: "Vorbereitung auf die Wiener Kenntnisprüfung — gebaut von und für ausländische Ärzt:innen.",
      en: "Vienna Kenntnisprüfung preparation — built by and for foreign doctors.",
    },
    product: { de: "Produkt", en: "Product" },
    legal: { de: "Rechtliches", en: "Legal" },
    company: { de: "Unternehmen", en: "Company" },
    rights: {
      de: "Alle Rechte vorbehalten.",
      en: "All rights reserved.",
    },
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
    return <div className="min-h-screen bg-[#F7F9FC]" />;
  }

  return (
    <div className="min-h-screen bg-white text-[#1A2B3C]">
      <Nav lang={lang} onLangChange={switchLang} />
      <Hero lang={lang} />
      <Stats lang={lang} />
      <Why lang={lang} />
      <Features lang={lang} />
      <HowItWorks lang={lang} />
      <SampleQuestion lang={lang} />
      <ComingSoon lang={lang} />
      <Pricing lang={lang} />
      <FAQ lang={lang} />
      <FinalCTA lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Nav
   ───────────────────────────────────────────────────────────── */
function Nav({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/85 backdrop-blur-xl border-b border-[#E4E9F0] shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/landing" className="flex items-center gap-2.5">
          <Image src="/brand/logomark.svg" alt="MedPrüf" width={32} height={32} />
          <span className="text-lg font-bold text-[#001B3D] tracking-tight font-display">
            Med<span className="text-[#00A896]">Prüf</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7 text-sm font-medium text-[#4A5568]">
          <a href="#features" className="hover:text-[#001B3D] transition-colors">
            {COPY.nav.features[lang]}
          </a>
          <a href="#sample" className="hover:text-[#001B3D] transition-colors">
            {COPY.nav.sample[lang]}
          </a>
          <a href="#pricing" className="hover:text-[#001B3D] transition-colors">
            {COPY.nav.pricing[lang]}
          </a>
          <a href="#faq" className="hover:text-[#001B3D] transition-colors">
            {COPY.nav.faq[lang]}
          </a>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-[#F7F9FC] rounded-lg p-0.5 text-xs border border-[#E4E9F0]">
            {(["de", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => onLangChange(l)}
                className={`px-2.5 py-1 rounded font-semibold transition-all ${
                  lang === l ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] hover:text-[#4A5568]"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-[#4A5568] hover:text-[#001B3D] transition-colors px-3 py-2"
          >
            {COPY.nav.login[lang]}
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 bg-[#001B3D] hover:bg-[#003A8C] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow-md"
          >
            {COPY.nav.start[lang]}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────
   Hero
   ───────────────────────────────────────────────────────────── */
function Hero({ lang }: { lang: Lang }) {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden bg-gradient-to-b from-[#F7F9FC] via-white to-white">
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, #001B3D 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute top-20 right-[-10%] w-[600px] h-[600px] rounded-full bg-[#00A896]/8 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-32 left-[-10%] w-[500px] h-[500px] rounded-full bg-[#003A8C]/6 blur-[100px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#007B5F]/10 border border-[#007B5F]/20 text-[#007B5F] text-xs font-semibold mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          {COPY.hero.badge[lang]}
        </span>

        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-[#001B3D] leading-[1.05] tracking-tight font-display mb-5">
          {COPY.hero.title_l1[lang]}{" "}
          <span className="text-[#00A896]">{COPY.hero.title_l2[lang]}</span>
          <br />
          {COPY.hero.title_l3[lang]}
        </h1>

        <p className="text-base sm:text-lg md:text-xl text-[#4A5568] max-w-2xl mx-auto mb-8 leading-relaxed">
          {COPY.hero.subtitle[lang]}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 bg-[#001B3D] hover:bg-[#003A8C] text-white text-base font-semibold px-7 py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            {COPY.hero.cta_primary[lang]}
            <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#sample"
            className="inline-flex items-center gap-2 bg-white border border-[#E4E9F0] hover:border-[#007B5F] text-[#1A2B3C] text-base font-semibold px-7 py-4 rounded-2xl transition-all hover:shadow-md"
          >
            {COPY.hero.cta_secondary[lang]}
          </a>
        </div>

        <p className="text-xs text-[#A0AEC0] flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#00A896]" />
          {COPY.hero.trust[lang]}
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Stats strip
   ───────────────────────────────────────────────────────────── */
function Stats({ lang }: { lang: Lang }) {
  return (
    <section className="py-12 border-y border-[#E4E9F0] bg-[#F7F9FC]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
        {COPY.stats.map((s) => (
          <div key={s.value} className="text-center">
            <div className="text-3xl md:text-4xl font-black font-display text-[#001B3D]">
              {s.value}
            </div>
            <div className="text-xs text-[#A0AEC0] uppercase tracking-wider font-semibold mt-1">
              {s.label[lang]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Why
   ───────────────────────────────────────────────────────────── */
function Why({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <p className="text-xs uppercase tracking-widest text-[#007B5F] font-bold mb-3">
          {COPY.why.eyebrow[lang]}
        </p>
        <h2 className="text-3xl md:text-4xl font-bold text-[#001B3D] font-display leading-tight mb-5">
          {COPY.why.title[lang]}
        </h2>
        <p className="text-base md:text-lg text-[#4A5568] leading-relaxed">
          {COPY.why.body[lang]}
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Features
   ───────────────────────────────────────────────────────────── */
function Features({ lang }: { lang: Lang }) {
  return (
    <section id="features" className="py-20 bg-[#F7F9FC]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-widest text-[#007B5F] font-bold mb-3">
            {COPY.features.eyebrow[lang]}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[#001B3D] font-display">
            {COPY.features.title[lang]}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {COPY.features.items.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title.en}
                className="bg-white border border-[#E4E9F0] rounded-2xl p-6 hover:border-[#007B5F]/40 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-[#007B5F]/10 flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6 text-[#007B5F]" />
                </div>
                <h3 className="text-base font-bold text-[#001B3D] mb-2 font-display">
                  {f.title[lang]}
                </h3>
                <p className="text-sm text-[#4A5568] leading-relaxed">{f.body[lang]}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   How it works
   ───────────────────────────────────────────────────────────── */
function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-widest text-[#007B5F] font-bold mb-3">
            {COPY.how.eyebrow[lang]}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[#001B3D] font-display">
            {COPY.how.title[lang]}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {COPY.how.steps.map((s) => (
            <div key={s.n} className="text-center md:text-left relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#001B3D] to-[#003A8C] text-white text-xl font-black font-display flex items-center justify-center mb-4 mx-auto md:mx-0 shadow-md">
                {s.n}
              </div>
              <h3 className="text-lg font-bold text-[#001B3D] mb-2 font-display">
                {s.title[lang]}
              </h3>
              <p className="text-sm text-[#4A5568] leading-relaxed">{s.body[lang]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sample question
   ───────────────────────────────────────────────────────────── */
function SampleQuestion({ lang }: { lang: Lang }) {
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  const onPick = (i: number) => {
    if (revealed) return;
    setPicked(i);
    setRevealed(true);
  };

  return (
    <section id="sample" className="py-20 bg-[#F7F9FC]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-[#007B5F] font-bold mb-3">
            {COPY.sample.eyebrow[lang]}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[#001B3D] font-display">
            {COPY.sample.title[lang]}
          </h2>
        </div>

        <div className="bg-white border border-[#E4E9F0] rounded-2xl p-6 md:p-8 shadow-lg">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-[#003A8C]/10 text-[#003A8C] mb-4">
            <Stethoscope className="w-3.5 h-3.5" />
            {COPY.sample.topic[lang]}
          </span>

          <p className="text-base md:text-lg leading-relaxed font-medium text-[#001B3D] mb-5">
            {COPY.sample.question[lang]}
          </p>

          <div className="space-y-2.5">
            {COPY.sample.options.map((opt, i) => {
              const isPicked = picked === i;
              let style =
                "w-full text-left px-4 py-3 border rounded-xl text-sm font-medium flex items-center gap-3 transition-all ";
              if (!revealed) {
                style +=
                  "bg-[#F7F9FC] border-[#E4E9F0] hover:border-[#007B5F]/50 hover:bg-white text-[#1A2B3C] active:scale-[0.99]";
              } else if (isPicked && opt.correct) {
                style += "bg-[#00A896]/10 border-[#00A896] text-[#00A896]";
              } else if (isPicked && !opt.correct) {
                style += "bg-[#D64545]/10 border-[#D64545] text-[#D64545]";
              } else if (opt.correct) {
                style += "bg-[#00A896]/8 border-[#00A896]/60 text-[#00A896]/90";
              } else {
                style += "bg-white border-[#E4E9F0]/40 text-[#A0AEC0] opacity-60";
              }
              return (
                <button key={opt.letter} onClick={() => onPick(i)} className={style}>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold border border-current font-mono flex-shrink-0">
                    {revealed && isPicked && opt.correct
                      ? "✓"
                      : revealed && isPicked
                      ? "✗"
                      : revealed && opt.correct
                      ? "✓"
                      : opt.letter}
                  </span>
                  <span>{opt.text[lang]}</span>
                </button>
              );
            })}
          </div>

          {revealed && (
            <div className="mt-5 bg-[#F4A261]/8 border border-[#F4A261]/25 rounded-xl p-4 animate-fade-in">
              <p className="text-[10px] uppercase tracking-wider text-[#F4A261] font-bold mb-2">
                {lang === "de" ? "Erklärung" : "Explanation"}
              </p>
              <p className="text-[#4A5568] text-sm leading-relaxed">
                {COPY.sample.explanation[lang]}
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-[#A0AEC0] mt-5">
          {lang === "de"
            ? "7.724 weitere Fragen warten auf dich nach der Anmeldung."
            : "7,724 more questions waiting for you after sign up."}
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Coming soon (more exams teaser)
   ───────────────────────────────────────────────────────────── */
function ComingSoon({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 bg-gradient-to-br from-[#001B3D] via-[#00244F] to-[#003A8C] text-white relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="absolute top-0 right-[-15%] w-[500px] h-[500px] rounded-full bg-[#00A896]/15 blur-[120px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-[#00A896] text-xs font-semibold mb-5">
          <Clock className="w-3.5 h-3.5" />
          {COPY.coming.eyebrow[lang]}
        </div>
        <h2 className="text-3xl md:text-4xl font-bold font-display mb-5">
          {COPY.coming.title[lang]}
        </h2>
        <p className="text-base md:text-lg text-white/80 max-w-2xl mx-auto leading-relaxed mb-8">
          {COPY.coming.body[lang]}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8 max-w-3xl mx-auto">
          {COPY.coming.upcoming.map((u) => (
            <div
              key={u.en}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 text-left flex items-start gap-3"
            >
              <GraduationCap className="w-5 h-5 text-[#00A896] flex-shrink-0 mt-0.5" />
              <span className="text-sm font-medium">{u[lang]}</span>
            </div>
          ))}
        </div>

        <a
          href="mailto:hello@medpruf.com?subject=Notify%20me%20about%20new%20exams"
          className="inline-flex items-center gap-2 bg-[#00A896] hover:bg-[#00C0AB] text-[#001B3D] text-sm font-bold px-6 py-3 rounded-xl transition-all shadow-lg hover:shadow-xl"
        >
          <Mail className="w-4 h-4" />
          {COPY.coming.notify[lang]}
        </a>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Pricing
   ───────────────────────────────────────────────────────────── */
function Pricing({ lang }: { lang: Lang }) {
  return (
    <section id="pricing" className="py-20 bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-widest text-[#007B5F] font-bold mb-3">
            {COPY.pricing.eyebrow[lang]}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[#001B3D] font-display">
            {COPY.pricing.title[lang]}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {COPY.pricing.plans.map((p) => {
            const isPro = p.highlight;
            const planName = typeof p.name === "string" ? p.name : p.name[lang];
            return (
              <div
                key={planName}
                className={`relative rounded-2xl p-8 border-2 transition-all ${
                  isPro
                    ? "bg-gradient-to-br from-[#001B3D] to-[#003A8C] text-white border-[#00A896] shadow-xl scale-[1.02]"
                    : "bg-white border-[#E4E9F0] text-[#1A2B3C]"
                }`}
              >
                {isPro && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#00A896] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                    {lang === "de" ? "Empfohlen" : "Recommended"}
                  </span>
                )}
                <h3
                  className={`text-2xl font-bold font-display mb-1 ${
                    isPro ? "text-white" : "text-[#001B3D]"
                  }`}
                >
                  {planName}
                </h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span
                    className={`text-5xl font-black font-display ${
                      isPro ? "text-white" : "text-[#001B3D]"
                    }`}
                  >
                    {p.price}
                  </span>
                  <span className={`text-sm ${isPro ? "text-white/70" : "text-[#A0AEC0]"}`}>
                    {p.period[lang]}
                  </span>
                </div>
                <ul className="space-y-2.5 mb-7">
                  {p.features.map((f) => (
                    <li
                      key={f.en}
                      className={`flex items-start gap-2.5 text-sm ${
                        isPro ? "text-white/90" : "text-[#4A5568]"
                      }`}
                    >
                      <CheckCircle2
                        className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                          isPro ? "text-[#00A896]" : "text-[#007B5F]"
                        }`}
                      />
                      <span>{f[lang]}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className={`block text-center py-3 rounded-xl font-semibold text-sm transition-all ${
                    isPro
                      ? "bg-[#00A896] hover:bg-[#00C0AB] text-[#001B3D] shadow-lg hover:shadow-xl"
                      : "bg-[#001B3D] hover:bg-[#003A8C] text-white"
                  }`}
                >
                  {p.cta[lang]}
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   FAQ
   ───────────────────────────────────────────────────────────── */
function FAQ({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 bg-[#F7F9FC]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-widest text-[#007B5F] font-bold mb-3">
            {COPY.faq.eyebrow[lang]}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-[#001B3D] font-display">
            {COPY.faq.title[lang]}
          </h2>
        </div>

        <div className="space-y-2">
          {COPY.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.q.en}
                className="bg-white border border-[#E4E9F0] rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#F7F9FC]/60 transition-colors"
                >
                  <span className="text-sm md:text-base font-semibold text-[#001B3D]">
                    {item.q[lang]}
                  </span>
                  <span className={`text-[#007B5F] text-xl transition-transform ${isOpen ? "rotate-45" : ""}`}>
                    +
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 -mt-1 text-sm text-[#4A5568] leading-relaxed animate-fade-in">
                    {item.a[lang]}
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
   Final CTA
   ───────────────────────────────────────────────────────────── */
function FinalCTA({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-black font-display text-[#001B3D] mb-4">
          {COPY.cta.title[lang]}
        </h2>
        <p className="text-base md:text-lg text-[#4A5568] mb-8">{COPY.cta.subtitle[lang]}</p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-[#001B3D] hover:bg-[#003A8C] text-white text-base font-bold px-8 py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
        >
          {COPY.cta.button[lang]}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="flex items-center justify-center gap-2 mt-5 text-xs text-[#A0AEC0]">
          <Star className="w-3.5 h-3.5 text-[#F4A261] fill-[#F4A261]" />
          <Star className="w-3.5 h-3.5 text-[#F4A261] fill-[#F4A261]" />
          <Star className="w-3.5 h-3.5 text-[#F4A261] fill-[#F4A261]" />
          <Star className="w-3.5 h-3.5 text-[#F4A261] fill-[#F4A261]" />
          <Star className="w-3.5 h-3.5 text-[#F4A261] fill-[#F4A261]" />
          <span className="ml-1">
            {lang === "de" ? "von ärztlichen Tester:innen" : "from physician testers"}
          </span>
        </div>
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
    <footer className="bg-[#001B3D] text-white pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <Image
                src="/brand/logomark.svg"
                alt="MedPrüf"
                width={32}
                height={32}
                style={{ filter: "brightness(0) invert(1)" }}
              />
              <span className="text-lg font-bold tracking-tight font-display">
                Med<span className="text-[#00A896]">Prüf</span>
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
              <li><a href="#features" className="hover:text-white transition-colors">{COPY.nav.features[lang]}</a></li>
              <li><a href="#sample" className="hover:text-white transition-colors">{COPY.nav.sample[lang]}</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">{COPY.nav.pricing[lang]}</a></li>
              <li><Link href="/changelog" className="hover:text-white transition-colors">Changelog</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-white/50 font-bold mb-3">
              {COPY.footer.legal[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li><Link href="/privacy" className="hover:text-white transition-colors">{lang === "de" ? "Datenschutz" : "Privacy"}</Link></li>
              <li><Link href="/terms" className="hover:text-white transition-colors">{lang === "de" ? "AGB" : "Terms"}</Link></li>
              <li><Link href="/impressum" className="hover:text-white transition-colors">Impressum</Link></li>
            </ul>
          </div>
        </div>

        <div className="pt-6 border-t border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-white/50">
          <p>© {year} MedPrüf · [name]. {COPY.footer.rights[lang]}</p>
          <p>medpruf.com · <a href="mailto:hello@medpruf.com" className="hover:text-white transition-colors">hello@medpruf.com</a></p>
        </div>
      </div>
    </footer>
  );
}
