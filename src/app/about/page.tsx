"use client";

import { useEffect, useState, useCallback } from "react";
import { getLang } from "@/lib/i18n";
import DocLayout from "@/components/DocLayout";
import {
  FileText,
  GraduationCap,
  BarChart3,
  Repeat,
  Globe,
  Flag,
  Mail,
  Send,
  Check,
} from "lucide-react";
import { COMPANY, CONTACT, EXAM_SIMULATION_HOURS } from "@/lib/content-truth";
import { SUPPORT_REPLY_PROMISE } from "@/lib/billing-copy";
import { claimText } from "@/lib/learning-claims";
import { getExamLabel } from "@/lib/master-locale/exam-label";

type Lang = "de" | "en";

export default function AboutPage() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = useCallback((l: Lang) => {
    setLangState(l);
  }, []);

  const banks = (["kenntnispruefung", "kmp_innsbruck", "pharma"] as const).map((k) => getExamLabel(k, "full", lang));
  const C = {
    kicker: { de: "Über MedPrüf", en: "About MedPrüf" },
    compact: { de: "Über", en: "About" },
    lede: {
      de: "Übungsplattform für österreichische Prüfungen auf dem Weg zur Nostrifizierung und Anerkennung.",
      en: "A practice platform for Austrian exams on the way to nostrification (Nostrifizierung) and recognition (Anerkennung).",
    },
    updated: { de: "12. Oktober 2026", en: "12 October 2026" }, // date-ok: page revision stamp, not an exam date
    whatTitle: { de: "Was ist MedPrüf?", en: "What is MedPrüf?" },
    what: {
      de: `MedPrüf ist eine Übungsplattform für Ärztinnen und Ärzte, die sich auf österreichische Prüfungen vorbereiten. Es gibt drei Fragenbanken: ${banks[0]}, ${banks[1]} und ${banks[2]}, mit über 10.000 kuratierten Übungsfragen. Die Fragenbanken sind Lernmaterial und bilden das jeweilige Prüfungsformat nicht in jedem Fall ab.`,
      en: `MedPrüf is a practice platform for doctors preparing for Austrian exams. There are three question banks: ${banks[0]}, ${banks[1]} and ${banks[2]}, with over 10,000 curated practice questions. The question banks are study material and do not necessarily reproduce each exam's format.`,
    },
    forTitle: { de: "Für wen ist MedPrüf?", en: "Who is MedPrüf for?" },
    forList: {
      de: [
        "Ärztinnen und Ärzte mit ausländischem Abschluss",
        "Ärztinnen und Ärzte in der Nostrifizierung oder Anerkennung in Österreich",
        "Ärztinnen und Ärzte, die mit der Wiener Fragenbank üben möchten",
        "Alle, die ihr medizinisches Wissen auffrischen möchten",
      ],
      en: [
        "Doctors with foreign medical degrees",
        "Doctors going through nostrification (Nostrifizierung) or recognition (Anerkennung) in Austria",
        "Doctors who want to practise with the Vienna bank",
        "Anyone looking to refresh their medical knowledge",
      ],
    },
    viennaTitle: { de: "Die Wiener Fragenbank", en: "The Vienna practice bank" },
    vienna: {
      de: `Die Fragenbank ${banks[0]} basiert auf SIP4a/SIP5a-Lernmaterial. Sie ist nicht die postgraduale Arztprüfung Allgemeinmedizin der Österreichischen Ärztekammer. MedPrüf bietet kuratierte Multiple-Choice-Übungen und aktives Erinnern, keine vollständige Nachbildung einer offiziellen Prüfung.`,
      en: `The ${banks[0]} bank is based on SIP4a/SIP5a study material. It is distinct from the Austrian Medical Chamber's postgraduate Allgemeinmedizin examination. MedPrüf offers curated multiple-choice practice and active recall, not a complete reproduction of an official examination.`,
    },
    confirm: {
      de: "Welche Prüfungen Sie ablegen müssen, welche Formate gelten und wann Sie sich anmelden können, klären Sie mit Ihrer Universität anhand Ihres Bescheids.",
      en: "Confirm your required examinations, formats and registration dates with your university and your individual decision.",
    },
    meduni: { de: "Informationen der MedUni Wien", en: "MedUni Vienna information" },
    outcomesTitle: { de: "Was Sie mit MedPrüf erreichen", en: "What MedPrüf helps you do" },
    contactTitle: { de: "Kontakt", en: "Contact" },
  } as const;
  const L = lang;
  const outcomes = [
    {
      icon: <FileText className="w-4 h-4 text-white" />,
      label: { de: "Den Prüfungsstoff mit über 10.000 kuratierten Übungsfragen durcharbeiten", en: "Work through the material with over 10,000 curated practice questions" },
    },
    {
      icon: <GraduationCap className="w-4 h-4 text-white" />,
      label: { de: `Prüfungsausdauer trainieren: Simulation über ${EXAM_SIMULATION_HOURS} Stunden mit Bewertung am Ende`, en: `Build exam stamina: a ${EXAM_SIMULATION_HOURS}-hour simulation graded at the end` },
    },
    {
      icon: <BarChart3 className="w-4 h-4 text-white" />,
      label: { de: "Schwache Fachgebiete erkennen und gezielt üben", en: "Spot weak subjects and practise them on purpose" },
    },
    {
      icon: <Repeat className="w-4 h-4 text-white" />,
      label: { de: "Falsch beantwortete Fragen wiederholen, bis sie sitzen", en: "Repeat the questions you got wrong until they stick" },
    },
    {
      icon: <Globe className="w-4 h-4 text-white" />,
      label: claimText("pricing.ai-explanations"),
    },
    {
      icon: <Flag className="w-4 h-4 text-white" />,
      label: { de: "Fehler in einer Frage direkt in der App melden", en: "Report an error in a question directly in the app" },
    },
  ];

  return (
    <DocLayout
      lang={lang}
      onLangChange={switchLang}
      kicker={C.kicker[L]}
      title={C.kicker[L]}
      compactTitle={C.compact[L]}
      lede={C.lede[L]}
      lastUpdated={C.updated[L]}
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
        <h2>{C.whatTitle[L]}</h2>
        <p>{C.what[L]}</p>
      </section>

      <section>
        <h2>{C.forTitle[L]}</h2>
        <ul className="!list-none !pl-0">
          {C.forList[L].map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 !mb-2 text-[var(--mp-fg-muted)]"
            >
              <Check className="w-4 h-4 text-[var(--mp-viridian)] mt-0.5 flex-shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{C.viennaTitle[L]}</h2>
        <p>{C.vienna[L]}</p>
        <p>
          {C.confirm[L]}{" "}
          <a href="https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/" target="_blank" rel="noopener noreferrer">
            {C.meduni[L]}
          </a>
        </p>
      </section>

      <section>
        <h2>{C.outcomesTitle[L]}</h2>
        <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {outcomes.map((f) => (
            <div
              key={f.label.en}
              className="flex items-center gap-3 text-sm text-[var(--mp-fg-muted)]"
            >
              <div className="w-10 h-10 rounded-full bg-[var(--mp-viridian)] flex items-center justify-center flex-shrink-0">
                {f.icon}
              </div>
              <span>{f.label[L]}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{C.contactTitle[L]}</h2>
        <p>{COMPANY.statement[L]}</p>
        <p>{SUPPORT_REPLY_PROMISE[L]}</p>
        <div className="not-prose flex flex-wrap gap-2 mt-3">
          {[
            {
              icon: <Mail className="w-4 h-4" />,
              label: CONTACT.email,
              href: `mailto:${CONTACT.email}`,
              external: false,
            },
            {
              icon: <Send className="w-4 h-4" />,
              label: "Telegram",
              href: "https://t.me/MedPruefBot",
              external: true,
            },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex items-center gap-2 px-3 py-2 min-h-11 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded text-sm text-[var(--mp-fg-muted)] hover:border-[var(--mp-viridian)]/40 hover:text-[var(--mp-fg)] transition-colors"
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
