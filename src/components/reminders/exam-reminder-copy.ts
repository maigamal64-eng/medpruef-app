// a-d5b exam deadline reminder opt-in (Settings card + Home line). Sie, no
// dashes. Reviewed languages only (de, en); every other preference renders
// English (REVIEWED_LANGS). Lektor APPROVE 2026-10-14 (after four rewrites).
import { CONTACT } from "@/lib/content-truth";
import type { ExamReminderBank, ExamReminderOutcome } from "@/lib/hooks/useExamReminder";

const COPY = {
  de: {
    title: "Prüfungsfristen per E-Mail",
    exams: { kenntnispruefung: "SIP4a und SIP5a (Wien)", pharma: "Rezeptierkunde und Gerichtsmedizin (Wien)", kmp_innsbruck: "" } as Record<ExamReminderBank, string>,
    lead: (exam: string) => `Wir erinnern Sie per E-Mail an den offiziellen Anmeldeschluss für ${exam}: 14, 7, 3 und 1 Tag vorher, solange die Anmeldung offen ist.`,
    turnOn: "Erinnerungen einschalten",
    off: "Ausgeschaltet.",
    pending: (email: string) => `Bitte bestätigen Sie über den Link, den wir an ${email} gesendet haben. Er ist 24 Stunden gültig. Erst danach senden wir Erinnerungen.`,
    on: (email: string) => `Eingeschaltet. Die Erinnerungen gehen an ${email}.`,
    resend: "Link erneut senden",
    cancel: "Anfrage zurückziehen",
    turnOff: "Erinnerungen abbestellen",
    noEmail: "Für Fristerinnerungen braucht Ihr Konto eine erreichbare E-Mail-Adresse.",
    footnote: "Jede Erinnerung enthält einen Link zum Abbestellen.",
    outcome: {
      sent: "Link gesendet. Bitte sehen Sie in Ihrem Postfach nach, auch im Spam-Ordner.",
      cooldown: "Wir haben Ihnen vor Kurzem einen Link gesendet. Bitte sehen Sie in Ihrem Postfach nach, auch im Spam-Ordner. Einen neuen Link können Sie nach einer Stunde anfordern.",
      withheld: `An diese Adresse können wir derzeit keine E-Mail senden. Bitte schreiben Sie uns an ${CONTACT.email}.`,
      already_on: "Die Erinnerungen sind bereits eingeschaltet.",
      turned_off: "Abbestellt. Sie erhalten keine Fristerinnerungen mehr.",
      no_email: "Für Fristerinnerungen braucht Ihr Konto eine erreichbare E-Mail-Adresse.",
      unsupported: "Für Ihre gewählte Prüfung gibt es keine Fristerinnerungen per E-Mail.",
      managed_elsewhere: `Für diese Adresse gibt es bereits eine frühere Anmeldung zu Fristerinnerungen, deshalb haben wir keinen neuen Link gesendet. Abbestellen können Sie über den Link in jeder Erinnerung. Für Änderungen schreiben Sie uns an ${CONTACT.email}.`,
      rate_limited: "Zu viele Versuche in kurzer Zeit. Bitte versuchen Sie es später erneut.",
      failed: "Das hat nicht geklappt. Bitte versuchen Sie es erneut.",
    } as Record<ExamReminderOutcome, string>,
    homePrompt: "Per E-Mail an Anmeldefristen erinnern lassen",
    homePending: "Bitte bestätigen Sie über den Link in Ihrem Postfach.",
  },
  en: {
    title: "Exam deadlines by email",
    exams: { kenntnispruefung: "SIP4a and SIP5a (Vienna)", pharma: "Rezeptierkunde and Gerichtsmedizin (Vienna)", kmp_innsbruck: "" } as Record<ExamReminderBank, string>,
    lead: (exam: string) => `We email you before the official registration deadline for ${exam}: 14, 7, 3 and 1 day before, while registration is open.`,
    turnOn: "Turn on reminders",
    off: "Off.",
    pending: (email: string) => `Please confirm using the link we sent to ${email}. It is valid for 24 hours. We only send reminders after that.`,
    on: (email: string) => `On. Reminders go to ${email}.`,
    resend: "Send the link again",
    cancel: "Withdraw request",
    turnOff: "Unsubscribe from reminders",
    noEmail: "Deadline reminders need an email address on your account that we can reach.",
    footnote: "Every reminder has a link to unsubscribe.",
    outcome: {
      sent: "Link sent. Please check your inbox, including the spam folder.",
      cooldown: "We sent you a link a short while ago. Please check your inbox, including the spam folder. You can request a new link after one hour.",
      withheld: `We cannot email this address at the moment. Please write to us at ${CONTACT.email}.`,
      already_on: "Reminders are already on.",
      turned_off: "Unsubscribed. You will not receive deadline reminders any more.",
      no_email: "Deadline reminders need an email address on your account that we can reach.",
      unsupported: "There are no email deadline reminders for the exam you chose.",
      managed_elsewhere: `This address already has an earlier sign-up for deadline reminders, so we did not send a new link. You can unsubscribe with the link in every reminder. To change it, write to us at ${CONTACT.email}.`,
      rate_limited: "Too many attempts in a short time. Please try again later.",
      failed: "That did not work. Please try again.",
    } as Record<ExamReminderOutcome, string>,
    homePrompt: "Get deadline reminders by email",
    homePending: "Please confirm using the link in your inbox.",
  },
} as const;

export type ExamReminderCopy = (typeof COPY)["de"] | (typeof COPY)["en"];
export function examReminderCopy(lang: string): ExamReminderCopy {
  return (COPY as Record<string, ExamReminderCopy>)[lang] ?? COPY.en;
}
