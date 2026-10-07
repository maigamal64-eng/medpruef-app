import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /stichprobentest — Stichprobentest (Innsbruck) landing page.
 *
 * IMPORTANT (2026-06-21 rename + fact reconciliation): the exam this
 * page covers is the national **Stichprobentest** (the MedUni
 * Nostrifizierung screening), NOT the domestic "Kumulative
 * Modulprüfung". The DB key stays `kmp_innsbruck` (legacy) and the URL
 * slug stays /stichprobentest (route + content-provenance anchor:
 * "Nostrifizierung Innsbruck"); only the display copy changed.
 *
 * Content numbers use a durable rounded count to avoid stale snapshots.
 * 12 specialties. Source: 17 KoalaMed PDFs distilled from the MedUni
 * Innsbruck clinical curriculum (`scripts/import_koalamed.py`).
 * KoalaMed is a third-party aggregator; we imported from those
 * materials. We do NOT claim these are official or leaked
 * Stichprobentest items, and we do not represent KoalaMed.
 *
 * NOTE (Lektor → [name]): this page was written on the wrong "modular
 * 12-module Innsbruck exam" premise. The factual claims were corrected
 * to the honest Stichprobentest core in this pass; a proper rebuild of
 * the positive exposition belongs to the Route-A vs Route-B positioning
 * project (Kenntnisprüfung/Ärztekammer vs Stichprobentest/MedUni).
 */

const content: ExamLandingContent = {
  examName: {
    de: "Stichprobentest (Innsbruck)",
    en: "Stichprobentest (Innsbruck)",
  },
  eyebrow: {
    de: "Österreich · Nostrifizierung · Stichprobentest",
    en: "Austria · Nostrification · Stichprobentest",
  },
  heroTitle: {
    de: "Bestehe den Stichprobentest beim ersten Versuch.",
    en: "Pass the Stichprobentest on your first try.",
  },
  heroSubtitle: {
    de: "Strukturierte Vorbereitung auf den nationalen Stichprobentest der Nostrifizierung. Über 2.700 kuratierte klinische Übungsfragen. Keine offiziellen oder erinnerten Prüfungsfragen.",
    en: "Structured preparation for Austria's national Stichprobentest. Over 2,700 curated clinical practice questions. These are not official or recalled exam items.",
  },
  primaryCtaHref: "/quiz?exam=kmp_innsbruck&free=1",
  primaryCtaLabel: {
    de: "Free starten: 150 Fragen",
    en: "Start free: 150 questions",
  },
  secondaryCtaHref: "/pricing",
  secondaryCtaLabel: {
    de: "Alle Pläne ansehen",
    en: "See all plans",
  },
  // Renders the venue-rotation table from the self-aging calendar
  // (src/lib/exam-dates.ts). This is the one exam whose venue moves
  // every sitting, so the rotation is a real reader question.
  sittingsExamType: "kmp_innsbruck",
  breakdown: [
    {
      label: { de: "Fragen", en: "Questions" },
      value: "2.700+",
      sub: {
        de: "Kuratierte klinische Übungen",
        en: "Curated clinical practice",
      },
    },
    {
      label: { de: "Fachgebiete", en: "Specialties" },
      value: "12",
      sub: {
        de: "Fragenbank-Kategorien, nicht Prüfungsformat",
        en: "Bank categories, not exam format",
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
      de: "12 Fachgebiete im Überblick: Innere Medizin, Allgemeine Chirurgie, chirurgische Spezialfächer + Anästhesie, Dermatologie, Gynäkologie & Geburtshilfe, HNO, Kinder- und Jugendheilkunde, Kinder- und Jugendpsychiatrie, Neurologie, Psychiatrie, Intensivmedizin, Augenheilkunde.",
      en: "12 specialties: Internal Medicine, General Surgery, Surgical Specialties + Anesthesiology, Dermatology, Gynecology & Obstetrics, ENT, Pediatrics, Child & Adolescent Psychiatry, Neurology, Psychiatry, Intensive Care Medicine, Ophthalmology.",
    },
    {
      de: "Klinische Fallvignetten: Diagnose, Differenzialdiagnose, Therapie und Management-Entscheidungen.",
      en: "Clinical case vignettes: diagnosis, differential diagnosis, therapy, and management decisions.",
    },
    {
      de: "KI-Erklärungen zu Guidelines (ÖDG, ERC, ESC, Herold, Amboss): nicht nur die Antwort, sondern das Warum.",
      en: "AI explanations citing guidelines (ÖDG, ERC, ESC, Herold, Amboss): not just the answer, but the reasoning.",
    },
    {
      de: "Spaced Repetition + personalisierter Lernplan, fokussiert auf die Fachgebiete, in denen du noch Luft nach oben hast.",
      en: "Spaced repetition + personalized study plan, focused on the specialties where you still have room to grow.",
    },
    {
      de: "Mobile + Offline-fähig: PWA installierbar, Fragen auch ohne Netz abrufbar.",
      en: "Mobile + offline-capable: installable PWA, questions accessible without network.",
    },
  ],
  faq: [
    {
      q: {
        de: "Was ist der Stichprobentest genau?",
        en: "What exactly is the Stichprobentest?",
      },
      a: {
        de: "Der Stichprobentest ist die nationale Screening-Prüfung im Rahmen der Nostrifizierung an einer österreichischen Medizinuniversität (Wien, Innsbruck, Graz oder Linz). Es ist rechtlich keine Prüfung im Sinne des Universitätsgesetzes, sondern ein Screening, und der Standort wechselt je Termin. Du meldest dich an der Universität an, an der du deinen Nostrifizierungs-Antrag gestellt hast. Inhaltlich deckt er die klinischen Kernfächer in mehreren Blöcken ab; in der Community gilt das Bestehen üblicherweise als ein bestimmter Anteil bestandener Blöcke (z. B. 6 von 10) mit jeweils mindestens 60 %. Die verbindlichen Regeln stehen in deinem Bescheid und auf der Seite deiner Universität.",
        en: "The Stichprobentest is the national screening assessment within the nostrification process at an Austrian medical university (Vienna, Innsbruck, Graz or Linz). Legally it is not an exam under the University Act, it is a screening, and the venue rotates per sitting. You register at the university where you filed your nostrification application. It covers the core clinical subjects across several blocks; in the community, passing is usually framed as a share of blocks passed (e.g. 6 of 10) at a minimum of 60% each. The binding rules are in your decision letter and on your university's page.",
      },
    },
    {
      q: {
        de: "Wann findet der nächste Stichprobentest statt?",
        en: "When is the next Stichprobentest?",
      },
      a: {
        de: "Der Stichprobentest hat fixe nationale Termine, deren Standort rotiert. Der nächste Termin und der genaue Ort werden in MedPrüf im Prüfungskalender (Startseite + Preisseite) angezeigt und altern automatisch aus, sobald ein Termin vorbei ist. Die offiziellen Termine, verbindlichen Anmeldefristen und der Veranstaltungsort stehen auf i-med.ac.at (Stichprobentest-Termine) bzw. auf der Seite deiner Nostrifizierungs-Universität. MedPrüf aktualisiert den Datensatz zu jedem neuen veröffentlichten Termin.",
        en: "The Stichprobentest has fixed national dates with a rotating venue. The next date and exact location are shown in MedPrüf's exam calendar (home + pricing pages) and age out automatically once a date passes. Official dates, binding registration deadlines, and the venue are on i-med.ac.at (Stichprobentest dates) or your nostrification university's page. MedPrüf updates the dataset with each newly published date.",
      },
    },
    {
      q: {
        de: "Warum unterscheiden sich die MedPrüf-Fragen für den Stichprobentest und die Kenntnisprüfung Wien?",
        en: "Why do MedPrüf questions differ between the Stichprobentest and the Vienna Kenntnisprüfung?",
      },
      a: {
        de: "Die Banken haben unterschiedliche Quellen: Die Wiener Bank enthält SIP4a/SIP5a-basierte MCQ-Übungen; die Stichprobentest-Bank enthält klinische Übungen aus dem Innsbrucker Curriculum. Die Wiener Bank ist keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin. Wählst du „Stichprobentest“ als Prüfungstyp, siehst du über 2.700 kuratierte Übungsfragen, keine offiziellen Prüfungsfragen.",
        en: "The banks have different sources: the Vienna bank contains SIP4a/SIP5a-based MCQ exercises; the Stichprobentest bank contains clinical exercises from the Innsbruck curriculum. The Vienna bank is not a simulation of the postgraduate ÖÄK general medicine exam. Choose \"Stichprobentest\" as your exam type to see over 2,700 curated practice questions, not official exam questions.",
      },
    },
    {
      q: {
        de: "Kann ich einzelne Fachgebiete gezielt vorbereiten?",
        en: "Can I focus on specific specialties?",
      },
      a: {
        de: "Ja. Nach der Wahl „Stichprobentest (Innsbruck)\" als Prüfungstyp kannst du im Quiz-Modus und im Prüfungs-Builder nach Fachgebiet filtern. So übst du z. B. nur HNO oder nur Augenheilkunde. Der Studienplan (Lernplan) berücksichtigt automatisch, welche Fachgebiete du bisher bearbeitet hast und welche noch offen sind.",
        en: "Yes. After selecting \"Stichprobentest\" as your exam type, you can filter by specialty in both Quiz mode and the Exam Builder, e.g. practice ENT only, or ophthalmology only. The study plan automatically tracks which specialties you've covered and which are still open.",
      },
    },
    {
      q: {
        de: "Wie melde ich mich zum Stichprobentest an?",
        en: "How do I register for the Stichprobentest?",
      },
      a: {
        de: "Die Anmeldung erfolgt direkt bei der Universität, an der du deinen Nostrifizierungs-Antrag gestellt hast, nicht über uns, und innerhalb der offiziellen Anmeldefrist. Nach deinem Nostrifizierungs-Antrag erhältst du Informationen zu Termin, Frist und Ablauf. Auch wenn der Veranstaltungsort national rotiert, läuft deine Anmeldung über deine Antrags-Universität. MedPrüf übernimmt die Vorbereitung, die administrative Anmeldung läuft immer über die Universität.",
        en: "Registration is done directly with the university where you filed your nostrification application, not through us, and within the official registration deadline. After your application you receive information on the date, deadline, and procedure. Even though the venue rotates nationally, you register through your application university. MedPrüf handles the preparation; the administrative registration always happens via the university.",
      },
    },
    {
      q: {
        de: "Wie lange sollte ich für die Vorbereitung einplanen?",
        en: "How long should I plan for prep?",
      },
      a: {
        de: "Erfahrungsberichte aus der Community nennen für eine solide Vorbereitung im Schnitt rund ein Jahr, stark abhängig von deinem Sprachniveau und deiner klinischen Vorerfahrung. Die größte Hürde ist fast immer die Sprache. Der MedPrüf-Lernplan fragt dich nach Prüfungsdatum und Tagesziel und verteilt die Fragen entsprechend: 70 % neue Inhalte, 30 % Wiederholung von Schwächen.",
        en: "Community accounts cite on average about a year of solid prep, heavily dependent on your language level and prior clinical experience. The biggest hurdle is almost always the language. The MedPrüf study plan asks for your exam date and daily goal, then spreads questions accordingly: 70% new content, 30% weakness revision.",
      },
    },
    {
      q: {
        de: "Sind die MedPrüf-Fragen identisch mit den echten Prüfungsfragen?",
        en: "Are MedPrüf's questions identical to the real exam questions?",
      },
      a: {
        de: "Nein. Unsere Fragen sind curriculumsnahe Übungsfragen im klinischen MCQ-Stil: Fallvignetten, MCQ-Format, teilweise Mehrfachantworten. Wir haben jede Frage auf Unicode-Artefakte geprüft und typografische Fehler aus der PDF-Extraktion behoben. Was wir NICHT versprechen: identische oder offizielle Prüfungsfragen. Die Fragenbank wird laufend erweitert, und der Zweck von MedPrüf ist Verständnis aufbauen, nicht Auswendiglernen.",
        en: "No. Our questions are curriculum-aligned practice items in a clinical MCQ style: case vignettes, MCQ format, some multi-correct. We've checked every question for Unicode artifacts and fixed typographic issues from the PDF extraction. What we DON'T promise: identical or official exam questions. The question base keeps growing, and MedPrüf's purpose is building understanding, not memorization.",
      },
    },
  ],
};

export default function KmpInnsbruckPage() {
  return <ExamLandingShell content={content} />;
}
