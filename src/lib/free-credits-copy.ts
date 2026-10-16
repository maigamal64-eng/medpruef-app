/**
 * Learner copy for the free mentor credit hooks (a-free-credit-hooks): the
 * /gratis/<code> landing, the redeem results, the Settings code card and the
 * Settings testimonial card. de and en are authored (Lektor review in the
 * release note); every other preference renders English until a native
 * review, Arabic until [name] signs it off. Sie, no em or en dashes, Austrian
 * exam framing, no prices, never "free AI" or "unlimited": credits are for
 * questions to the AI Mentor, they expire, and they are not Pro or money.
 */

import { CONTACT, FREE_TIER } from "./content-truth";
import { getExamLabel } from "./master-locale/exam-label";

/** The three banks by their one learner name (a10 getExamLabel), never typed by hand. */
const LIST_JOIN: Record<FreeCreditsLang, string> = { de: "sowie", en: "and" };
function examList(lang: FreeCreditsLang): string {
  const [a, b, c] = ["kenntnispruefung", "kmp_innsbruck", "pharma"].map((k) => getExamLabel(k, "full", lang));
  return `${a}, ${b} ${LIST_JOIN[lang]} ${c}`;
}

export type FreeCreditsLang = "de" | "en";

const AUTHORED: Record<string, FreeCreditsLang> = { de: "de", en: "en" };

export function freeCreditsLang(lang: string | null | undefined): FreeCreditsLang {
  return AUTHORED[lang ?? ""] ?? "en";
}

export type RedeemMessageKey =
  | "success"
  | "duplicate"
  | "already_redeemed"
  | "account_too_old"
  | "unverified"
  | "cap_reached"
  | "daily_cap"
  | "not_active"
  | "banned"
  | "rate_limited"
  | "unavailable"
  | "invalid_args";

interface Copy {
  landingEyebrow: string;
  landingTitle: (credits: number) => string;
  landingLead: (credits: number) => string;
  landingWhat: string;
  landingExpiry: (days: number) => string;
  landingRule: (maxAgeDays: number) => string;
  landingFreeStart: (freeQuestions: number) => string;
  landingRegister: string;
  landingSignIn: string;
  landingRedeemNow: string;
  landingRedeeming: string;
  landingToMentor: string;
  landingInactiveTitle: string;
  landingInactiveBody: (freeQuestions: number) => string;
  landingInactiveCta: string;
  redeem: Record<Exclude<RedeemMessageKey, "account_too_old">, string> & { account_too_old: (maxAgeDays: number) => string };
  redeemSuccess: (credits: number, date: string) => string;
  redeemNext: string;
  codeTitle: string;
  codeLead: (maxAgeDays: number) => string;
  codeLabel: string;
  codeSubmit: string;
  codeRedeemed: (code: string, credits: number) => string;
  expTitle: string;
  expLead: (credits: number, days: number) => string;
  expLabel: string;
  expHelper: string;
  expConsent: string;
  expConsentHelper: string;
  expSubmit: string;
  expSending: string;
  expTooShort: string;
  expSent: string;
  expRewarded: string;
  expFailed: string;
  dateLocale: string;
}

const COPY: Record<FreeCreditsLang, Copy> = {
  de: {
    landingEyebrow: "Credits für den KI-Mentor",
    landingTitle: (c) => `${c} Credits für den KI-Mentor von MedPrüf`,
    landingLead: (c) => `MedPrüf ist eine Lernplattform für die Nostrifizierung in Österreich, mit Übungsfragen für ${examList("de")}. Mit diesem Code erhalten Sie ${c} Credits für den KI-Mentor.`,
    landingWhat: "Der KI-Mentor beantwortet Fragen zu Prüfungsterminen, Fristen und Regeln mit Verweis auf die offizielle Quelle und erklärt Übungsfragen, die Sie in MedPrüf beantwortet haben. Eine Frage an den Mentor kostet meist etwa einen Credit.",
    landingExpiry: (d) => `Die Credits gelten ${d} Tage ab dem Einlösen und verfallen danach. Sie sind kein Pro-Zugang und haben keinen Geldwert.`,
    landingRule: (n) => `Pro Konto können Sie einen Code einlösen, solange das Konto höchstens ${n} Tage alt ist. Ein neues Konto zählt dazu. Zum Einlösen braucht das Konto eine bestätigte E-Mail-Adresse, eine Telegram-Anmeldung oder 10 verschiedene beantwortete Übungsfragen.`,
    landingFreeStart: (q) => `Unabhängig davon können Sie ${q} Übungsfragen pro Fragenbank kostenlos und ohne Karte ausprobieren.`,
    landingRegister: "Konto anlegen und Code einlösen",
    landingSignIn: "Ich habe schon ein Konto",
    landingRedeemNow: "Code jetzt einlösen",
    landingRedeeming: "Wird eingelöst …",
    landingToMentor: "Zum KI-Mentor",
    landingInactiveTitle: "Dieser Link ist nicht aktiv",
    landingInactiveBody: (q) => `Der Code ist abgelaufen oder nicht verfügbar. Unabhängig davon können Sie ${q} Übungsfragen pro Fragenbank kostenlos und ohne Karte ausprobieren.`,
    landingInactiveCta: "Kostenlose Probe starten",
    redeem: {
      success: "Eingelöst.",
      duplicate: "Dieser Code ist für Ihr Konto bereits eingelöst.",
      already_redeemed: "Für Ihr Konto wurde bereits ein Code eingelöst. Pro Konto ist ein Code möglich.",
      account_too_old: (n) => `Codes gelten für neue Konten, die höchstens ${n} Tage alt sind. Für Ihr Konto ist der Code daher nicht gültig.`,
      unverified: "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse oder beantworten Sie 10 Übungsfragen. Danach können Sie den Code einlösen.",
      cap_reached: "Dieser Code ist ausgeschöpft.",
      daily_cap: "Dieser Code ist für heute ausgeschöpft. Bitte versuchen Sie es morgen erneut.",
      not_active: "Dieser Code ist nicht gültig oder nicht mehr aktiv.",
      banned: "Dieser Code kann für Ihr Konto nicht eingelöst werden.",
      rate_limited: "Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut.",
      unavailable: "Das Einlösen ist gerade nicht möglich. Bitte versuchen Sie es später erneut.",
      invalid_args: "Bitte prüfen Sie den Code.",
    },
    redeemSuccess: (c, date) => `Eingelöst: ${c} Credits für den KI-Mentor, gültig bis ${date}.`,
    redeemNext: "Nächster Schritt: Wählen Sie Ihre Prüfung und Ihren Termin, damit Ihr Lernplan zu Ihrer Prüfung passt.",
    codeTitle: "Code für Mentor-Credits",
    codeLead: (n) => `Haben Sie einen Code für den KI-Mentor, etwa aus einer Lerngruppe? Sie können einen Code pro Konto einlösen, solange Ihr Konto höchstens ${n} Tage alt ist.`,
    codeLabel: "Code",
    codeSubmit: "Einlösen",
    codeRedeemed: (code, c) => `Eingelöst: Code ${code}, ${c} Credits für den KI-Mentor.`,
    expTitle: "Ihre Erfahrung mit MedPrüf",
    expLead: (c, d) => `Erzählen Sie uns in ein paar Sätzen, wie Sie MedPrüf bei Ihrer Vorbereitung erleben, ob positiv, gemischt oder kritisch. Als Dankeschön erhalten Sie einmalig ${c} Credits für den KI-Mentor, ${d} Tage ab der Gutschrift gültig, unabhängig davon, wie Ihre Erfahrung ausfällt.`,
    expLabel: "Ihre Erfahrung",
    expHelper: "Bitte nennen Sie keine Gesundheitsdaten von Patientinnen oder Patienten.",
    expConsent: "MedPrüf darf meinen Text öffentlich zeigen, mit meinem Vornamen oder meinen Initialen und dem Hinweis, dass ich dafür Credits erhalten habe.",
    expConsentHelper: `Ohne Häkchen lesen nur wir Ihren Text. Ihre Zustimmung können Sie jederzeit per E-Mail an ${CONTACT.email} widerrufen.`,
    expSubmit: "Senden",
    expSending: "Wird gesendet …",
    expTooShort: "Bitte schreiben Sie mindestens einen ganzen Satz.",
    expSent: "Danke. Wir sehen Ihren Text durch und schreiben Ihnen die Credits danach gut. Ihr Guthaben sehen Sie beim KI-Mentor.",
    expRewarded: "Danke, dass Sie Ihre Erfahrung geteilt haben. Die Credits sind gutgeschrieben.",
    expFailed: "Nicht gesendet. Bitte versuchen Sie es erneut.",
    dateLocale: "de-AT",
  },
  en: {
    landingEyebrow: "Credits for the AI Mentor",
    landingTitle: (c) => `${c} credits for the MedPrüf AI Mentor`,
    landingLead: (c) => `MedPrüf is a study platform for medical degree recognition (Nostrifizierung) in Austria, with practice questions for ${examList("en")}. With this code you receive ${c} credits for the AI Mentor.`,
    landingWhat: "The AI Mentor answers questions about exam dates, deadlines and rules with a link to the official source, and explains practice questions you have answered in MedPrüf. One question to the mentor usually costs about one credit.",
    landingExpiry: (d) => `The credits are valid for ${d} days from redeeming and then expire. They are not Pro access and have no cash value.`,
    landingRule: (n) => `You can redeem one code per account while the account is at most ${n} days old. A new account counts. To redeem, the account needs a confirmed email address, a Telegram sign-in or 10 different answered practice questions.`,
    landingFreeStart: (q) => `Separately, you can try ${q} practice questions per question bank for free, no card needed.`,
    landingRegister: "Create an account and redeem",
    landingSignIn: "I already have an account",
    landingRedeemNow: "Redeem the code now",
    landingRedeeming: "Redeeming …",
    landingToMentor: "Open the AI Mentor",
    landingInactiveTitle: "This link is not active",
    landingInactiveBody: (q) => `The code has expired or is not available. Separately, you can try ${q} practice questions per question bank for free, no card needed.`,
    landingInactiveCta: "Start the free sample",
    redeem: {
      success: "Redeemed.",
      duplicate: "This code is already redeemed for your account.",
      already_redeemed: "A code has already been redeemed for your account. One code per account.",
      account_too_old: (n) => `Codes are for new accounts that are at most ${n} days old, so the code is not valid for your account.`,
      unverified: "Please confirm your email address first or answer 10 practice questions. Then you can redeem the code.",
      cap_reached: "This code has been used up.",
      daily_cap: "This code has been used up for today. Please try again tomorrow.",
      not_active: "This code is not valid or no longer active.",
      banned: "This code cannot be redeemed for your account.",
      rate_limited: "Too many attempts. Please try again in a few minutes.",
      unavailable: "Redeeming is not possible right now. Please try again later.",
      invalid_args: "Please check the code.",
    },
    redeemSuccess: (c, date) => `Redeemed: ${c} AI Mentor credits, valid until ${date}.`,
    redeemNext: "Next step: choose your exam and sitting so your study plan fits your exam.",
    codeTitle: "Code for mentor credits",
    codeLead: (n) => `Do you have a code for the AI Mentor, for example from a study group? You can redeem one code per account while your account is at most ${n} days old.`,
    codeLabel: "Code",
    codeSubmit: "Redeem",
    codeRedeemed: (code, c) => `Redeemed: code ${code}, ${c} AI Mentor credits.`,
    expTitle: "Your experience with MedPrüf",
    expLead: (c, d) => `Tell us in a few sentences how you experience MedPrüf in your preparation, whether positive, mixed or critical. As a thank-you you receive ${c} AI Mentor credits once, valid for ${d} days from when they are added, however your experience turns out.`,
    expLabel: "Your experience",
    expHelper: "Please do not include any patient health information.",
    expConsent: "MedPrüf may show my text publicly, with my first name or initials and a note that I received credits for it.",
    expConsentHelper: `Without the tick only we read your text. You can withdraw your consent at any time by email to ${CONTACT.email}.`,
    expSubmit: "Send",
    expSending: "Sending …",
    expTooShort: "Please write at least one full sentence.",
    expSent: "Thank you. We will look through your text and then add the credits. You can see your balance in the AI Mentor.",
    expRewarded: "Thank you for sharing your experience. The credits have been added.",
    expFailed: "Not sent. Please try again.",
    dateLocale: "en-GB",
  },
};

export function freeCreditsCopy(lang: string | null | undefined): Copy {
  return COPY[freeCreditsLang(lang)];
}

/** Server reason -> message key (unknown reasons read as unavailable). */
export function redeemMessageKey(reason: unknown): RedeemMessageKey {
  const keys = Object.keys(COPY.en.redeem) as RedeemMessageKey[];
  return typeof reason === "string" && (keys as string[]).includes(reason) ? (reason as RedeemMessageKey) : "unavailable";
}

/** The learner line for a redeem outcome key. */
export function redeemMessage(lang: string | null | undefined, key: RedeemMessageKey, maxAgeDays = 7): string {
  const r = freeCreditsCopy(lang).redeem;
  return key === "account_too_old" ? r.account_too_old(maxAgeDays) : r[key];
}

/** Free practice questions per bank (content-truth owns the number). */
export const FREE_QUESTIONS_PER_BANK = FREE_TIER.questions_per_exam_type;

export function formatCreditDate(iso: string | null | undefined, lang: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat(freeCreditsCopy(lang).dateLocale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(t));
}

/** Minimum testimonial length (a spam floor, never a quality or sentiment rule). */
export const TESTIMONIAL_MIN_CHARS = 20;
export const TESTIMONIAL_MAX_CHARS = 2000;
