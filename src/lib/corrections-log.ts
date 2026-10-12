import data from "@/lib/guidance-data/corrections-log.data.json";
export const correctionsLog = data;
export const correctionsCopy = {
  de: {
    title: "Korrekturen im Fragenpool", intro: "Was wir an unserem Lernmaterial für Österreich überarbeitet haben.",
    scope: "Gezählt werden Fragen mit Korrektur-Tags, auch inaktive Fragen. Jede Frage zählt pro Pool und Monat einmal. Die Kategorien können sich überschneiden. Diese Übersicht belegt weder den genauen Änderungstag noch sämtliche Änderungen.",
    checked: "Geprüft am", against: "anhand von", reported: "Status: dokumentiert (reported)",
    questions: "Fragen", empty: "Noch keine datierten Korrektur-Tags erfasst.",
    home: "Startseite", guide: "Prüfungsweg Wien", language: "English", otherLang: "en", nav: "Seitennavigation", date: "Monat",
    stale: "Diese Übersicht ist eine Momentaufnahme. Spätere Korrekturen erscheinen nach der nächsten Aktualisierung.",
    banks: { kenntnispruefung: "Wien: SIP-Lernmaterial", kmp_innsbruck: "Stichprobentest (Innsbruck)", pharma: "Rezeptierkunde: Pharmakologie" },
    reasons: { wording: "Fragetext oder Präfix überarbeitet", answer: "Antwortschlüssel korrigiert", review: "Inhalt geprüft oder gepflegt" },
  },
  en: {
    title: "Question-bank corrections", intro: "Recorded maintenance of our study material for Austrian exams.",
    scope: "Counts cover questions with correction tags, including inactive questions. Each question counts once per bank and month. Categories may overlap. This log does not establish the exact change day or cover every edit.",
    checked: "Checked on", against: "against", reported: "Status: documented (reported)",
    questions: "questions", empty: "No dated correction tags recorded yet.",
    home: "Home", guide: "Vienna exam pathway", language: "Deutsch", otherLang: "de", nav: "Page navigation", date: "Month",
    stale: "This is a snapshot. Later corrections appear after the next refresh.",
    banks: { kenntnispruefung: "Vienna: SIP study material", kmp_innsbruck: "Stichprobentest (Innsbruck)", pharma: "Rezeptierkunde: pharmacology" },
    reasons: { wording: "Question wording or prefix revised", answer: "Answer key corrected", review: "Content reviewed or maintained" },
  },
} as const;
