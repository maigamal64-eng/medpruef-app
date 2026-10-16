/**
 * a-seo-from-gsc copy (shown only while SEO_GSC_COPY_ENABLED is "true").
 * Lektor APPROVE WITH EDITS 15 Oct 2026 (edits applied); German in Sie, Austrian framing only, no dates, no prices,
 * no dashes. Titles at most 60 characters plus " | MedPrüf" where used,
 * descriptions at most 160 characters (test-pinned).
 */
import { FREE_TIER } from "@/lib/content-truth";

const N = FREE_TIER.questions_per_exam_type;

export const SEO_COPY = {
  pages: {
    landing: {
      title: "MedPrüf: Übungsfragen für die Nostrifizierung in Österreich",
      description: `Kuratierte Übungsfragen für SIP4a, SIP5a, Stichprobentest und Rezeptierkunde zur Nostrifizierung in Österreich. ${N} Fragen pro Fragenbank als kostenlose Probe.`,
    },
    kenntnispruefung: {
      title: "SIP4a und SIP5a Wien: Übungsfragen zur Nostrifizierung | MedPrüf",
      description: `Kuratierte Übungsfragen mit Erklärungen zu SIP4a und SIP5a an der MedUni Wien. Nicht für die postgraduale ÖÄK-Arztprüfung. ${N} Fragen als kostenlose Probe.`,
    },
    stichprobentest: {
      title: "Stichprobentest Österreich: Übungsfragen | MedPrüf",
      description: `Übungsfragen mit Erklärungen für den Stichprobentest der Nostrifizierung in Österreich. Keine offiziellen Prüfungsfragen. ${N} Fragen als kostenlose Probe.`,
    },
  },
  scope: {
    de: {
      text: "MedPrüf bietet Übungsfragen für Prüfungen der medizinischen Nostrifizierung in Österreich: SIP4a und SIP5a an der MedUni Wien, den Stichprobentest und Rezeptierkunde. Nicht abgedeckt sind die postgraduale ÖÄK-Arztprüfung und Prüfungen mit ähnlichem Namen in anderen Ländern.",
      link: "Welche Prüfung ist welche?",
    },
    en: {
      text: "MedPrüf offers practice questions for the exams of medical nostrification in Austria: SIP4a and SIP5a at MedUni Vienna, the Stichprobentest and Rezeptierkunde. Not covered: the postgraduate ÖÄK Arztprüfung and exams with similar names in other countries.",
      link: "Which exam is which?",
    },
  },
  hub: {
    de: { title: "Mehr zur Prüfung", answers: "Kurze Antworten", sittings: "Seiten zu den nächsten Prüfungsterminen" },
    en: { title: "More about the exam", answers: "Short answers", sittings: "Pages for the next sittings" },
  },
} as const;
