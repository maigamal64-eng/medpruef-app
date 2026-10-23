/**
 * Privacy page entry for Intercom (a-intercom-contact-sync). Pure; the page
 * passes the two build flags. Messenger only: the earlier text, unchanged.
 * Contact sync on (NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC, copied at build from
 * MEDPRUF_INTERCOM_SYNC_ENABLED): the contact sync entry below, Lektor
 * APPROVE WITH EDITS 17 Oct 2026 (edits applied verbatim). Flipping the sync flag needs a redeploy so this text ships with it.
 *
 * a-intercom-into-n2n3-1021: one Intercom row whatever the mix of flags.
 * Marketing consent (NEXT_PUBLIC_MARKETING_CONSENT_ENABLED) on its own keeps
 * its own row (support and opted-in news); together with the contact sync the
 * sync row gets one added sentence about news emails (Lektor read in the
 * track-b handover a-intercom-into-n2n3-1021/lektor.md). The Telegram bridge
 * (NEXT_PUBLIC_TELEGRAM_INTERCOM_BRIDGE) adds its Lektor-approved purpose
 * block: in the sync row right after the chat sentence (support channels
 * together, then the consent sentence, then deletion); elsewhere appended;
 * alone with its own US line (Lektor 21 Oct).
 */
import { PRIVACY_INTERCOM_NEWS } from "@/lib/marketing-consent/copy";
import { BRIDGE_PRIVACY } from "@/lib/intercom/bridge-privacy-copy";

export interface PrivacyProcessor {
  name: string;
  purpose: { de: string; en: string };
  jurisdiction: { de: string; en: string };
  policyUrl: string;
  policyLabel: string;
}

const POLICY = { policyUrl: "https://www.intercom.com/legal/privacy", policyLabel: "intercom.com/legal/privacy" };

export const INTERCOM_MESSENGER_ENTRY: PrivacyProcessor = {
  name: "Intercom",
  purpose: {
    de: "Support-Chat, den angemeldete Nutzer selbst öffnen. Übermittelt werden eine serverseitig bestätigte Konto-ID und die im Chat eingegebenen Inhalte.",
    en: "Support chat opened by signed-in users. A server-verified account ID and the content entered in chat are shared.",
  },
  jurisdiction: {
    de: "Intercom, Inc. Die Verarbeitungsregion hängt von der Workspace-Konfiguration ab. Siehe Intercoms Datenschutzhinweise.",
    en: "Intercom, Inc. Processing region depends on workspace configuration. See Intercom's privacy information.",
  },
  ...POLICY,
};

export const INTERCOM_CONTACT_SYNC_ENTRY: PrivacyProcessor = {
  name: "Intercom",
  purpose: {
    de: "Kundenservice (Support-Chat und Antworten auf Ihre Anfragen). Damit Sie Ihre Angaben im Support nicht erneut nennen müssen, übermitteln wir für Ihr Konto: Konto-ID, E-Mail-Adresse, Name, gewählte Prüfung, das von Ihnen selbst eingetragene Prüfungsdatum, Tarif und Ende des Zugangs, Sprache der Oberfläche, Datum der Registrierung, letzte Aktivität, ob ein Telegram-Konto verknüpft ist und ob Sie Werbe-E-Mails zugestimmt haben. Im Support-Chat kommen die von Ihnen eingegebenen Inhalte hinzu. Wenn Ihr Konto gelöscht wird, veranlassen wir auch die Löschung Ihres Kontakteintrags bei Intercom.",
    en: "Customer support (support chat and replies to your requests). So that you do not have to repeat your details to support, we share for your account: account ID, email address, name, chosen exam, the exam date you entered yourself, plan and end of access, interface language, sign-up date, last activity, whether a Telegram account is linked and whether you agreed to marketing emails. In the support chat, the content you enter is added. When your account is deleted, we also request deletion of your contact record at Intercom.",
  },
  // True only while MEDPRUF_INTERCOM_REGION is us (the MedPruef workspace is
  // US). A region change must update this line in the same deploy.
  jurisdiction: {
    de: "Intercom, Inc., USA. Die Daten werden in den USA verarbeitet. Übermittlungsgrundlage wird derzeit geprüft. Siehe Intercoms Datenschutzhinweise.",
    en: "Intercom, Inc., USA. The data is processed in the USA. Transfer basis under review. See Intercom's privacy information.",
  },
  ...POLICY,
};

/** Appended to the contact sync row while the marketing consent is on. */
export const INTERCOM_SYNC_NEWS_SENTENCE = {
  de: "Nur wenn Sie zugestimmt haben, senden wir Ihnen über Intercom außerdem E-Mails mit Neuigkeiten, Lerntipps und Angeboten.",
  en: "We also send you emails with news, study tips and offers through Intercom, but only if you have agreed to receive them.",
} as const;

/**
 * Feedback tickets (a-intercom-feedback-tickets, build copy
 * NEXT_PUBLIC_MEDPRUF_INTERCOM_TICKETS). Lektor APPROVE WITH EDITS 21 Oct
 * (edits applied; track-b handover a-intercom-into-n2n3-1021/lektor.md).
 */
export const INTERCOM_TICKETS_SENTENCE = {
  de: "Wenn Sie nach der Anmeldung Feedback senden oder eine Frage melden, legen wir dafür ein Ticket in unserem Support-Postfach bei Intercom an: bei Feedback mit Ihrem Text und der Seite, von der Sie es senden, bei Meldungen mit Ihrem Text, der Nummer der Frage, der Prüfung und dem Grund. Über den Stand des Tickets informieren wir Sie über Intercom.",
  en: "When you send feedback or report a question while signed in, we open a ticket in our support inbox at Intercom: for feedback with your text and the page you sent it from, for reports with your text, the question number, the exam and the reason. We tell you about the status of the ticket through Intercom.",
} as const;

/** The approved deletion sentence of the contact sync row; added sentences go before it (Lektor 21 Oct). */
const SYNC_DELETION = {
  de: "Wenn Ihr Konto gelöscht wird,",
  en: "When your account is deleted,",
} as const;

/**
 * The contact sync row with extra sentences placed before its closing
 * deletion sentence, so the row reads: what is shared, then what else is
 * sent, then what happens on deletion (Lektor 21 Oct, track-b handover
 * a-intercom-into-n2n3-1021/lektor.md).
 */
export function syncPurposeWith(extra: { de: string[]; en: string[] }): { de: string; en: string } {
  const place = (lang: "de" | "en") => {
    const text = INTERCOM_CONTACT_SYNC_ENTRY.purpose[lang];
    const at = text.indexOf(SYNC_DELETION[lang]);
    const add = extra[lang].filter(Boolean);
    if (add.length === 0) return text;
    if (at < 0) return [text, ...add].join(" ");
    return [text.slice(0, at).trimEnd(), ...add, text.slice(at)].join(" ");
  };
  return { de: place("de"), en: place("en") };
}

function baseEntry(flags: { messenger: boolean; sync: boolean; news?: boolean }): PrivacyProcessor | null {
  if (flags.sync) return INTERCOM_CONTACT_SYNC_ENTRY;
  if (flags.news) {
    return {
      name: "Intercom",
      purpose: flags.messenger ? { ...PRIVACY_INTERCOM_NEWS.purpose } : { ...PRIVACY_INTERCOM_NEWS.purposeNoChat },
      jurisdiction: { ...PRIVACY_INTERCOM_NEWS.jurisdiction },
      ...POLICY,
    };
  }
  if (flags.messenger) return INTERCOM_MESSENGER_ENTRY;
  return null;
}

export function intercomPrivacyEntry(flags: { messenger: boolean; sync: boolean; news?: boolean; bridge?: boolean; tickets?: boolean }): PrivacyProcessor | null {
  if (flags.sync) {
    // Order (Lektor 21 Oct): data list, chat sentence, Telegram block, tickets, consent sentence, deletion.
    const pick = (lang: "de" | "en") => [
      flags.bridge ? BRIDGE_PRIVACY.intercomPurpose[lang] : "",
      flags.tickets ? INTERCOM_TICKETS_SENTENCE[lang] : "",
      flags.news ? INTERCOM_SYNC_NEWS_SENTENCE[lang] : "",
    ];
    if (!flags.bridge && !flags.news && !flags.tickets) return INTERCOM_CONTACT_SYNC_ENTRY;
    return { ...INTERCOM_CONTACT_SYNC_ENTRY, purpose: syncPurposeWith({ de: pick("de"), en: pick("en") }) };
  }
  const base = baseEntry(flags);
  const extra = (lang: "de" | "en") =>
    [flags.bridge ? BRIDGE_PRIVACY.intercomPurpose[lang] : "", flags.tickets ? INTERCOM_TICKETS_SENTENCE[lang] : ""].filter(Boolean);
  if (!flags.bridge && !flags.tickets) return base;
  if (!base) {
    return {
      name: "Intercom",
      purpose: { de: extra("de").join(" "), en: extra("en").join(" ") },
      jurisdiction: { ...BRIDGE_PRIVACY.intercomJurisdiction },
      ...POLICY,
    };
  }
  return {
    ...base,
    purpose: {
      de: [base.purpose.de, ...extra("de")].join(" "),
      en: [base.purpose.en, ...extra("en")].join(" "),
    },
    // The messenger-only line leaves the region open; bridge and tickets run on the US workspace.
    jurisdiction: base === INTERCOM_MESSENGER_ENTRY ? { ...BRIDGE_PRIVACY.intercomJurisdiction } : base.jurisdiction,
  };
}
