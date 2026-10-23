/**
 * Privacy page lines for the Telegram to Intercom bridge
 * (a-intercom-telegram-bridge). Shown only in a build where
 * TELEGRAM_INTERCOM_BRIDGE_ENABLED is 'true' (next.config.ts copies it into
 * NEXT_PUBLIC_TELEGRAM_INTERCOM_BRIDGE), so the page names Intercom exactly
 * when the relay runs. Lektor APPROVE WITH EDITS 17 Oct (edits applied);
 * verdict in the handover lektor.md.
 */

export function telegramBridgePrivacyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TELEGRAM_INTERCOM_BRIDGE === "true";
}

export const BRIDGE_PRIVACY = {
  /** Intercom processor row, purpose sentence. */
  intercomPurpose: {
    de: "Support-Nachrichten, die Sie dem MedPrüf-Bot auf Telegram schreiben: Wir leiten den Text an unser Support-Postfach bei Intercom weiter, unsere Antwort kommt über den Bot zurück. Ist Ihr Telegram-Konto mit einem MedPrüf-Konto verbunden, wird zusätzlich dessen Konto-ID übermittelt, sonst nur eine pseudonyme Kennung. Ihre Telegram-ID, Ihren Namen und Ihren Benutzernamen erhält Intercom nicht. Bilder und Dateien werden nicht weitergeleitet.",
    en: "Support messages you write to the MedPrüf bot on Telegram: we forward the text to our support inbox at Intercom, and our reply comes back through the bot. If your Telegram account is linked to a MedPrüf account, its account ID is also shared; otherwise only a pseudonymous identifier. Intercom does not receive your Telegram ID, name or username. Photos and files are not forwarded.",
  },
  /** Intercom processor row, jurisdiction while the bridge is on (US workspace). */
  intercomJurisdiction: {
    de: "Intercom, Inc., USA (US-Workspace). Übermittlungsgrundlage wird derzeit geprüft. Siehe Intercoms Datenschutzhinweise.",
    en: "Intercom, Inc., USA (US workspace). Transfer basis under review. See Intercom's privacy information.",
  },
  /** Telegram processor row, recipient line while the bridge is on. */
  telegramJurisdiction: {
    de: "Telegram FZ-LLC, Vereinigte Arabische Emirate. Nur übermittelt: Telegram-ID, Vorname, optional Benutzername sowie der Text unserer Antworten auf Ihre Support-Nachrichten.",
    en: "Telegram FZ-LLC, United Arab Emirates. Only transferred: Telegram ID, first name, optional username, and the text of our replies to your support messages.",
  },
  /** Telegram processor row, appended to the purpose. */
  telegramPurpose: {
    de: "Support-Nachrichten an den MedPrüf-Bot und unsere Antworten.",
    en: "Support messages to the MedPrüf bot and our replies.",
  },
  /** Section 2.2, data we collect. */
  dataBullet: {
    de: "Nachrichten, die Sie dem MedPrüf-Bot auf Telegram schreiben, und unsere Antworten darauf.",
    en: "Messages you write to the MedPrüf bot on Telegram and our replies to them.",
  },
} as const;
