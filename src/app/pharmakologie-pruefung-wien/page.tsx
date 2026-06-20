import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /pharmakologie-pruefung-wien — Pharmakologie landing page.
 *
 * Unique to this page:
 *   - Always-visible countdown chip to 26 June 2026 (the next known
 *     Pharmakologie exam date — matches NEXT_EXAM_DATE.pharma and the
 *     Juni-26-Kohorte sold on /pricing).
 *   - Global CohortCountdownBanner is also visible, but this chip is
 *     non-dismissible so stays on the page even after the banner is
 *     dismissed.
 *
 * Content: 335 questions, single topic "Pharmakologie" per NOTES.md
 * §Content (source: Rezeptierkunde 2026 PDF).
 */

const content: ExamLandingContent = {
  examName: {
    de: "Pharmakologie-Prüfung Wien",
    en: "Vienna Pharmakologie Exam",
  },
  eyebrow: {
    de: "Österreich · Wien · Pharmakologie · Rezeptierkunde",
    en: "Austria · Vienna · Pharmacology · Prescribing",
  },
  heroTitle: {
    de: "Bestehe die Pharmakologie-Prüfung Wien beim ersten Versuch.",
    en: "Pass the Vienna Pharmakologie exam on your first try.",
  },
  heroSubtitle: {
    de: "Spezialisierte Vorbereitung auf die österreichische Pharmakologie- und Rezeptierkunde-Prüfung: 335 Fragen mit klinischen Begründungen, Dosierungsregeln und Wechselwirkungen. Kenntnisprüfung-Kohorte inklusive Pass-Until-You-Pass-Garantie.",
    en: "Specialized prep for the Austrian Pharmakologie and Rezeptierkunde exam: 335 questions with clinical reasoning, dosing rules, and interactions. The Kenntnisprüfung Cohort includes Pass-Until-You-Pass.",
  },
  primaryCtaHref: "/quiz?exam=pharma&free=1",
  primaryCtaLabel: {
    de: "Free starten — 150 Pharma Fragen",
    en: "Start free — 150 Pharma questions",
  },
  secondaryCtaHref: "/pricing",
  secondaryCtaLabel: {
    de: "Kenntnisprüfung-Kohorte ansehen",
    en: "See Kenntnisprüfung Cohort",
  },
  // Countdown chip — Pharma-only. The global CohortCountdownBanner
  // also shows this date but can be dismissed; this chip stays.
  // Anchored to the in-market Kenntnisprüfung Wien sitting (SoT §1).
  showCountdownChip: true,
  countdownTargetIso: "2026-09-28T09:00:00+02:00",
  breakdown: [
    {
      label: { de: "Fragen", en: "Questions" },
      value: "335",
      sub: {
        de: "Rezeptierkunde + klinische Pharma",
        en: "Prescribing + clinical pharma",
      },
    },
    {
      label: { de: "Prüfungstermin", en: "Exam date" },
      value: "28. Sept",
      sub: {
        de: "2026 · Kenntnisprüfung Wien",
        en: "2026 · Kenntnisprüfung Wien",
      },
    },
    {
      label: { de: "Kenntnisprüfung-Kohorte", en: "Kenntnisprüfung Cohort" },
      value: "114 €",
      sub: {
        de: "6 Monate · Pass-Until-You-Pass",
        en: "6 months · Pass-Until-You-Pass",
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
      de: "Österreichische Arzneiverordnung: Rezeptpflicht, Suchtgiftrezepte, Formvorschriften, Telemedizin-Rezepte — alles nach aktueller Rechtslage.",
      en: "Austrian prescribing rules: prescription-required drugs, controlled-substance prescriptions, formal requirements, telemedicine scripts — per current legislation.",
    },
    {
      de: "Dosierungslogik: Gewicht-, Alters- und Nierenfunktion-adjustierte Dosen, pädiatrische Umrechnungen, geriatrische Anpassungen.",
      en: "Dosing logic: weight-, age-, and renal-function-adjusted doses, pediatric conversions, geriatric adjustments.",
    },
    {
      de: "Wechselwirkungen + Kontraindikationen: CYP450-Metabolismus, Inducer/Inhibitor-Tabelle, Schwangerschaft/Stillzeit, klassische Fallstricke.",
      en: "Interactions + contraindications: CYP450 metabolism, inducer/inhibitor table, pregnancy/breastfeeding, classic pitfalls.",
    },
    {
      de: "Klinische Vignetten: „Patient hat X, nimmt Y, jetzt neu Z — was tun?\" — genau der Entscheidungsstil, den die Prüfung verlangt.",
      en: "Clinical vignettes: \"Patient has X, takes Y, now starting Z — what do you do?\" — exactly the decision style the exam expects.",
    },
    {
      de: "Pass-Until-You-Pass auf der Kenntnisprüfung-Kohorte: wenn du durchfällst, verlängern wir deinen Zugang kostenlos bis zur nächsten Prüfung (maximal zwei zusätzliche Zyklen).",
      en: "Pass-Until-You-Pass on the Kenntnisprüfung Cohort: if you fail, we extend your access free through the next exam cycle (max two additional cycles).",
    },
  ],
  faq: [
    {
      q: {
        de: "Was prüft die Pharmakologie-Prüfung Wien eigentlich?",
        en: "What does the Vienna Pharmakologie exam actually test?",
      },
      a: {
        de: "Die Prüfung kombiniert zwei Komponenten: klinische Pharmakologie (Wirkstoffe, Dosierungen, Kontraindikationen, Wechselwirkungen) und Rezeptierkunde (korrektes Ausstellen österreichischer Rezepte, inkl. Suchtgiftformulare). Es geht weniger um auswendig gelerntes Wissen und mehr um situatives Entscheiden: „Welches Medikament bei dieser Diagnose, in welcher Dosis, mit welchen Kontraindikationen, und auf welcher Rezeptform?\" Die österreichische Spezifität ist wichtig — Verordnungsregeln unterscheiden sich von Deutschland oder der Schweiz.",
        en: "The exam combines two parts: clinical pharmacology (drugs, dosing, contraindications, interactions) and prescribing (correctly writing Austrian prescriptions, including controlled-substance forms). It's less about memorized knowledge and more about situated decision-making: \"Which drug for this diagnosis, what dose, what contraindications, which prescription form?\" The Austrian specificity matters — prescribing rules differ from Germany or Switzerland.",
      },
    },
    {
      q: {
        de: "Wann ist die nächste Pharmakologie-Prüfung?",
        en: "When is the next Pharmakologie exam?",
      },
      a: {
        de: "Die Pharmakologie-Prüfung ist an die Nostrifikations-Termine deiner Medizinischen Universität und die Kenntnisprüfung-Zyklen gekoppelt; der nächste große Termin der Kenntnisprüfung Wien ist der 28. September 2026 (Anmeldung bis Ende Juli). Deinen genauen Pharma-Termin entnimmst du deinem Nostrifikationsbescheid und der Ärztekammer Wien. Unsere Kenntnisprüfung-Kohorte (114 €) gibt dir 6 Monate Vollzugang plus Pass-Until-You-Pass; wir aktualisieren die Termine, sobald die Ärztekammer Wien neue veröffentlicht.",
        en: "The Pharmakologie exam is tied to your Medical University's nostrification dates and the Kenntnisprüfung cycles; the next major Kenntnisprüfung Wien sitting is 28 September 2026 (registration by end of July). For your exact Pharma date, check your nostrification decision letter and the Ärztekammer Wien. Our Kenntnisprüfung Cohort (114 €) gives you 6 months of full access plus Pass-Until-You-Pass; we update the dates as soon as the Ärztekammer Wien publishes new ones.",
      },
    },
    {
      q: {
        de: "Warum ist die Pharmakologie-Prüfung separat von der Kenntnisprüfung?",
        en: "Why is Pharmakologie separate from the Kenntnisprüfung?",
      },
      a: {
        de: "Die Nostrifikation der Medizinischen Universität entscheidet, welche Ergänzungsprüfungen du ablegen musst. Für viele Ärzt:innen aus Drittstaaten umfasst das sowohl die Kenntnisprüfung als auch eine eigenständige Pharmakologie-Prüfung. Die Ärztekammer Wien prüft Pharma als separaten Prüfungsteil, weil die Rezeptierkunde eine eigene Fachkompetenz mit österreichischer Rechtsnorm ist — nicht einfach ein Unterfach der Inneren Medizin. Ob du Pharma ablegen musst, steht in deinem Nostrifikationsbescheid.",
        en: "Your Medical University's nostrification decision determines which supplementary exams you need. For many doctors from non-EU countries, that includes both the Kenntnisprüfung and a standalone Pharmakologie exam. The Ärztekammer Wien tests Pharma separately because Austrian prescribing law is a distinct domain — not simply a sub-topic of internal medicine. Whether you need to take Pharma is specified in your nostrification decision letter.",
      },
    },
    {
      q: {
        de: "Was ist die Kenntnisprüfung-Kohorte und wie funktioniert Pass-Until-You-Pass?",
        en: "What is the Kenntnisprüfung Cohort and how does Pass-Until-You-Pass work?",
      },
      a: {
        de: "Die Kenntnisprüfung-Kohorte ist unser Lerngemeinschafts-Tarif für die nächste Prüfungsphase (Kenntnisprüfung Wien am 28. September 2026): 114 € für 6 Monate Vollzugang plus die Pass-Until-You-Pass-Garantie. Bestehst du nicht, verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin (max. 2 zusätzliche Zyklen), vorausgesetzt, du hast mindestens 70% der Fragenbank bearbeitet und lädst dein offizielles Prüfungsergebnis hoch. Ein Admin verifiziert manuell innerhalb von 72 Stunden. Keine Bargeld-Erstattung: wir investieren in dein Bestehen, nicht in eine Ausstiegsklausel.",
        en: "The Kenntnisprüfung Cohort is our study-group plan for the next exam window (Kenntnisprüfung Wien on 28 September 2026): 114 € for 6 months full access plus the Pass-Until-You-Pass guarantee. If you fail, we extend your access free through the next exam date (max 2 additional cycles), provided you completed at least 70% of the question bank and upload your official exam result. An admin verifies manually within 72 hours. No cash refunds: we invest in your pass, not in an exit clause.",
      },
    },
    {
      q: {
        de: "Unterscheidet sich die Pharmakologie-Prüfung Wien von Innsbruck?",
        en: "Does the Vienna Pharmakologie exam differ from Innsbruck?",
      },
      a: {
        de: "Ja. Die Wiener Pharmakologie-Prüfung ist ein separater Prüfungsteil der Ärztekammer Wien, der speziell auf österreichische Rezeptierkunde fokussiert. In Innsbruck ist Pharmakologie typischerweise als Teil der Kumulativen Modulprüfung (KMP) integriert — nicht als eigenständige Prüfung mit eigenem Termin. Wenn dein Nostrifikationsbescheid Pharma als separate Prüfung nennt, geht es meist über Wien; wenn es als KMP-Modul auftaucht, läuft es über Innsbruck. Die fachlichen Inhalte überschneiden sich stark, die Prüfungsform unterscheidet sich.",
        en: "Yes. The Vienna Pharmakologie exam is a standalone test by the Ärztekammer Wien, specifically focused on Austrian prescribing rules. In Innsbruck, pharmacology is typically integrated into the Cumulative Module Exam (KMP) — not a standalone exam with its own date. If your nostrification decision lists Pharma as a separate exam, it's usually Vienna; if it appears as a KMP module, it's Innsbruck. The subject content overlaps significantly; the exam format differs.",
      },
    },
    {
      q: {
        de: "Kann ich die Pharma-Prüfung ohne die Kenntnisprüfung ablegen?",
        en: "Can I take the Pharma exam without the Kenntnisprüfung?",
      },
      a: {
        de: "Das hängt von deinem Nostrifikationsbescheid ab. Die Prüfungen sind organisatorisch unabhängig — du kannst Pharma allein absolvieren, wenn dein Bescheid nur Pharma verlangt. Du kannst auch Kenntnisprüfung und Pharma auf unterschiedliche Termine verteilen, solange du die Anmeldefristen der Ärztekammer einhältst. MedPrüf erlaubt dir im Dashboard, zwischen den drei Prüfungstypen (Kenntnisprüfung, KMP Innsbruck, Pharma) jederzeit zu wechseln, ohne etwas zu verlieren.",
        en: "That depends on your nostrification decision. The exams are administratively independent — you can take Pharma alone if your decision letter only requires Pharma. You can also split Kenntnisprüfung and Pharma across different dates, as long as you respect the Ärztekammer's registration deadlines. MedPrüf lets you switch between the three exam types (Kenntnisprüfung, KMP Innsbruck, Pharma) at any time in the dashboard without losing progress.",
      },
    },
    {
      q: {
        de: "Welche Quellen nutzen die Fragen und Erklärungen?",
        en: "What sources do the questions and explanations use?",
      },
      a: {
        de: "Die 335 Fragen stammen aus der aktuellen Rezeptierkunde-Sammlung 2026, kuratiert und typographisch bereinigt (siehe NOTES.md §OCR-Aufräumaktion). Die KI-Erklärungen greifen auf Standardreferenzen zurück: Herold („Innere Medizin\"), Austrian Drug Compendium (AMI), ESC/ÖDG/ERC-Guidelines für herzkreislauf- und metabolische Indikationen, Amboss für klinische Entscheidungslogik. Jede Erklärung nennt die Guideline oder Quelle beim Namen, wenn sie relevant ist — so kannst du Aussagen selbst nachprüfen.",
        en: "The 335 questions come from the current Rezeptierkunde collection for 2026, curated and typographically cleaned (see NOTES.md §OCR cleanup). AI explanations draw on standard references: Herold (\"Innere Medizin\"), the Austrian Drug Compendium (AMI), ESC/ÖDG/ERC guidelines for cardiovascular and metabolic indications, Amboss for clinical decision logic. Every explanation cites the guideline or source by name when relevant — so you can check claims yourself.",
      },
    },
  ],
};

export default function PharmakologiePage() {
  return <ExamLandingShell content={content} />;
}
