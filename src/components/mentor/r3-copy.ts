import type { MentorUiLang } from "@/lib/i18n-mentor";
const COPY = {
  saved: ["Ihre Frage ist gespeichert", "Your question is saved"],
  restored: ["Frage wiederhergestellt", "Question restored"],
  day: ["Tageslimit erreicht (60 Nachrichten). Ihre Credits bleiben erhalten. Weiter ab 00:00 Uhr Wiener Zeit.", "Daily limit reached (60 messages). Your credits are kept. You can continue from 00:00 Vienna time."],
  month: ["Monatslimit für die kostenlose Mentor-Nutzung erreicht. Dafür wurden keine Credits abgezogen. Ab dem 1. des nächsten Monats, 02:00 Uhr Wiener Zeit, können Sie wieder fragen, sofern Ihre Credits dann noch gültig sind.", "Monthly limit for free mentor use reached. No credits were deducted for this. You can ask again from 02:00 Vienna time on the 1st of next month, as long as your credits are still valid then."],
  minute: ["Kurze Pause: In {s} Sekunden können Sie weiterfragen.", "Short break: you can ask again in {s} seconds."],
  ready: ["Sie können wieder fragen.", "You can ask again."],
  remembered: ["Der Mentor erinnert sich an die letzten Nachrichten.", "The mentor remembers the last few messages."],
  topic: ["Worum geht es?", "What is it about?"],
  facts_hint: ["Antwortet aus den offiziellen Seiten", "Answers from the official pages"],
  study_hint: ["Nutzt Ihren Fortschritt in der App", "Uses your progress in the app"],
  explain_hint: ["Erklärt die Übungsfrage", "Explains the practice question"],
  more: ["Mehr", "More"],
  disclaimer: ["Lernhilfe, keine medizinische oder rechtliche Beratung. Termine immer auf der offiziellen Seite bestätigen.", "Study support, no medical or legal advice. Always confirm dates on the official page."],
  uses: ["Der Mentor nutzt geprüfte Quellen und Ihren Fortschritt in MedPrüf.", "The mentor uses checked sources and your progress in MedPrüf."],
  never: ["Er entscheidet nicht über Ihre Zulassung und gibt keine Rechtsberatung, Patientenberatung oder Auskunft zu echten Prüfungsfragen.", "It does not decide eligibility or provide legal advice, patient advice or real exam recall."],
  report: ["Melden Sie falsche oder veraltete Antworten über die Melden-Schaltfläche unter der Antwort.", "Report wrong or outdated answers using the report button below the answer."],
  data: ["Ihre Nachrichten werden für den Gesprächsverlauf gespeichert. Gemeldete oder zur Qualitätsprüfung ausgewählte Antworten werden bis zu 30 Tage für berechtigte Prüfer aufbewahrt.", "Your messages are saved for conversation history. Reported answers or answers selected for quality review are retained for up to 30 days for authorized reviewers."],
  pro: ["Pro ansehen", "View Pro"],
  edit: ["Nachricht bearbeiten", "Edit message"],
  not_arrived: ["Antwort kam nicht an", "The answer did not arrive"],
} as const;
export function r3T(key: keyof typeof COPY, lang: MentorUiLang, vars: Record<string,string|number> = {}): string {
  return COPY[key][lang === "de" ? 0 : 1].replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m));
}
/** Egyptian Arabic DRAFT only; active copy falls back to English. */
export const R3_AR_DRAFT = { status: "needs [name] sign-off", saved: "سؤالك محفوظ", restored: "رجّعنا سؤالك", disclaimer: "مساعدة للمذاكرة، مش نصيحة طبية أو قانونية. اتأكد دايمًا من المواعيد على الصفحة الرسمية." } as const;
