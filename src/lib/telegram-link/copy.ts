/**
 * Learner copy of the link-Telegram path (a-trial-phone-gate). Formal Sie, no
 * em dashes, no dates beyond the trial end. German and English only; other
 * saved languages render English (Arabic drafts for [name] live in the track-b
 * handover, never here). Lektor (Content Steward) APPROVE WITH EDITS, 17 Oct
 * 2026, edits applied verbatim. The "3" in the titles equals REVERSE_TRIAL_DAYS
 * (a unit test pins it).
 */
import type { BindResult } from "./server";

export interface TelegramLinkCopy {
  region: string;
  title: string;
  body: string;
  privacy: string;
  cta: string;
  busy: string;
  waiting: string;
  openAgain: string;
  success: string;
  linkedNoTrial: string;
  linkedClaim: string;
  expired: string;
  retry: string;
  later: string;
}

const DE: TelegramLinkCopy = {
  region: "Testzugang mit Telegram",
  title: "Telegram verbinden, um Ihre 3 Tage Pro zu starten",
  body: "Den Testzugang gibt es einmal pro Telegram-Konto, ohne Karte und ohne Abo. Bis dahin üben Sie mit der kostenlosen Probe weiter.",
  privacy: "Wir speichern dafür Ihre Telegram-ID und Ihren Telegram-Namen. Danach können Sie sich auch mit Telegram anmelden.",
  cta: "Telegram verbinden",
  busy: "Wird geöffnet …",
  waiting: "Telegram ist geöffnet. Tippen Sie dort auf „Starten“ und kommen Sie dann hierher zurück.",
  openAgain: "Telegram erneut öffnen",
  success: "Telegram ist verknüpft. Ihr Testzugang läuft bis {when}.",
  linkedNoTrial: "Telegram ist verknüpft. Ein Testzugang ist für dieses Konto nicht möglich, zum Beispiel weil er für dieses Telegram-Konto schon genutzt wurde.",
  linkedClaim: "Telegram ist verknüpft.",
  expired: "Der Link ist abgelaufen. Tippen Sie erneut auf „Telegram verbinden“.",
  retry: "Das hat gerade nicht geklappt. Bitte versuchen Sie es in einer Minute erneut.",
  later: "Später",
};

const EN: TelegramLinkCopy = {
  region: "Trial with Telegram",
  title: "Link Telegram to start your 3-day trial",
  body: "The trial is once per Telegram account, with no card and no subscription. Until then you keep practising with the free sample.",
  privacy: "For this we store your Telegram ID and your Telegram name. Afterwards you can also sign in with Telegram.",
  cta: "Link Telegram",
  busy: "Opening…",
  waiting: "Telegram is open. Tap “Start” there, then come back here.",
  openAgain: "Open Telegram again",
  success: "Telegram is linked. Your trial runs until {when}.",
  linkedNoTrial: "Telegram is linked. A trial is not possible for this account, for example because it was already used for this Telegram account.",
  linkedClaim: "Telegram is linked.",
  expired: "The link has expired. Tap “Link Telegram” again.",
  retry: "That did not work just now. Please try again in a minute.",
  later: "Later",
};

const COPY: Record<string, TelegramLinkCopy> = { de: DE, en: EN };

export function telegramLinkCopy(lang: string): TelegramLinkCopy {
  return COPY[lang] ?? EN;
}

/** The bot's reply after "/start lk_<token>". */
const BOT: Record<"de" | "en", Record<Exclude<BindResult, "off">, string>> = {
  de: {
    linked: "Ihr Telegram ist jetzt mit Ihrem MedPrüf-Konto verknüpft. Sie können zu MedPrüf zurückkehren.",
    already: "Dieses Telegram ist bereits mit Ihrem MedPrüf-Konto verknüpft. Sie können zu MedPrüf zurückkehren.",
    account_has_other: "Ihr MedPrüf-Konto ist schon mit einem anderen Telegram-Konto verknüpft.",
    telegram_in_use: "Dieses Telegram-Konto ist schon mit einem anderen MedPrüf-Konto verknüpft. Wenn Sie sich mit Telegram anmelden, öffnet sich jenes andere Konto.",
    expired: "Dieser Link ist abgelaufen. Tippen Sie in MedPrüf erneut auf „Telegram verbinden“.",
    invalid: "Dieser Link ist nicht gültig. Tippen Sie in MedPrüf erneut auf „Telegram verbinden“.",
    error: "Das hat gerade nicht geklappt. Bitte tippen Sie in einer Minute in MedPrüf erneut auf „Telegram verbinden“.",
  },
  en: {
    linked: "Your Telegram is now linked to your MedPrüf account. You can go back to MedPrüf.",
    already: "This Telegram is already linked to your MedPrüf account. You can go back to MedPrüf.",
    account_has_other: "Your MedPrüf account is already linked to another Telegram account.",
    telegram_in_use: "This Telegram account is already linked to another MedPrüf account. Signing in with Telegram opens that account.",
    expired: "This link has expired. Tap “Link Telegram” in MedPrüf again.",
    invalid: "This link is not valid. Tap “Link Telegram” in MedPrüf again.",
    error: "That did not work just now. Please tap “Link Telegram” in MedPrüf again in a minute.",
  },
};

/** null = say nothing (the flag is off: the bot treats the start like any unknown payload). */
export function botLinkReply(result: BindResult, languageCode: string | null | undefined): string | null {
  if (result === "off") return null;
  const german = typeof languageCode === "string" && languageCode.toLowerCase().startsWith("de");
  return (german ? BOT.de : BOT.en)[result];
}
