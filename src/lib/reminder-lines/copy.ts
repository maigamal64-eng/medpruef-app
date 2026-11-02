/**
 * Copy of the A3 reminder lines (growth pass 2 Nov 2026), byte-exact from
 * reports/growth-weekly/2026-11-02/approved/in-app-lines.json (sha256
 * 315a2b1a8ae37e06d8afd6b396250d70d9e8eb72362c51dc33bf3cb998935143, Lektor
 * APPROVE round 2): a3-answer-page-reminder-line and a3-lernplan-reminder-line.
 * No date, price or number is typed here. German and English only; any other
 * language reads English. a3-home-pending-expired is not shipped (it needs the
 * "expired" view state first; see the job's followups).
 */
export type ReminderLang = "de" | "en";

export const A3_ANSWER_LINE: Record<ReminderLang, { body: string; cta: string; ctaSignedIn: string }> = {
  de: {
    body: "Fristen nicht verpassen: Mit einem MedPrüf-Konto, ohne Karte, schalten Sie Erinnerungen an die offiziellen Anmeldefristen per E-Mail ein, höchstens zweimal pro Frist.",
    cta: "Konto anlegen",
    ctaSignedIn: "Erinnerungen in den Einstellungen einschalten",
  },
  en: {
    body: "Do not miss a deadline: with a MedPrüf account, no card needed, you can turn on email reminders for the official registration deadlines, at most twice per deadline.",
    cta: "Create an account",
    ctaSignedIn: "Turn on reminders in Settings",
  },
};

export const A3_LERNPLAN_LINE: Record<ReminderLang, string> = {
  de: "Ihr Plan steht. Nach dem Speichern können Sie in den Einstellungen Erinnerungen an die Anmeldefristen per E-Mail einschalten, höchstens zweimal pro Frist.",
  en: "Your plan is ready. Once it is saved, you can turn on email reminders for the registration deadlines in Settings, at most twice per deadline.",
};

export function reminderLang(lang: string | null | undefined): ReminderLang {
  if (lang === "de") return "de";
  return "en";
}
