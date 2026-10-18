/**
 * Owned Telegram channel inflow (a-channel-inflow, plan a-telegram-growth A6).
 *
 * One line with the link to MedPrüf's own channel @fristen_nostrifizierung on
 * three surfaces: the bot's /start welcome (private chats only, never a group),
 * /pruefungskalender and /lernplan (which keeps its own page flag).
 *
 * Off unless FRISTEN_CHANNEL_LINK_ENABLED is the literal "true" (server env,
 * read per request, so off takes effect without a redeploy). Off: every
 * surface renders and sends exactly what it did before.
 *
 * Copy: Lektor (Content Steward) verdict in the track-b handover
 * a-channel-inflow/lektor.md. Never call the channel official or tied to a
 * university; no date, price or offer in the line.
 */

export const FRISTEN_CHANNEL_USERNAME = "fristen_nostrifizierung";
export const FRISTEN_CHANNEL_URL = `https://t.me/${FRISTEN_CHANNEL_USERNAME}`;
export const FRISTEN_CHANNEL_TITLE = "Fristen Nostrifizierung Österreich";

export function fristenChannelLinkEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.FRISTEN_CHANNEL_LINK_ENABLED === "true";
}

export type FristenLang = "de" | "en";

export const FRISTEN_CHANNEL_COPY = {
  de: {
    page_line: "Neue Prüfungs- und Anmeldetermine aus offiziellen Quellen, immer mit Lesedatum: unser Telegram-Kanal „Fristen Nostrifizierung Österreich“.",
    page_link: "Kanal auf Telegram öffnen",
    bot_line: `Neue Prüfungs- und Anmeldetermine aus offiziellen Quellen, immer mit Lesedatum, finden Sie in unserem Telegram-Kanal: ${FRISTEN_CHANNEL_URL}`,
  },
  en: {
    page_line: "New exam dates and registration deadlines from official sources, always with the date we read them: our Telegram channel “Fristen Nostrifizierung Österreich”.",
    page_link: "Open the channel on Telegram",
    bot_line: `New exam dates and registration deadlines from official sources, always with the date we read them, are in our Telegram channel: ${FRISTEN_CHANNEL_URL}`,
  },
} as const satisfies Record<FristenLang, Record<string, string>>;

export function fristenCopy(key: keyof (typeof FRISTEN_CHANNEL_COPY)["de"], lang: FristenLang): string {
  return FRISTEN_CHANNEL_COPY[lang][key];
}
