/**
 * a-seo-from-gsc copy (shown only while SEO_GSC_COPY_ENABLED is "true").
 * Lektor APPROVE WITH EDITS 15 Oct 2026 (edits applied); German in Sie, Austrian framing only, no dates, no prices,
 * no dashes. Titles at most 60 characters plus " | MedPrüf" where used,
 * descriptions at most 160 characters (test-pinned).
 */
import { FREE_TIER } from "@/lib/content-truth";

const N = FREE_TIER.questions_per_exam_type;

/**
 * a-answers-b4-1116 deliverable 1: page-specific search titles and descriptions for guidance routes whose Search Console
 * rows (28 days to 16 Nov 2026) show impressions with almost no clicks. Shown only while SEO_GSC_COPY_ENABLED is "true",
 * like the rest of this file; keyed by route path, DE (Sie) and EN. Titles stay under 60 characters with " | MedPrüf",
 * descriptions under 155, no dates, no prices, no "official" for our own content (the pages quote official sources).
 */
export const GUIDANCE_SEO_COPY: Record<string, { de: { title: string; description: string }; en: { title: string; description: string } }> = {
  "/wien-route": {
    de: {
      title: "Prüfungsweg Wien: Anmeldung und Fristen",
      description: "Anmelden, Fristen prüfen, nächsten Schritt kennen: Anmeldefenster für SIP4a, SIP5a, Rezeptierkunde und Gerichtsmedizin an der MedUni Wien, mit Quellen.",
    },
    en: {
      title: "Vienna exam pathway: registration and deadlines",
      description: "Register, check deadlines, know the next step: registration windows for SIP4a, SIP5a, Rezeptierkunde and Gerichtsmedizin at MedUni Vienna, with sources.",
    },
  },
  "/wien-route/sip-regeln": {
    de: {
      title: "SIP-Prüfung Wien: Regeln, Bestehen, Wiederholung",
      description: "SIP4a und SIP5a an der MedUni Wien: mindestens 60 Prozent insgesamt und je Block oder Tertial, Teile, Wiederholung und Abmeldung. Mit Quellen.",
    },
    en: {
      title: "SIP exam Vienna: rules, passing, repeats",
      description: "SIP4a and SIP5a at MedUni Vienna: at least 60 percent overall and per block or tertial, parts, repeats and withdrawal. With sources.",
    },
  },
  "/exam-formats/sip4a": {
    de: {
      title: "SIP4a MedUni Wien: Blöcke, Punkte, Bestehen",
      description: "SIP4a für Nostrifikant:innen: Blöcke 25 bis 27, Multiple Choice oder Kurzantworten, mindestens 60 Prozent insgesamt und je Block. Mit Quellen.",
    },
    en: {
      title: "SIP4a MedUni Vienna: blocks, scoring, passing",
      description: "SIP4a for nostrification applicants: blocks 25 to 27, multiple choice or short answers, at least 60 percent overall and per block. With sources.",
    },
  },
  "/exam-formats/sip5a": {
    de: {
      title: "SIP5a MedUni Wien: Tertiale, Punkte, Bestehen",
      description: "SIP5a für Nostrifikant:innen: sieben Tertiale von Neurologie bis Notfall- und Intensivmedizin, mindestens 60 Prozent insgesamt und je Tertial.",
    },
    en: {
      title: "SIP5a MedUni Vienna: tertials, scoring, passing",
      description: "SIP5a for nostrification applicants: seven tertials from neurology to emergency and intensive care medicine, at least 60 percent overall and per tertial.",
    },
  },
  "/pruefungskalender": {
    de: {
      title: "Prüfungskalender MedUni Wien: Termine, Quellen",
      description: "Termine und Anmeldefristen zur Nostrifizierung in Österreich: SIP4a, SIP5a, Rezeptierkunde, Stichprobentest, mit Quellen und offenen Punkten.",
    },
    // The ?lang=en URL also ranks for German queries (prüfungskalender meduni wien), so the English title names them.
    en: {
      title: "Prüfungskalender MedUni Wien: exam dates",
      description: "Exam dates and registration deadlines for nostrification in Austria: SIP4a, SIP5a, Rezeptierkunde, Stichprobentest, with sources and open points.",
    },
  },
};

export const SEO_COPY = {
  pages: {
    landing: {
      title: "MedPrüf: Übungsfragen für die Nostrifizierung in Österreich",
      description: `Kuratierte Übungsfragen für SIP4a, SIP5a, Stichprobentest und Rezeptierkunde zur Nostrifizierung in Österreich. ${N} Fragen pro Fragenbank als kostenlose Probe.`,
    },
    // a-search-fixes-1027: the page drew "Kenntnisprüfung" impressions at 1.2% CTR with a title that never named it.
    // a-kp-landing-lead-1113: lead refresh, says what is practised first (the Germany line lives in the page lead: the copy guard bans it in meta).
    // "Kenntnisprüfung Wien" is the bank label (SoT 0.1), scoped to SIP4a/SIP5a and kept apart from the ÖÄK exam.
    kenntnispruefung: {
      title: "Kenntnisprüfung Wien: SIP4a und SIP5a (MedUni Wien) üben | MedPrüf",
      description: `Fragen zu SIP4a und SIP5a der MedUni Wien mit Erklärungen, nicht zur ÖÄK-Arztprüfung. ${N} Fragen als kostenlose Probe.`,
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
