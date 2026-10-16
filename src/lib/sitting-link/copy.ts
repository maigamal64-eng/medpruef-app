/**
 * Copy of the one-tap sitting link (a-sitting-one-tap): the page behind the
 * link and the one mail line that carries it. Formal Sie, no em dashes, no
 * medical line, Austrian framing, no countdown other than the official date,
 * no price-change urgency. Dates never appear in this file: they come from
 * OFFICIAL_SITTINGS through the formatters in i18n-dates.ts. German and
 * English only; other saved languages get English.
 *
 * Lektor review: reports/track-b-2026-10-11/handover/a-sitting-one-tap/
 * (lektor.md). Change a string only with a new Lektor APPROVE.
 */
import type { PuypExamType } from "@/lib/exam-dates";
import type { SittingLinkLang } from "./token";

export interface SittingLinkCopy {
  title: string;
  lead: string;
  bank: Record<PuypExamType, string>;
  otherBanks: string;
  switchNote: string;
  sittingOn: string;
  saved_marker: string;
  official: string;
  open: string;
  noneListed: string;
  reminder: string;
  save: string;
  nothingYet: string;
  savedSitting: string;
  savedOpen: string;
  left: { today: string; day: string; days: string; week: string; weeks: string };
  toPlan: string;
  reminderResult: Record<"sent" | "already" | "unsupported" | "not_now", string>;
  fitTitle: string;
  fitLine: string;
  seePlans: string;
  frozen: string;
  invalid: string;
  expired: string;
  stale: string;
  retry: string;
  unavailable: string;
  settings: string;
  home: string;
}

const DE: SittingLinkCopy = {
  title: "Ihr Prüfungstermin",
  lead: "Wählen Sie den Termin, auf den Sie sich vorbereiten. Alle Termine stammen von den offiziellen Seiten der Universitäten.",
  bank: {
    kenntnispruefung: "SIP4a und SIP5a (MedUni Wien)",
    kmp_innsbruck: "Stichprobentest",
    pharma: "Rezeptierkunde und Gerichtsmedizin (MedUni Wien)",
  },
  otherBanks: "Andere Prüfungen",
  switchNote: "Wenn Sie hier wählen, wechseln Ihre Übungsfragen zu dieser Prüfung.",
  sittingOn: "{exam}: {when}",
  saved_marker: "derzeit gespeichert",
  official: "Offizielle Seite: {publisher}",
  open: "Noch offen: Ich kenne meinen Termin noch nicht.",
  noneListed: "Derzeit ist kein Termin veröffentlicht.",
  reminder: "Erinnern Sie mich per E-Mail an die Anmeldefrist (nicht für den Stichprobentest). Dafür schicken wir Ihnen zuerst einen Bestätigungslink.",
  save: "Termin speichern",
  nothingYet: "Erst mit „Termin speichern“ ändert sich etwas in Ihrem Konto.",
  savedSitting: "Gespeichert: {exam}, {when}.",
  savedOpen: "Gespeichert: Ihr Termin ist noch offen. Sie können ihn jederzeit in den Einstellungen festlegen.",
  left: {
    today: "Ihr Termin ist heute.",
    day: "Bis zu Ihrem Termin ist es noch 1 Tag.",
    days: "Bis zu Ihrem Termin sind es noch {n} Tage.",
    week: "Bis zu Ihrem Termin ist es noch 1 Woche.",
    weeks: "Bis zu Ihrem Termin sind es noch {n} Wochen.",
  },
  toPlan: "Zu Ihrem Lernplan",
  reminderResult: {
    sent: "Wir haben Ihnen einen Bestätigungslink geschickt. Erst nach Ihrer Bestätigung erhalten Sie Fristerinnerungen.",
    already: "Ihre Fristerinnerungen sind bereits eingeschaltet.",
    unsupported: "Für den Stichprobentest verschicken wir keine Fristerinnerungen, weil die Frist von der Universität abhängt, bei der Sie Ihren Antrag eingereicht haben. Die Fristen finden Sie auf den offiziellen Seiten.",
    not_now: "Die Fristerinnerungen konnten wir gerade nicht einschalten. Sie können das in den Einstellungen nachholen.",
  },
  fitTitle: "Der passende Tarif",
  fitLine: "Am günstigsten deckt Ihren Termin dieser Tarif ab: {plan}. Bis zu Ihrem Termin insgesamt {total}.",
  seePlans: "Tarife und Verlängerung ansehen",
  frozen: "Die Termine werden gerade neu geprüft. Bis dahin finden Sie die aktuellen Termine auf den offiziellen Seiten:",
  invalid: "Dieser Link ist nicht gültig. Sie können Ihren Termin in den Einstellungen festlegen.",
  expired: "Dieser Link ist abgelaufen. Sie können Ihren Termin in den Einstellungen festlegen.",
  stale: "Dieser Termin ist nicht mehr auswählbar. Bitte wählen Sie erneut.",
  retry: "Das hat gerade nicht geklappt. Bitte versuchen Sie es in einigen Minuten erneut.",
  unavailable: "Diese Seite ist gerade nicht verfügbar.",
  settings: "Zu den Einstellungen",
  home: "Zu MedPrüf",
};

const EN: SittingLinkCopy = {
  title: "Your exam sitting",
  lead: "Choose the sitting you are preparing for. Every date comes from the universities' official pages.",
  bank: {
    kenntnispruefung: "SIP4a and SIP5a (MedUni Vienna)",
    kmp_innsbruck: "Stichprobentest",
    pharma: "Rezeptierkunde and Gerichtsmedizin (MedUni Vienna)",
  },
  otherBanks: "Other exams",
  switchNote: "If you choose here, your practice questions switch to this exam.",
  sittingOn: "{exam}: {when}",
  saved_marker: "currently saved",
  official: "Official page: {publisher}",
  open: "Not decided yet: I do not know my sitting.",
  noneListed: "No sitting is published at the moment.",
  reminder: "Remind me of the registration deadline by email (not for the Stichprobentest). We will first send you a confirmation link for this.",
  save: "Save sitting",
  nothingYet: "Nothing changes in your account until you press “Save sitting”.",
  savedSitting: "Saved: {exam}, {when}.",
  savedOpen: "Saved: your sitting is not decided yet. You can set it at any time in your settings.",
  left: {
    today: "Your sitting is today.",
    day: "1 day to go until your sitting.",
    days: "{n} days to go until your sitting.",
    week: "1 week to go until your sitting.",
    weeks: "{n} weeks to go until your sitting.",
  },
  toPlan: "Go to your study plan",
  reminderResult: {
    sent: "We have sent you a confirmation link. You will only receive deadline reminders once you confirm.",
    already: "Your deadline reminders are already on.",
    unsupported: "We do not send deadline reminders for the Stichprobentest, because the deadline depends on the university where you filed your application. You can find the deadlines on the official pages.",
    not_now: "We could not turn on deadline reminders just now. You can do this later in your settings.",
  },
  fitTitle: "The plan that fits",
  fitLine: "The plan that covers your sitting at the lowest cost: {plan}. Up to your sitting, {total} in total.",
  seePlans: "See plans and renewal terms",
  frozen: "The dates are being checked again right now. Until then, you can find the current dates on the official pages:",
  invalid: "This link is not valid. You can set your sitting in your settings.",
  expired: "This link has expired. You can set your sitting in your settings.",
  stale: "This sitting can no longer be chosen. Please choose again.",
  retry: "That did not work just now. Please try again in a few minutes.",
  unavailable: "This page is not available right now.",
  settings: "Go to settings",
  home: "Go to MedPrüf",
};

const COPY: Record<SittingLinkLang, SittingLinkCopy> = { de: DE, en: EN };

export function sittingLinkCopy(lang: SittingLinkLang): SittingLinkCopy {
  return COPY[lang] ?? EN;
}

export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/**
 * The one mail line that carries the link (placement note in the release
 * note: B3 v2 only if re-gated by its gate date, else the B2 forward card
 * and the access-ending mail). No date, no price, no plan, no trial: B2
 * (rulebook B0.6) bars them, and learner mails carry no dates (SoT 5.4).
 */
export const SITTING_LINK_MAIL_LINE: Record<SittingLinkLang, { text: string; cta: string }> = {
  de: {
    text: "Wann ist Ihre Prüfung? Wählen Sie Ihren Termin aus den offiziellen Terminen aus, dann plant MedPrüf Ihre Wochen bis dahin.",
    cta: "Termin auswählen",
  },
  en: {
    text: "When is your exam? Choose your sitting from the official dates, and MedPrüf plans your weeks up to it.",
    cta: "Choose your sitting",
  },
};
