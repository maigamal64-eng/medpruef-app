// LX-11 study reminder card (a30). Sie, no loss wording. Reviewed languages
// only (de, en); every other preference renders English (REVIEWED_LANGS).
const COPY = {
  de: {
    title: "Lernerinnerungen",
    lead: "Höchstens eine Nachricht am Tag und nur, wenn Sie heute noch nicht geübt haben: fällige Wiederholungen (Pro) oder Ihre offene Lernserie.",
    switchLabel: "Lernerinnerungen senden",
    channel: "Kanal",
    email: "E-Mail",
    telegram: "Telegram",
    hour: "Uhrzeit (Wiener Zeit)",
    on: (channel: string, hour: string) => `Eingeschaltet: ${channel}, täglich um ${hour}.`,
    off: "Ausgeschaltet.",
    pending: "Bitte bestätigen Sie den Link in Ihrem Postfach. Erst danach senden wir Erinnerungen.",
    noDestination: "Für E-Mail-Erinnerungen braucht Ihr Konto eine erreichbare E-Mail-Adresse.",
    telegramStart: "Telegram-Erinnerungen kommen vom MedPrüf-Bot, den Sie bereits gestartet haben.",
    saving: "Wird gespeichert …",
    saved: "Gespeichert.",
    rateLimited: "Zu viele Änderungen in kurzer Zeit. Bitte versuchen Sie es in einer Stunde erneut.",
    failed: "Nicht gespeichert. Bitte versuchen Sie es erneut.",
    unsubscribe: "Jede Erinnerung enthält einen Link zum Abbestellen.",
  },
  en: {
    title: "Study reminders",
    lead: "At most one message a day, and only when you have not practiced yet today: reviews that are due (Pro) or your open study streak.",
    switchLabel: "Send study reminders",
    channel: "Channel",
    email: "Email",
    telegram: "Telegram",
    hour: "Time (Vienna time)",
    on: (channel: string, hour: string) => `On: ${channel}, daily at ${hour}.`,
    off: "Off.",
    pending: "Please confirm the link in your inbox. We send reminders only after that.",
    noDestination: "Email reminders need a reachable email address on your account.",
    telegramStart: "Telegram reminders come from the MedPrüf bot you already started.",
    saving: "Saving …",
    saved: "Saved.",
    rateLimited: "Too many changes in a short time. Please try again in an hour.",
    failed: "Not saved. Please try again.",
    unsubscribe: "Every reminder contains an unsubscribe link.",
  },
} as const;

export type StudyNudgeCopy = (typeof COPY)["de"] | (typeof COPY)["en"];
export function studyNudgeCopy(lang: string): StudyNudgeCopy {
  return (COPY as Record<string, StudyNudgeCopy>)[lang] ?? COPY.en;
}
