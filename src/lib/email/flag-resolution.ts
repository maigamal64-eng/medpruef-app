/**
 * TR-10: the email a reporter receives when an admin resolves their
 * question report. Pure (no I/O) and unit-tested.
 *
 * German uses formal Sie; any other account language gets English.
 * No em dashes. The only identity in the mail is the recipient's own
 * first name; the admin and other reporters are never named.
 */

import type { ReporterOutcome } from "@/lib/reports/report-status";

export interface FlagResolutionArgs {
  lang: "de" | "en";
  firstName: string | null;
  questionId: number;
  outcome: ReporterOutcome;
  /** The admin note from the resolution, sent verbatim (escaped). */
  adminNote: string | null;
  reportedAtIso: string | null;
  siteUrl?: string;
}

/** Account language → mail language. Unknown or non-German preferences read English; no preference reads German. */
export function flagResolutionLang(languageCode: string | null | undefined): "de" | "en" {
  if (!languageCode) return "de";
  return languageCode.toLowerCase().startsWith("de") ? "de" : "en";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COPY = {
  de: {
    subject: {
      fixed: "Ihre Meldung zu Frage #{id}: korrigiert",
      accepted: "Ihre Meldung zu Frage #{id}: angenommen",
      not_an_error: "Ihre Meldung zu Frage #{id}: geprüft",
      needs_info: "Ihre Meldung zu Frage #{id}: Rückfrage",
    },
    greeting: "Guten Tag",
    intro: "vielen Dank für Ihre Meldung zu Frage #{id}{date}. Wir haben sie geprüft.",
    reportedOn: " vom {date}",
    outcome: {
      fixed: "Wir haben die Frage korrigiert. Die überarbeitete Fassung sehen Sie ab sofort beim Üben.",
      accepted: "Ihr Hinweis ist berechtigt. Wir haben die Meldung angenommen und überarbeiten die Frage.",
      not_an_error: "Wir haben Frage und Lösung erneut geprüft und keinen Fehler gefunden. Die Frage bleibt unverändert.",
      needs_info: "Wir konnten das Problem noch nicht nachvollziehen. Wenn Sie uns mehr Angaben schicken möchten, antworten Sie einfach auf diese E-Mail.",
    },
    result: "Ergebnis",
    note: "Anmerkung aus unserem Team",
    open: "Frage ansehen",
    list: "Alle Ihre Meldungen und deren Status finden Sie in den Einstellungen unter Meine Meldungen.",
    closing: "Mit freundlichen Grüßen",
    team: "Ihr MedPrüf-Team",
    locale: "de-AT",
  },
  en: {
    subject: {
      fixed: "Your report on question #{id}: fixed",
      accepted: "Your report on question #{id}: accepted",
      not_an_error: "Your report on question #{id}: reviewed",
      needs_info: "Your report on question #{id}: we need more information",
    },
    greeting: "Hello",
    intro: "thank you for reporting question #{id}{date}. We have reviewed it.",
    reportedOn: " on {date}",
    outcome: {
      fixed: "We corrected the question. You will see the revised version the next time you practise it.",
      accepted: "Your report is valid. We accepted it and are revising the question.",
      not_an_error: "We checked the question and its answer again and found no error. The question stays as it is.",
      needs_info: "We could not reproduce the problem yet. If you would like to send us more detail, simply reply to this email.",
    },
    result: "Outcome",
    note: "Note from our team",
    open: "Open the question",
    list: "All your reports and their status are in Settings under My reports.",
    closing: "Kind regards",
    team: "The MedPrüf team",
    locale: "en-GB",
  },
} as const;

export function renderFlagResolution(args: FlagResolutionArgs): { subject: string; htmlBody: string; textBody: string } {
  const c = COPY[args.lang];
  const site = (args.siteUrl || "https://medpruf.com").replace(/\/$/, "");
  const id = String(args.questionId);
  const reported = args.reportedAtIso ? new Date(args.reportedAtIso) : null;
  const dateText = reported && Number.isFinite(reported.getTime())
    ? c.reportedOn.replace("{date}", reported.toLocaleDateString(c.locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }))
    : "";
  const subject = c.subject[args.outcome].replace("{id}", id);
  const name = args.firstName?.trim() ? ` ${args.firstName.trim().slice(0, 60)}` : "";
  const intro = c.intro.replace("{id}", id).replace("{date}", dateText);
  const outcome = c.outcome[args.outcome];
  const note = args.adminNote?.trim() ? args.adminNote.trim().slice(0, 1000) : null;
  const questionUrl = `${site}/quiz?questionId=${encodeURIComponent(id)}`;
  const listUrl = `${site}/settings#meine-meldungen`;

  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;">
<p>${c.greeting}${escapeHtml(name)},</p>
<p>${escapeHtml(intro)}</p>
<p><strong>${c.result}:</strong> ${escapeHtml(outcome)}</p>
${note ? `<p><strong>${c.note}:</strong><br>${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : ""}
<p><a href="${questionUrl}" style="display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;">${c.open}</a></p>
<p style="font-size:14px; color:#4a5568;"><a href="${listUrl}" style="color:#003a8c;">${escapeHtml(c.list)}</a></p>
<p>${c.closing}<br>${c.team}</p>
</body></html>`;

  const textBody = [
    `${c.greeting}${name},`,
    "",
    intro,
    "",
    `${c.result}: ${outcome}`,
    ...(note ? ["", `${c.note}:`, note] : []),
    "",
    `${c.open}: ${questionUrl}`,
    `${c.list} ${listUrl}`,
    "",
    c.closing,
    c.team,
  ].join("\n");

  return { subject, htmlBody, textBody };
}
