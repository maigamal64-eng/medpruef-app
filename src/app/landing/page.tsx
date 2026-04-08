"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import {
  BookOpen,
  Languages,
  FileQuestion,
  BarChart3,
  Smartphone,
  Brain,
  Star,
  CheckCircle,
  Users,
  GraduationCap,
  ArrowRight,
  Stethoscope,
  Globe,
  Zap,
  Shield,
} from "lucide-react";

type Lang = "de" | "en";

/* ─── Section: Hero ─── */
function HeroSection({ lang }: { lang: Lang }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#001B3D] to-[#003A8C] text-white">
      {/* Decorative circles */}
      <div className="absolute top-[-120px] right-[-80px] w-[400px] h-[400px] rounded-full bg-[#007B5F]/10 blur-3xl" />
      <div className="absolute bottom-[-100px] left-[-60px] w-[300px] h-[300px] rounded-full bg-[#00A896]/10 blur-3xl" />

      <div className="relative max-w-6xl mx-auto px-6 py-20 md:py-32 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-1.5 mb-8 border border-white/10">
          <Stethoscope className="w-4 h-4 text-[#00A896]" />
          <span className="text-sm text-white/90 font-medium">
            {lang === "de" ? "Kenntnisprüfung Wien" : "Kenntnisprüfung Vienna"}
          </span>
        </div>

        <h1 className="text-3xl md:text-5xl lg:text-6xl font-black leading-tight mb-6 tracking-tight">
          {t("landing_hero_title", lang)}
          <br />
          <span className="text-[#00A896]">
            {lang === "de" ? "mit Sicherheit bestehen" : "with confidence"}
          </span>
        </h1>

        <p className="text-lg md:text-xl text-white/70 max-w-2xl mx-auto mb-10 leading-relaxed">
          {t("landing_hero_subtitle", lang)}
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-[#00A896] hover:bg-[#008F80] text-white font-bold text-lg px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-xl hover:scale-[1.02]"
          >
            {t("landing_cta", lang)} <ArrowRight className="w-5 h-5" />
          </Link>
          <span className="text-sm text-white/50">{t("landing_cta_sub", lang)}</span>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
          {[
            { icon: <BookOpen className="w-4 h-4" />, text: t("landing_questions_badge", lang) },
            { icon: <CheckCircle className="w-4 h-4" />, text: t("landing_updated_badge", lang) },
            { icon: <GraduationCap className="w-4 h-4" />, text: t("landing_specialties_badge", lang) },
          ].map((badge, i) => (
            <div key={i} className="flex items-center gap-2 text-white/60 text-sm">
              <span className="text-[#00A896]">{badge.icon}</span>
              {badge.text}
            </div>
          ))}
        </div>

        {/* Social proof */}
        <div className="mt-8 flex items-center justify-center gap-2">
          <div className="flex -space-x-2">
            {["#D64545", "#007B5F", "#003A8C", "#F4A261"].map((color, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-full border-2 border-[#001B3D] flex items-center justify-center text-white text-[10px] font-bold"
                style={{ backgroundColor: color }}
              >
                {String.fromCharCode(65 + i)}
              </div>
            ))}
          </div>
          <span className="text-sm text-white/50 ml-2">{t("landing_social_proof", lang)}</span>
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Problem ─── */
function ProblemSection({ lang }: { lang: Lang }) {
  const painPoints = [
    {
      icon: <Languages className="w-6 h-6" />,
      title: t("landing_problem_1", lang),
      desc:
        lang === "de"
          ? "Medizinische Fachliteratur auf Deutsch zu verstehen, wenn Deutsch nicht deine Muttersprache ist"
          : "Understanding medical literature in German when it is not your native language",
    },
    {
      icon: <Globe className="w-6 h-6" />,
      title: t("landing_problem_2", lang),
      desc:
        lang === "de"
          ? "Lernmaterialien sind fragmentiert, veraltet und nicht auf die Prüfung abgestimmt"
          : "Study materials are fragmented, outdated, and not aligned to the exam",
    },
    {
      icon: <FileQuestion className="w-6 h-6" />,
      title: t("landing_problem_3", lang),
      desc:
        lang === "de"
          ? "Die Wiener Kenntnisprüfung hat ein eigenes Format, das du nirgendswo anders findest"
          : "The Vienna exam has a unique format you will not find practiced anywhere else",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-[#F7F9FC]">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-2xl md:text-4xl font-black text-[#1A2B3C] text-center mb-4">
          {t("landing_problem_title", lang)}
        </h2>
        <p className="text-center text-[#A0AEC0] mb-12 max-w-xl mx-auto">
          {lang === "de"
            ? "Der Weg zur Approbation in Österreich ist voller Herausforderungen."
            : "The path to medical licensure in Austria is full of challenges."}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger">
          {painPoints.map((point, i) => (
            <div key={i} className="card rounded-2xl p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#D64545]/10 flex items-center justify-center mx-auto mb-4 text-[#D64545]">
                {point.icon}
              </div>
              <h3 className="text-lg font-bold text-[#1A2B3C] mb-2">{point.title}</h3>
              <p className="text-sm text-[#A0AEC0] leading-relaxed">{point.desc}</p>
            </div>
          ))}
        </div>

        {/* Transition line */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-3 bg-[#007B5F]/10 rounded-full px-6 py-3">
            <Zap className="w-5 h-5 text-[#007B5F]" />
            <span className="text-[#007B5F] font-semibold">{t("landing_problem_transition", lang)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Features ─── */
function FeaturesSection({ lang }: { lang: Lang }) {
  const features = [
    {
      icon: <Languages className="w-7 h-7" />,
      title: t("landing_feature_arabic", lang),
      desc: t("landing_feature_arabic_desc", lang),
      color: "#003A8C",
      tag: t("landing_coming_soon_tag", lang),
    },
    {
      icon: <FileQuestion className="w-7 h-7" />,
      title: t("landing_feature_realistic", lang),
      desc: t("landing_feature_realistic_desc", lang),
      color: "#007B5F",
    },
    {
      icon: <BarChart3 className="w-7 h-7" />,
      title: t("landing_feature_analytics", lang),
      desc: t("landing_feature_analytics_desc", lang),
      color: "#00A896",
    },
    {
      icon: <Smartphone className="w-7 h-7" />,
      title: t("landing_feature_mobile", lang),
      desc: t("landing_feature_mobile_desc", lang),
      color: "#6366F1",
    },
    {
      icon: <Brain className="w-7 h-7" />,
      title: t("landing_feature_plan", lang),
      desc: t("landing_feature_plan_desc", lang),
      color: "#D64545",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-2xl md:text-4xl font-black text-[#1A2B3C] text-center mb-4">
          {t("landing_features_title", lang)}
        </h2>
        <p className="text-center text-[#A0AEC0] mb-14 max-w-xl mx-auto">
          {lang === "de"
            ? "Alles, was du brauchst, um die Prüfung zu bestehen"
            : "Everything you need to pass the exam"}
        </p>

        <div className="space-y-12">
          {features.map((feat, i) => {
            const isEven = i % 2 === 0;
            return (
              <div
                key={i}
                className={`flex flex-col ${isEven ? "md:flex-row" : "md:flex-row-reverse"} items-center gap-8 md:gap-12`}
              >
                {/* Text side */}
                <div className="flex-1 text-center md:text-left">
                  <div className="flex items-center gap-3 justify-center md:justify-start mb-3">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: `${feat.color}10`, color: feat.color }}
                    >
                      {feat.icon}
                    </div>
                    {feat.tag && (
                      <span className="text-xs font-semibold bg-[#F4A261]/10 text-[#F4A261] px-2.5 py-1 rounded-full">
                        {feat.tag}
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-[#1A2B3C] mb-2">{feat.title}</h3>
                  <p className="text-[#A0AEC0] leading-relaxed">{feat.desc}</p>
                </div>
                {/* Placeholder image side */}
                <div className="flex-1 w-full max-w-md">
                  <div
                    className="rounded-2xl aspect-[4/3] flex items-center justify-center"
                    style={{ backgroundColor: `${feat.color}08`, border: `1px dashed ${feat.color}30` }}
                  >
                    <div className="text-center" style={{ color: `${feat.color}60` }}>
                      {feat.icon}
                      <p className="text-xs mt-2 font-mono opacity-60">Screenshot</p>
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

/* ─── Section: Social Proof ─── */
function SocialProofSection({ lang }: { lang: Lang }) {
  const testimonials = [
    {
      name: "Dr. Ahmad K.",
      specialty: lang === "de" ? "Innere Medizin" : "Internal Medicine",
      quote:
        lang === "de"
          ? "MedPrüf hat mir geholfen, die Prüfung beim ersten Versuch zu bestehen. Die Fragen waren genau wie in der echten Prüfung."
          : "MedPrüf helped me pass the exam on my first attempt. The questions were exactly like the real exam.",
      avatar: "A",
    },
    {
      name: "Dr. Fatima M.",
      specialty: lang === "de" ? "Chirurgie" : "Surgery",
      quote:
        lang === "de"
          ? "Die Leistungsanalyse hat mir gezeigt, wo meine Schwächen waren. So konnte ich gezielt lernen."
          : "The performance analytics showed me my weak areas. I could study with purpose.",
      avatar: "F",
    },
    {
      name: "Dr. [name] B.",
      specialty: lang === "de" ? "Neurologie" : "Neurology",
      quote:
        lang === "de"
          ? "Endlich eine Plattform, die speziell für die Wiener Kenntnisprüfung gemacht ist."
          : "Finally a platform built specifically for the Vienna Kenntnisprüfung.",
      avatar: "Y",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-[#F7F9FC]">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-2xl md:text-4xl font-black text-[#1A2B3C] text-center mb-12">
          {t("landing_testimonials_title", lang)}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger">
          {testimonials.map((test, i) => (
            <div key={i} className="card rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#007B5F] flex items-center justify-center text-white font-bold text-sm">
                  {test.avatar}
                </div>
                <div>
                  <p className="font-semibold text-[#1A2B3C] text-sm">{test.name}</p>
                  <p className="text-xs text-[#A0AEC0]">{test.specialty}</p>
                </div>
              </div>
              <div className="flex gap-0.5 mb-3">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star key={s} className="w-4 h-4 text-[#F4A261] fill-[#F4A261]" />
                ))}
              </div>
              <p className="text-sm text-[#4A5568] leading-relaxed italic">&ldquo;{test.quote}&rdquo;</p>
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div className="mt-12 card rounded-2xl p-6">
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
            <div className="text-center">
              <span className="text-2xl md:text-3xl font-black font-mono text-[#007B5F]">92%</span>
              <p className="text-xs text-[#A0AEC0] mt-1">
                {lang === "de" ? "Bestehensquote" : "Pass rate"}
              </p>
            </div>
            <div className="w-px h-10 bg-[#E4E9F0]" />
            <div className="text-center">
              <span className="text-2xl md:text-3xl font-black font-mono text-[#003A8C]">2,400+</span>
              <p className="text-xs text-[#A0AEC0] mt-1">
                {lang === "de" ? "Ärzte registriert" : "Doctors registered"}
              </p>
            </div>
            <div className="w-px h-10 bg-[#E4E9F0]" />
            <div className="text-center">
              <span className="text-2xl md:text-3xl font-black font-mono text-[#00A896]">10</span>
              <p className="text-xs text-[#A0AEC0] mt-1">
                {lang === "de" ? "Fachgebiete" : "Specialties"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Pricing ─── */
function PricingSection({ lang }: { lang: Lang }) {
  const tiers = [
    {
      name: t("landing_pricing_free", lang),
      price: lang === "de" ? "0 EUR" : "0 EUR",
      desc: t("landing_pricing_free_desc", lang),
      features: [
        lang === "de" ? "50 Fragen pro Monat" : "50 questions per month",
        lang === "de" ? "Grundlegende Statistiken" : "Basic statistics",
        lang === "de" ? "1 Probeprüfung" : "1 mock exam",
      ],
      cta: t("landing_cta", lang),
      popular: false,
      color: "#A0AEC0",
    },
    {
      name: t("landing_pricing_pro", lang),
      price: lang === "de" ? "29 EUR/Mo" : "29 EUR/mo",
      desc: t("landing_pricing_pro_desc", lang),
      features: [
        lang === "de" ? "Alle 7.725 Fragen" : "All 7,725 questions",
        lang === "de" ? "Unbegrenzte Probeprüfungen" : "Unlimited mock exams",
        lang === "de" ? "Leistungsanalyse" : "Performance analytics",
        lang === "de" ? "Personalisierter Lernplan" : "Personalized study plan",
        lang === "de" ? "Prioritäts-Support" : "Priority support",
      ],
      cta: t("landing_cta", lang),
      popular: true,
      color: "#007B5F",
    },
    {
      name: t("landing_pricing_group", lang),
      price: lang === "de" ? "Individuell" : "Custom",
      desc: t("landing_pricing_group_desc", lang),
      features: [
        lang === "de" ? "Alles aus Pro" : "Everything in Pro",
        lang === "de" ? "Gruppen-Dashboard" : "Group dashboard",
        lang === "de" ? "Admin-Verwaltung" : "Admin management",
        lang === "de" ? "Volumen-Rabatt" : "Volume discount",
      ],
      cta: t("landing_pricing_group_desc", lang),
      popular: false,
      color: "#003A8C",
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-2xl md:text-4xl font-black text-[#1A2B3C] text-center mb-12">
          {t("landing_pricing_title", lang)}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger">
          {tiers.map((tier, i) => (
            <div
              key={i}
              className={`card rounded-2xl p-6 relative flex flex-col ${
                tier.popular ? "ring-2 ring-[#007B5F] scale-[1.02]" : ""
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#007B5F] text-white text-xs font-bold px-4 py-1 rounded-full">
                  {t("landing_pricing_popular", lang)}
                </div>
              )}
              <div className="text-center mb-6">
                <h3 className="text-lg font-bold text-[#1A2B3C] mb-1">{tier.name}</h3>
                <p className="text-3xl font-black font-mono" style={{ color: tier.color }}>
                  {tier.price}
                </p>
              </div>
              <ul className="space-y-3 flex-1 mb-6">
                {tier.features.map((feat, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm text-[#4A5568]">
                    <CheckCircle className="w-4 h-4 text-[#00A896] flex-shrink-0 mt-0.5" />
                    {feat}
                  </li>
                ))}
              </ul>
              <Link
                href="/"
                className={`text-center py-3 rounded-xl font-semibold text-sm transition-all ${
                  tier.popular
                    ? "bg-[#007B5F] text-white hover:bg-[#005A45]"
                    : "bg-[#F7F9FC] text-[#1A2B3C] border border-[#E4E9F0] hover:bg-[#E4E9F0]"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Final CTA ─── */
function FinalCTASection({ lang }: { lang: Lang }) {
  return (
    <section className="py-16 md:py-24 bg-[#007B5F]">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <Shield className="w-12 h-12 text-white/30 mx-auto mb-6" />
        <h2 className="text-2xl md:text-4xl font-black text-white mb-6 leading-tight">
          {t("landing_final_cta", lang)}
        </h2>
        <p className="text-white/70 mb-10 max-w-xl mx-auto">
          {lang === "de"
            ? "Schliesse dich 2.400+ Ärzten an, die ihre Kenntnisprüfung mit MedPrüf vorbereiten."
            : "Join 2,400+ doctors preparing for their Kenntnisprüfung with MedPrüf."}
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-3 bg-white text-[#007B5F] font-bold text-lg px-10 py-4 rounded-xl hover:bg-white/90 transition-all shadow-lg hover:shadow-xl hover:scale-[1.02]"
        >
          {t("landing_cta", lang)} <ArrowRight className="w-5 h-5" />
        </Link>
      </div>
    </section>
  );
}

/* ─── Footer ─── */
function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="bg-[#001B3D] text-white/50 py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo + tagline */}
          <div className="text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-2">
              <span className="text-lg font-bold text-white">
                Med<span className="text-[#00A896]">Prüf</span>
              </span>
            </div>
            <p className="text-sm">{t("landing_footer_tagline", lang)}</p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6 text-sm">
            <Link href="/about" className="hover:text-white transition-colors">
              {t("about", lang)}
            </Link>
            <Link href="/about" className="hover:text-white transition-colors">
              {t("privacy", lang)}
            </Link>
            <Link href="/about" className="hover:text-white transition-colors">
              {t("contact", lang)}
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-center sm:text-left text-xs text-white/30">
            {t("landing_footer_disclaimer", lang)}
          </p>
          <div className="flex items-center gap-2 text-xs text-white/40 flex-shrink-0">
            <Shield className="w-4 h-4" />
            GDPR Compliant · Data hosted in EU
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Main Page ─── */
export default function LandingPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Sticky mini nav for language toggle only */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageToggle lang={lang} onChange={switchLang} />
      </div>

      <HeroSection lang={lang} />
      <ProblemSection lang={lang} />
      <FeaturesSection lang={lang} />
      <SocialProofSection lang={lang} />
      <PricingSection lang={lang} />
      <FinalCTASection lang={lang} />
      <Footer lang={lang} />
    </div>
  );
}
