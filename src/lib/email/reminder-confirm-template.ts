import { escapeHtml as e } from "@/lib/reminders/common";

// Double opt-in mails for exam deadline reminders and study reminders (b19,
// a30 copy pass): Sie, MedPrüf in the subject, lang on the HTML, only true
// statements (the link lives 24 hours, see signReminderToken).
export type ConfirmKind = "exam" | "study";
const COPY = {
  de: {
    subject: { exam: "MedPrüf: Fristerinnerungen bestätigen", study: "MedPrüf: Lernerinnerungen bestätigen" },
    body: {
      exam: "Bitte bestätigen Sie, dass wir Sie per E-Mail an die offiziellen Anmeldefristen Ihrer Prüfung erinnern dürfen (14, 7, 3 und 1 Tag vor Anmeldeschluss, solange die Anmeldung offen ist).",
      study: "Bitte bestätigen Sie, dass wir Ihnen Lernerinnerungen an diese E-Mail-Adresse senden dürfen (höchstens eine pro Tag, zu der von Ihnen gewählten Uhrzeit).",
    },
    button: "Bestätigen",
    expiry: "Der Link ist 24 Stunden gültig. Falls Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren.",
  },
  en: {
    subject: { exam: "MedPrüf: confirm deadline reminders", study: "MedPrüf: confirm study reminders" },
    body: {
      exam: "Please confirm that we may email you about the official registration deadlines of your exam (14, 7, 3 and 1 day before registration closes, while registration is open).",
      study: "Please confirm that we may send study reminders to this email address (at most one a day, at the time you chose).",
    },
    button: "Confirm",
    expiry: "The link is valid for 24 hours. If you did not request this, you can ignore this email.",
  },
} as const;

export function renderReminderConfirmation(kind: ConfirmKind, lang: "de" | "en", url: string): { subject: string; htmlBody: string } {
  const t = COPY[lang];
  return {
    subject: t.subject[kind],
    htmlBody: `<!DOCTYPE html><html lang="${lang}"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;"><p>${e(t.body[kind])}</p><p><a href="${e(url)}" style="display:inline-block;background:#007B5F;color:white;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;">${e(t.button)}</a></p><p style="color:#4a5568;font-size:13px;">${e(t.expiry)}</p></body></html>`,
  };
}
