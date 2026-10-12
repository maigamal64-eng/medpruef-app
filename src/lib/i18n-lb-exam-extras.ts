export const EXTRAS_COPY = {
  de: {
    eyebrow: "ÖSTERREICH / PRÜFUNGSWEG", intro: "Ergebnisse, Prüfungsraum und Lernumfang für Ihren Prüfungsweg in Österreich. Jede Regel nennt Quelle, Prüfdatum und Geltungsbereich.",
    back: "Prüfungsformate", navigation: "Weitere Prüfungshilfen", officialNotice: "Ihr Bescheid, die aktuelle Einladung und die Ausschreibung der Universität bestimmen Ihren konkreten Prüfungsweg.",
    status: { official: "Offiziell", reported: "Produktinformation / berichtet", not_confirmed: "Nicht bestätigt" },
    scope: "Geltungsbereich", checked: "Geprüft am", against: "anhand", edition: "Ausgabe", source: "Quelle", language: "Sprache",
    inventory: "Aktive Lernfragen", snapshot: "Bestand geprüft", cache: "Bestandszahlen werden zwischengespeichert und nach spätestens fünf Minuten neu abgefragt. Während einer Aktualisierung kann der vorherige Stand sichtbar bleiben. Sie sind keine offiziellen Prüfungszahlen.",
    unavailable: "Bestandszahlen sind derzeit nicht verfügbar. Eine fehlgeschlagene Abfrage wird nicht als null Fragen angezeigt.",
    subject: "Fach", officialQuestions: "Offizielle Fragen", bank: "Lernbank", mapped: "Zugeordnete Lernfragen", mapping: "Themenzuordnung für Lernzwecke; keine bestätigte Zuordnung zu offiziellen Prüfungsaufgaben. Verwandte Themen werden zusammengefasst. Nicht zugeordnete Themen stehen unten.",
    unmapped: "Weitere oder nicht zugeordnete Themen", noTopic: "Ohne Thema", active: "Aktiv", mc: "Mit nutzbaren MC-Optionen", withoutMc: "Ohne nutzbare MC-Optionen", sipShape: "SIP-MC-Form (nur Struktur)", outsideSipShape: "Andere MC-Struktur", shapeNote: "Die Strukturprüfung zählt Optionen und richtige Markierungen. Sie prüft weder medizinische Richtigkeit noch vollständige Prüfungsnähe. Lernfragen ohne nutzbare MC-Optionen sind keine verfügbaren MC-Simulationen.",
    practice: "Zur Lernbank", windowUnknown: "Anmeldefenster noch nicht bestätigt", unconfirmed: "Offene Anmeldefenster", changeNotice: "Dies ist das Quellenprüfprotokoll dieses Leitfadens. Eine erneute Prüfung einer Quelle ist keine behauptete Regeländerung.",
  },
  en: {
    eyebrow: "AUSTRIA / EXAM PATHWAY", intro: "Results, exam room and practice coverage for your Austrian exam pathway. Each rule identifies its source, review date and scope.",
    back: "Exam formats", navigation: "More exam guidance", officialNotice: "Your decision, current invitation and university announcement determine your specific exam pathway.",
    status: { official: "Official", reported: "Product information / reported", not_confirmed: "Not confirmed" },
    scope: "Scope", checked: "Checked on", against: "against", edition: "Edition", source: "Source", language: "Language",
    inventory: "Active practice items", snapshot: "Inventory checked", cache: "Inventory counts are cached and refreshed after five minutes. The previous snapshot may remain visible during refresh. These are not official exam counts.",
    unavailable: "Inventory counts are currently unavailable. A failed query is not shown as zero questions.",
    subject: "Subject", officialQuestions: "Official questions", bank: "Practice bank", mapped: "Mapped practice items", mapping: "Topic mapping for study purposes; no confirmed correspondence to official exam tasks. Related topics are grouped together. Unmapped topics appear below.",
    unmapped: "Additional or unmapped topics", noTopic: "No topic", active: "Active", mc: "With usable MC options", withoutMc: "Without usable MC options", sipShape: "SIP MC shape (structure only)", outsideSipShape: "Other MC structure", shapeNote: "The structural check counts options and correct markers. It does not assess medical accuracy or complete exam fidelity. Items without usable MC options are not available MC simulations.",
    practice: "Open practice bank", windowUnknown: "Window not yet confirmed", unconfirmed: "Unconfirmed registration windows", changeNotice: "This is the source-review log for this guide. Checking a source again does not imply a rule changed.",
  },
} as const;
