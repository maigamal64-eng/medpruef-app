import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";

/**
 * /pharmakologie-pruefung-wien — Pharmakologie landing page.
 *
 * Unique to this page:
 *   - MedUni Wien publishes term-specific Rezeptierkunde exam weeks.
 *
 * Practice material: Rezeptierkunde collection; counts are not pinned here.
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
  // MedUni Wien Rezeptierkunde calendar, WS 2026/27, checked 2026-10-11.
  breakdown: [
    {
      label: { de: "Übungsbank", en: "Practice bank" },
      value: "Rezeptierkunde",
      sub: {
        de: "Rezeptierkunde + klinische Pharma",
        en: "Prescribing + clinical pharma",
      },
    },
    {
      label: { de: "Prüfungstermin", en: "Exam date" },
      value: { de: "23. bis 27. Nov.", en: "23 to 27 Nov." },
      sub: {
        de: "2026 · Anmeldung bis 20. Okt., 12:00 Uhr (Wien)",
        en: "2026 · Register by 20 Oct, 12:00 Vienna time",
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
        de: "Für das Wiener Nostrifikationsverfahren werden Rezeptierkunde (Pharmakologie) und Gerichtliche Medizin als Ergänzungsprüfungen vorgeschrieben. Die aktuellen offiziellen Anmeldeseiten beschreiben kein Prüfungsformat. Kläre Inhalte und Ablauf mit der Universität anhand deines Bescheids. MedPrüfs Pharma-Bank bietet Übungsfragen zur Rezeptierkunde und klinischen Pharmakologie, keine bestätigte Simulation der offiziellen Prüfung.",
        en: "Vienna nostrification requires supplementary examinations in prescribing (pharmacology) and forensic medicine. The current official registration pages do not describe the exam format. Confirm content and procedure with the university using your decision letter. MedPrüf’s Pharma bank offers practice in prescribing and clinical pharmacology, not a verified simulation of the official exam.",
      },
    },
    {
      q: {
        de: "Wann ist die nächste Pharmakologie-Prüfung?",
        en: "When is the next Pharmakologie exam?",
      },
      a: {
        de: "MedUni Wien veröffentlicht für Rezeptierkunde und Gerichtsmedizin die Prüfungswochen 23. bis 27. November 2026 und 18. bis 22. Januar 2027. Anmeldung: 7. bis 20. Oktober 2026 bzw. 2. bis 15. Dezember 2026, jeweils bis Dienstag um 12:00 Uhr (Wien). Beide Prüfungen werden separat mit dem jeweiligen Formular vom MedUni-E-Mail-Konto angemeldet. Prüfungswochen für das Sommersemester 2027 sind noch nicht veröffentlicht. Stand: 11. Oktober 2026, offizieller Prüfungskalender WS 2026/27: https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/pruefungen/",
        en: "MedUni Vienna lists exam weeks for prescribing and forensic medicine on 23 to 27 November 2026 and 18 to 22 January 2027. Registration runs from 7 to 20 October 2026 and from 2 to 15 December 2026 respectively, closing on Tuesday at 12:00 Vienna time. Register separately for each exam using its form and your MedUni email account. Summer-semester 2027 exam weeks have not yet been published. Checked on 11 October 2026 against the official WS 2026/27 exam calendar: meduniwien.ac.at (Nostrifizierung, Prüfungen).",
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
        de: "Die Pharma-Bank enthält Übungsmaterial aus der Rezeptierkunde-Sammlung. Sie ist keine Sammlung offiziell veröffentlichter Prüfungsfragen und bestätigt keine vollständige Prüfungsabdeckung. KI-generierte Erklärungen sind Lernhilfen und können Fehler enthalten. Prüfe klinische Aussagen anhand aktueller Fachinformationen und Leitlinien.",
        en: "The Pharma bank contains practice material from the prescribing collection. It is not a collection of officially published exam questions and does not establish complete exam coverage. AI-generated explanations are study aids and may contain errors. Check clinical claims against current drug information and guidelines.",
      },
    },
  ],
};

export default function PharmakologiePage() {
  return <ExamLandingShell content={content} />;
}
