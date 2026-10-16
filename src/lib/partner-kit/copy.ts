/**
 * Partner kit copy (a-partner-kit): the handout (A4 print and square image),
 * the public organiser page /kooperation and the organiser report. German in
 * Sie, English as the second language; no price, no pass promise, no medical
 * line, nothing that implies a university or authority endorses MedPrüf, no
 * dashes as sentence punctuation. Numbers (credits, days, age limit) come in
 * as arguments from the code's own row, never typed here. Lektor gate before
 * the flag flips (handover).
 */
import type { PartnerLang } from "./index";

export type RedeemVariant = "register" | "settings";

interface HandoutCopy {
  brand: string;
  kicker: string;
  codeLabel: string;
  whatTitle: string;
  creditsWhat: (credits: number, days: number) => string;
  seatWhat: (proDays: number, credits: number) => string;
  mentorLine: string;
  howTitle: string;
  stepSearchPrint: string;
  stepSearchImage: string;
  stepRegister: string;
  stepSettings: string;
  stepAfterRegister: string;
  creditsRule: (maxAgeDays: number, until: string) => string;
  seatRule: (maxAgeDays: number, until: string) => string;
  independence: string;
  filePrefix: string;
}

const DE: HandoutCopy = {
  brand: "MedPrüf",
  kicker: "Übungsplattform für die Nostrifizierung in Österreich",
  codeLabel: "Code für Ihre Gruppe",
  whatTitle: "Das erhalten Mitglieder",
  creditsWhat: (c, d) => `Neue Konten erhalten mit diesem Code ${c} Credits für den KI-Mentor, gültig ${d} Tage ab Einlösung.`,
  seatWhat: (p, c) => `Neue Konten erhalten mit diesem Code ${p} Tage vollen Zugang (Pro) und ${c} Credits für den KI-Mentor, ohne Karte und ohne Abo. Alles endet nach ${p} Tagen von selbst, nichts verlängert sich automatisch.`,
  mentorLine: "Der KI-Mentor beantwortet Fragen zu Prüfungsterminen, Fristen und Regeln mit Verweis auf die offizielle Quelle und erklärt Übungsfragen.",
  howTitle: "So lösen Sie den Code ein",
  stepSearchPrint: "Suchen Sie im Internet nach „MedPrüf“ (mit ü) oder öffnen Sie medpruf.com.",
  stepSearchImage: "Suchen Sie im Internet oder in Ihrem Browser nach „MedPrüf“ (mit ü).",
  stepRegister: "Legen Sie ein kostenloses Konto an und tragen Sie den Code im Feld „Haben Sie einen Code?“ ein.",
  stepSettings: "Legen Sie ein kostenloses Konto an. Öffnen Sie danach die Einstellungen und geben Sie den Code in der Karte ein, deren Titel mit „Code“ beginnt.",
  stepAfterRegister: "Bestätigen Sie Ihre E-Mail-Adresse. Danach wird der Code eingelöst.",
  creditsRule: (n, d) => `Der Code gilt für neue Konten (höchstens ${n} Tage alt), ein Code pro Konto, solange der Vorrat reicht, bis ${d}.`,
  seatRule: (n, d) => `Der Code gilt für neue Konten (höchstens ${n} Tage alt), die noch keinen Tarif bezahlt haben, ein Platz pro Person. Die Plätze pro Code sind begrenzt, bis ${d}.`,
  independence: "MedPrüf ist ein unabhängiges Lernangebot und steht in keiner Verbindung zu Hochschulen oder Behörden.",
  filePrefix: "handout",
};

const EN: HandoutCopy = {
  brand: "MedPrüf",
  kicker: "Practice platform for recognition in Austria",
  codeLabel: "Code for your group",
  whatTitle: "What members get",
  creditsWhat: (c, d) => `New accounts get ${c} credits for the AI Mentor with this code, valid for ${d} days after redeeming.`,
  seatWhat: (p, c) => `New accounts get ${p} days of full access (Pro) and ${c} credits for the AI Mentor with this code, no card and no subscription. Everything ends on its own after ${p} days and nothing renews automatically.`,
  mentorLine: "The AI Mentor answers questions about exam dates, deadlines and rules with a link to the official source and explains practice questions.",
  howTitle: "How to redeem the code",
  stepSearchPrint: "Search the web for “MedPrüf” (with ü) or open medpruf.com.",
  stepSearchImage: "Search the web or your browser for “MedPrüf” (with ü).",
  stepRegister: "Create a free account and enter the code in the field “Do you have a code?”.",
  stepSettings: "Create a free account. Then open Settings and enter the code in the card whose title starts with “Code”.",
  stepAfterRegister: "Confirm your email address. The code is then redeemed.",
  creditsRule: (n, d) => `The code is for new accounts (at most ${n} days old), one code per account, while supplies last, until ${d}.`,
  seatRule: (n, d) => `The code is for new accounts (at most ${n} days old) that have not paid for a plan, one seat per person. The seats per code are limited, until ${d}.`,
  independence: "MedPrüf is an independent study service and is not connected to any university or authority.",
  filePrefix: "handout",
};

export const handoutCopy = (lang: PartnerLang): HandoutCopy => (lang === "en" ? EN : DE);

interface PageCopy {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  lead: string;
  membersTitle: string;
  members: string[];
  organiserTitle: string;
  organiser: string[];
  privacyTitle: string;
  privacy: string;
  stepsTitle: string;
  steps: string[];
  independence: string;
  formTitle: string;
  formLead: string;
  langSwitch: string;
}

const PAGE_DE: PageCopy = {
  metaTitle: "Kooperation für Lerngruppen und Organisationen | MedPrüf",
  metaDescription: "MedPrüf für Gruppen, Vereine und Organisationen, die Ärztinnen und Ärzte bei der Nostrifizierung in Österreich begleiten: ein eigener Code, ein Handout und eine anonyme Übersicht.",
  eyebrow: "Für Organisatorinnen und Organisatoren",
  title: "MedPrüf für Ihre Lerngruppe",
  lead: "Sie begleiten Ärztinnen und Ärzte bei der Nostrifizierung in Österreich, in einer Gruppe, einem Verein oder einem Kurs? Dann erhalten Ihre Mitglieder mit einem eigenen Code einen guten Einstieg in MedPrüf.",
  membersTitle: "Das erhalten Ihre Mitglieder",
  members: [
    "Einen eigenen Code für Ihre Gruppe. Je nach Absprache enthält er Credits für den KI-Mentor oder einen befristeten Pro-Platz.",
    "Ein kostenloses Konto mit Übungsfragen für die Kenntnisprüfung (SIP4a und SIP5a Wien), den Stichprobentest und die Rezeptierkunde.",
    "Offizielle Termine und Fristen mit Link zur Quelle, damit Sie nichts raten müssen.",
  ],
  organiserTitle: "Das erhalten Sie",
  organiser: [
    "Ein Handout mit Ihrem Code als PDF zum Ausdrucken und als Bild für Chats, in denen keine Links erlaubt sind.",
    "Eine Übersicht nur für Ihren Code: wie viele Mitglieder den Code eingelöst haben, wie viele zuletzt aktiv waren und wie viele Fragen insgesamt beantwortet wurden.",
  ],
  privacyTitle: "Datenschutz",
  privacy: "Sie sehen nur Summen für Ihren Code. Zahlen unter 5 zeigen wir nicht an. Namen, E-Mail-Adressen und einzelne Lernstände geben wir nicht weiter, auch nicht an Organisatorinnen und Organisatoren.",
  stepsTitle: "So läuft es ab",
  steps: [
    "Sie schreiben uns kurz, wer Sie sind und wen Sie begleiten.",
    "Wir antworten Ihnen persönlich und besprechen mit Ihnen, was zu Ihrer Gruppe passt.",
    "Sie erhalten Ihren Code und das Handout. Mitglieder lösen den Code selbst ein.",
  ],
  independence: "Eine Anfrage legt kein Konto und keinen Code automatisch an. MedPrüf ist ein unabhängiges Lernangebot und steht in keiner Verbindung zu Hochschulen oder Behörden.",
  formTitle: "Kooperation anfragen",
  formLead: "Nennen Sie in der Nachricht Ihre Gruppe oder Organisation, die Sprache der Mitglieder und wie viele Personen Sie ungefähr begleiten.",
  langSwitch: "English",
};

const PAGE_EN: PageCopy = {
  metaTitle: "Partnership for study groups and organisations | MedPrüf",
  metaDescription: "MedPrüf for groups, associations and organisations that support doctors through recognition in Austria: your own code, a handout and an anonymous overview.",
  eyebrow: "For organisers",
  title: "MedPrüf for your study group",
  lead: "Do you support doctors through recognition in Austria, in a group, an association or a course? With a code of its own, your members get a good start with MedPrüf.",
  membersTitle: "What your members get",
  members: [
    "A code of its own for your group. Depending on what we agree, it holds credits for the AI Mentor or a time-limited Pro seat.",
    "A free account with practice questions for the Kenntnisprüfung (SIP4a and SIP5a Vienna), the Stichprobentest and the Rezeptierkunde.",
    "Official dates and deadlines with a link to the source, so that nobody has to guess.",
  ],
  organiserTitle: "What you get",
  organiser: [
    "A handout with your code as a PDF to print and as an image for chats where links are not allowed.",
    "An overview for your code only: how many members redeemed it, how many were active recently and how many questions were answered in total.",
  ],
  privacyTitle: "Privacy",
  privacy: "You only see totals for your code. We do not show numbers below 5. We do not share names, email addresses or individual progress, not even with organisers.",
  stepsTitle: "How it works",
  steps: [
    "You write to us briefly: who you are and whom you support.",
    "We reply personally and talk through what fits your group.",
    "You receive your code and the handout. Members redeem the code themselves.",
  ],
  independence: "A request does not create an account or a code automatically. MedPrüf is an independent study service and is not connected to any university or authority.",
  formTitle: "Request a partnership",
  formLead: "In your message, name your group or organisation, the language of your members and roughly how many people you support.",
  langSwitch: "Deutsch",
};

export const pageCopy = (lang: PartnerLang): PageCopy => (lang === "en" ? PAGE_EN : PAGE_DE);

interface ReportCopy {
  metaTitle: string;
  title: (code: string) => string;
  lead: string;
  redemptions: string;
  active: string;
  answers: string;
  small: string;
  unavailable: string;
  privacy: string;
  updated: (when: string) => string;
  expired: string;
  roundedNote: string;
}

const REPORT_DE: ReportCopy = {
  metaTitle: "Übersicht für Ihren Code | MedPrüf",
  title: (c) => `Übersicht für den Code ${c}`,
  lead: "Summen für alle Konten, die Ihren Code eingelöst haben.",
  redemptions: "Eingelöste Codes",
  active: "Aktiv in den letzten 7 Tagen",
  answers: "Beantwortete Fragen",
  small: "unter 5",
  unavailable: "gerade nicht verfügbar",
  privacy: "Zahlen unter 5 zeigen wir nicht an. Namen, E-Mail-Adressen und einzelne Lernstände sehen Sie nicht.",
  updated: (w) => `Stand: ${w}`,
  expired: "Dieser Link ist nicht gültig oder abgelaufen.",
  roundedNote: "Zahlen sind gerundet (auf 5, beantwortete Fragen auf 10).",
};

const REPORT_EN: ReportCopy = {
  metaTitle: "Overview for your code | MedPrüf",
  title: (c) => `Overview for code ${c}`,
  lead: "Totals for all accounts that redeemed your code.",
  redemptions: "Codes redeemed",
  active: "Active in the last 7 days",
  answers: "Questions answered",
  small: "under 5",
  unavailable: "not available right now",
  privacy: "We do not show numbers below 5. You do not see names, email addresses or individual progress.",
  updated: (w) => `As of ${w}`,
  expired: "This link is not valid or has expired.",
  roundedNote: "Numbers are rounded (to 5, questions answered to 10).",
};

export const reportCopy = (lang: PartnerLang): ReportCopy => (lang === "en" ? REPORT_EN : REPORT_DE);
