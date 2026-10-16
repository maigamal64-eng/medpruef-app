/**
 * Learner copy of the code front door (a-code-front-door). German in Sie,
 * English fallback for every other language. No price, no medical line, no
 * promise about what a code is worth: the success line states what the server
 * granted. Lektor gate before the flag flips (handover).
 */
import type { CodeFailure } from "./index";
import { seatCopy } from "@/lib/seed-seats/copy";

export type CodeLang = "de" | "en";

interface Copy {
  /** Register form field. */
  fieldLabel: string;
  fieldHelper: string;
  fieldInvalid: string;
  fieldSaved: string;
  /** Landing and Home entry. */
  entryOpen: string;
  entryLabel: string;
  entrySubmitSignedOut: string;
  entrySubmitSignedIn: string;
  entryClose: string;
  entryHintSignedOut: string;
  entryHaveAccount: string;
  /** Results. */
  working: string;
  successCampaign: (credits: number, date: string | null) => string;
  successCampaignPlain: string;
  successReferral: string;
  /** a-seed-seats: seat lines are owned by the seed-seats copy (its own Lektor gate). */
  successSeat: (date: string | null, credits: number) => string;
  duplicate: string;
  failures: Record<CodeFailure, string>;
}

const DE: Copy = {
  fieldLabel: "Haben Sie einen Code?",
  fieldHelper: "Optional. Zum Beispiel aus einer Lerngruppe oder von einer Kollegin oder einem Kollegen. Das ist nicht der Anmeldecode von Telegram.",
  fieldInvalid: "Bitte prüfen Sie den Code.",
  fieldSaved: "Der Code wird nach Ihrer Anmeldung eingelöst.",
  entryOpen: "Code einlösen",
  entryLabel: "Ihr Code",
  entrySubmitSignedOut: "Weiter zur Registrierung",
  entrySubmitSignedIn: "Einlösen",
  entryClose: "Schließen",
  entryHintSignedOut: "Sie legen als Nächstes ein Konto an, ohne Karte. Danach wird der Code eingelöst.",
  entryHaveAccount: "Ich habe schon ein Konto",
  working: "Der Code wird eingelöst.",
  successCampaign: (c, date) => (date ? `Code eingelöst: ${c} Credits für den KI-Mentor, gültig bis ${date}.` : `Code eingelöst: ${c} Credits für den KI-Mentor.`),
  successCampaignPlain: "Code eingelöst.",
  successReferral: "Code eingelöst. Der Einladungscode ist Ihrem Konto zugeordnet.",
  successSeat: (date, c) => (date ? seatCopy("de").success(date, c) : seatCopy("de").successNoDate),
  duplicate: "Dieser Code ist für Ihr Konto bereits eingelöst.",
  failures: {
    not_active: "Dieser Code ist nicht gültig oder nicht mehr aktiv.",
    already_used: "Für Ihr Konto wurde bereits ein Code eingelöst. Pro Konto ist ein Code möglich.",
    own_code: "Das ist Ihr eigener Einladungscode. Er funktioniert nur für andere Personen.",
    account_too_old: "Codes gelten für neue Konten. Für Ihr Konto ist dieser Code daher nicht gültig.",
    unverified: "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse oder beantworten Sie 10 verschiedene Übungsfragen. Danach können Sie den Code einlösen.",
    cap_reached: "Dieser Code ist ausgeschöpft.",
    daily_cap: "Dieser Code ist für heute ausgeschöpft. Bitte versuchen Sie es morgen erneut.",
    banned: "Dieser Code kann für Ihr Konto nicht eingelöst werden.",
    rate_limited: "Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut.",
    unavailable: "Das Einlösen ist gerade nicht möglich. Bitte versuchen Sie es später erneut.",
    invalid_args: "Bitte prüfen Sie den Code.",
    paid_before: seatCopy("de").reasons.paid_before,
    already_pro: seatCopy("de").reasons.already_pro,
    identity_used: seatCopy("de").reasons.identity_used,
    seat_unverified: seatCopy("de").reasons.unverified,
  },
};

const EN: Copy = {
  fieldLabel: "Do you have a code?",
  fieldHelper: "Optional. For example from a study group or a colleague. This is not the Telegram sign-in code.",
  fieldInvalid: "Please check the code.",
  fieldSaved: "The code will be redeemed after you sign in.",
  entryOpen: "Redeem code",
  entryLabel: "Your code",
  entrySubmitSignedOut: "Continue to sign-up",
  entrySubmitSignedIn: "Redeem",
  entryClose: "Close",
  entryHintSignedOut: "Next, you create an account, no card needed. The code is redeemed after that.",
  entryHaveAccount: "I already have an account",
  working: "Redeeming the code.",
  successCampaign: (c, date) => (date ? `Code redeemed: ${c} AI Mentor credits, valid until ${date}.` : `Code redeemed: ${c} AI Mentor credits.`),
  successCampaignPlain: "Code redeemed.",
  successReferral: "Code redeemed. The invite code is linked to your account.",
  successSeat: (date, c) => (date ? seatCopy("en").success(date, c) : seatCopy("en").successNoDate),
  duplicate: "This code is already redeemed for your account.",
  failures: {
    not_active: "This code is not valid or no longer active.",
    already_used: "A code has already been redeemed for your account. One code per account.",
    own_code: "That is your own invite code. It only works for other people.",
    account_too_old: "Codes are for new accounts, so this code is not valid for your account.",
    unverified: "Please confirm your email address first or answer 10 different practice questions. Then you can redeem the code.",
    cap_reached: "This code has been used up.",
    daily_cap: "This code has been used up for today. Please try again tomorrow.",
    banned: "This code cannot be redeemed for your account.",
    rate_limited: "Too many attempts. Please try again in a few minutes.",
    unavailable: "Redeeming is not possible right now. Please try again later.",
    invalid_args: "Please check the code.",
    paid_before: seatCopy("en").reasons.paid_before,
    already_pro: seatCopy("en").reasons.already_pro,
    identity_used: seatCopy("en").reasons.identity_used,
    seat_unverified: seatCopy("en").reasons.unverified,
  },
};

export function codeEntryCopy(lang: string | null | undefined): Copy {
  const byLang: Record<string, Copy> = { de: DE, en: EN };
  return byLang[lang ?? ""] ?? EN;
}
