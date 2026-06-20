import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /kenntnispruefung-wien — Vienna Kenntnisprüfung landing page.
 *
 * Content numbers are authoritative as of 2026-04-24 per NOTES.md
 * §Content: 7,566 Kenntnisprüfung questions across 10 specialties,
 * split into SIP 4 (surgery, internal medicine, dermatology) and
 * SIP 5 (7 subjects). See `src/lib/topics.ts#VIENNA_EXAM_PARTS`.
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
    de: "Strukturierte Vorbereitung auf die österreichische Kenntnisprüfung (SIP 4 + SIP 5) — 7.566 Fragen aus 10 Fachgebieten, klinisch kommentiert, destilliert aus dokumentierten offiziellen Wiener Prüfungsmaterialien seit 2016.",
    en: "Structured prep for the Austrian Kenntnisprüfung (SIP 4 + SIP 5) — 7,566 questions across 10 specialties, clinically annotated, distilled from documented official Vienna exam materials since 2016.",
  },
  primaryCtaHref: "/quiz?exam=kenntnispruefung&free=1",
  primaryCtaLabel: {
    de: "Free starten — 150 Kenntnisprüfung Fragen",
    en: "Start free — 150 Kenntnisprüfung questions",
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
        de: "Klinisch kuratiert · MCQ + Mehrfachauswahl",
        en: "Clinically curated · MCQ + multi-correct",
      },
    },
    {
      label: { de: "Fachgebiete", en: "Specialties" },
      value: "10",
      sub: {
        de: "SIP 4 + SIP 5 komplett abgedeckt",
        en: "Full SIP 4 + SIP 5 coverage",
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
      de: "SIP 4: Chirurgische Fächer, Innere Medizin, Dermatologie und Venerologie — klinische Vignetten nach realem Prüfungsstil.",
      en: "SIP 4: Surgery, Internal Medicine, Dermatology — clinical vignettes mirroring the real exam style.",
    },
    {
      de: "SIP 5: Augenheilkunde, HNO, Psychiatrie, Notfall-/Intensivmedizin, Gynäkologie, Pädiatrie, Neurologie — 7 Fachgebiete mit fachspezifischen Schwerpunkten.",
      en: "SIP 5: Ophthalmology, ENT, Psychiatry, Emergency/Intensive Medicine, Gynecology, Pediatrics, Neurology — 7 specialties with subject-specific emphases.",
    },
    {
      de: "Mehrfachantwort-Fragen mit strikter Bewertung — genau wie in der echten Prüfung.",
      en: "Multi-correct questions with strict grading — just like on the real exam.",
    },
    {
      de: "KI-Erklärungen zu Guidelines (ERC, ESC, ÖDG, Herold, Amboss) — nicht nur „richtig/falsch\", sondern Warum.",
      en: "AI explanations citing guidelines (ERC, ESC, ÖDG, Herold, Amboss) — not just right/wrong, but why.",
    },
    {
      de: "Spaced Repetition (SM-2), personalisierter Lernplan, Schwächen-Radar — damit du deine Zeit nicht auf Fächer verschwendest, die du bereits kannst.",
      en: "Spaced repetition (SM-2), personalized study plan, weakness radar — so you don't waste time on subjects you already know.",
    },
  ],
  faq: [
    {
      q: {
        de: "Wann ist die nächste Kenntnisprüfung Wien?",
        en: "When is the next Vienna Kenntnisprüfung?",
      },
      a: {
        de: "Die Ärztekammer Wien veröffentlicht die Prüfungstermine typischerweise zwei bis drei Monate im Voraus. 2026 gibt es zwei Zyklen im Jahr. Der nächste publizierte Termin liegt im Mai 2026; der Herbstzyklus wird üblicherweise im September/Oktober abgehalten. Die offiziellen Daten findest du unter aerztekammer.at → Ausländische Ärzte → Kenntnisprüfung.",
        en: "The Ärztekammer Wien publishes exam dates typically two to three months in advance. 2026 has two cycles. The next published date is in May 2026; the autumn cycle usually runs September/October. Official dates at aerztekammer.at → Foreign Doctors → Kenntnisprüfung.",
      },
    },
    {
      q: {
        de: "Wie ist die Struktur von SIP 4 vs SIP 5?",
        en: "How are SIP 4 and SIP 5 structured?",
      },
      a: {
        de: "Die Kenntnisprüfung besteht aus zwei Teilen: SIP 4 (Summative Integrierte Prüfung 4) deckt die drei großen Fächer Innere Medizin, Chirurgische Fächer und Dermatologie/Venerologie ab. SIP 5 umfasst sieben kleinere Fachgebiete: Augenheilkunde, HNO, Neurologie, Psychiatrie, Gynäkologie, Kinder- und Jugendheilkunde sowie Notfall- und Intensivmedizin. Jeder Teil wird separat bewertet. In MedPrüf kannst du gezielt nach SIP-Teil filtern oder einen simulierten Prüfungsmodus mit Originalstruktur wählen.",
        en: "The Kenntnisprüfung has two parts: SIP 4 (Summative Integrated Exam 4) covers the three major subjects — Internal Medicine, Surgery, Dermatology/Venereology. SIP 5 covers seven smaller specialties: Ophthalmology, ENT, Neurology, Psychiatry, Gynecology, Pediatrics, Emergency/Intensive Medicine. Each part is graded separately. In MedPrüf you can filter specifically by SIP part, or run a simulated exam mode with the original structure.",
      },
    },
    {
      q: {
        de: "Was kostet die Prüfungsgebühr?",
        en: "What is the exam fee?",
      },
      a: {
        de: "Die offizielle Prüfungsgebühr wird von der Ärztekammer Wien festgelegt und lag zuletzt im Bereich von ca. €400 pro Versuch. Die Gebühr wird pro SIP-Teil erhoben — wer beide Teile antritt, zahlt entsprechend für beide. Die aktuellen Gebühren findest du immer auf der offiziellen Seite der Ärztekammer Wien. MedPrüf ist eine davon unabhängige Lernplattform — wir haben keinen Einfluss auf die Prüfungsgebühr.",
        en: "The official exam fee is set by the Ärztekammer Wien and was most recently around €400 per attempt. The fee is charged per SIP part — if you take both parts, you pay for both. Current fees are listed on the Ärztekammer Wien website. MedPrüf is an independent learning platform — we don't set or influence the exam fee.",
      },
    },
    {
      q: {
        de: "Kann ich die Prüfung wiederholen, wenn ich durchfalle?",
        en: "Can I retake the exam if I fail?",
      },
      a: {
        de: "Ja, ein nicht bestandener SIP-Teil kann beim nächsten Prüfungstermin wiederholt werden. Grundsätzlich gibt es keine harte Obergrenze, aber jede Wiederholung kostet die volle Gebühr. Genau deshalb bauen wir MedPrüf: unsere Pass-Until-You-Pass-Garantie (auf der Prüfungs-Kohorte und dem Jahresabo) verlängert deinen Zugang kostenlos bis zur nächsten Prüfung, wenn du durchfällst, damit du nicht zusätzlich zur Prüfungsgebühr auch noch für das Lernmaterial erneut zahlst.",
        en: "Yes, a failed SIP part can be retaken at the next exam date. There's no hard cap on attempts, but each retake costs the full exam fee. That's exactly why we built MedPrüf: our Pass-Until-You-Pass guarantee (on the Exam Cohort and annual plan) extends your access free through the next exam cycle if you fail, so you don't pay for the study material twice on top of the exam fee.",
      },
    },
    {
      q: {
        de: "Wie lange sollte ich mich auf die Kenntnisprüfung vorbereiten?",
        en: "How long should I prepare for the Kenntnisprüfung?",
      },
      a: {
        de: "Die Vorbereitungszeit hängt stark von deinem Ausgangsniveau ab. Ärzt:innen mit aktueller klinischer Praxis in einem EU-nahen System berichten typischerweise von 8-12 Wochen fokussierter Vorbereitung. Wer länger nicht klinisch tätig war oder das deutsche medizinische Vokabular noch aufbaut, plant realistisch 4-6 Monate. Der MedPrüf-Lernplan (im Dashboard) fragt dich nach deinem Prüfungsdatum und baut daraus einen tagesgenauen Plan — 70% neue Fragen, 30% Konsolidierung der Schwächen.",
        en: "Preparation time depends heavily on your baseline. Doctors with current clinical practice in an EU-adjacent system typically report 8-12 weeks of focused prep. Those who haven't been clinically active for a while, or who are still building German medical vocabulary, realistically plan 4-6 months. The MedPrüf study plan (in the dashboard) asks for your exam date and builds a day-by-day plan — 70% new questions, 30% weakness consolidation.",
      },
    },
    {
      q: {
        de: "Auf welcher Sprache ist die Prüfung und die Lernplattform?",
        en: "What language is the exam in, and what about the platform?",
      },
      a: {
        de: "Die Kenntnisprüfung wird auf Deutsch abgehalten — das ist nicht verhandelbar. Fragen, Fallvignetten und alle Antwortoptionen sind auf Deutsch, und medizinische Fachbegriffe folgen der österreichischen Konvention (z.B. „Magen-Darm-Trakt\" statt „Gastrointestinaltrakt\"). Die MedPrüf-Plattform ist primär auf Deutsch, aber Erklärungen können auf Knopfdruck ins Englische, Arabische, Russische, Französische, Türkische, Ukrainische und Serbische übersetzt werden — medizinisches Vokabular bleibt erhalten. So kannst du deutsch trainieren, ohne an einer Erklärung hängen zu bleiben.",
        en: "The Kenntnisprüfung is held in German — that's non-negotiable. Questions, case vignettes, and all answer options are in German, and medical terminology follows Austrian convention (e.g. „Magen-Darm-Trakt\" instead of „Gastrointestinaltrakt\"). The MedPrüf platform is primarily German, but explanations can be translated on-demand into English, Arabic, Russian, French, Turkish, Ukrainian, and Serbian — medical vocabulary is preserved. So you can train in German without getting stuck on an explanation.",
      },
    },
    {
      q: {
        de: "Welche Voraussetzungen brauche ich, um überhaupt zur Prüfung zugelassen zu werden?",
        en: "What prerequisites do I need to be admitted to the exam?",
      },
      a: {
        de: "Grundvoraussetzung ist ein abgeschlossenes Medizinstudium und ein Nostrifikationsverfahren der zuständigen Medizinischen Universität (in Wien die MedUni Wien). Die Nostrifikation bewertet dein ausländisches Diplom und bestimmt, welche Ergänzungsprüfungen du ablegen musst — typischerweise die Kenntnisprüfung, oft auch Pharmakologie. Ohne abgeschlossene Nostrifikation (oder zumindest laufendes Verfahren mit Bescheid über die zu absolvierenden Teile) kannst du nicht zur Kenntnisprüfung antreten. Infos zur Nostrifikation findest du bei der MedUni Wien.",
        en: "The baseline requirement is a completed medical degree plus a nostrification process through the relevant Medical University (in Vienna: MedUni Wien). Nostrification evaluates your foreign diploma and determines which supplementary exams you need to take — typically the Kenntnisprüfung, often also Pharmakologie. Without a completed nostrification (or at least an active process with a formal decision on which parts you need), you cannot sit the Kenntnisprüfung. See MedUni Wien for nostrification information.",
      },
    },
  ],
};

export default function KenntnispruefungWienPage() {
  return <ExamLandingShell content={content} />;
}
