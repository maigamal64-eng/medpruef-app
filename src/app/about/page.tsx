"use client";

import { useEffect, useState, useCallback } from "react";
import { getLang, setLang } from "@/lib/i18n";
import { QUESTIONS } from "@/lib/content-truth";
import DocLayout from "@/components/DocLayout";
import {
  FileText,
  GraduationCap,
  BarChart3,
  Flame,
  Globe,
  Smartphone,
  Send,
  Share2,
  Camera,
  Check,
} from "lucide-react";

type Lang = "de" | "en";

export default function AboutPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  return (
    <DocLayout
      lang={lang}
      onLangChange={switchLang}
      kicker={lang === "de" ? "Über MedPrüf" : "About MedPrüf"}
      title={lang === "de" ? "Über MedPrüf" : "About MedPrüf"}
      compactTitle={lang === "de" ? "Über" : "About"}
      lede={
        lang === "de"
          ? "Deine Lernplattform für die österreichische Kenntnisprüfung."
          : "Your learning platform for the Austrian Kenntnisprüfung."
      }
      lastUpdated={lang === "de" ? "Juni 2026" : "June 2026"}
      backHref="/"
    >
      {/* Brand mark + seal — decorative, stays before the first TOC section */}
      <div className="flex flex-col items-center gap-4 py-2 mb-4 not-prose">
        <div className="w-20 h-20 rounded-2xl border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 flex items-center justify-center">
          <img
            src="/brand/logomark.svg"
            alt="MedPrüf"
            className="w-12 h-12"
          />
        </div>
        <img
          src="/brand/logo-full.png"
          alt="MedPrüf"
          className="h-10"
        />
        <img
          src="/brand/seal.png"
          alt="MedPrüf Official Seal"
          className="w-28 mt-2"
        />
      </div>

      <section>
        <h2>{lang === "de" ? "Was ist MedPrüf?" : "What is MedPrüf?"}</h2>
        <p>
          {lang === "de"
            ? `MedPrüf ist eine spezialisierte Lernplattform für ausländische Ärztinnen und Ärzte, die sich auf die österreichischen Ärzteprüfungen vorbereiten: Kenntnisprüfung Wien, Stichprobentest (Innsbruck) und Pharmakologie. Mit ${QUESTIONS.total.toLocaleString(
                "de-DE",
              )} Übungsfragen aus 16 Fachgebieten helfen wir dir, die Prüfung erfolgreich zu bestehen.`
            : `MedPrüf is a specialized learning platform for foreign doctors preparing for the Austrian medical exams: Kenntnisprüfung Wien, Stichprobentest (Innsbruck) and Pharmakologie. With ${QUESTIONS.total.toLocaleString(
                "en-US",
              )} practice questions across 16 specialties, we help you pass the exam successfully.`}
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Für wen ist MedPrüf?" : "Who is MedPrüf for?"}</h2>
        <ul className="!list-none !pl-0">
          {(lang === "de"
            ? [
                "Ärztinnen und Ärzte mit ausländischem Abschluss",
                "Approbationssuchende in Österreich (Wien)",
                "Mediziner, die die Kenntnisprüfung ablegen müssen",
                "Alle, die ihr medizinisches Wissen auffrischen möchten",
              ]
            : [
                "Doctors with foreign medical degrees",
                "Those seeking medical licensure (Approbation) in Austria (Vienna)",
                "Physicians required to take the Kenntnisprüfung",
                "Anyone looking to refresh their medical knowledge",
              ]
          ).map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2 !mb-2 text-[var(--mp-fg-muted)]"
            >
              <Check className="w-4 h-4 text-[var(--mp-viridian)] mt-0.5 flex-shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{lang === "de" ? "Die Kenntnisprüfung" : "The Kenntnisprüfung"}</h2>
        <p>
          {lang === "de"
            ? "Die Kenntnisprüfung ist eine staatliche Prüfung für Ärzte mit ausländischer Ausbildung. Sie prüft, ob die medizinischen Kenntnisse dem Stand der österreichischen Ärzteausbildungsordnung (ÄAO) entsprechen."
            : "The Kenntnisprüfung is a state examination for doctors with foreign training. It tests whether medical knowledge meets the standards of the Austrian Ärzteausbildungsordnung (ÄAO)."}
        </p>
        <div className="not-prose grid grid-cols-2 gap-3 mt-4">
          {[
            {
              label: lang === "de" ? "Fragen gesamt" : "Total questions",
              value: "250",
            },
            {
              label: lang === "de" ? "Bestehensschwelle" : "Pass threshold",
              value: "60%",
            },
            {
              label: lang === "de" ? "Prüfungsdauer" : "Exam duration",
              value: "4h",
            },
            {
              label: lang === "de" ? "Fachgebiete" : "Specialties",
              value: "10",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="mp-card p-4 text-center"
            >
              <p className="text-2xl font-black text-[var(--mp-viridian)] font-mono">
                {stat.value}
              </p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)] mt-1">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{lang === "de" ? "Features" : "Features"}</h2>
        <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {[
            {
              icon: <FileText className="w-4 h-4 text-white" />,
              label:
                lang === "de"
                  ? `${QUESTIONS.total.toLocaleString("de-DE")} Übungsfragen`
                  : `${QUESTIONS.total.toLocaleString("en-US")} Practice Questions`,
            },
            {
              icon: <GraduationCap className="w-4 h-4 text-white" />,
              label: lang === "de" ? "Prüfungssimulation" : "Exam Simulation",
            },
            {
              icon: <BarChart3 className="w-4 h-4 text-white" />,
              label:
                lang === "de" ? "Detaillierte Statistiken" : "Detailed Statistics",
            },
            {
              icon: <Flame className="w-4 h-4 text-white" />,
              label: lang === "de" ? "Gamification & XP" : "Gamification & XP",
            },
            {
              icon: <Globe className="w-4 h-4 text-white" />,
              label: lang === "de" ? "7 Sprachen" : "7 languages",
            },
            {
              icon: <Smartphone className="w-4 h-4 text-white" />,
              label: lang === "de" ? "Telegram Mini App" : "Telegram Mini App",
            },
          ].map((f) => (
            <div
              key={f.label}
              className="flex items-center gap-3 text-sm text-[var(--mp-fg-muted)]"
            >
              <div className="w-10 h-10 rounded-full bg-[var(--mp-viridian)] flex items-center justify-center flex-shrink-0">
                {f.icon}
              </div>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{lang === "de" ? "Team & Kontakt" : "Team & Contact"}</h2>
        <p>
          {lang === "de"
            ? "MedPrüf wird von einem engagierten Team entwickelt, das selbst Erfahrung mit der Approbation in Österreich hat. Wir wissen, wie herausfordernd dieser Prozess ist."
            : "MedPrüf is developed by a dedicated team with firsthand experience in Austrian medical licensure. We understand how challenging this process can be."}
        </p>
        <div className="not-prose flex flex-wrap gap-2 mt-3">
          {[
            {
              icon: <Send className="w-4 h-4" />,
              label: "Telegram",
              href: "https://t.me/MedPruefBot",
            },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded text-sm text-[var(--mp-fg-muted)] hover:border-[var(--mp-viridian)]/40 hover:text-[var(--mp-fg)] transition-colors"
            >
              {link.icon}
              <span>{link.label}</span>
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2>{lang === "de" ? "Social Media" : "Social Media"}</h2>
        <div className="not-prose flex flex-wrap gap-2 mt-2">
          {[
            {
              icon: <Smartphone className="w-4 h-4" />,
              label: "Telegram Bot",
              href: "#",
            },
            {
              icon: <Share2 className="w-4 h-4" />,
              label: "Twitter / X",
              href: "#",
            },
            {
              icon: <Camera className="w-4 h-4" />,
              label: "Instagram",
              href: "#",
            },
          ].map((s) => (
            <a
              key={s.label}
              href={s.href}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded text-sm text-[var(--mp-fg-subtle)] cursor-pointer"
            >
              {s.icon}
              <span>{s.label}</span>
              <span className="text-[9px] bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)] px-1 rounded border border-[var(--mp-status-warning)]/20">
                {lang === "de" ? "Bald" : "Soon"}
              </span>
            </a>
          ))}
        </div>
      </section>
    </DocLayout>
  );
}
