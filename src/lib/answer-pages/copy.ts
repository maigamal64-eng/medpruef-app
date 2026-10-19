// Code-owned strings of the answer pages (lead, free-sample block, FAQ answers
// generated from OFFICIAL_SITTINGS). Formal Sie, no dashes; copy-lint scope.
import type { OfficialExamKey } from "@/lib/exam-dates";
import { formatGuidanceDate } from "@/lib/guidance/facts";
import { daysLeftText } from "@/lib/i18n-dates";
import type { LeadEntry, LeadRow, LeadSitting } from "./lead";
import type { AnswerLang } from "./types";

export const EXAM_NAMES: Record<OfficialExamKey, { de: string; en: string }> = {
  sip4a: { de: "SIP4a (MedUni Wien)", en: "SIP4a (MedUni Vienna)" },
  sip5a: { de: "SIP5a (MedUni Wien)", en: "SIP5a (MedUni Vienna)" },
  stichprobentest: { de: "Stichprobentest", en: "Stichprobentest" },
  rezeptierkunde: { de: "Rezeptierkunde (Pharmakologie)", en: "Rezeptierkunde (pharmacology)" },
  gerichtsmedizin: { de: "Gerichtsmedizin", en: "Gerichtsmedizin (forensic medicine)" },
  c1: { de: "C1-Nachweis", en: "C1 certificate" },
  general: { de: "Nostrifizierung", en: "Nostrification" },
  fsp: { de: "Fachsprachprüfung", en: "Medical German exam" },
};

export const ANSWER_UI = {
  de: {
    kicker: "Kurze Antwort",
    leadHeading: "Nächster offizieller Termin",
    leadNote: "Termine aus den offiziellen Quellen, Wiener Zeit. Maßgeblich sind immer die Angaben der Universität.",
    exam: "Prüfung",
    none: "Derzeit ist kein weiterer offizieller Termin veröffentlicht.",
    nextOpen: "Nächstes Anmeldefenster",
    answerHeading: "Die Antwort",
    faqHeading: "Häufige Fragen",
    sourcesHeading: "Quellen",
    relatedHeading: "Weiterlesen",
    checked: "Inhalt geprüft am",
    read: "gelesen am",
    source: "Quelle",
    inLanguage: "de-AT",
    notConfirmed: "Nicht offiziell bestätigt",
    sampleHeading: "Kostenlose Probe",
    sampleText: "Üben Sie mit der kostenlosen Probe: {freeQuestions} kuratierte Übungsfragen pro Fragenbank, ohne Karte. Erklärungen lassen sich in Ihre Sprache übersetzen (maschinell übersetzt, mit Tageslimit für kostenlose Konten). Es sind keine offiziellen Prüfungsfragen.",
    sampleCta: "Kostenlose Probe starten",
    back: "Zurück zum Blog",
    allAnswers: "Weitere kurze Antworten",
    articleKicker: "Ratgeber",
    articleAnswerHeading: "Das Wichtigste in Kürze",
    nextStepHeading: "Ihr nächster Schritt",
    nextStepText: "Wählen Sie Ihren offiziellen Termin und Ihre Lernstunden pro Woche. Der Lernplan verteilt die Themen Ihrer Fragenbank auf die Wochen bis zur Prüfung, ohne Konto.",
    nextStepCta: "Lernplan bis zu Ihrem Termin erstellen",
    guidesHeading: "Ratgeber für die Nostrifizierung in Österreich",
    guidesIntro: "Ablauf, Termine, Prüfungen und Deutsch: mit Links zu den offiziellen Seiten der Universitäten.",
  },
  en: {
    kicker: "Short answer",
    leadHeading: "Next official sitting",
    leadNote: "Dates from the official sources, Vienna time. The university's own information always decides.",
    exam: "Exam",
    none: "No further official sitting is published at the moment.",
    nextOpen: "Next registration window",
    answerHeading: "The answer",
    faqHeading: "Frequently asked questions",
    sourcesHeading: "Sources",
    relatedHeading: "Read more",
    checked: "Content checked on",
    read: "read on",
    source: "Source",
    inLanguage: "en",
    notConfirmed: "Not officially confirmed",
    sampleHeading: "Free sample",
    sampleText: "Practise with the free sample: {freeQuestions} curated practice questions per question bank, no card needed. Explanations can be translated into your language (machine translated, with a daily limit for free accounts). They are not official exam questions.",
    sampleCta: "Start the free sample",
    back: "Back to the blog",
    allAnswers: "More short answers",
    articleKicker: "Guide",
    articleAnswerHeading: "In short",
    nextStepHeading: "Your next step",
    nextStepText: "Pick your official sitting and your study hours a week. The study plan spreads the topics of your question bank over the weeks up to the exam, no account needed.",
    nextStepCta: "Build a study plan to your sitting",
    guidesHeading: "Guides to nostrification in Austria",
    guidesIntro: "Procedure, dates, exams and German: with links to the universities' official pages.",
  },
} as const;

const d = (iso: string, lang: AnswerLang) => formatGuidanceDate(iso, lang);

import { publisherName } from "@/lib/publisher-names";
export { publisherName };

/** Sentence builders per language (a lookup, so ru/uk/tr/ar can be added after native review). */
const SENTENCES = {
  de: {
    range: (from: string, to: string) => `${from} bis ${to}`,
    closeAt: (date: string, time: string) => `${date}, ${time} Uhr`,
    filing: "Einreichungsfrist",
    registration: "Anmeldefrist",
    unconfirmed: (who: string) => `${who}: Anmeldefenster noch nicht bestätigt.`,
    closed: (who: string, kind: string, close: string) => `${who}: ${kind} abgelaufen (${close}).`,
    upcoming: (who: string, open: string, close: string) => `${who}: Anmeldung vom ${open} bis ${close}.`,
    open: (who: string, kind: string, close: string, left: string) => `${who}: ${kind} bis ${close} (${left}).`,
    question: (name: string) => `${name}: Wann ist der nächste offizielle Termin?`,
    none: "Prüfen Sie die offiziellen Angaben der Universität.",
    source: (publisher: string, read: string) => `Quelle: ${publisher}, gelesen am ${read}.`,
  },
  en: {
    range: (from: string, to: string) => `${from} to ${to}`,
    closeAt: (date: string, time: string) => `${date}, ${time}`,
    filing: "submission deadline",
    registration: "registration deadline",
    unconfirmed: (who: string) => `${who}: registration window not confirmed yet.`,
    closed: (who: string, kind: string, close: string) => `${who}: ${kind} passed (${close}).`,
    upcoming: (who: string, open: string, close: string) => `${who}: registration from ${open} to ${close}.`,
    open: (who: string, kind: string, close: string, left: string) => `${who}: ${kind} ${close} (${left}).`,
    question: (name: string) => `${name}: when is the next official sitting?`,
    none: "Check the university's official information.",
    source: (publisher: string, read: string) => `Source: ${publisher}, read on ${read}.`,
  },
} as const;

export function sittingDateText(s: Pick<LeadSitting, "date" | "date_end">, lang: AnswerLang): string {
  return s.date_end ? SENTENCES[lang].range(d(s.date, lang), d(s.date_end, lang)) : d(s.date, lang);
}

function closeText(row: LeadRow, lang: AnswerLang): string {
  const close = d(row.sitting.registration_closes!, lang);
  return row.sitting.closes_at_time ? SENTENCES[lang].closeAt(close, row.sitting.closes_at_time) : close;
}

/** One line per publisher: what the deadline is and its state today. */
export function rowText(row: LeadRow, lang: AnswerLang, now: Date): string {
  const t = SENTENCES[lang];
  const s = row.sitting;
  const who = publisherName(s.publisher, lang);
  const kind = s.deadline_type === "filing_cutoff" ? t.filing : t.registration;
  if (row.state === "unconfirmed") return t.unconfirmed(who);
  if (row.state === "closed") return t.closed(who, kind, closeText(row, lang));
  if (row.state === "upcoming" && s.registration_opens) return t.upcoming(who, d(s.registration_opens, lang), closeText(row, lang));
  return t.open(who, kind, closeText(row, lang), daysLeftText(s.registration_closes!, lang, now));
}

/** Plain-text question for the code-generated "next sitting" FAQ entry. */
export function nextSittingQuestion(exam: OfficialExamKey, lang: AnswerLang): string {
  return SENTENCES[lang].question(EXAM_NAMES[exam][lang]);
}

export function nextSittingAnswer(entry: LeadEntry, lang: AnswerLang, now: Date): string {
  const t = SENTENCES[lang];
  const ui = ANSWER_UI[lang];
  if (!entry.next) return `${ui.none} ${t.none}`;
  const describe = (g: LeadSitting) => [`${g.label[lang]}: ${sittingDateText(g, lang)}.`, ...g.rows.map((r) => rowText(r, lang, now))].join(" ");
  const parts = [describe(entry.next)];
  if (entry.nextOpen) parts.push(`${ui.nextOpen}: ${describe(entry.nextOpen)}`);
  const rows = [...entry.next.rows, ...(entry.nextOpen?.rows ?? [])];
  const sources = [...new Map(rows.map((r) => [r.sitting.source_url, r.sitting])).values()].map((s) => t.source(publisherName(s.publisher, lang), d(s.read_on, lang)));
  return [...parts, ...sources].join(" ");
}
