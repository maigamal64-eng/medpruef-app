/**
 * Telegram Mini App welcome (a-tg-miniapp-welcome). Pure, server and client.
 *
 * While TG_MINIAPP_WELCOME_ENABLED is the literal "true", the bot welcome in
 * a private chat sends each exam as an inline web_app button. Telegram opens
 * /tg-welcome inside the chat as a Mini App; the page signs in through the
 * existing initData path of /api/auth (no token in any URL), saves the bank,
 * asks for the official sitting first and then hands over to the activation
 * starter set. Off (or in a group) the welcome is today's message.
 */
import { EXAM_LABEL_KEYS, type ExamLabelKey } from "@/lib/master-locale/exam-label";

type Env = Record<string, string | undefined>;

export const TG_WELCOME_PATH = "/tg-welcome";
/** The `source` the in-app picker path stores with a sitting saved here. */
export const TG_WELCOME_SOURCE = "tg_welcome";

export function tgMiniappWelcomeEnabled(env: Env = process.env): boolean {
  return env.TG_MINIAPP_WELCOME_ENABLED === "true";
}

export type TgWelcomeLang = "de" | "en";

/** Absolute Mini App URL for one bank. Campaign tags ride along like on every other site button. */
export function tgWelcomeUrl(opts: {
  siteUrl: string;
  exam: ExamLabelKey;
  lang: TgWelcomeLang;
  campaign: { source: string; medium: string; campaign: string } | null;
}): string {
  const url = new URL(`${opts.siteUrl.replace(/\/$/, "")}${TG_WELCOME_PATH}`);
  url.searchParams.set("exam", opts.exam);
  url.searchParams.set("lang", opts.lang);
  if (opts.campaign) {
    url.searchParams.set("utm_source", opts.campaign.source);
    url.searchParams.set("utm_medium", opts.campaign.medium);
    url.searchParams.set("utm_campaign", opts.campaign.campaign);
  }
  return url.toString();
}

/** The page's query: a known bank or null, and de/en (anything else reads English). */
export function parseTgWelcomeQuery(params: { exam?: unknown; lang?: unknown }): { exam: ExamLabelKey | null; lang: TgWelcomeLang } {
  // An own key of the label table only ("constructor" passes an `in` check).
  const exam = (EXAM_LABEL_KEYS as readonly unknown[]).includes(params.exam) ? (params.exam as ExamLabelKey) : null;
  return { exam, lang: COPY_LANG.get(params.lang) ?? "en" };
}

const COPY_LANG = new Map<unknown, TgWelcomeLang>([["de", "de"], ["en", "en"]]);

/**
 * The Telegram user id inside an initData string. Only used to check that a
 * stored session belongs to the Telegram account in front of us (stale
 * initData case); never trusted for sign-in, which /api/auth verifies.
 */
export function initDataTelegramId(initData: string): number | null {
  try {
    const id = Number((JSON.parse(new URLSearchParams(initData).get("user") ?? "null") as { id?: unknown } | null)?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export const TG_WELCOME_BANKS: readonly ExamLabelKey[] = EXAM_LABEL_KEYS;

type Pair = { de: string; en: string };

/**
 * Learner copy. German in Sie, no em dashes, no prices, no pass promise.
 * Lektor gate 15 Oct 2026 (a-tg-miniapp-welcome): every line APPROVE or replaced
 * with the Lektor text (not_in_telegram, sitting_body, later_title EN).
 */
export const TG_WELCOME_COPY = {
  // Bot message: one line added under today's welcome text, and the secondary button.
  bot_miniapp_line: {
    de: "MedPrüf öffnet sich direkt hier in Telegram. Sie brauchen kein eigenes Passwort.",
    en: "MedPrüf opens right here in Telegram. You do not need a separate password.",
  },
  bot_browser_button: { de: "Im Browser öffnen", en: "Open in browser" },
  // Page.
  signing_in: { de: "Sie werden mit Telegram angemeldet.", en: "Signing you in with Telegram." },
  sign_in_failed: {
    de: "Die Anmeldung mit Telegram hat nicht geklappt. Bitte schließen Sie MedPrüf und öffnen Sie es über den Button im Chat erneut.",
    en: "Signing in with Telegram did not work. Please close MedPrüf and open it again from the button in the chat.",
  },
  retry: { de: "Erneut versuchen", en: "Try again" },
  not_in_telegram: {
    de: "Diese Seite ist für Telegram gedacht. Im Browser melden Sie sich hier an:",
    en: "This page is meant to open inside Telegram. In a browser, sign in here:",
  },
  not_in_telegram_button: { de: "Zur Anmeldung", en: "Go to sign in" },
  sitting_title: { de: "Wann ist Ihre Prüfung?", en: "When is your exam?" },
  sitting_body: {
    de: "Wählen Sie den offiziellen Termin, zu dem Sie antreten. Ihr Lernplan richtet sich danach.",
    en: "Pick the official sitting you are taking. Your study plan follows it.",
  },
  continue: { de: "Weiter", en: "Continue" },
  saving: { de: "Wird gespeichert", en: "Saving" },
  save_failed: { de: "Das hat nicht geklappt. Bitte versuchen Sie es erneut.", en: "That did not work. Please try again." },
  saved_title: { de: "Ihr Termin ist gespeichert.", en: "Your sitting is saved." },
  later_title: { de: "Sie können den Termin jederzeit in den Einstellungen festlegen.", en: "You can set your sitting any time in Settings." },
  home: { de: "Zur Startseite", en: "Go to Home" },
} as const satisfies Record<string, Pair>;

export type TgWelcomeCopyKey = keyof typeof TG_WELCOME_COPY;

/** German for de, English for every other language (reviewed fallback). */
export function tw(key: TgWelcomeCopyKey, lang: string): string {
  return TG_WELCOME_COPY[key][COPY_LANG.get(lang) ?? "en"];
}
