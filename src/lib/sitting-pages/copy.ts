import type { SittingExamKey } from "./index";

/**
 * Template copy of the sitting pages (a-sitting-pages). German in formal Sie,
 * English alongside. No price, no offer, no pass promise, no medical line.
 * Dates and windows come from the page model, never from this file.
 */
export type SittingLang = "de" | "en";

interface Copy {
  jsonLdDescription: string;
  lede: string;
  sittingHeading: string;
  examDay: (date: string) => string;
  examWeek: (from: string, to: string) => string;
  registrationHeading: string;
  kind: { registration: string; filing: string };
  opens: string;
  closes: string;
  closesAt: (time: string) => string;
  viennaTime: string;
  noClose: string;
  state: { open: string; running: string; upcoming: string; closed: string };
  twoPublishers: string;
  official: string;
  sourceStamp: (publisher: string, readOn: string) => string;
  nextHeading: string;
  next: Record<SittingExamKey, string>;
  readHeading: string;
  prepareHeading: string;
  plan: string;
  planNote: string;
  calendar: string;
  calendarNote: string;
  sample: string;
  sampleNote: string;
  sampleNoteGm: string;
  siblingLead: string;
  frozen: string;
  disclaimer: string;
  allSittings: string;
  language: string;
  metaTitle: (label: string, date: string | null) => string;
  metaDescription: (label: string, date: string | null) => string;
}

export const SITTING_COPY: Record<SittingLang, Copy> = {
  de: {
    jsonLdDescription: "Prüfungstermin laut offizieller Quelle. Informationsseite von MedPrüf, nicht von der Universität.",
    lede: "Diese Seite fasst den veröffentlichten Termin, die Fristen und die offiziellen Quellen zusammen. Sie ist eine Informationsseite von MedPrüf und keine Seite der Universität. Maßgeblich ist immer die offizielle Seite.",
    sittingHeading: "Termin",
    examDay: (d) => `Prüfung am ${d}`,
    examWeek: (a, b) => `Prüfungswoche vom ${a} bis ${b}`,
    registrationHeading: "Anmeldung und Fristen",
    kind: { registration: "Anmeldefrist", filing: "Einreichungsfrist für den Antrag" },
    opens: "Beginn",
    closes: "Ende",
    closesAt: (t) => `${t} Uhr`,
    viennaTime: "Wiener Zeit",
    noClose: "Für diese Stelle ist keine Frist veröffentlicht.",
    state: {
      open: "Das Fenster ist offen.",
      running: "Die Frist ist noch nicht abgelaufen.",
      upcoming: "Das Fenster hat noch nicht begonnen.",
      closed: "Das Fenster ist geschlossen.",
    },
    twoPublishers:
      "Für denselben Termin sind zwei Fristen von zwei Stellen veröffentlicht. Welche für Sie gilt, bestätigt die Universität, bei der Sie Ihren Antrag eingereicht haben.",
    official: "Zur offiziellen Seite",
    sourceStamp: (p, d) => `Quelle: ${p}, gelesen am ${d}.`,
    nextHeading: "Der nächste Schritt",
    next: {
      sip4a: "Prüfen Sie die Anmeldung auf der offiziellen Seite und lesen Sie danach Format und Regeln der Prüfung.",
      sip5a: "Prüfen Sie die Anmeldung auf der offiziellen Seite und lesen Sie danach Format und Regeln der Prüfung.",
      stichprobentest:
        "Bestätigen Sie die Frist bei der Universität, bei der Sie Ihren Antrag eingereicht haben. Nach dem Test entscheidet das Ergebnis, welche weiteren Prüfungen folgen.",
      rezeptierkunde: "Prüfen Sie die Anmeldung auf der offiziellen Seite und lesen Sie danach Format und Regeln der Prüfung.",
      gerichtsmedizin: "Prüfen Sie die Anmeldung auf der offiziellen Seite und lesen Sie danach Format und Regeln der Prüfung.",
    },
    readHeading: "Weiterlesen",
    prepareHeading: "Bis zum Termin",
    plan: "Lernplan für diesen Termin",
    planNote: "Der Termin ist im Lernplan vorausgewählt.",
    calendar: "Termine als Kalender abonnieren",
    calendarNote: "Eine Kalenderdatei mit Beginn, Ende und Prüfungstag dieser Prüfung.",
    sample: "Mit der kostenlosen Probe beginnen",
    sampleNote: "Kostenlose Probe, ohne Zahlungsdaten.",
    sampleNoteGm: "Kostenlose Probe der Pharmakologie, ohne Zahlungsdaten. Gerichtsmedizin ist darin nicht enthalten.",
    siblingLead: "Dieselbe Prüfungswoche:",
    frozen:
      "Die Termine werden gerade gegen die offizielle Quelle geprüft und sind hier vorübergehend ausgeblendet. Bitte nutzen Sie die offizielle Seite.",
    disclaimer:
      "MedPrüf ist nicht mit den genannten Universitäten verbunden und wird von ihnen nicht empfohlen. Fristen und Regeln können sich ändern; prüfen Sie sie vor jeder Anmeldung auf der offiziellen Seite.",
    allSittings: "Alle Prüfungstermine",
    language: "Sprache",
    metaTitle: (l, d) => `${l}${d ? `, ${d}` : ""}: Anmeldung und Frist | MedPrüf`,
    metaDescription: (l, d) =>
      `${l}${d ? ` am ${d}` : ""}: veröffentlichte Anmeldefenster, Fristen und der Link zur offiziellen Seite, mit Lesedatum.`,
  },
  en: {
    jsonLdDescription: "Exam date according to the official source. Information page by MedPrüf, not by the university.",
    lede: "This page sums up the published sitting, the deadlines and the official sources. It is an information page by MedPrüf, not a page of the university. The official page always decides.",
    sittingHeading: "Sitting",
    examDay: (d) => `Exam on ${d}`,
    examWeek: (a, b) => `Exam week from ${a} to ${b}`,
    registrationHeading: "Registration and deadlines",
    kind: { registration: "Registration deadline", filing: "Filing deadline for the application" },
    opens: "Opens",
    closes: "Closes",
    closesAt: (t) => `${t}`,
    viennaTime: "Vienna time",
    noClose: "No deadline is published for this body.",
    state: {
      open: "The window is open.",
      running: "The deadline has not passed yet.",
      upcoming: "The window has not started yet.",
      closed: "The window is closed.",
    },
    twoPublishers:
      "Two deadlines from two bodies are published for the same sitting. The university where you filed your application confirms which one applies to you.",
    official: "Open the official page",
    sourceStamp: (p, d) => `Source: ${p}, read on ${d}.`,
    nextHeading: "The next step",
    next: {
      sip4a: "Check the registration on the official page, then read the format and rules of the exam.",
      sip5a: "Check the registration on the official page, then read the format and rules of the exam.",
      stichprobentest:
        "Confirm the deadline with the university where you filed your application. After the test, the result decides which further exams follow.",
      rezeptierkunde: "Check the registration on the official page, then read the format and rules of the exam.",
      gerichtsmedizin: "Check the registration on the official page, then read the format and rules of the exam.",
    },
    readHeading: "Keep reading",
    prepareHeading: "Until the sitting",
    plan: "Study plan for this sitting",
    planNote: "The sitting is preselected in the study plan.",
    calendar: "Subscribe to the dates as a calendar",
    calendarNote: "A calendar file with the opening, closing and exam day of this exam.",
    sample: "Start with the free sample",
    sampleNote: "Free sample, no payment details.",
    sampleNoteGm: "Free pharmacology sample, no payment details. Gerichtsmedizin is not part of it.",
    siblingLead: "Same exam week:",
    frozen:
      "The dates are being checked against the official source and are hidden here for now. Please use the official page.",
    disclaimer:
      "MedPrüf is not affiliated with the universities named and is not endorsed by them. Deadlines and rules can change; check them on the official page before every registration.",
    allSittings: "All exam sittings",
    language: "Language",
    metaTitle: (l, d) => `${l}${d ? `, ${d}` : ""}: registration and deadline | MedPrüf`,
    metaDescription: (l, d) =>
      `${l}${d ? ` on ${d}` : ""}: published registration windows, deadlines and the link to the official page, with the read date.`,
  },
};

/** Guidance and format pages that answer the questions of this sitting. */
export const SITTING_READ_LINKS: Record<SittingExamKey, string[]> = {
  sip4a: ["/wien-route/sip-anmeldung", "/exam-formats/sip4a", "/wien-route/sip-regeln"],
  sip5a: ["/wien-route/sip-anmeldung", "/exam-formats/sip5a", "/wien-route/sip-regeln"],
  stichprobentest: ["/exam-formats/stichprobentest", "/wien-route/nach-dem-stichprobentest", "/graz-innsbruck"],
  rezeptierkunde: ["/wien-route/rez-gm-anmeldung", "/exam-formats/rezeptierkunde"],
  gerichtsmedizin: ["/wien-route/rez-gm-anmeldung", "/exam-formats/gerichtsmedizin", "/gerichtsmedizin"],
};
