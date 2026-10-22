
import { billingSurfaceText } from "@/lib/billing-copy";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import ExamLandingShell, {
  type ExamLandingContent,
} from "@/components/seo/ExamLandingShell";
import { getOpenOfficialDeadlines } from "@/lib/exam-dates";
import { formatSittingWhen, formatWindow, td } from "@/lib/i18n-dates";
import { pharmaNextAnswer } from "@/lib/pharma-window";
import { rulesForExam } from "@/lib/exam-formats";


/**
 * /pharmakologie-pruefung-wien — Pharmakologie landing page.
 *
 * Unique to this page:
 *   - MedUni Wien publishes term-specific Rezeptierkunde exam weeks.
 *
 * Practice material: Rezeptierkunde collection; counts are not pinned here.
 */

export const dynamic = "force-dynamic";

/** Vienna and Innsbruck formats come from the one sourced rule table (pick-pharma-format-copy A). */
function rule(id: string) {
  const found = rulesForExam("rezeptierkunde").find((r) => r.id === id);
  if (!found) throw new Error(`missing exam-format rule ${id}`);
  return found;
}

function getContent(): ExamLandingContent {
  const sitting = getOpenOfficialDeadlines({ exams: ["rezeptierkunde"] })[0];
  const vienna = rule("rx.format");
  const innsbruck = rule("rx.innsbruck");
  return {
  examName: {
    de: "Pharmakologie-Prüfung Wien",
    en: "Vienna Pharmakologie Exam",
  },
  eyebrow: {
    de: "Österreich · Wien · Pharmakologie · Rezeptierkunde",
    en: "Austria · Vienna · Pharmacology · Prescribing",
  },
  heroTitle: {
    de: "Bereiten Sie sich auf Rezeptierkunde und Pharmakologie in Wien vor.",
    en: "Prepare for Pharmakologie and prescribing in Vienna.",
  },
  heroSubtitle: {
    de: "Übungsfragen zu Rezeptierkunde und klinischer Pharmakologie, mit Erklärungen, für die Ergänzungsprüfung an der MedUni Wien.",
    en: "Practice questions on prescribing and clinical pharmacology, with explanations, for the supplementary exam at MedUni Vienna.",
  },
  officialPharmaWeek: true,
  bank: "pharma",
  rulesPaths: ["/exam-formats/rezeptierkunde", "/exam-formats/gerichtsmedizin", "/exam-formats/pruefungsraum"],
  primaryCtaHref: "/quiz?exam=pharma&free=1",
  primaryCtaLabel: {
    de: "Free starten: 150 Pharma Fragen",
    en: "Start free: 150 Pharma questions",
  },
  secondaryCtaHref: "/pricing",
  guidanceLink: {
    href: "/wien-route/rez-gm-anmeldung",
    label: {
      de: "Rezeptierkunde und Gerichtsmedizin anmelden: Fristen und Formulare",
      en: "Register for Rezeptierkunde and Gerichtsmedizin: deadlines and forms",
    },
  },
  // a-v2-copy-surfaces-1021 (copy audit item 5): no Cohort in the v2 offer.
  secondaryCtaLabel: pricingV2Enabled()
    ? { de: "Tarife ansehen", en: "See plans" }
    : { de: "Prüfungs-Kohorte ansehen", en: "See Exam Cohort" },
  // MedUni Wien Rezeptierkunde calendar, WS 2026/27, checked 2026-10-11. date-ok: source verification stamp
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
      value: {
        de: sitting ? formatSittingWhen(sitting, "de") : td("picker_no_official", "de"),
        en: sitting ? formatSittingWhen(sitting, "en") : td("picker_no_official", "en"),
      },
      sub: {
        de: sitting ? `${formatWindow(sitting, "de")}, ${sitting.closes_at_time} Uhr (Wien)` : "",
        en: sitting ? `${formatWindow(sitting, "en")}, ${sitting.closes_at_time} Vienna time` : "",
      },
    },
    {
      // a-pricing-v2: the Guarantee Ticket replaces the Cohort in the offer.
      label: pricingV2Enabled() ? { de: "Garantie-Ticket", en: "Guarantee Ticket" } : { de: "Prüfungs-Kohorte", en: "Exam Cohort" },
      value: billingSurfaceText("pharmakologie_pruefung_wien_page_tsx_0", "de"),
      sub: pricingV2Enabled()
        ? { de: "12 Monate · Verlängerungsjahre auf Nachweis", en: "12 months · renewal years on proof" }
        : { de: "6 Monate · Pass-Until-You-Pass", en: "6 months · Pass-Until-You-Pass" },
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
      de: `Prüfungsformat in ${vienna.title.de}. Prüfen Sie die Ausschreibung Ihres Termins.`,
      en: `Exam format in ${vienna.title.en}. Check the announcement for your sitting.`,
    },
    pricingV2Enabled()
      ? {
          de: "Garantie-Ticket: Auf Nachweis eines nicht bestandenen Ergebnisses oder einer Anmeldung zu einem Prüfungstermin nach dem Ende des Tickets verlängern wir es kostenlos um ein Jahr, höchstens zweimal.",
          en: "Guarantee Ticket: on proof of a failed result or of a registration for a sitting after the ticket ends we extend it by one year free of charge, at most twice.",
        }
      : {
          de: "Pass-Until-You-Pass auf der Prüfungs-Kohorte: Wenn Sie nicht bestehen, verlängern wir Ihren Zugang kostenlos bis zur nächsten Prüfung (maximal zwei zusätzliche Zyklen).",
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
        de: `${vienna.text.de} Andere Universitäten prüfen anders: ${innsbruck.text.de} Alle Regeln mit Quellen: medpruf.com/exam-formats/rezeptierkunde. MedPrüfs Pharma-Bank bietet Übungsfragen zur Rezeptierkunde und klinischen Pharmakologie, keine Simulation der offiziellen Prüfung.`,
        en: `${vienna.text.en} Other universities examine differently: ${innsbruck.text.en} All rules with sources: medpruf.com/exam-formats/rezeptierkunde. MedPrüf's Pharma bank offers practice in prescribing and clinical pharmacology, not a simulation of the official exam.`,
      },
    },
    {
      q: {
        de: "Wann ist die nächste Pharmakologie-Prüfung?",
        en: "When is the next Pharmakologie exam?",
      },
      a: {
        de: pharmaNextAnswer("de"),
        en: pharmaNextAnswer("en"),
      },
    },
    {
      q: {
        de: "Warum ist die Pharmakologie-Prüfung separat von der Kenntnisprüfung?",
        en: "Why is Pharmakologie separate from the Kenntnisprüfung?",
      },
      a: {
        de: "Welche Ergänzungsprüfungen Sie ablegen müssen, ergibt sich aus Ihrem Bescheid und den Anforderungen Ihrer Universität. MedUni Wien führt Rezeptierkunde im universitären Nostrifikationsverfahren auf. MedPrüfs Pharma-Fragenbank ist Lernmaterial, keine Prüfung der Ärztekammer Wien.",
        en: "Your decision and university requirements determine which supplementary examinations you need. MedUni Vienna lists prescribing within its university nostrification process. MedPrüf’s Pharma bank is study material, not an examination run by the Vienna Medical Chamber.",
      },
    },
    {
      q: pricingV2Enabled()
        ? { de: "Was ist das Garantie-Ticket und wie funktionieren die Verlängerungsjahre?", en: "What is the Guarantee Ticket and how do the renewal years work?" }
        : { de: "Was ist die Prüfungs-Kohorte und wie funktioniert Pass-Until-You-Pass?", en: "What is the Exam Cohort and how does Pass-Until-You-Pass work?" },
      a: {
        de: billingSurfaceText("pharmakologie_pruefung_wien_page_tsx_3", "de"),
        en: billingSurfaceText("pharmakologie_pruefung_wien_page_tsx_4", "en"),
      },
    },
    {
      q: {
        de: "Unterscheidet sich die Prüfung in Wien von Innsbruck?",
        en: "Does the Vienna Pharmakologie exam differ from Innsbruck?",
      },
      a: {
        de: "Formate, Inhalte und Termine sind institutionenspezifisch. Eine Zuordnung zu einer eigenständigen Ärztekammer-Prüfung ist hier nicht belegt. Klären Sie die genaue Prüfung mit Ihrer Universität anhand Ihres Bescheids.",
        en: "Formats, content and dates are institution-specific. A mapping to a separate Medical Chamber examination is not established here. Confirm your exact examination with your university and your decision.",
      },
    },
    {
      q: {
        de: "Kann ich die Pharma-Prüfung ohne die Kenntnisprüfung ablegen?",
        en: "Can I take the Pharma exam without the Kenntnisprüfung?",
      },
      a: {
        de: "Welche Prüfungen Sie benötigen und ob Sie sie getrennt anmelden können, bestätigt Ihre Universität anhand Ihres Bescheids. Die Auswahl einer MedPrüf-Fragenbank ersetzt diese Bestätigung nicht. Sie können zwischen den Fragenbanken wechseln, ohne Ihren Lernfortschritt zu verlieren.",
        en: "Your university confirms which examinations you need and whether you can register for them separately, based on your decision. Selecting a MedPrüf bank does not replace that confirmation. You can switch between banks without losing your study progress.",
      },
    },
    {
      q: {
        de: "Welche Quellen nutzen die Fragen und Erklärungen?",
        en: "What sources do the questions and explanations use?",
      },
      a: {
        de: "Die Pharma-Bank enthält Übungsmaterial aus der Rezeptierkunde-Sammlung. Sie ist keine Sammlung offiziell veröffentlichter Prüfungsfragen und bestätigt keine vollständige Prüfungsabdeckung. KI-generierte Erklärungen sind Lernhilfen und können Fehler enthalten. Prüfen Sie klinische Aussagen anhand aktueller Fachinformationen und Leitlinien.",
        en: "The Pharma bank contains practice material from the prescribing collection. It is not a collection of officially published exam questions and does not establish complete exam coverage. AI-generated explanations are study aids and may contain errors. Check clinical claims against current drug information and guidelines.",
      },
    },
  ],
};
}

export default function PharmakologiePage() {
  return <ExamLandingShell content={getContent()} />;
}
