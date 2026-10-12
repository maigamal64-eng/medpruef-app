"use client";

import { useEffect, useState, useCallback } from "react";
import { getLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";
import {
  FileText,
  GraduationCap,
  BarChart3,
  Flame,
  Globe,
  Smartphone,
  Send,
  Check,
} from "lucide-react";

type Lang = "de" | "en";

export default function AboutPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
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
          ? "Deine Lernplattform für österreichische Ärzteprüfungen."
          : "Your learning platform for Austrian medical exams."
      }
      lastUpdated={lang === "de" ? "25. September 2026" : "25 September 2026"}
      backHref="/"
    >
      {/* Brand marks */}
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
      </div>

      <section>
        <h2>{lang === "de" ? "Was ist MedPrüf?" : "What is MedPrüf?"}</h2>
        <p>
          {lang === "de"
            ? "MedPrüf ist eine Lernplattform für Ärztinnen und Ärzte, die sich auf österreichische Prüfungswege vorbereiten: Kenntnisprüfung, Stichprobentest und Pharmakologie. Die Plattform bietet über 10.000 kuratierte Übungsfragen. Die Fragebanken sind Lernmaterial und bilden das jeweilige Prüfungsformat nicht in jedem Fall ab."
            : "MedPrüf is a learning platform for doctors preparing for Austrian exam pathways: the Kenntnisprüfung, Stichprobentest and Pharmakologie. The platform offers over 10,000 curated practice questions. The question banks are study materials and do not necessarily reproduce each exam's format."}
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Für wen ist MedPrüf?" : "Who is MedPrüf for?"}</h2>
        <ul className="!list-none !pl-0">
          {(lang === "de"
            ? [
                "Ärztinnen und Ärzte mit ausländischem Abschluss",
                "Approbationssuchende in Österreich (Wien)",
                "Mediziner, die mit der Wiener Fragenbank üben möchten",
                "Alle, die ihr medizinisches Wissen auffrischen möchten",
              ]
            : [
                "Doctors with foreign medical degrees",
                "Those seeking medical licensure (Approbation) in Austria (Vienna)",
                "Physicians who want to practice with the Vienna bank",
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
        <h2>{lang === "de" ? "Die Wiener Fragenbank" : "The Vienna practice bank"}</h2>
        <p>
          {lang === "de"
            ? "Die Fragenbank mit dem Namen Kenntnisprüfung Wien basiert auf SIP4a/SIP5a-Lernmaterial. Sie ist nicht die postgraduale Arztprüfung Allgemeinmedizin der Österreichischen Ärztekammer. MedPrüf bietet kuratierte Multiple-Choice-Übungen und aktives Erinnern, keine vollständige Nachbildung einer offiziellen Prüfung."
            : "The bank named Kenntnisprüfung Vienna is based on SIP4a/SIP5a study material. It is distinct from the Austrian Medical Chamber's postgraduate Allgemeinmedizin examination. MedPrüf offers curated multiple-choice practice and active recall, not a complete reproduction of an official examination."}
        </p>
        <p>
          {lang === "de"
            ? "Welche Prüfungen du ablegen musst, welche Formate gelten und wann du dich anmelden kannst, klärst du mit deiner Universität anhand deines Bescheids."
            : "Confirm your required examinations, formats and registration dates with your university and your individual decision."}{" "}
          <a href="https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/" target="_blank" rel="noopener noreferrer">
            {lang === "de" ? "Informationen der MedUni Wien" : "MedUni Vienna information"}
          </a>
        </p>
      </section>

      <section>
        <h2>{lang === "de" ? "Features" : "Features"}</h2>
        <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {[
            {
              icon: <FileText className="w-4 h-4 text-white" />,
              label:
                lang === "de"
                  ? "10.000+ kuratierte Übungsfragen"
                  : "10,000+ curated practice questions",
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

    </DocLayout>
  );
}
