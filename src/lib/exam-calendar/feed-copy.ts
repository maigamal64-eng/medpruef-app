/**
 * Calendar-feed copy (a-exam-calendar-feed). German learner copy uses Sie.
 * No dates, prices or offers in the strings: dates come from OFFICIAL_SITTINGS
 * at render time. Lektor gate: see tests/unit/a-exam-calendar-feed/copy.test.ts.
 */
export type FeedLang = "de" | "en";

export const FEED_COPY = {
  de: {
    calPublic: "MedPrüf: Prüfungstermine in Österreich",
    calPersonal: "Meine Prüfung (MedPrüf)",
    calDesc: "Offizielle Termine der österreichischen Prüfungen für im Ausland ausgebildete Ärztinnen und Ärzte, jeweils mit Quelle, dazu ein Lernhinweis von MedPrüf vier Wochen vor der Prüfung. Bitte prüfen Sie Fristen vor wichtigen Schritten auf der offiziellen Seite.",
    opens: "Anmeldung beginnt",
    closesRegistration: "Anmeldung endet",
    closesFiling: "Einreichungsfrist endet",
    closesBoth: "Anmelde- bzw. Einreichungsfrist endet",
    t28: "Lernhinweis: noch vier Wochen bis zur Prüfung",
    exam: "Prüfung",
    examWeek: "Prüfungswoche",
    opensText: "Laut offizieller Quelle beginnt heute die Anmeldung.",
    closesText: "Laut offizieller Quelle ist heute der letzte Tag der Frist",
    closesTime: (t: string) => ` (bis ${t} Uhr, Wiener Zeit)`,
    t28Text: "Lernhinweis von MedPrüf, kein offizieller Termin: In vier Wochen findet die Prüfung laut offizieller Quelle statt.",
    examText: "Laut offizieller Quelle findet die Prüfung heute statt.",
    examWeekText: "Laut offizieller Quelle findet die Prüfung in dieser Woche statt.",
    source: (p: string) => `Quelle: ${p}.`,
    official: "Offizielle Seite:",
    readOn: (d: string) => `Quelle gelesen am ${d}. Bitte prüfen Sie Fristen vor wichtigen Schritten auf der offiziellen Seite.`,
    backPersonal: "Ihr Lernplan in MedPrüf:",
    backPublic: "Alle Termine bei MedPrüf:",
    alarm: (s: string) => `Morgen endet eine Frist: ${s}`,
  },
  en: {
    calPublic: "MedPrüf: exam dates in Austria",
    calPersonal: "My exam (MedPrüf)",
    calDesc: "Official dates of the Austrian exams for internationally trained doctors, each with its source, plus a MedPrüf study reminder four weeks before the exam. Please check deadlines on the official page before any important step.",
    opens: "registration opens",
    closesRegistration: "registration closes",
    closesFiling: "filing deadline",
    closesBoth: "registration or filing deadline",
    t28: "Study reminder: four weeks to the exam",
    exam: "exam",
    examWeek: "exam week",
    opensText: "According to the official source, registration opens today.",
    closesText: "According to the official source, today is the last day of the deadline",
    closesTime: (t: string) => ` (until ${t}, Vienna time)`,
    t28Text: "Study reminder from MedPrüf, not an official date: the exam takes place in four weeks according to the official source.",
    examText: "According to the official source, the exam takes place today.",
    examWeekText: "According to the official source, the exam takes place this week.",
    source: (p: string) => `Source: ${p}.`,
    official: "Official page:",
    readOn: (d: string) => `Source read on ${d}. Please check deadlines on the official page before any important step.`,
    backPersonal: "Your study plan in MedPrüf:",
    backPublic: "All dates at MedPrüf:",
    alarm: (s: string) => `A deadline closes tomorrow: ${s}`,
  },
} as const;

export function parseFeedLang(raw: unknown): FeedLang {
  return raw === "en" ? "en" : "de";
}
