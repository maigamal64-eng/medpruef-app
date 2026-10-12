/**
 * Learner copy for question reports (a15: QLT-03, TR-10). Own dictionary so
 * the shared src/lib/i18n.ts stays untouched.
 *
 * de and en are authored. Every other account language reads English until a
 * native review exists (Arabic additionally needs [name]'s sign-off). German
 * uses formal Sie. No em dashes; a unit test enforces both rules.
 */

import type { Lang } from "@/lib/i18n";
import type { LearnerReportState } from "@/lib/reports/report-status";

export interface ReportsCopy {
  ackTitle: string;
  ackBody: string;
  ackLink: string;
  close: string;
  sendError: string;
  rateLimited: string;
  offline: string;
  listTitle: string;
  listIntro: string;
  listEmpty: string;
  listError: string;
  retry: string;
  loading: string;
  loadMore: string;
  turnaroundHours: string;
  turnaroundDays: string;
  question: string;
  reportedOn: string;
  resolvedOn: string;
  openQuestion: string;
  typeFlag: string;
  typeEdit: string;
  settingsRow: string;
  settingsRowSub: string;
  state: Record<LearnerReportState, string>;
  stateBody: Record<LearnerReportState, string>;
  dateLocale: string;
}

const DE: ReportsCopy = {
  ackTitle: "Vielen Dank",
  ackBody: "Ihre Meldung ist angekommen. Den Status sehen Sie jederzeit unter Meine Meldungen.",
  ackLink: "Meine Meldungen ansehen",
  close: "Schließen",
  sendError: "Ihre Meldung konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
  rateLimited: "Sie haben in kurzer Zeit viele Meldungen gesendet. Bitte versuchen Sie es in einigen Minuten erneut.",
  offline: "Sie sind offline. Ihre Eingabe bleibt erhalten; senden Sie die Meldung, sobald Sie wieder verbunden sind.",
  listTitle: "Meine Meldungen",
  listIntro: "Hier sehen Sie, was aus Ihren gemeldeten Fragen geworden ist.",
  listEmpty: "Sie haben noch keine Frage gemeldet. Einen Fehler melden Sie über „Melden“ direkt bei der Frage.",
  listError: "Ihre Meldungen konnten nicht geladen werden.",
  retry: "Erneut versuchen",
  loading: "Meldungen werden geladen",
  loadMore: "Weitere laden",
  turnaroundHours: "Meldungen werden derzeit im Median nach etwa {n} Stunden bearbeitet.",
  turnaroundDays: "Meldungen werden derzeit im Median nach etwa {n} Tagen bearbeitet.",
  question: "Frage #{id}",
  reportedOn: "Gemeldet am {date}",
  resolvedOn: "Bearbeitet am {date}",
  openQuestion: "Frage öffnen",
  typeFlag: "Problem gemeldet",
  typeEdit: "Änderung vorgeschlagen",
  settingsRow: "Meine Meldungen",
  settingsRowSub: "Status Ihrer gemeldeten Fragen",
  state: {
    open: "Offen",
    accepted: "Angenommen",
    fixed: "Korrigiert",
    not_an_error: "Kein Fehler",
    needs_info: "Mehr Angaben nötig",
    closed: "Abgeschlossen",
  },
  stateBody: {
    open: "Wir haben Ihre Meldung erhalten und prüfen sie.",
    accepted: "Ihr Hinweis ist berechtigt. Die Frage wird überarbeitet.",
    fixed: "Die Frage wurde korrigiert. Die neue Fassung sehen Sie beim nächsten Üben.",
    not_an_error: "Wir haben Frage und Lösung geprüft und keinen Fehler gefunden.",
    needs_info: "Wir konnten das Problem nicht nachvollziehen. Melden Sie die Frage gern erneut mit mehr Details.",
    closed: "Diese Meldung ist abgeschlossen.",
  },
  dateLocale: "de-AT",
};

const EN: ReportsCopy = {
  ackTitle: "Thank you",
  ackBody: "Your report has arrived. You can follow its status any time under My reports.",
  ackLink: "View my reports",
  close: "Close",
  sendError: "Your report could not be sent. Please try again.",
  rateLimited: "You sent many reports in a short time. Please try again in a few minutes.",
  offline: "You are offline. Your text is kept; send the report once you are connected again.",
  listTitle: "My reports",
  listIntro: "What happened to the questions you reported.",
  listEmpty: "You have not reported a question yet. Use Report on any question to tell us about an error.",
  listError: "Your reports could not be loaded.",
  retry: "Try again",
  loading: "Loading reports",
  loadMore: "Load more",
  turnaroundHours: "Reports are currently resolved in a median of about {n} hours.",
  turnaroundDays: "Reports are currently resolved in a median of about {n} days.",
  question: "Question #{id}",
  reportedOn: "Reported on {date}",
  resolvedOn: "Resolved on {date}",
  openQuestion: "Open question",
  typeFlag: "Problem reported",
  typeEdit: "Edit suggested",
  settingsRow: "My reports",
  settingsRowSub: "Status of the questions you reported",
  state: {
    open: "Open",
    accepted: "Accepted",
    fixed: "Fixed",
    not_an_error: "Not an error",
    needs_info: "More information needed",
    closed: "Closed",
  },
  stateBody: {
    open: "We received your report and are reviewing it.",
    accepted: "Your report is valid. The question is being revised.",
    fixed: "The question was corrected. You will see the new version the next time you practise.",
    not_an_error: "We checked the question and its answer and found no error.",
    needs_info: "We could not reproduce the problem. Feel free to report the question again with more detail.",
    closed: "This report is closed.",
  },
  dateLocale: "en-GB",
};

export const REPORTS_COPY = { de: DE, en: EN } as const;

/** German for German, English for every other language (reviewed fallback). */
export function reportsCopy(lang: Lang): ReportsCopy {
  return lang === "de" ? DE : EN;
}

/** "about N hours" under two days, otherwise "about N days". */
export function turnaroundLine(copy: ReportsCopy, medianHours: number): string {
  if (medianHours < 48) return copy.turnaroundHours.replace("{n}", String(Math.max(1, Math.round(medianHours))));
  return copy.turnaroundDays.replace("{n}", String(Math.round(medianHours / 24)));
}
