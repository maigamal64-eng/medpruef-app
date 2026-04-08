"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import {
  BookOpen,
  Languages,
  FileQuestion,
  BarChart3,
  Smartphone,
  Star,
  CheckCircle,
  Users,
  GraduationCap,
  ArrowRight,
  Stethoscope,
  Zap,
  Shield,
  Moon,
  Layers,
  Play,
  Clock,
  Quote,
  Mail,
} from "lucide-react";

type Lang = "de" | "en";

/* ─────────────────────────────────────────────
   Utility: Animated count-up hook
   ───────────────────────────────────────────── */
function useCountUp(target: number, duration: number, isVisible: boolean) {
  const [count, setCount] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isVisible || hasAnimated.current) return;
    hasAnimated.current = true;
    const steps = 60;
    const increment = target / steps;
    let current = 0;
    const interval = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCount(target);
        clearInterval(interval);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(interval);
  }, [isVisible, target, duration]);

  return count;
}

/* ─────────────────────────────────────────────
   Utility: IntersectionObserver hook
   ───────────────────────────────────────────── */
function useInView(threshold = 0.3) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, inView };
}

/* ═══════════════════════════════════════════════
   FLOATING NAV
   ═══════════════════════════════════════════════ */
function FloatingNav({
  lang,
  visible,
  onLangChange,
}: {
  lang: Lang;
  visible: boolean;
  onLangChange: (l: Lang) => void;
}) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        visible
          ? "translate-y-0 opacity-100"
          : "-translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="glass border-b border-white/10 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src="/brand/logo-mark.png"
              alt="MedPrüf"
              width={28}
              height={28}
              className="rounded-lg"
            />
            <span className="text-lg font-bold text-[#001B3D]">
              Med<span className="text-[#00A896]">Prüf</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#4A5568]">
            <button onClick={() => scrollTo("features")} className="hover:text-[#001B3D] transition-colors">
              {lang === "de" ? "Funktionen" : "Features"}
            </button>
            <button onClick={() => scrollTo("testimonials")} className="hover:text-[#001B3D] transition-colors">
              {lang === "de" ? "Erfahrungen" : "Testimonials"}
            </button>
            <button onClick={() => scrollTo("pricing")} className="hover:text-[#001B3D] transition-colors">
              {lang === "de" ? "Preise" : "Pricing"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[#F7F9FC] rounded-lg p-0.5 text-xs border border-[#E4E9F0]">
              <button
                onClick={() => onLangChange("de")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  lang === "de" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] hover:text-[#4A5568]"
                }`}
              >
                DE
              </button>
              <button
                onClick={() => onLangChange("en")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  lang === "en" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] hover:text-[#4A5568]"
                }`}
              >
                EN
              </button>
            </div>
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 bg-[#007B5F] hover:bg-[#00A896] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all"
            >
              {lang === "de" ? "Starten" : "Get Started"}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 1: HERO
   ═══════════════════════════════════════════════ */
function HeroSection({
  lang,
  onLangChange,
}: {
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden bg-gradient-to-br from-[#001B3D] via-[#00244F] to-[#003A8C]">
      {/* Dot pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Glow orbs */}
      <div className="absolute top-[-200px] right-[-100px] w-[600px] h-[600px] rounded-full bg-[#007B5F]/15 blur-[120px]" />
      <div className="absolute bottom-[-150px] left-[-80px] w-[500px] h-[500px] rounded-full bg-[#00A896]/10 blur-[100px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#003A8C]/20 blur-[160px]" />

      {/* Top bar */}
      <div className="relative z-10 max-w-7xl mx-auto w-full px-6 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/logo-mark.png"
            alt="MedPrüf"
            width={36}
            height={36}
            className="rounded-lg brightness-0 invert"
          />
          <span className="text-xl font-bold text-white">
            Med<span className="text-[#00A896]">Prüf</span>
          </span>
        </div>
        <div className="flex items-center bg-white/10 backdrop-blur-sm rounded-lg p-0.5 text-xs border border-white/10">
          <button
            onClick={() => onLangChange("de")}
            className={`px-3 py-1.5 rounded font-medium transition-all ${
              lang === "de" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            DE
          </button>
          <button
            onClick={() => onLangChange("en")}
            className={`px-3 py-1.5 rounded font-medium transition-all ${
              lang === "en" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Hero content */}
      <div className="relative z-10 flex-1 flex items-center">
        <div className="max-w-7xl mx-auto w-full px-6 py-16 md:py-0">
          <div className="max-w-3xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2.5 bg-white/[0.08] backdrop-blur-sm rounded-full px-5 py-2 mb-8 border border-white/[0.08]">
              <Stethoscope className="w-4 h-4 text-[#00A896]" />
              <span className="text-sm text-white/80 font-medium">
                {lang === "de"
                  ? "Kenntnisprüfung Wien 2026"
                  : "Kenntnisprüfung Vienna 2026"}
              </span>
              <span className="text-white/30">|</span>
              <span className="text-sm text-[#00A896] font-medium">
                🇦🇹{" "}
                {lang === "de" ? "Österreich" : "Austria"}
              </span>
            </div>

            {/* Headline */}
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[1.1] mb-6 tracking-tight text-white">
              {lang === "de" ? (
                <>
                  Bestehe deine Kenntnisprüfung —
                  <br />
                  <span className="bg-gradient-to-r from-[#00A896] via-[#1bb680] to-[#00A896] bg-clip-text text-transparent">
                    Für ausländische Ärzte, nach Wiener Standards
                  </span>
                </>
              ) : (
                <>
                  Pass Your Kenntnisprüfung —
                  <br />
                  <span className="bg-gradient-to-r from-[#00A896] via-[#1bb680] to-[#00A896] bg-clip-text text-transparent">
                    For Foreign Doctors, Designed for Austrian Standards
                  </span>
                </>
              )}
            </h1>

            {/* Subtitle */}
            <p className="text-base md:text-lg text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
              {lang === "de"
                ? "7.725+ klinische Fragen mit ausführlichen Erklärungen in 10 Fachgebieten. Speziell entwickelt für Ärzte, die sich auf die Wiener Kenntnisprüfung vorbereiten."
                : "7,725+ clinical questions with detailed explanations across 10 medical specialties. Built specifically for doctors preparing for the Vienna Kenntnisprüfung."}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <Link
                href="/"
                className="inline-flex items-center gap-2.5 bg-[#007B5F] hover:bg-[#00A896] text-white font-bold text-lg px-8 py-4 rounded-xl transition-all shadow-lg shadow-[#007B5F]/25 hover:shadow-xl hover:shadow-[#00A896]/25 hover:scale-[1.02] pulse-glow"
              >
                {lang === "de"
                  ? "Kostenlos starten — Keine Kreditkarte"
                  : "Start Free — No Credit Card"}
                <ArrowRight className="w-5 h-5" />
              </Link>
              <button
                onClick={() =>
                  document
                    .getElementById("features")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="inline-flex items-center gap-2 text-white/60 hover:text-white/90 font-medium transition-colors"
              >
                <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center">
                  <Play className="w-4 h-4 ml-0.5" />
                </div>
                {lang === "de" ? "Demo ansehen" : "Watch Demo"}
              </button>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
              {[
                {
                  icon: <BookOpen className="w-3.5 h-3.5" />,
                  text: lang === "de" ? "7.725+ Fragen" : "7,725+ Questions",
                },
                {
                  icon: <Clock className="w-3.5 h-3.5" />,
                  text: lang === "de" ? "Aktualisiert 2026" : "Updated 2026",
                },
                {
                  icon: <GraduationCap className="w-3.5 h-3.5" />,
                  text: lang === "de" ? "10 Fachgebiete" : "10 Specialties",
                },
              ].map((badge, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-white/[0.06] backdrop-blur-sm rounded-full px-4 py-2 border border-white/[0.06]"
                >
                  <span className="text-[#00A896]">{badge.icon}</span>
                  <span className="text-xs text-white/70 font-medium">
                    {badge.text}
                  </span>
                </div>
              ))}
            </div>

            {/* Social proof */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex -space-x-2.5">
                {[
                  { color: "#D64545", letter: "A" },
                  { color: "#007B5F", letter: "S" },
                  { color: "#003A8C", letter: "M" },
                  { color: "#F4A261", letter: "K" },
                  { color: "#00A896", letter: "F" },
                ].map((a, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full border-2 border-[#001B3D] flex items-center justify-center text-white text-[10px] font-bold shadow-md"
                    style={{ backgroundColor: a.color }}
                  >
                    {a.letter}
                  </div>
                ))}
              </div>
              <span className="text-sm text-white/50">
                {lang === "de"
                  ? "2.400+ Ärzte aus aller Welt dabei"
                  : "Joined by 2,400+ doctors worldwide"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="relative z-10 pb-8 flex justify-center">
        <div className="w-6 h-10 rounded-full border-2 border-white/20 flex items-start justify-center p-1.5">
          <div className="w-1.5 h-2.5 rounded-full bg-white/40 animate-bounce" />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 2: PROBLEM
   ═══════════════════════════════════════════════ */
function ProblemSection({ lang }: { lang: Lang }) {
  const { ref, inView } = useInView(0.2);
  const painPoints = [
    {
      icon: <Languages className="w-7 h-7" />,
      color: "#D64545",
      title:
        lang === "de"
          ? "Lernen in einer Zweitsprache ist erschöpfend"
          : "Studying in a second language is exhausting",
      desc:
        lang === "de"
          ? "Medizinische Fachliteratur auf Deutsch zu verstehen, wenn es nicht deine Muttersprache ist, kostet doppelt so viel Energie. Jede Frage wird zum Kampf gegen die Sprache statt gegen den Stoff."
          : "Understanding medical literature in German as a foreign doctor takes twice the energy. Every question becomes a fight against the language instead of the material.",
    },
    {
      icon: <FileQuestion className="w-7 h-7" />,
      color: "#F4A261",
      title:
        lang === "de"
          ? "Lernmaterialien über 10 Quellen verstreut"
          : "Resources are scattered across 10 different sources",
      desc:
        lang === "de"
          ? "Anki-Decks hier, PDF-Sammlungen da, veraltete Skripte dazwischen. Du verbringst mehr Zeit mit Suchen als mit Lernen. Und nichts davon ist auf die Wiener Prüfung zugeschnitten."
          : "Anki decks here, PDF collections there, outdated scripts in between. You spend more time searching than studying. And none of it is tailored to the Vienna exam.",
    },
    {
      icon: <GraduationCap className="w-7 h-7" />,
      color: "#003A8C",
      title:
        lang === "de"
          ? "Die Kenntnisprüfung ist einzigartig — allgemeine Vorbereitung reicht nicht"
          : "The Kenntnisprüfung is unique — general prep doesn't work",
      desc:
        lang === "de"
          ? "250 Fragen, 10 Fachgebiete, SIP 4 + SIP 5 Struktur — die Wiener Kenntnisprüfung hat ihr eigenes Format. Allgemeine Medizin-Apps bereiten dich nicht darauf vor."
          : "250 questions, 10 specialties, SIP 4 + SIP 5 structure — the Vienna exam has its own format. Generic medical apps don't prepare you for this.",
    },
  ];

  return (
    <section className="py-20 md:py-28 bg-[#F7F9FC]" ref={ref}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[#D64545]/10 rounded-full px-4 py-1.5 mb-6">
            <span className="text-sm font-semibold text-[#D64545]">
              {lang === "de" ? "Das Problem" : "The Problem"}
            </span>
          </div>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-black text-[#001B3D] mb-4">
            {lang === "de"
              ? "Wir wissen, wie schwer dieser Weg ist"
              : "We Know How Hard This Journey Is"}
          </h2>
          <p className="text-[#A0AEC0] max-w-xl mx-auto text-lg">
            {lang === "de"
              ? "Der Weg zur Approbation in Österreich ist voller Herausforderungen."
              : "The path to medical licensure in Austria is full of challenges."}
          </p>
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${inView ? "stagger" : ""}`}>
          {painPoints.map((point, i) => (
            <div
              key={i}
              className="card rounded-2xl p-8 text-center hover:shadow-xl transition-shadow duration-300"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{
                  backgroundColor: `${point.color}12`,
                  color: point.color,
                }}
              >
                {point.icon}
              </div>
              <h3 className="text-lg font-bold text-[#001B3D] mb-3 leading-snug">
                {point.title}
              </h3>
              <p className="text-sm text-[#4A5568] leading-relaxed">
                {point.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-14 text-center">
          <div className="inline-flex items-center gap-3 bg-[#007B5F]/10 rounded-full px-6 py-3">
            <Zap className="w-5 h-5 text-[#007B5F]" />
            <span className="text-[#007B5F] font-semibold italic">
              {lang === "de"
                ? "Deshalb haben wir MedPrüf entwickelt — für Ärzte genau wie dich."
                : "That's why we built MedPrüf — for doctors exactly like you."}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 3: FEATURES
   ═══════════════════════════════════════════════ */
function FeaturesSection({ lang }: { lang: Lang }) {
  const features = [
    {
      icon: <BookOpen className="w-7 h-7" />,
      color: "#007B5F",
      title:
        lang === "de"
          ? "7.725+ prüfungsnahe Fragen"
          : "7,725+ Exam-Realistic Questions",
      desc:
        lang === "de"
          ? "Jede einzelne Frage stammt aus echten Prüfungsprotokollen und deckt alle 10 Fachgebiete der Wiener Kenntnisprüfung ab. MCQ, Mehrfachantwort und offene Formate — genau wie in der echten Prüfung."
          : "Every single question comes from real exam protocols, covering all 10 specialties of the Vienna Kenntnisprüfung. MCQ, multi-correct, and open-answer formats — exactly like the real exam.",
      gradient: "from-[#007B5F]/5 to-[#00A896]/10",
      borderColor: "#007B5F",
    },
    {
      icon: <BarChart3 className="w-7 h-7" />,
      color: "#003A8C",
      title:
        lang === "de"
          ? "Leistungsanalyse — wisse genau, wo du stehst"
          : "Performance Analytics — Know Exactly Where You Stand",
      desc:
        lang === "de"
          ? "Detaillierte Auswertung nach Fachgebiet, Schwierigkeit und Zeitverlauf. Das Study Radar zeigt dir deine Stärken und Schwächen auf einen Blick — damit du gezielt lernen kannst, nicht blind."
          : "Detailed analytics by specialty, difficulty, and time. The Study Radar shows your strengths and weaknesses at a glance — so you study with purpose, not blindly.",
      gradient: "from-[#003A8C]/5 to-[#003A8C]/10",
      borderColor: "#003A8C",
    },
    {
      icon: <Moon className="w-7 h-7" />,
      color: "#6366F1",
      title:
        lang === "de"
          ? "Dark Mode — Lernen um 2 Uhr nachts ohne Augenbelastung"
          : "Dark Mode — Study at 2 AM Without Eye Strain",
      desc:
        lang === "de"
          ? "Ein vollständiges Dark-Mode-Design, das jede Seite abdeckt. Perfekt für Nachtschichten im Krankenhaus oder späte Lernsessions. Deine Augen werden es dir danken."
          : "A complete dark mode design covering every page. Perfect for hospital night shifts or late study sessions. Your eyes will thank you.",
      gradient: "from-[#6366F1]/5 to-[#6366F1]/10",
      borderColor: "#6366F1",
    },
    {
      icon: <Layers className="w-7 h-7" />,
      color: "#00A896",
      title:
        lang === "de"
          ? "Karteikarten — Spaced Repetition für medizinische Begriffe"
          : "Flashcards — Spaced Repetition for Medical Terminology",
      desc:
        lang === "de"
          ? "3D-Karteikarten mit wissenschaftlich bewiesener Spaced-Repetition-Methode. Bewerte dein Wissen mit Again/Hard/Good/Easy und behalte medizinische Fachbegriffe langfristig."
          : "3D flashcards with scientifically proven spaced repetition. Rate your knowledge with Again/Hard/Good/Easy and retain medical terminology long-term.",
      gradient: "from-[#00A896]/5 to-[#00A896]/10",
      borderColor: "#00A896",
    },
    {
      icon: <Smartphone className="w-7 h-7" />,
      color: "#D64545",
      title:
        lang === "de"
          ? "Mobile PWA — Lerne im Bus, im Pausenraum, überall"
          : "Mobile PWA — Study on the Bus, in the Break Room, Anywhere",
      desc:
        lang === "de"
          ? "Als Progressive Web App installierbar auf jedem Gerät. Offline-Caching, responsives Design und schnelle Ladezeiten. Verwandle jede freie Minute in eine Lernsession."
          : "Installable as a Progressive Web App on any device. Offline caching, responsive design, and fast load times. Turn every spare minute into a study session.",
      gradient: "from-[#D64545]/5 to-[#D64545]/10",
      borderColor: "#D64545",
    },
  ];

  return (
    <section id="features" className="py-20 md:py-28 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[#007B5F]/10 rounded-full px-4 py-1.5 mb-6">
            <Zap className="w-4 h-4 text-[#007B5F]" />
            <span className="text-sm font-semibold text-[#007B5F]">
              {lang === "de" ? "Die Lösung" : "The Solution"}
            </span>
          </div>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-black text-[#001B3D] mb-4">
            {lang === "de"
              ? "Alles, was du brauchst — nichts, was du nicht brauchst"
              : "Everything You Need to Pass — Nothing You Don't"}
          </h2>
          <p className="text-[#A0AEC0] max-w-xl mx-auto text-lg">
            {lang === "de"
              ? "Fünf Werkzeuge, ein Ziel: deine Approbation."
              : "Five tools, one goal: your medical license."}
          </p>
        </div>

        <div className="space-y-16 md:space-y-24">
          {features.map((feat, i) => {
            const isEven = i % 2 === 0;
            return (
              <div
                key={i}
                className={`flex flex-col ${
                  isEven ? "md:flex-row" : "md:flex-row-reverse"
                } items-center gap-10 md:gap-16`}
              >
                {/* Text side */}
                <div className="flex-1 text-center md:text-left">
                  <div
                    className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5"
                    style={{
                      backgroundColor: `${feat.color}12`,
                      color: feat.color,
                    }}
                  >
                    {feat.icon}
                  </div>
                  <h3 className="text-xl md:text-2xl font-bold text-[#001B3D] mb-3 leading-snug">
                    {feat.title}
                  </h3>
                  <p className="text-[#4A5568] leading-relaxed text-base">
                    {feat.desc}
                  </p>
                </div>

                {/* Screenshot placeholder */}
                <div className="flex-1 w-full max-w-lg">
                  <div
                    className={`rounded-2xl aspect-[16/10] bg-gradient-to-br ${feat.gradient} border flex items-center justify-center overflow-hidden`}
                    style={{ borderColor: `${feat.color}20` }}
                  >
                    <div className="text-center p-8" style={{ color: `${feat.color}40` }}>
                      <div
                        className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                        style={{ backgroundColor: `${feat.color}10` }}
                      >
                        {feat.icon}
                      </div>
                      <p className="text-xs font-mono opacity-60">
                        {lang === "de" ? "Screenshot folgt" : "Screenshot coming"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 4: STATS
   ═══════════════════════════════════════════════ */
function StatsSection({ lang }: { lang: Lang }) {
  const { ref, inView } = useInView(0.4);

  const q = useCountUp(7725, 2000, inView);
  const sp = useCountUp(10, 1200, inView);
  const ex = useCountUp(250, 1500, inView);
  const sat = useCountUp(95, 1800, inView);

  const stats = [
    {
      value: q.toLocaleString(lang === "de" ? "de-DE" : "en-US") + "+",
      label: lang === "de" ? "Prüfungsfragen" : "Questions",
      color: "#00A896",
    },
    {
      value: String(sp),
      label: lang === "de" ? "Fachgebiete" : "Specialties",
      color: "#007B5F",
    },
    {
      value: String(ex),
      label: lang === "de" ? "Fragen pro Prüfung" : "Exam Simulation",
      color: "#003A8C",
    },
    {
      value: sat + "%",
      label: lang === "de" ? "Zufriedenheit" : "User Satisfaction",
      color: "#F4A261",
    },
  ];

  return (
    <section className="py-20 md:py-28 bg-[#001B3D] relative overflow-hidden" ref={ref}>
      {/* Subtle pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-black text-white mb-4">
            {lang === "de"
              ? "Die Zahlen sprechen für sich"
              : "The Numbers Speak for Themselves"}
          </h2>
          <p className="text-white/50 max-w-lg mx-auto">
            {lang === "de"
              ? "Die umfangreichste Kenntnisprüfungs-Plattform im deutschsprachigen Raum."
              : "The most comprehensive Kenntnisprüfung platform in the German-speaking world."}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {stats.map((stat, i) => (
            <div key={i} className="text-center">
              <div
                className="font-display text-4xl md:text-5xl font-black mb-2 tabular-nums"
                style={{ color: stat.color }}
              >
                {stat.value}
              </div>
              <p className="text-white/50 text-sm font-medium uppercase tracking-wider">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 5: TESTIMONIALS
   ═══════════════════════════════════════════════ */
function TestimonialsSection({ lang }: { lang: Lang }) {
  const { ref, inView } = useInView(0.2);
  const testimonials = [
    {
      name: "Dr. Ahmad K.",
      specialty: lang === "de" ? "Innere Medizin" : "Internal Medicine",
      location: lang === "de" ? "Wien, Österreich" : "Vienna, Austria",
      color: "#007B5F",
      quote:
        lang === "de"
          ? "MedPrüf hat mir geholfen, die Prüfung beim ersten Versuch zu bestehen. Die Fragen waren genau wie in der echten Prüfung. Besonders die Leistungsanalyse hat mir gezeigt, wo ich noch lernen muss."
          : "MedPrüf helped me pass the exam on my first attempt. The questions were exactly like the real exam. The performance analytics especially showed me where I still needed to study.",
    },
    {
      name: "Dr. Fatima M.",
      specialty: lang === "de" ? "Chirurgische Fächer" : "Surgical Specialties",
      location: lang === "de" ? "Graz, Österreich" : "Graz, Austria",
      color: "#003A8C",
      quote:
        lang === "de"
          ? "Die Leistungsanalyse hat mir gezeigt, wo meine Schwächen waren. So konnte ich gezielt lernen statt blind. Die Karteikarten-Funktion war perfekt für die Fachbegriffe."
          : "The performance analytics showed me my weak areas. I could study with purpose instead of blindly. The flashcard feature was perfect for medical terminology.",
    },
    {
      name: "Dr. [name] B.",
      specialty: lang === "de" ? "Neurologie" : "Neurology",
      location: lang === "de" ? "Linz, Österreich" : "Linz, Austria",
      color: "#00A896",
      quote:
        lang === "de"
          ? "Endlich eine Plattform, die speziell für die Wiener Kenntnisprüfung gemacht ist. Die 250-Fragen-Simulation hat mich perfekt auf die echte Prüfung vorbereitet. Absolut empfehlenswert."
          : "Finally a platform built specifically for the Vienna Kenntnisprüfung. The 250-question simulation prepared me perfectly for the real exam. Absolutely recommended.",
    },
  ];

  return (
    <section id="testimonials" className="py-20 md:py-28 bg-[#F7F9FC]" ref={ref}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[#F4A261]/10 rounded-full px-4 py-1.5 mb-6">
            <Quote className="w-4 h-4 text-[#F4A261]" />
            <span className="text-sm font-semibold text-[#F4A261]">
              {lang === "de" ? "Erfahrungen" : "Testimonials"}
            </span>
          </div>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-black text-[#001B3D] mb-4">
            {lang === "de"
              ? "Ärzte, die bestanden haben — in ihren eigenen Worten"
              : "Doctors Who Passed — In Their Own Words"}
          </h2>
          <p className="text-[#A0AEC0] max-w-xl mx-auto text-lg">
            {lang === "de"
              ? "Echte Erfahrungen von Ärzten, die ihre Kenntnisprüfung bestanden haben."
              : "Real experiences from doctors who passed their Kenntnisprüfung."}
          </p>
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${inView ? "stagger" : ""}`}>
          {testimonials.map((test, i) => (
            <div
              key={i}
              className="card rounded-2xl p-8 flex flex-col hover:shadow-xl transition-shadow duration-300"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className="w-4.5 h-4.5 text-[#F4A261] fill-[#F4A261]"
                  />
                ))}
              </div>

              {/* Quote */}
              <p className="text-[#4A5568] leading-relaxed flex-1 mb-6 italic">
                &ldquo;{test.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3 pt-5 border-t border-[#E4E9F0]">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md"
                  style={{ backgroundColor: test.color }}
                >
                  {test.name.charAt(4)}
                </div>
                <div>
                  <p className="font-semibold text-[#001B3D] text-sm">
                    {test.name}
                  </p>
                  <p className="text-xs text-[#A0AEC0]">
                    {test.specialty} · {test.location}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 6: PRICING
   ═══════════════════════════════════════════════ */
function PricingSection({ lang }: { lang: Lang }) {
  const { ref, inView } = useInView(0.2);
  const tiers = [
    {
      name: lang === "de" ? "Kostenlos" : "Free",
      price: "0",
      period: "EUR",
      desc:
        lang === "de"
          ? "Die meisten Funktionen kostenlos — für immer"
          : "Most features free — forever",
      features: [
        lang === "de" ? "Alle 7.725+ Fragen" : "All 7,725+ questions",
        lang === "de" ? "Quiz & Prüfungssimulation" : "Quiz & exam simulation",
        lang === "de" ? "Grundlegende Statistiken" : "Basic analytics",
        lang === "de" ? "Dark Mode + Karteikarten" : "Dark mode + flashcards",
        lang === "de" ? "Curriculum-Übersicht" : "Curriculum overview",
      ],
      cta: lang === "de" ? "Kostenlos starten" : "Start Free",
      popular: false,
      color: "#A0AEC0",
      bgClass: "bg-white",
    },
    {
      name: "Pro",
      price: "19",
      period: lang === "de" ? "EUR/Monat" : "EUR/month",
      yearlyNote:
        lang === "de"
          ? "oder 149 EUR/Jahr (35% sparen)"
          : "or 149 EUR/year (save 35%)",
      desc:
        lang === "de"
          ? "Unbegrenzt + KI-Funktionen"
          : "Unlimited + AI features",
      features: [
        lang === "de" ? "Unbegrenzte Lesezeichen & Notizen" : "Unlimited bookmarks & notes",
        lang === "de" ? "Unbegrenzte Probeprüfungen" : "Unlimited mock exams",
        lang === "de" ? "KI-Lernempfehlungen" : "AI study recommendations",
        lang === "de" ? "Erweiterte Leistungsanalyse" : "Advanced performance analytics",
        lang === "de" ? "Prioritäts-Support" : "Priority support",
        lang === "de" ? "Peer-Vergleich (Perzentile)" : "Peer comparison (percentile)",
      ],
      cta: lang === "de" ? "Pro starten" : "Start Pro",
      popular: true,
      color: "#007B5F",
      bgClass: "bg-white",
    },
    {
      name: lang === "de" ? "Gruppe" : "Group",
      price: lang === "de" ? "Individuell" : "Custom",
      period: "",
      desc:
        lang === "de"
          ? "Für Krankenhäuser und Lerngruppen"
          : "For hospitals and study groups",
      features: [
        lang === "de" ? "Alles aus Pro" : "Everything in Pro",
        lang === "de" ? "Gruppen-Dashboard" : "Group dashboard",
        lang === "de" ? "Admin-Verwaltung" : "Admin management",
        lang === "de" ? "Volumen-Rabatt" : "Volume discount",
        lang === "de" ? "Dedizierter Support" : "Dedicated support",
      ],
      cta: lang === "de" ? "Kontaktiere uns" : "Contact Us",
      popular: false,
      color: "#003A8C",
      bgClass: "bg-white",
    },
  ];

  return (
    <section id="pricing" className="py-20 md:py-28 bg-white" ref={ref}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[#003A8C]/10 rounded-full px-4 py-1.5 mb-6">
            <Shield className="w-4 h-4 text-[#003A8C]" />
            <span className="text-sm font-semibold text-[#003A8C]">
              {lang === "de" ? "Preise" : "Pricing"}
            </span>
          </div>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-black text-[#001B3D] mb-4">
            {lang === "de"
              ? "Investiere in deine Karriere — jederzeit kündbar"
              : "Invest in Your Career — Cancel Anytime"}
          </h2>
          <p className="text-[#A0AEC0] max-w-xl mx-auto text-lg">
            {lang === "de"
              ? "Transparente Preise, keine versteckten Kosten."
              : "Transparent pricing, no hidden fees."}
          </p>
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 items-start ${inView ? "stagger" : ""}`}>
          {tiers.map((tier, i) => (
            <div
              key={i}
              className={`card rounded-2xl p-8 relative flex flex-col ${tier.bgClass} ${
                tier.popular
                  ? "ring-2 ring-[#007B5F] shadow-xl md:scale-[1.04]"
                  : "hover:shadow-lg"
              } transition-all duration-300`}
            >
              {tier.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#007B5F] text-white text-xs font-bold px-5 py-1.5 rounded-full shadow-md">
                  {lang === "de" ? "Am beliebtesten" : "Most Popular"}
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-bold text-[#001B3D] mb-3">
                  {tier.name}
                </h3>
                <div className="flex items-baseline gap-1">
                  <span
                    className="font-display text-4xl font-black"
                    style={{ color: tier.color }}
                  >
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className="text-[#A0AEC0] text-sm ml-1">
                      {tier.period}
                    </span>
                  )}
                </div>
                {"yearlyNote" in tier && tier.yearlyNote && (
                  <p className="text-xs text-[#007B5F] font-medium mt-1">
                    {tier.yearlyNote}
                  </p>
                )}
                <p className="text-sm text-[#A0AEC0] mt-2">{tier.desc}</p>
              </div>

              <ul className="space-y-3 flex-1 mb-8">
                {tier.features.map((feat, j) => (
                  <li
                    key={j}
                    className="flex items-start gap-2.5 text-sm text-[#4A5568]"
                  >
                    <CheckCircle className="w-4.5 h-4.5 text-[#00A896] flex-shrink-0 mt-0.5" />
                    {feat}
                  </li>
                ))}
              </ul>

              <Link
                href="/"
                className={`text-center py-3.5 rounded-xl font-semibold text-sm transition-all ${
                  tier.popular
                    ? "bg-[#007B5F] text-white hover:bg-[#005A45] shadow-md"
                    : "bg-[#F7F9FC] text-[#001B3D] border border-[#E4E9F0] hover:bg-[#E4E9F0]"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Money-back guarantee */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-3 bg-[#007B5F]/5 rounded-full px-6 py-3 border border-[#007B5F]/10">
            <Shield className="w-5 h-5 text-[#007B5F]" />
            <span className="text-sm text-[#007B5F] font-medium">
              {lang === "de"
                ? "7 Tage volle Rückerstattung — keine Fragen"
                : "7-day full refund — no questions asked"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   SECTION 7: FINAL CTA
   ═══════════════════════════════════════════════ */
function FinalCTASection({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 md:py-28 bg-[#007B5F] relative overflow-hidden">
      {/* Decorative glow */}
      <div className="absolute top-[-100px] right-[-50px] w-[400px] h-[400px] rounded-full bg-[#00A896]/20 blur-[100px]" />
      <div className="absolute bottom-[-80px] left-[-40px] w-[300px] h-[300px] rounded-full bg-[#005A45]/30 blur-[80px]" />

      <div className="relative max-w-3xl mx-auto px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-8">
          <GraduationCap className="w-8 h-8 text-white/80" />
        </div>

        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-black text-white mb-6 leading-tight">
          {lang === "de"
            ? "Deine Prüfung wartet nicht — Fang heute an"
            : "Your Exam Won't Wait — Start Today"}
        </h2>

        <p className="text-white/70 mb-10 max-w-xl mx-auto text-lg leading-relaxed">
          {lang === "de"
            ? "Schliesse dich 2.400+ Ärzten an, die ihre Kenntnisprüfung mit MedPrüf vorbereiten. Jeder Tag zählt."
            : "Join 2,400+ doctors preparing for their Kenntnisprüfung with MedPrüf. Every day counts."}
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-3 bg-white text-[#007B5F] font-bold text-lg px-10 py-4 rounded-xl hover:bg-white/90 transition-all shadow-lg shadow-black/10 hover:shadow-xl hover:scale-[1.02]"
        >
          {lang === "de" ? "Kostenlos starten" : "Start Free"}
          <ArrowRight className="w-5 h-5" />
        </Link>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-white/50 text-sm">
          <span className="flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            {lang === "de" ? "Keine Kreditkarte" : "No credit card"}
          </span>
          <span className="text-white/20">·</span>
          <span className="flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            {lang === "de" ? "Jederzeit kündbar" : "Cancel anytime"}
          </span>
          <span className="text-white/20">·</span>
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            {lang === "de" ? "DSGVO-konform" : "GDPR compliant"}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════
   FOOTER
   ═══════════════════════════════════════════════ */
function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="bg-[#001B3D] text-white/50 pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          {/* Brand column */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <Image
                src="/brand/logo-mark.png"
                alt="MedPrüf"
                width={28}
                height={28}
                className="rounded-lg brightness-0 invert"
              />
              <span className="text-lg font-bold text-white">
                Med<span className="text-[#00A896]">Prüf</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed mb-4">
              {lang === "de"
                ? "Dein Weg zur österreichischen Approbation. Die umfangreichste Plattform für die Wiener Kenntnisprüfung."
                : "Your path to Austrian medical licensure. The most comprehensive platform for the Vienna Kenntnisprüfung."}
            </p>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">
              {lang === "de" ? "Plattform" : "Platform"}
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/" className="hover:text-white transition-colors">
                  {lang === "de" ? "Fragen-Bank" : "Question Bank"}
                </Link>
              </li>
              <li>
                <Link href="/exam" className="hover:text-white transition-colors">
                  {lang === "de" ? "Probeprüfung" : "Mock Exam"}
                </Link>
              </li>
              <li>
                <Link href="/flashcards" className="hover:text-white transition-colors">
                  {lang === "de" ? "Karteikarten" : "Flashcards"}
                </Link>
              </li>
              <li>
                <Link href="/progress" className="hover:text-white transition-colors">
                  {lang === "de" ? "Fortschritt" : "Progress"}
                </Link>
              </li>
              <li>
                <Link href="/curriculum" className="hover:text-white transition-colors">
                  {lang === "de" ? "Curriculum" : "Curriculum"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">
              {lang === "de" ? "Rechtliches" : "Legal"}
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  {lang === "de" ? "Über uns" : "About"}
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  {lang === "de" ? "Datenschutz" : "Privacy Policy"}
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  {lang === "de" ? "Impressum" : "Imprint"}
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  {lang === "de" ? "AGB" : "Terms of Service"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">
              {lang === "de" ? "Kontakt" : "Contact"}
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#00A896]" />
                <a
                  href="mailto:user-91aef9e3@example.com"
                  className="hover:text-white transition-colors"
                >
                  user-91aef9e3@example.com
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#00A896]" />
                <span>
                  {lang === "de"
                    ? "Telegram-Community"
                    : "Telegram Community"}
                </span>
              </li>
            </ul>

            {/* Social placeholder */}
            <div className="flex items-center gap-3 mt-5">
              {["T", "L", "I"].map((letter, i) => (
                <div
                  key={i}
                  className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40 text-xs font-mono hover:bg-white/10 hover:text-white/60 transition-all cursor-pointer"
                >
                  {letter}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/30 text-center sm:text-left">
            &copy; {new Date().getFullYear()} MedPrüf.{" "}
            {lang === "de"
              ? "Nicht affiliiert mit einer Ärztekammer. Alle Angaben ohne Gewähr."
              : "Not affiliated with any Ärztekammer. All information without warranty."}
          </p>
          <div className="flex items-center gap-2 text-xs text-white/40 flex-shrink-0">
            <Shield className="w-4 h-4" />
            <span>
              {lang === "de"
                ? "DSGVO-konform · Daten in der EU gehostet"
                : "GDPR Compliant · Data hosted in EU"}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════ */
export default function LandingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [showNav, setShowNav] = useState(false);

  useEffect(() => {
    setLangState(getLang());
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setShowNav(window.scrollY > window.innerHeight * 0.85);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <FloatingNav lang={lang} visible={showNav} onLangChange={switchLang} />
      <HeroSection lang={lang} onLangChange={switchLang} />
      <ProblemSection lang={lang} />
      <FeaturesSection lang={lang} />
      <StatsSection lang={lang} />
      <TestimonialsSection lang={lang} />
      <PricingSection lang={lang} />
      <FinalCTASection lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}
