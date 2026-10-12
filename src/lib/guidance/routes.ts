export interface GuidanceRoute {
  path: string;
  label: { de: string; en: string };
  package: string;
  status: "live" | "planned";
}

export const GUIDANCE_ROUTES: readonly GuidanceRoute[] = [
  {
    path: "/wien-route",
    label: {"de": "Prüfungsweg Wien", "en": "Vienna exam pathway"},
    package: "b01",
    status: "live",
  },
  {
    path: "/wien-route/sip-anmeldung",
    label: {"de": "SIP4a und SIP5a anmelden", "en": "Register for SIP4a and SIP5a"},
    package: "b01",
    status: "live",
  },
  {
    path: "/wien-route/rez-gm-anmeldung",
    label: {"de": "Rezeptierkunde und Gerichtsmedizin anmelden", "en": "Register for Rezeptierkunde and Gerichtsmedizin"},
    package: "b01",
    status: "live",
  },
  {
    path: "/wien-route/sip-regeln",
    label: {"de": "SIP: Regeln und Bestehen", "en": "SIP: rules and passing"},
    package: "b01",
    status: "live",
  },
  {
    path: "/exam-formats",
    label: {"de": "Prüfungsformate und Regeln", "en": "Exam formats and rules"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/sip4a",
    label: {"de": "SIP4a (MedUni Wien)", "en": "SIP4a (MedUni Vienna)"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/sip5a",
    label: {"de": "SIP5a (MedUni Wien)", "en": "SIP5a (MedUni Vienna)"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/stichprobentest",
    label: {"de": "Stichprobentest", "en": "Stichprobentest"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/rezeptierkunde",
    label: {"de": "Rezeptierkunde (Pharmakologie)", "en": "Rezeptierkunde (Pharmacology)"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/gerichtsmedizin",
    label: {"de": "Gerichtsmedizin", "en": "Legal medicine"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/ergebnisse",
    label: {"de": "Ergebnisse und Feedback", "en": "Results and feedback"},
    package: "b14",
    status: "live",
  },
  {
    path: "/exam-formats/pruefungsraum",
    label: {"de": "Prüfungsraum und Checkliste", "en": "Exam room and checklist"},
    package: "b14",
    status: "live",
  },
  {
    path: "/exam-formats/kommission",
    label: {"de": "Wiederholungen und Kommission", "en": "Repeats and commission"},
    package: "b14",
    status: "live",
  },
  {
    path: "/exam-formats/aenderungen",
    label: {"de": "Quellenstand und offene Punkte", "en": "Source review and unresolved points"},
    package: "b14",
    status: "live",
  },
  {
    path: "/exam-formats/haeufige-fragen",
    label: {"de": "Häufige Fragen", "en": "Frequently asked questions"},
    package: "b14",
    status: "live",
  },
  {
    path: "/exam-formats/faecher",
    label: {"de": "Fächer und Lernbank", "en": "Subjects and practice bank"},
    package: "b14",
    status: "live",
  },
  {
    path: "/exam-formats/praxis-vs-pruefung",
    label: {"de": "Praxis und offizielle Prüfung", "en": "Practice and official exams"},
    package: "b14",
    status: "live",
  },
  {
    path: "/wien-route/c1",
    label: {"de": "C1-Nachweis für Wien", "en": "C1 proof for Vienna"},
    package: "b15",
    status: "live",
  },
  {
    path: "/wien-route/antrag-checkliste",
    label: {"de": "Antrag: Ihre Unterlagenliste", "en": "Application: your document checklist"},
    package: "b15",
    status: "live",
  },
  {
    path: "/wien-route/kosten",
    label: {"de": "Kosten richtig einplanen", "en": "Plan your costs"},
    package: "b15",
    status: "live",
  },
  {
    path: "/wien-route/nach-dem-stichprobentest",
    label: {"de": "Nach dem Stichprobentest", "en": "After the Stichprobentest"},
    package: "b15",
    status: "live",
  },
  {
    path: "/wien-route/studierendenstatus",
    label: {"de": "Außerordentlicher Studierendenstatus", "en": "Extraordinary student status"},
    package: "b15",
    status: "live",
  },
  {
    path: "/wien-route/kontakte",
    label: {"de": "Die richtige Kontaktstelle", "en": "The right contact"},
    package: "b15",
    status: "live",
  },
  {
    path: "/was-ist-was",
    label: {"de": "Prüfungsnamen verstehen", "en": "Understand exam names"},
    package: "b16",
    status: "live",
  },
  {
    path: "/umfang",
    label: {"de": "Umfang und Grenzen von MedPrüf", "en": "MedPrüf scope and limits"},
    package: "b16",
    status: "live",
  },
  {
    path: "/pruefungskalender",
    label: {"de": "Prüfungskalender", "en": "Exam calendar"},
    package: "b17",
    status: "live",
  },
  {
    path: "/graz-innsbruck",
    label: {"de": "Graz und Innsbruck", "en": "Graz and Innsbruck"},
    package: "b17",
    status: "live",
  },
  {
    path: "/gerichtsmedizin",
    label: {"de": "Gerichtsmedizin (in Vorbereitung)", "en": "Legal medicine (in preparation)"},
    package: "b17",
    status: "live",
  },
  {
    path: "/korrekturen",
    label: {"de": "Korrekturen im Fragenpool", "en": "Question-bank corrections"},
    package: "b18",
    status: "live",
  },
  {
    path: "/graz-innsbruck/abdeckung",
    label: {"de": "Übungsabdeckung Graz und Innsbruck", "en": "Practice coverage Graz and Innsbruck"},
    package: "b22",
    status: "live",
  },
  {
    path: "/exam-formats/fsp",
    label: {"de": "Fachsprachprüfung (FSP)", "en": "Medical German exam (FSP)"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/c1",
    label: {"de": "C1-Sprachnachweis", "en": "C1 language certificate"},
    package: "b07",
    status: "live",
  },
  {
    path: "/exam-formats/general",
    label: {"de": "Nostrifizierung in Österreich", "en": "Nostrification in Austria"},
    package: "b07",
    status: "live",
  },
];

export const liveGuidanceRoutes = () => GUIDANCE_ROUTES.filter((route) => route.status === "live");
