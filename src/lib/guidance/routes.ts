export interface GuidanceRoute {
  path: string;
  label: { de: string; en: string };
  package: string;
  status: "live" | "planned";
}

export const GUIDANCE_ROUTES: readonly GuidanceRoute[] = [
  {
    path: "/wien-route",
    label: {"de": "Wien: dein Prüfungsweg", "en": "Vienna: your exam pathway"},
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
    label: {"de": "exam formats", "en": "exam formats"},
    package: "b07",
    status: "planned",
  },
  {
    path: "/exam-formats/sip4a",
    label: {"de": "sip4a", "en": "sip4a"},
    package: "b07",
    status: "planned",
  },
  {
    path: "/exam-formats/sip5a",
    label: {"de": "sip5a", "en": "sip5a"},
    package: "b07",
    status: "planned",
  },
  {
    path: "/exam-formats/stichprobentest",
    label: {"de": "stichprobentest", "en": "stichprobentest"},
    package: "b07",
    status: "planned",
  },
  {
    path: "/exam-formats/rezeptierkunde",
    label: {"de": "rezeptierkunde", "en": "rezeptierkunde"},
    package: "b07",
    status: "planned",
  },
  {
    path: "/exam-formats/gerichtsmedizin",
    label: {"de": "gerichtsmedizin", "en": "gerichtsmedizin"},
    package: "b07",
    status: "planned",
  },
  {
    path: "/exam-formats/ergebnisse",
    label: {"de": "ergebnisse", "en": "ergebnisse"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/exam-formats/pruefungsraum",
    label: {"de": "pruefungsraum", "en": "pruefungsraum"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/exam-formats/kommission",
    label: {"de": "kommission", "en": "kommission"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/exam-formats/aenderungen",
    label: {"de": "aenderungen", "en": "aenderungen"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/exam-formats/haeufige-fragen",
    label: {"de": "haeufige fragen", "en": "haeufige fragen"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/exam-formats/faecher",
    label: {"de": "faecher", "en": "faecher"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/exam-formats/praxis-vs-pruefung",
    label: {"de": "praxis vs pruefung", "en": "praxis vs pruefung"},
    package: "b14",
    status: "planned",
  },
  {
    path: "/wien-route/c1",
    label: {"de": "c1", "en": "c1"},
    package: "b15",
    status: "planned",
  },
  {
    path: "/wien-route/antrag-checkliste",
    label: {"de": "antrag checkliste", "en": "antrag checkliste"},
    package: "b15",
    status: "planned",
  },
  {
    path: "/wien-route/kosten",
    label: {"de": "kosten", "en": "kosten"},
    package: "b15",
    status: "planned",
  },
  {
    path: "/wien-route/nach-dem-stichprobentest",
    label: {"de": "nach dem stichprobentest", "en": "nach dem stichprobentest"},
    package: "b15",
    status: "planned",
  },
  {
    path: "/wien-route/studierendenstatus",
    label: {"de": "studierendenstatus", "en": "studierendenstatus"},
    package: "b15",
    status: "planned",
  },
  {
    path: "/wien-route/kontakte",
    label: {"de": "kontakte", "en": "kontakte"},
    package: "b15",
    status: "planned",
  },
  {
    path: "/was-ist-was",
    label: {"de": "was ist was", "en": "was ist was"},
    package: "b16",
    status: "planned",
  },
  {
    path: "/umfang",
    label: {"de": "umfang", "en": "umfang"},
    package: "b16",
    status: "planned",
  },
  {
    path: "/pruefungskalender",
    label: {"de": "pruefungskalender", "en": "pruefungskalender"},
    package: "b17",
    status: "planned",
  },
  {
    path: "/graz-innsbruck",
    label: {"de": "graz innsbruck", "en": "graz innsbruck"},
    package: "b17",
    status: "planned",
  },
  {
    path: "/gerichtsmedizin",
    label: {"de": "gerichtsmedizin", "en": "gerichtsmedizin"},
    package: "b17",
    status: "planned",
  },
  {
    path: "/korrekturen",
    label: {"de": "korrekturen", "en": "korrekturen"},
    package: "b18",
    status: "planned",
  },
  {
    path: "/graz-innsbruck/abdeckung",
    label: {"de": "abdeckung", "en": "abdeckung"},
    package: "b22",
    status: "planned",
  },
];

export const liveGuidanceRoutes = () => GUIDANCE_ROUTES.filter((route) => route.status === "live");
