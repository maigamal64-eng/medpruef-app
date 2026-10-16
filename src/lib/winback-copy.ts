/**
 * Learner copy for win-back credits (a-winback-credits, J11): the one line in
 * the access-ending mail and the Home note after the grant. de and en are
 * authored; every other preference reads English (the mail already follows
 * reminderLang). Sie, no em or en dashes, no prices, no deadline wording
 * (pick-predeadline-send A), never "free AI" or "unlimited": the credits are
 * for questions to the AI Mentor, they expire, and they are not Pro or money.
 * Lektor review is a release gate before REWARDS_WINBACK_ENABLED goes on.
 *
 * Server and client safe (no I/O).
 */

export type WinbackLang = "de" | "en";

const AUTHORED: Record<string, WinbackLang> = { de: "de", en: "en" };

export function winbackLang(lang: string | null | undefined): WinbackLang {
  return AUTHORED[lang ?? ""] ?? "en";
}

interface WinbackCopy {
  /** Mail: after the plan list, never before it (price last still binds). */
  mailLine: (credits: number, days: number) => string;
  noteTitle: string;
  noteBody: (credits: number, date: string) => string;
  noteOpen: string;
  notePlans: string;
  noteDismiss: string;
  dateLocale: string;
}

const COPY: Record<WinbackLang, WinbackCopy> = {
  de: {
    mailLine: (c, d) => `Ihr KI-Mentor bleibt bei Ihnen: Wenn Ihr Pro-Zugang endet, schreiben wir Ihrem Konto ${c} Credits für Fragen an den KI-Mentor gut, ${d} Tage gültig. Die Credits sind kein Pro-Zugang und haben keinen Geldwert.`,
    noteTitle: "Ihr KI-Mentor bleibt bei Ihnen",
    noteBody: (c, date) => `Ihr Pro-Zugang ist beendet. Für Fragen an den KI-Mentor stehen Ihnen ${c} Credits zur Verfügung, gültig bis ${date}. Die Fragenbank zeigt jetzt die kostenlose Version. Zu Pro können Sie jederzeit zurückkehren.`,
    noteOpen: "Mentor öffnen",
    notePlans: "Tarife ansehen",
    noteDismiss: "Ausblenden",
    dateLocale: "de-AT",
  },
  en: {
    mailLine: (c, d) => `Your AI Mentor stays with you: when your Pro access ends, we add ${c} credits for questions to the AI Mentor to your account, valid for ${d} days. The credits are not Pro access and have no cash value.`,
    noteTitle: "Your AI Mentor stays with you",
    noteBody: (c, date) => `Your Pro access has ended. You have ${c} credits for questions to the AI Mentor, valid until ${date}. The question bank now shows the free version. You can come back to Pro any time.`,
    noteOpen: "Open the mentor",
    notePlans: "See plans",
    noteDismiss: "Hide",
    dateLocale: "en-GB",
  },
};

export function winbackCopy(lang: WinbackLang): WinbackCopy {
  return COPY[lang];
}

/** The expiry as the learner reads it: Vienna calendar day. */
export function winbackDate(iso: string, lang: WinbackLang): string {
  return new Intl.DateTimeFormat(COPY[lang].dateLocale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(iso));
}
