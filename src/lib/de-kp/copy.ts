/**
 * Learner copy for KP-DE case practice (spec sections 4.3 and 6). Own module so
 * no Austrian copy file imports Germany wording. de and en are authored; every
 * other language reads German or English by the caller. German uses formal Sie.
 * No dashes, none of the general never-say words; the boundary test enforces it.
 *
 * Carve-out for reviewers (Lektor, spec 6.6): on this surface only,
 * "Deutschland" names the exam. The Austrian exams keep their own rule.
 */

export type DeKpLang = "de" | "en";

export interface DeKpLandingCopy {
  metaTitle: string; metaDescription: string; h1: string; lead: string;
  lawHeading: string; lawBody: string; lawTiming: string; lawLink: string; lawRead: string; landNote: string;
  whatHeading: string; whatItems: string[];
  limitsHeading: string;
  freeHeading: string; freeBody: string; freeCta: string; freeCtaNoCase: string;
  plansHeading: string; plansIntro: string;
  monthLabel: string; monthTerms: string; monthCta: string;
  trialLabel: string; trialCta: string; trialTerms: string;
  switchTo: string; switchHref: string; switchLang: string;
}

export interface DeKpHubCopy {
  title: string; intro: string; subjects: { innere: string; chirurgie: string; notfall: string };
  free: string; locked: string; start: string; resume: string; again: string; count: string;
  yourRuns: string; noCases: string; loading: string; lockedNote: string; plansLink: string; back: string;
}

export interface DeKpRunnerCopy {
  loading: string; leave: string; leaveTitle: string; leaveBody: string; stay: string; cancel: string;
  stepOf: string; offline: string; syncing: string; syncFailed: string; saved: string;
  vignetteHeading: string; submit: string; next: string; continue: string; retry: string; reviewLoading: string; reviewError: string;
  anamneseHint: string; anamneseLine: string; addLine: string; askPatient: string; patientAnswers: string; noPatientAnswers: string;
  checklistHeading: string; checklistHint: string; findingsHeading: string; covered: string; notCovered: string;
  diffLeading: string; diffOthers: string; diffOther: string; diffHint: string; yourAnswer: string; acceptedWordings: string; leadingKey: string; othersKey: string;
  berichtHint: string; clockToggle: string; clockNote: string; clockEnded: string;
  rubricHeading: string; rubricHint: string; modelHeading: string; yourReport: string; criticalMark: string;
  oralHeading: string; oralHint: string; oralAnswer: string; oralModel: string; oralKeyPoints: string; scopeCase: string; scopeCross: string; markAll: string;
  resultHeading: string; resultNote: string; scoreOf: string; noCritical: string; sourcesHeading: string; toHub: string; toPlans: string; savedRun: string; pending: string;
  paywallTitle: string; paywallBody: string; paywallCta: string; trialOr: string;
  resumeTitle: string; resumeBody: string; resumeYes: string; resumeNo: string;
}

export interface DeKpCopy {
  landing: DeKpLandingCopy;
  hub: DeKpHubCopy;
  runner: DeKpRunnerCopy;
  examName: string;
  chip: string;
  brandLine: string;
  practiceLabel: string;
  honesty: string;
  landerNote: string;
  stepLabels: { vignette: string; anamnese: string; findings: string; differentials: string; bericht: string; oral: string; result: string };
  sectionLabels: { anamnese: string; diagnose: string; prognose: string; behandlungsplan: string; epikrise: string };
  scoreLabels: { history: string; differential: string; bericht: string; followup: string };
  criticalHeading: string;
  clockLabel: string;
  marking: { right: string; notRight: string; hint: { matches: string; compare: string; empty: string } };
  errors: {
    disabled: string;
    proRequired: string;
    notSubmitted: string;
    notFound: string;
    unavailable: string;
    withdrawn: string;
    badRequest: string;
    generic: string;
  };
}

const DE: DeKpCopy = {
  landing: {
    metaTitle: "Kenntnisprüfung in Deutschland: Fallübungen für Ärztinnen und Ärzte | MedPrüf",
    metaDescription: "Fallübungen zur Kenntnisprüfung in Deutschland: Anamnese, Differenzialdiagnosen, schriftlicher Bericht und mündliche Fragen, selbst bewertet. Ein Fall ist kostenlos.",
    h1: "Kenntnisprüfung (Deutschland): Fälle üben",
    lead: "Ein Fall nach dem anderen: Anamnese, Befunde, Differenzialdiagnosen, der schriftliche Bericht und die mündlichen Fragen, mit einem geprüften Lösungsraster zum Selbstbewerten.",
    lawHeading: "Die Prüfung und ihre Rechtsgrundlage",
    lawBody: "Kenntnisprüfung nach § 37 Approbationsordnung für Ärzte (ÄApprO), in der seit 1. November 2026 geltenden Fassung (BGBl. 2026 I Nr. 225 und Nr. 326). Sie ist eine mündlich-praktische Prüfung. Ihr geht eine patientenbezogene Prüfungsvorbereitung voraus: Anamnese und Untersuchung (höchstens 20 Minuten), danach ein schriftlicher Bericht (höchstens 30 Minuten). Die Prüfung selbst dauert je Prüfling 60 bis 90 Minuten.",
    lawTiming: "Welche Fassung für Ihren Antrag gilt, hängt vom Antragsdatum ab. Fragen Sie dazu die für Sie zuständige Behörde.",
    lawLink: "§ 37 ÄApprO im Gesetzestext (gesetze-im-internet.de)",
    lawRead: "Gelesen am 17. November 2026.",
    landNote: "Ablauf, Gebühren und Termine legt Ihr Land fest. Lesen Sie das aktuelle Merkblatt Ihres Landes. Wir verlinken keines, solange wir keines gelesen haben, das nach dem 1. November 2026 erschienen ist.",
    whatHeading: "Was Sie hier üben",
    whatItems: [
      "Anamnese: Sie stellen die Fragen, die Simulationspatientin antwortet.",
      "Befunde lesen und Differenzialdiagnosen benennen.",
      "Den schriftlichen Bericht schreiben: Anamnese, Diagnose, Prognose, Behandlungsplan, Epikrise.",
      "Fünf bis acht mündliche Fragen zum Fall und fachübergreifend.",
    ],
    limitsHeading: "Was sich im Text nicht üben lässt",
    freeHeading: "Ein Fall kostenlos",
    freeBody: "Üben Sie einen vollständigen Fall mit Konto, ohne Karte. Danach sehen Sie, was die übrigen Fälle bieten.",
    freeCta: "Kostenlosen Fall üben",
    freeCtaNoCase: "Fälle ansehen",
    plansHeading: "Alle Fälle",
    plansIntro: "Die übrigen Fälle gehören zu Pro.",
    monthLabel: "Monatsabo",
    monthTerms: "{price} alle 30 Tage, bis Sie kündigen.",
    monthCta: "Monatsabo wählen",
    trialLabel: "Pro testen",
    trialCta: "Pro testen",
    trialTerms: "",
    switchTo: "English",
    switchHref: "?lang=en",
    switchLang: "en",
  },
  hub: {
    title: "Fälle",
    intro: "Wählen Sie einen Fall. Ihre Eingaben bleiben auf diesem Gerät gespeichert, bis Sie den Fall abgeschlossen haben.",
    subjects: { innere: "Innere Medizin", chirurgie: "Chirurgie", notfall: "Notfallmedizin" },
    free: "Kostenlos", locked: "Pro", start: "Fall starten", resume: "Fortsetzen", again: "Erneut üben", count: "{n} Fälle",
    yourRuns: "Ihre letzten Läufe", noCases: "Zurzeit sind keine Fälle freigeschaltet.", loading: "Fälle werden geladen.",
    lockedNote: "Fälle mit der Markierung Pro gehören zu Pro.", plansLink: "Pro ansehen", back: "Zur Übersicht",
  },
  runner: {
    loading: "Fall wird geladen.", leave: "Verlassen", leaveTitle: "Fall verlassen?", leaveBody: "Ihr Stand bleibt auf diesem Gerät gespeichert. Sie können später fortsetzen.", stay: "Weiter üben", cancel: "Abbrechen",
    stepOf: "Schritt {i} von {n}", offline: "Sie sind offline. Ihre Eingaben bleiben gespeichert.", syncing: "Speichert.", syncFailed: "Speichern auf dem Server gerade nicht möglich. Es wird erneut versucht.", saved: "Gespeichert.",
    vignetteHeading: "Der Fall", submit: "Abgeben", next: "Weiter", continue: "Weiter", retry: "Erneut versuchen", reviewLoading: "Lösung wird geladen.", reviewError: "Die Lösung konnte nicht geladen werden.",
    anamneseHint: "Schreiben Sie je Zeile eine Frage oder ein Thema, das Sie erfragen würden (bis zu 25 Zeilen).", anamneseLine: "Frage {i}", addLine: "Zeile hinzufügen", askPatient: "Antworten der Patientin anzeigen", patientAnswers: "Antworten der Simulationspatientin", noPatientAnswers: "Zu Ihren Zeilen liegt noch keine Antwort vor.",
    checklistHeading: "Anamnese-Raster", checklistHint: "Haken Sie jeden Punkt ab, den Sie erfragt haben. Vorbelegt sind die Punkte der Themen, die Ihre Zeilen genannt haben. Sie entscheiden.", findingsHeading: "Befunde", covered: "Erfragt", notCovered: "Nicht erfragt",
    diffLeading: "Führende Diagnose", diffOthers: "Weitere Differenzialdiagnosen", diffOther: "Differenzialdiagnose {i}", diffHint: "Nennen Sie die führende Diagnose und bis zu vier weitere.", yourAnswer: "Ihre Antwort", acceptedWordings: "Hinterlegte Formulierungen", leadingKey: "Führende Diagnose, hinterlegt", othersKey: "Weitere Diagnosen, hinterlegt",
    berichtHint: "Schreiben Sie den Bericht in den fünf Abschnitten. Mindestens ein Abschnitt braucht Text.", clockToggle: "Übungsuhr mitlaufen lassen", clockNote: "Eine freiwillige Übungsuhr, kein Prüfungsmaß.", clockEnded: "Die Übungszeit ist abgelaufen. Sie können weiterschreiben.",
    rubricHeading: "Bewertungsraster", rubricHint: "Haken Sie jeden Punkt ab, den Ihr Bericht abdeckt. Ein Punkt zählt nur, wenn sein Abschnitt Text enthält.", modelHeading: "Musterbericht", yourReport: "Ihr Bericht", criticalMark: "Sicherheitsrelevant",
    oralHeading: "Mündliche Fragen", oralHint: "Beantworten Sie jede Frage kurz. Sie dürfen Fragen auslassen.", oralAnswer: "Antwort {i}", oralModel: "Musterantwort", oralKeyPoints: "Kernpunkte", scopeCase: "Zum Fall", scopeCross: "Fachübergreifend", markAll: "Bewerten Sie jede beantwortete Frage.",
    resultHeading: "Ergebnis", resultNote: "Übung, selbst bewertet. Das ist keine Aussage über eine Prüfung.", scoreOf: "{p} Prozent", noCritical: "Keine sicherheitsrelevanten Punkte ausgelassen.", sourcesHeading: "Quellen", toHub: "Zu den Fällen", toPlans: "Alle Fälle mit Pro", savedRun: "Ihr Lauf ist gespeichert.", pending: "Ihr Lauf wird gespeichert, sobald Sie wieder online sind.",
    paywallTitle: "Dieser Fall gehört zu Pro", paywallBody: "Der kostenlose Fall steht jedem Konto offen. Die übrigen Fälle gehören zu Pro.", paywallCta: "Pro ansehen", trialOr: "Oder Pro testen",
    resumeTitle: "Angefangenen Lauf fortsetzen?", resumeBody: "Auf diesem Gerät liegt ein begonnener Lauf dieses Falls.", resumeYes: "Fortsetzen", resumeNo: "Neu beginnen",
  },
  examName: "Kenntnisprüfung (Deutschland)",
  chip: "KP-DE",
  brandLine: "MedPrüf, Fallübungen zur Kenntnisprüfung in Deutschland",
  practiceLabel: "Übung, selbst bewertet",
  honesty:
    "Text kann zwei Teile nicht trainieren: die körperliche Untersuchung am Simulationspatienten und das mündliche Prüfungsgespräch mit der Kommission. Hier üben Sie Anamnese, Bericht und die mündlichen Fragen.",
  landerNote: "Ablauf, Gebühren und Termine legt Ihr Land fest. Lesen Sie das aktuelle Merkblatt Ihres Landes.",
  stepLabels: { vignette: "Fall", anamnese: "Anamnese", findings: "Befunde", differentials: "Differenzialdiagnosen", bericht: "Bericht", oral: "Mündliche Fragen", result: "Ergebnis" },
  sectionLabels: { anamnese: "Anamnese", diagnose: "Diagnose", prognose: "Prognose", behandlungsplan: "Behandlungsplan", epikrise: "Epikrise" },
  scoreLabels: { history: "Anamnese", differential: "Differenzialdiagnosen", bericht: "Bericht", followup: "Mündliche Fragen" },
  criticalHeading: "Sicherheitsrelevant, nicht genannt",
  clockLabel: "Übungszeit",
  marking: {
    right: "Richtig",
    notRight: "Nicht richtig",
    hint: { matches: "Entspricht einer hinterlegten Formulierung. Sie entscheiden.", compare: "Vergleichen Sie mit der Musterantwort. Sie entscheiden.", empty: "Nichts eingegeben." },
  },
  errors: {
    disabled: "Dieses Angebot ist noch nicht verfügbar.",
    proRequired: "Dieser Fall gehört zu Pro.",
    notSubmitted: "Die Lösung wird erst nach dem Abgeben dieses Schritts angezeigt.",
    notFound: "Dieser Fall wurde nicht gefunden.",
    unavailable: "Die Fälle sind gerade nicht erreichbar. Bitte versuchen Sie es später erneut.",
    withdrawn: "Dieser Fall wird gerade überprüft. Ihre Eingaben bleiben auf diesem Gerät gespeichert.",
    badRequest: "Die Anfrage war unvollständig.",
    generic: "Das hat nicht geklappt. Bitte versuchen Sie es erneut.",
  },
};

const EN: DeKpCopy = {
  landing: {
    metaTitle: "Kenntnisprüfung in Germany: case practice for doctors | MedPrüf",
    metaDescription: "Case practice for the Kenntnisprüfung in Germany: history taking, differential diagnoses, the written report and oral questions, self-marked. One case is free.",
    h1: "Kenntnisprüfung (Germany): practise cases",
    lead: "One case at a time: history, findings, differential diagnoses, the written report and the oral questions, with a reviewed answer key you mark yourself against.",
    lawHeading: "The exam and its legal basis",
    lawBody: "Kenntnisprüfung under section 37 of the Approbationsordnung für Ärzte (ÄApprO), in the version in force since 1 November 2026 (BGBl. 2026 I No. 225 and No. 326). It is an oral and practical exam. A patient-related preparation comes first: history and examination (at most 20 minutes), then a written report (at most 30 minutes). The exam itself takes 60 to 90 minutes per candidate.",
    lawTiming: "Which version applies to your application depends on the date you applied. Ask the authority responsible for you.",
    lawLink: "Section 37 ÄApprO, legal text (gesetze-im-internet.de, in German)",
    lawRead: "Read on 17 November 2026.",
    landNote: "Your state sets the procedure, the fees and the dates. Read the current information sheet of your state. We link none until we have read one published after 1 November 2026.",
    whatHeading: "What you practise here",
    whatItems: [
      "History taking: you ask the questions, the simulated patient answers.",
      "Reading findings and naming differential diagnoses.",
      "Writing the report: history, diagnosis, prognosis, treatment plan, epicrisis.",
      "Five to eight oral questions on the case and across subjects.",
    ],
    limitsHeading: "What cannot be practised in text",
    freeHeading: "One case free",
    freeBody: "Practise one complete case with an account, no card. Then you see what the other cases offer.",
    freeCta: "Practise the free case",
    freeCtaNoCase: "See the cases",
    plansHeading: "All cases",
    plansIntro: "The other cases are part of Pro.",
    monthLabel: "Monthly plan",
    monthTerms: "{price} every 30 days until you cancel.",
    monthCta: "Choose the monthly plan",
    trialLabel: "Try Pro",
    trialCta: "Try Pro",
    trialTerms: "",
    switchTo: "Deutsch",
    switchHref: "?lang=de",
    switchLang: "de",
  },
  hub: {
    title: "Cases",
    intro: "Choose a case. Your input stays on this device until you finish the case.",
    subjects: { innere: "Internal medicine", chirurgie: "Surgery", notfall: "Emergency medicine" },
    free: "Free", locked: "Pro", start: "Start case", resume: "Resume", again: "Practise again", count: "{n} cases",
    yourRuns: "Your latest runs", noCases: "No cases are available at the moment.", loading: "Loading cases.",
    lockedNote: "Cases marked Pro need Pro.", plansLink: "See Pro", back: "Back to overview",
  },
  runner: {
    loading: "Loading the case.", leave: "Leave", leaveTitle: "Leave the case?", leaveBody: "Your progress stays on this device. You can resume later.", stay: "Keep practising", cancel: "Cancel",
    stepOf: "Step {i} of {n}", offline: "You are offline. Your input stays saved.", syncing: "Saving.", syncFailed: "Saving to the server is not possible right now. It will be retried.", saved: "Saved.",
    vignetteHeading: "The case", submit: "Submit", next: "Next", continue: "Continue", retry: "Try again", reviewLoading: "Loading the answer key.", reviewError: "The answer key could not be loaded.",
    anamneseHint: "Write one question or topic per line that you would ask about (up to 25 lines).", anamneseLine: "Question {i}", addLine: "Add line", askPatient: "Show the patient's answers", patientAnswers: "Answers of the simulated patient", noPatientAnswers: "There is no answer to your lines yet.",
    checklistHeading: "History checklist", checklistHint: "Tick every point you asked about. Points of the topics your lines named are pre-ticked. You decide.", findingsHeading: "Findings", covered: "Asked", notCovered: "Not asked",
    diffLeading: "Leading diagnosis", diffOthers: "Further differential diagnoses", diffOther: "Differential diagnosis {i}", diffHint: "Name the leading diagnosis and up to four others.", yourAnswer: "Your answer", acceptedWordings: "Stored wordings", leadingKey: "Leading diagnosis, stored", othersKey: "Other diagnoses, stored",
    berichtHint: "Write the report in the five sections. At least one section needs text.", clockToggle: "Run a practice clock", clockNote: "A voluntary practice clock, not an exam measure.", clockEnded: "The practice time is over. You can keep writing.",
    rubricHeading: "Marking rubric", rubricHint: "Tick every point your report covers. A point counts only when its section has text.", modelHeading: "Model report", yourReport: "Your report", criticalMark: "Safety-relevant",
    oralHeading: "Oral questions", oralHint: "Answer each question briefly. You may skip questions.", oralAnswer: "Answer {i}", oralModel: "Model answer", oralKeyPoints: "Key points", scopeCase: "On the case", scopeCross: "Across subjects", markAll: "Mark every question you answered.",
    resultHeading: "Result", resultNote: "Practice, self-marked. This says nothing about an exam.", scoreOf: "{p} percent", noCritical: "No safety relevant points left out.", sourcesHeading: "Sources", toHub: "To the cases", toPlans: "All cases with Pro", savedRun: "Your run is saved.", pending: "Your run is saved as soon as you are back online.",
    paywallTitle: "This case is part of Pro", paywallBody: "The free case is open to every account. The other cases are part of Pro.", paywallCta: "See Pro", trialOr: "Or try Pro",
    resumeTitle: "Resume the run you started?", resumeBody: "A run of this case was started on this device.", resumeYes: "Resume", resumeNo: "Start over",
  },
  examName: "Kenntnisprüfung (Germany)",
  chip: "KP-DE",
  brandLine: "MedPrüf, case practice for the Kenntnisprüfung in Germany",
  practiceLabel: "Practice, self-marked",
  honesty:
    "Text cannot train two parts: the physical examination of a simulated patient and the spoken exam conversation with the commission. Here you practise history taking, the written report and the oral questions.",
  landerNote: "Your state sets the procedure, the fees and the dates. Read the current information sheet of your state.",
  stepLabels: { vignette: "Case", anamnese: "History", findings: "Findings", differentials: "Differential diagnoses", bericht: "Report", oral: "Oral questions", result: "Result" },
  sectionLabels: { anamnese: "History", diagnose: "Diagnosis", prognose: "Prognosis", behandlungsplan: "Treatment plan", epikrise: "Epicrisis" },
  scoreLabels: { history: "History", differential: "Differential diagnoses", bericht: "Report", followup: "Oral questions" },
  criticalHeading: "Safety-relevant, not mentioned",
  clockLabel: "Practice time",
  marking: {
    right: "Right",
    notRight: "Not right",
    hint: { matches: "Matches a stored wording. You decide.", compare: "Compare with the model answer. You decide.", empty: "Nothing entered." },
  },
  errors: {
    disabled: "This is not available yet.",
    proRequired: "This case is part of Pro.",
    notSubmitted: "The solution is shown only after you submit this step.",
    notFound: "This case was not found.",
    unavailable: "The cases are unavailable right now. Please try again later.",
    withdrawn: "This case is being reviewed. Your input stays on this device.",
    badRequest: "The request was incomplete.",
    generic: "That did not work. Please try again.",
  },
};

/** German unless English is asked for; Arabic and every other language read German until a sign-off (spec 9). */
export function deKpCopy(lang: string | null | undefined): DeKpCopy {
  return lang && lang.toLowerCase().startsWith("en") ? EN : DE;
}

/** Template fill: {name} placeholders. */
export function fillCopy(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** Language from the ?lang query: English only for "en"; everything else reads German (spec 9). */
export function deKpLang(raw: string | string[] | null | undefined): DeKpLang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.toLowerCase().startsWith("en") ? "en" : "de";
}

/** The legal text of section 37 ÄApprO (read 17 Nov 2026). No Land sheet is linked until one dated after 1 Nov 2026 is read. */
export const DE_KP_LAW_URL = "https://www.gesetze-im-internet.de/_appro_2002/__37.html";
