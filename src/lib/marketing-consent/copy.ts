/**
 * Learner copy for the marketing consent (a-intercom-marketing-consent).
 * DE in Sie and EN; every other interface language reads English until a
 * native review (Arabic drafts go to [name], never here). Lektor APPROVE WITH
 * EDITS 17 Oct 2026, edits applied verbatim; second pass (privacy 3.3 item,
 * purposeNoChat, onUnconfirmed) APPROVE (track-b handover
 * a-intercom-marketing-consent/lektor.md).
 *
 * MARKETING_CONSENT_VERSION names the consent text a learner saw. Change the
 * checkbox or the card description and the version together: the unit test
 * pins the text of each version.
 */

export const MARKETING_CONSENT_VERSION = "mc-2026-10-17.1";

export type ConsentLang = "de" | "en";

const REVIEWED: Record<string, ConsentLang> = { de: "de", en: "en" };

export function consentLang(lang: string | null | undefined): ConsentLang {
  return REVIEWED[lang ?? ""] ?? "en";
}

/** The consent text itself: what the learner agrees to (versioned). */
export const CONSENT_TEXT = {
  de: {
    checkbox: "E-Mails mit Neuigkeiten, Lerntipps und Angeboten von MedPrüf erhalten (freiwillig, jederzeit in den Einstellungen abbestellbar)",
    cardBody: "Neue Funktionen, Lerntipps und Angebote von MedPrüf per E-Mail. Freiwillig und jederzeit abbestellbar.",
  },
  en: {
    checkbox: "Get emails with MedPrüf news, study tips and offers (optional, unsubscribe any time in Settings)",
    cardBody: "New features, study tips and offers from MedPrüf by email. Optional, unsubscribe any time.",
  },
} as const;

const CARD = {
  de: {
    title: "Neuigkeiten per E-Mail",
    switchLabel: "Neuigkeiten und Angebote per E-Mail erhalten",
    on: (email: string) => `Ihre Zustimmung ist gespeichert. Wenn wir Neuigkeiten senden, gehen sie an ${email}.`,
    onUnconfirmed: "Ihre Zustimmung ist gespeichert. Neuigkeiten senden wir erst, wenn Ihre E-Mail-Adresse bestätigt ist.",
    off: "Sie erhalten keine E-Mails mit Neuigkeiten und Angeboten. E-Mails zu Ihrem Konto, Ihrem Zugang und Zahlungen sowie Antworten auf Ihre Anfragen bekommen Sie weiterhin.",
    noEmail: "Hinterlegen Sie zuerst eine E-Mail-Adresse, um Neuigkeiten zu erhalten.",
    outcome: {
      saved_on: "Gespeichert. Sie haben E-Mails mit Neuigkeiten und Angeboten zugestimmt.",
      saved_off: "Gespeichert. Wir senden Ihnen keine E-Mails mit Neuigkeiten und Angeboten mehr.",
      failed: "Nicht gespeichert. Ihre bisherige Einstellung gilt weiter. Bitte versuchen Sie es erneut.",
      rate_limited: "Zu viele Änderungen. Bitte versuchen Sie es in einigen Minuten erneut.",
    },
  },
  en: {
    title: "News by email",
    switchLabel: "Get news and offers by email",
    on: (email: string) => `Your consent is saved. When we send news, it goes to ${email}.`,
    onUnconfirmed: "Your consent is saved. We send news only once your email address is confirmed.",
    off: "You get no emails with news and offers. Emails about your account, your access and payments, and replies to your requests still reach you.",
    noEmail: "Add an email address first to get news.",
    outcome: {
      saved_on: "Saved. You agreed to emails with news and offers.",
      saved_off: "Saved. We will no longer send you emails with news and offers.",
      failed: "Not saved. Your previous setting still applies. Please try again.",
      rate_limited: "Too many changes. Please try again in a few minutes.",
    },
  },
} as const;

export type ConsentOutcome = keyof (typeof CARD)["de"]["outcome"];

export function marketingConsentCopy(lang: string | null | undefined) {
  const l = consentLang(lang);
  return { ...CARD[l], body: CONSENT_TEXT[l].cardBody, checkbox: CONSENT_TEXT[l].checkbox };
}

/** Privacy page text shown while the consent flag is on. */
export const PRIVACY_CONSENT = {
  heading: { de: "3.3 Einwilligung in E-Mails mit Neuigkeiten und Angeboten", en: "3.3 Consent to emails with news and offers" },
  items: [
    {
      de: "E-Mails mit Neuigkeiten, Lerntipps und Angeboten senden wir nur, wenn Sie bei der Registrierung oder in den Einstellungen zugestimmt haben (Art. 6 Abs. 1 lit. a DSGVO), und nur an eine von Ihnen bestätigte E-Mail-Adresse. Diese E-Mails versenden wir über Intercom, Inc., USA, oder über Zoho Mail. Wir speichern, ob Sie zugestimmt haben, den Zeitpunkt Ihrer letzten Entscheidung und die Fassung des Zustimmungstextes.",
      en: "We send emails with news, study tips and offers only if you agreed at sign-up or in Settings (Art. 6(1)(a) GDPR), and only to an email address you have confirmed. We send these emails through Intercom, Inc., USA, or Zoho Mail. We store whether you agreed, the time of your latest decision and the version of the consent text.",
    },
    {
      de: "Sie können die Zustimmung jederzeit in den Einstellungen widerrufen. Der Widerruf gilt ab diesem Zeitpunkt und berührt nicht die Rechtmäßigkeit der Verarbeitung bis dahin. E-Mails zu Ihrem Konto, Ihrem Zugang und Zahlungen sowie Antworten auf Ihre Anfragen senden wir unabhängig davon.",
      en: "You can withdraw your consent at any time in Settings. The withdrawal applies from that moment and does not affect processing before it. Emails about your account, your access and payments, and replies to your requests are sent regardless.",
    },
  ],
} as const;

export const PRIVACY_INTERCOM_NEWS = {
  purpose: {
    de: "Kundenservice (Support-Chat) und, nur wenn Sie zugestimmt haben, der Versand von E-Mails mit Neuigkeiten und Angeboten. Übermittelt werden eine serverseitig bestätigte Konto-ID, die im Chat eingegebenen Inhalte und ob Sie diesen E-Mails zugestimmt haben; für den Versand zusätzlich Ihre E-Mail-Adresse und Ihr Name.",
    en: "Customer support (support chat) and, only if you agreed, sending emails with news and offers. Shared: a server-verified account ID, the content entered in chat and whether you agreed to these emails; for sending them, also your email address and name.",
  },
  /** The Intercom row while the support chat (NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED) is off. */
  purposeNoChat: {
    de: "Versand von E-Mails mit Neuigkeiten und Angeboten, nur wenn Sie zugestimmt haben. Übermittelt werden eine serverseitig bestätigte Konto-ID und ob Sie diesen E-Mails zugestimmt haben; für den Versand zusätzlich Ihre E-Mail-Adresse und Ihr Name.",
    en: "Sending emails with news and offers, only if you agreed. Shared: a server-verified account ID and whether you agreed to these emails; for sending them, also your email address and name.",
  },
  jurisdiction: {
    de: "Intercom, Inc., USA. Die Daten werden in den USA verarbeitet. Übermittlungsgrundlage wird derzeit geprüft. Siehe Intercoms Datenschutzhinweise.",
    en: "Intercom, Inc., USA. The data is processed in the USA. Transfer basis under review. See Intercom's privacy information.",
  },
} as const;

export const PRIVACY_ZOHO_PURPOSE = {
  de: "Ausgehender E-Mail-Versand über user-b7e46e80@example.com: E-Mails zu Ihrem Konto, Ihrem Zugang und Zahlungen (auch der Hinweis vor dem Ende Ihres Zugangs), Antworten auf Ihre Anfragen, Benachrichtigungen zu von Ihnen gemeldeten Fragen und persönliche Nachrichten von MedPrüf. Werbliche Inhalte nur mit Ihrer Zustimmung.",
  en: "Outbound email via user-b7e46e80@example.com: emails about your account, your access and payments (including the notice before your access ends), replies to your requests, notifications about questions you reported and personal messages from MedPrüf. Marketing content only with your consent.",
} as const;
