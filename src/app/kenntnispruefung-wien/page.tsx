import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /kenntnispruefung-wien — Vienna Kenntnisprüfung landing page.
 *
 * The question count is database-owned. The exam-format copy below must not
 * imply that the MCQ bank reproduces the official open-answer format.
 *
 * FAQ answers are fact-based from the Ärztekammer Wien site and
 * real exam cycles 2024-2026. Do not invent dates or fees — when a
 * number isn't independently verifiable, use a cautious phrasing
 * ("typically", "as of 2026") and link to the official source.
 */

const content: ExamLandingContent = {
  examName: {
    de: "Kenntnisprüfung Wien",
    en: "Vienna Kenntnisprüfung",
  },
  eyebrow: {
    de: "Österreich · Wien · Kenntnisprüfung",
    en: "Austria · Vienna · Kenntnisprüfung",
  },
  heroTitle: {
    de: "Bestehe die Kenntnisprüfung Wien beim ersten Versuch.",
    en: "Pass the Vienna Kenntnisprüfung on your first try.",
  },
  heroSubtitle: {
    de: "Strukturierte Wissensvorbereitung auf die österreichische Kenntnisprüfung Wien: 7.566 klinische MCQs mit Erklärungen. Die echte Prüfung arbeitet mit offenen Kurzantwortfragen, deshalb trainierst du hier Wissen und Fallverständnis, nicht eine vorgetäuschte 1:1-Prüfungssimulation.",
    en: "Structured knowledge preparation for the Austrian Kenntnisprüfung Vienna: 7,566 clinical MCQs with explanations. The real exam uses open short-answer questions, so this trains knowledge and case reasoning without pretending to reproduce the official exam format.",
  },
  primaryCtaHref: "/quiz?exam=kenntnispruefung&free=1",
  primaryCtaLabel: {
    de: "Free starten: 150 Kenntnisprüfung Fragen",
    en: "Start free: 150 Kenntnisprüfung questions",
  },
  secondaryCtaHref: "/pricing",
  secondaryCtaLabel: {
    de: "Alle Pläne ansehen",
    en: "See all plans",
  },
  breakdown: [
    {
      label: { de: "Fragen", en: "Questions" },
      value: "7,566",
      sub: {
        de: "Klinische MCQs · Mehrfachauswahl",
        en: "Clinical MCQs · multi-select",
      },
    },
    {
      label: { de: "Fachgebiete", en: "Specialties" },
      value: "10",
      sub: {
        de: "Breite klinische Wissensbank",
        en: "Broad clinical knowledge bank",
      },
    },
    {
      label: { de: "Sprachen", en: "Languages" },
      value: "7+",
      sub: {
        de: "DE primär · EN · AR · RU · FR · TR · UK",
        en: "DE primary · EN · AR · RU · FR · TR · UK",
      },
    },
    {
      label: { de: "Kostenlos", en: "Free tier" },
      value: "150",
      sub: {
        de: "Fragen ohne Kreditkarte",
        en: "Questions, no credit card",
      },
    },
  ],
  whatYouLearn: [
    {
      de: "Klinische Wissensbasis für die problemorientierten Fälle der Kenntnisprüfung: Innere Medizin, Chirurgie, Dermatologie und weitere klinische Fächer.",
      en: "Clinical knowledge for the problem-oriented cases of the Kenntnisprüfung: internal medicine, surgery, dermatology and other clinical fields.",
    },
    {
      de: "Problemorientierte Fallvorbereitung mit Neurologie, Psychiatrie, Gynäkologie, Pädiatrie, Augenheilkunde, HNO, Notfallmedizin und weiteren Themen.",
      en: "Problem-oriented case preparation across neurology, psychiatry, gynecology, pediatrics, ophthalmology, ENT, emergency medicine and more.",
    },
    {
      de: "MCQ-Training mit strikter Bewertung als Wissensbasis für die offenen Kurzantwortfragen der echten Prüfung.",
      en: "Strictly graded MCQ training as a knowledge base for the real exam's open short-answer questions.",
    },
    {
      de: "KI-Erklärungen zu Guidelines (ERC, ESC, ÖDG, Herold, Amboss): nicht nur „richtig/falsch\", sondern Warum.",
      en: "AI explanations citing guidelines (ERC, ESC, ÖDG, Herold, Amboss): not just right/wrong, but why.",
    },
    {
      de: "Spaced Repetition (SM-2), personalisierter Lernplan, Schwächen-Radar, damit du deine Zeit nicht auf Fächer verschwendest, die du bereits kannst.",
      en: "Spaced repetition (SM-2), personalized study plan, weakness radar, so you don't waste time on subjects you already know.",
    },
  ],
  faq: [
    {
      q: {
        de: "Wann ist die nächste Kenntnisprüfung Wien?",
        en: "When is the next Vienna Kenntnisprüfung?",
      },
      a: {
        de: "Der nächste in MedPrüfs Kalender geführte Termin ist der 28. September 2026 in Wien. Der Anmeldeschluss war der 28. Juli 2026. Termine und Fristen können sich ändern: prüfe die aktuelle Ausschreibung der Arztakademie.",
        en: "The next sitting listed in MedPrüf's calendar is 28 September 2026 in Vienna. The registration deadline was 28 July 2026. Dates and deadlines can change, so verify the current announcement from the Arztakademie.",
      },
    },
    {
      q: {
        de: "Wie ist die Struktur von SIP 4 vs SIP 5?",
        en: "How are SIP 4 and SIP 5 structured?",
      },
      a: {
        de: "Die Kenntnisprüfung ist problemorientiert und arbeitet mit Kurzantwortfragen: Fallvignetten enthalten mehrere offene Teilfragen, die du auf Deutsch aus dem Gedächtnis beantwortest. MedPrüf ergänzt diese Vorbereitung mit klinischen MCQs, Erklärungen und einem Lernplan, ersetzt aber nicht die offizielle Musterprüfung.",
        en: "The Kenntnisprüfung is problem-oriented and uses short-answer questions: case vignettes contain several open sub-questions answered from memory in German. MedPrüf complements that preparation with clinical MCQs, explanations and a study plan, but does not replace the official mock exam.",
      },
    },
    {
      q: {
        de: "Was kostet die Prüfungsgebühr?",
        en: "What is the exam fee?",
      },
      a: {
        de: "Die offizielle Gebühr der Kenntnisprüfung Wien beträgt laut aktuellem MedPrüf-Faktenstand 795 € pro Versuch. Prüfe vor der Anmeldung immer die aktuelle Gebühreninformation der Arztakademie. MedPrüf ist eine unabhängige Lernplattform und legt diese Gebühr nicht fest.",
        en: "The official Vienna Kenntnisprüfung fee is €795 per attempt according to MedPrüf's current fact record. Always verify the current fee information from the Arztakademie before registering. MedPrüf is an independent learning platform and does not set this fee.",
      },
    },
    {
      q: {
        de: "Kann ich die Prüfung wiederholen, wenn ich durchfalle?",
        en: "Can I retake the exam if I fail?",
      },
      a: {
        de: "Ja, ein nicht bestandener Prüfungsteil kann beim nächsten Prüfungstermin wiederholt werden. Grundsätzlich gibt es keine harte Obergrenze, aber jede Wiederholung kostet die volle Gebühr. Die Pass-Until-You-Pass-Garantie der Prüfungs-Kohorte kann deinen Zugang unter den genannten Bedingungen bis zum nächsten Prüfungstermin verlängern, damit du nicht zusätzlich zur Prüfungsgebühr auch noch für das Lernmaterial erneut zahlst.",
        en: "Yes, a failed exam part can be retaken at the next exam date. There's no hard cap on attempts, but each retake costs the full exam fee. The Exam Cohort's Pass-Until-You-Pass guarantee can extend your access under its stated conditions through the next exam cycle, so you don't pay for the study material twice on top of the exam fee.",
      },
    },
    {
      q: {
        de: "Wie lange sollte ich mich auf die Kenntnisprüfung vorbereiten?",
        en: "How long should I prepare for the Kenntnisprüfung?",
      },
      a: {
        de: "Die Vorbereitungszeit hängt stark von deinem Ausgangsniveau ab. Ärzt:innen mit aktueller klinischer Praxis in einem EU-nahen System berichten typischerweise von 8-12 Wochen fokussierter Vorbereitung. Wer länger nicht klinisch tätig war oder das deutsche medizinische Vokabular noch aufbaut, plant realistisch 4-6 Monate. Der MedPrüf-Lernplan (im Dashboard) fragt dich nach deinem Prüfungsdatum und baut daraus einen tagesgenauen Plan: 70% neue Fragen, 30% Konsolidierung der Schwächen.",
        en: "Preparation time depends heavily on your baseline. Doctors with current clinical practice in an EU-adjacent system typically report 8-12 weeks of focused prep. Those who haven't been clinically active for a while, or who are still building German medical vocabulary, realistically plan 4-6 months. The MedPrüf study plan (in the dashboard) asks for your exam date and builds a day-by-day plan: 70% new questions, 30% weakness consolidation.",
      },
    },
    {
      q: {
        de: "Auf welcher Sprache ist die Prüfung und die Lernplattform?",
        en: "What language is the exam in, and what about the platform?",
      },
      a: {
        de: "Die Kenntnisprüfung wird auf Deutsch abgehalten, das ist nicht verhandelbar. Fragen, Fallvignetten und alle Antwortoptionen sind auf Deutsch, und medizinische Fachbegriffe folgen der österreichischen Konvention (z.B. „Magen-Darm-Trakt\" statt „Gastrointestinaltrakt\"). Die MedPrüf-Plattform ist primär auf Deutsch, aber Erklärungen können auf Knopfdruck ins Englische, Arabische, Russische, Französische, Türkische, Ukrainische und Serbische übersetzt werden, medizinisches Vokabular bleibt erhalten. So kannst du deutsch trainieren, ohne an einer Erklärung hängen zu bleiben.",
        en: "The Kenntnisprüfung is held in German; that's non-negotiable. Questions, case vignettes, and all answer options are in German, and medical terminology follows Austrian convention (e.g. „Magen-Darm-Trakt\" instead of „Gastrointestinaltrakt\"). The MedPrüf platform is primarily German, but explanations can be translated on-demand into English, Arabic, Russian, French, Turkish, Ukrainian, and Serbian; medical vocabulary is preserved. So you can train in German without getting stuck on an explanation.",
      },
    },
    {
      q: {
        de: "Welche Voraussetzungen brauche ich, um überhaupt zur Prüfung zugelassen zu werden?",
        en: "What prerequisites do I need to be admitted to the exam?",
      },
      a: {
        de: "Grundvoraussetzung ist ein abgeschlossenes Medizinstudium und ein Nostrifikationsverfahren der zuständigen Medizinischen Universität (in Wien die MedUni Wien). Die Nostrifikation bewertet dein ausländisches Diplom und bestimmt, welche Ergänzungsprüfungen du ablegen musst, typischerweise die Kenntnisprüfung, oft auch Pharmakologie. Ohne abgeschlossene Nostrifikation (oder zumindest laufendes Verfahren mit Bescheid über die zu absolvierenden Teile) kannst du nicht zur Kenntnisprüfung antreten. Infos zur Nostrifikation findest du bei der MedUni Wien.",
        en: "The baseline requirement is a completed medical degree plus a nostrification process through the relevant Medical University (in Vienna: MedUni Wien). Nostrification evaluates your foreign diploma and determines which supplementary exams you need to take, typically the Kenntnisprüfung, often also Pharmakologie. Without a completed nostrification (or at least an active process with a formal decision on which parts you need), you cannot sit the Kenntnisprüfung. See MedUni Wien for nostrification information.",
      },
    },
  ],
};

export default function KenntnispruefungWienPage() {
  return <ExamLandingShell content={content} />;
}
