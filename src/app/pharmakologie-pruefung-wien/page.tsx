import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /pharmakologie-pruefung-wien — Pharmakologie landing page.
 *
 * Unique to this page:
 *   - No fixed exam date is shown because Pharma dates depend on the
 *     student's university and term.
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
    de: "Spezialisierte Vorbereitung auf Pharmakologie und Rezeptierkunde mit kuratierten klinischen Übungsfragen zu Dosierungen und Wechselwirkungen.",
    en: "Specialized preparation for Pharmakologie and prescribing with curated clinical practice questions on dosing and interactions.",
  },
  primaryCtaHref: "/quiz?exam=pharma&free=1",
  primaryCtaLabel: {
    de: "Free starten: 150 Pharma Fragen",
    en: "Start free: 150 Pharma questions",
  },
  secondaryCtaHref: "/pricing",
  secondaryCtaLabel: {
    de: "Prüfungs-Kohorte ansehen",
    en: "See Exam Cohort",
  },
  // Pharma has no fixed annual exam date; timing is set by each university.
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
      value: { de: "kein Fixtermin", en: "term-based" },
      sub: {
        de: "Termin laut Universität",
        en: "Date set by your university",
      },
    },
    {
      label: { de: "Prüfungs-Kohorte", en: "Exam Cohort" },
      value: "129 €",
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
      de: "Österreichische Arzneiverordnung: Rezeptpflicht, Suchtgiftrezepte, Formvorschriften, Telemedizin-Rezepte, alles nach aktueller Rechtslage.",
      en: "Austrian prescribing rules: prescription-required drugs, controlled-substance prescriptions, formal requirements, telemedicine scripts; per current legislation.",
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
      de: "Klinische Vignetten: „Patient hat X, nimmt Y, jetzt neu Z: was tun?\" Genau der Entscheidungsstil, den die Prüfung verlangt.",
      en: "Clinical vignettes: \"Patient has X, takes Y, now starting Z: what do you do?\" Exactly the decision style the exam expects.",
    },
    {
      de: "Pass-Until-You-Pass auf der Prüfungs-Kohorte: wenn du durchfällst, verlängern wir deinen Zugang kostenlos bis zur nächsten Prüfung (maximal zwei zusätzliche Zyklen).",
      en: "Pass-Until-You-Pass on the Exam Cohort: if you fail, we extend your access free through the next exam cycle (max two additional cycles).",
    },
  ],
  faq: [
    {
      q: {
        de: "Was prüft die Pharmakologie-Prüfung Wien eigentlich?",
        en: "What does the Vienna Pharmakologie exam actually test?",
      },
      a: {
        de: "Die Prüfung kombiniert zwei Komponenten: klinische Pharmakologie (Wirkstoffe, Dosierungen, Kontraindikationen, Wechselwirkungen) und Rezeptierkunde (korrektes Ausstellen österreichischer Rezepte, inkl. Suchtgiftformulare). Es geht weniger um auswendig gelerntes Wissen und mehr um situatives Entscheiden: „Welches Medikament bei dieser Diagnose, in welcher Dosis, mit welchen Kontraindikationen, und auf welcher Rezeptform?\" Die österreichische Spezifität ist wichtig, Verordnungsregeln unterscheiden sich von Deutschland oder der Schweiz.",
        en: "The exam combines two parts: clinical pharmacology (drugs, dosing, contraindications, interactions) and prescribing (correctly writing Austrian prescriptions, including controlled-substance forms). It's less about memorized knowledge and more about situated decision-making: \"Which drug for this diagnosis, what dose, what contraindications, which prescription form?\" The Austrian specificity matters; prescribing rules differ from Germany or Switzerland.",
      },
    },
    {
      q: {
        de: "Wann ist die nächste Pharmakologie-Prüfung?",
        en: "When is the next Pharmakologie exam?",
      },
      a: {
        de: "Pharma-Prüfungstermine hängen von deiner Medizinischen Universität und deinem Studienplan ab. Prüfe deinen Nostrifikationsbescheid oder frage deine Universität nach dem nächsten Termin. MedPrüf zeigt keinen allgemeinen jährlichen Pharma-Termin an. Die Prüfungs-Kohorte kostet 129 € für sechs Monate.",
        en: "Pharma exam dates depend on your Medical University and study plan. Check your nostrification decision or ask your university for the next date. MedPrüf does not show one general annual Pharma date. The Exam Cohort costs €129 for six months.",
      },
    },
    {
      q: {
        de: "Warum ist die Pharmakologie-Prüfung separat von der Kenntnisprüfung?",
        en: "Why is Pharmakologie separate from the Kenntnisprüfung?",
      },
      a: {
        de: "Welche Ergänzungsprüfungen du ablegen musst, ergibt sich aus deinem Bescheid und den Anforderungen deiner Universität. MedUni Wien führt Rezeptierkunde im universitären Nostrifikationsverfahren auf. MedPrüfs Pharma-Fragenbank ist Lernmaterial, keine Prüfung der Ärztekammer Wien.",
        en: "Your decision and university requirements determine which supplementary examinations you need. MedUni Vienna lists prescribing within its university nostrification process. MedPrüf’s Pharma bank is study material, not an examination run by the Vienna Medical Chamber.",
      },
    },
    {
      q: {
        de: "Was ist die Prüfungs-Kohorte und wie funktioniert Pass-Until-You-Pass?",
        en: "What is the Exam Cohort and how does Pass-Until-You-Pass work?",
      },
      a: {
        de: "Die Prüfungs-Kohorte bietet sechs Monate Zugang für 129 €. Bestehst du nicht, verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin (max. 2 zusätzliche Zyklen), vorausgesetzt, du hast mindestens 70% der Fragenbank bearbeitet und lädst dein offizielles Prüfungsergebnis hoch. Ein Admin verifiziert manuell innerhalb von 72 Stunden. Die separate 7-Tage-Rückerstattung nach einem Kauf bleibt davon unberührt. Nach Ablauf dieser Frist sieht die Pass-Until-You-Pass-Garantie eine Zugangsverlängerung statt einer Rückerstattung vor.",
        en: "The Exam Cohort provides six months of access for €129. If you fail, we extend your access free through the next exam date (max 2 additional cycles), provided you completed at least 70% of the question bank and upload your official exam result. An admin verifies manually within 72 hours. The separate 7-day purchase-refund window still applies. After that window, the Pass-Until-You-Pass guarantee provides an access extension rather than a refund.",
      },
    },
    {
      q: {
        de: "Unterscheidet sich die Pharmakologie-Prüfung Wien von Innsbruck?",
        en: "Does the Vienna Pharmakologie exam differ from Innsbruck?",
      },
      a: {
        de: "Formate, Inhalte und Termine sind institutionenspezifisch. Eine Zuordnung zu einer eigenständigen Ärztekammer-Prüfung ist hier nicht belegt. Kläre die genaue Prüfung mit deiner Universität anhand deines Bescheids.",
        en: "Formats, content and dates are institution-specific. A mapping to a separate Medical Chamber examination is not established here. Confirm your exact examination with your university and your decision.",
      },
    },
    {
      q: {
        de: "Kann ich die Pharma-Prüfung ohne die Kenntnisprüfung ablegen?",
        en: "Can I take the Pharma exam without the Kenntnisprüfung?",
      },
      a: {
        de: "Welche Prüfungen du benötigst und ob du sie getrennt anmelden kannst, bestätigt deine Universität anhand deines Bescheids. Die Auswahl einer MedPrüf-Fragenbank ersetzt diese Bestätigung nicht. Du kannst zwischen den Fragenbanken wechseln, ohne deinen Lernfortschritt zu verlieren.",
        en: "Your university confirms which examinations you need and whether you can register for them separately, based on your decision. Selecting a MedPrüf bank does not replace that confirmation. You can switch between banks without losing your study progress.",
      },
    },
    {
      q: {
        de: "Welche Quellen nutzen die Fragen und Erklärungen?",
        en: "What sources do the questions and explanations use?",
      },
      a: {
        de: "Die 335 Fragen stammen aus der aktuellen Rezeptierkunde-Sammlung 2026, kuratiert und typographisch bereinigt (siehe NOTES.md §OCR-Aufräumaktion). Die KI-Erklärungen greifen auf Standardreferenzen zurück: Herold („Innere Medizin\"), Austrian Drug Compendium (AMI), ESC/ÖDG/ERC-Guidelines für herzkreislauf- und metabolische Indikationen, Amboss für klinische Entscheidungslogik. Jede Erklärung nennt die Guideline oder Quelle beim Namen, wenn sie relevant ist, so kannst du Aussagen selbst nachprüfen.",
        en: "The 335 questions come from the current Rezeptierkunde collection for 2026, curated and typographically cleaned (see NOTES.md §OCR cleanup). AI explanations draw on standard references: Herold (\"Innere Medizin\"), the Austrian Drug Compendium (AMI), ESC/ÖDG/ERC guidelines for cardiovascular and metabolic indications, Amboss for clinical decision logic. Every explanation cites the guideline or source by name when relevant, so you can check claims yourself.",
      },
    },
  ],
};

export default function PharmakologiePage() {
  return <ExamLandingShell content={content} />;
}
