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
 * track-b handover a-intercom-into-n2n3-1021/lektor.md).
 */
import { PRIVACY_INTERCOM_NEWS } from "@/lib/marketing-consent/copy";

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
  de: "Nur wenn Sie zugestimmt haben, senden wir Ihnen über Intercom außerdem E-Mails mit Neuigkeiten und Angeboten.",
  en: "Only if you agreed, we also send you emails with news and offers through Intercom.",
} as const;

export function intercomPrivacyEntry(flags: { messenger: boolean; sync: boolean; news?: boolean }): PrivacyProcessor | null {
  if (flags.sync && flags.news) {
    return {
      ...INTERCOM_CONTACT_SYNC_ENTRY,
      purpose: {
        de: `${INTERCOM_CONTACT_SYNC_ENTRY.purpose.de} ${INTERCOM_SYNC_NEWS_SENTENCE.de}`,
        en: `${INTERCOM_CONTACT_SYNC_ENTRY.purpose.en} ${INTERCOM_SYNC_NEWS_SENTENCE.en}`,
      },
    };
  }
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
