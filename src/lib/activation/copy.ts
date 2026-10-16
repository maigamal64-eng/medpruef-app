/**
 * Learner copy of the first-48-hours path (a-activation-48h). German in Sie,
 * no em dashes, no prices, no promise of a pass or of native explanations:
 * translations are machine translations and say so (TR-38, a29). Lektor gate
 * 15 Oct 2026: every line approved or replaced with the Lektor text. Languages
 * without a reviewed block render English (REVIEWED_LANGS = de, en).
 */
import type { TranslationTarget } from "@/lib/explanation-translation";

type Pair = { de: string; en: string };

export const ACTIVATION_COPY = {
  // Home: 1 to 9 answers inside the window.
  continue_title: { de: "Ihre ersten 10 Fragen", en: "Your first 10 questions" },
  continue_body: { de: "Noch {n} Fragen bis zu Ihren ersten 10. Ihr Fortschritt bleibt gespeichert.", en: "{n} more questions to reach your first 10. Your progress stays saved." },
  continue_body_one: { de: "Noch eine Frage bis zu Ihren ersten 10.", en: "One more question to reach your first 10." },
  continue_button: { de: "Weiterüben", en: "Keep practising" },
  // Starter set line (hero and Home card) when cached translations exist.
  translated_line: {
    de: "Bei {n} dieser Fragen gibt es die Erklärung schon auf {language}, maschinell übersetzt und noch nicht fachlich geprüft. Die Fragen selbst bleiben auf Deutsch.",
    en: "For {n} of these questions the explanation is already available in {language}, machine translated and not yet medically reviewed. The questions themselves stay in German.",
  },
  translated_line_one: {
    de: "Bei einer dieser Fragen gibt es die Erklärung schon auf {language}, maschinell übersetzt und noch nicht fachlich geprüft. Die Fragen selbst bleiben auf Deutsch.",
    en: "For one of these questions the explanation is already available in {language}, machine translated and not yet medically reviewed. The questions themselves stay in German.",
  },
  // Quiz round end and Home after the first 10.
  win_title: { de: "Ihre ersten 10 Fragen sind geschafft.", en: "You have answered your first 10 questions." },
  win_plan_named: { de: "Ihr Lernplan bis zu Ihrem Termin ist bereit.", en: "Your study plan up to your exam is ready." },
  win_plan_button: { de: "Lernplan ansehen", en: "View study plan" },
  win_ask: { de: "Wann ist Ihre Prüfung? Mit Ihrem Prüfungstermin plant Ihr Lernplan jede Woche bis dahin.", en: "When is your exam? With your exam date, your study plan covers every week up to it." },
  win_ask_button: { de: "Prüfungstermin festlegen", en: "Set exam date" },
  // Opt-in study reminder (study nudge sender, a30).
  reminder_title: { de: "Morgen weiterüben?", en: "Practise again tomorrow?" },
  reminder_body_email: {
    de: "Wir schicken Ihnen höchstens eine E-Mail am Tag um {hour} Uhr (Wiener Zeit), an Tagen, an denen Sie noch nicht geübt haben, solange Ihre Serie läuft. Vorher bestätigen Sie einmal den Link in Ihrem Postfach.",
    en: "We will send you at most one email a day at {hour}:00 (Vienna time), on days you have not practised yet, while your streak is running. First, confirm the link in your inbox once.",
  },
  reminder_body_telegram: {
    de: "Der MedPrüf-Bot schickt Ihnen in Telegram höchstens eine Nachricht am Tag um {hour} Uhr (Wiener Zeit), an Tagen, an denen Sie noch nicht geübt haben, solange Ihre Serie läuft.",
    en: "The MedPrüf bot will send you at most one Telegram message a day at {hour}:00 (Vienna time), on days you have not practised yet, while your streak is running.",
  },
  reminder_button: { de: "Erinnerung einrichten", en: "Set up reminder" },
  reminder_saving: { de: "Wird gespeichert", en: "Saving" },
  reminder_saved: { de: "Erinnerung gespeichert. Sie können sie in den Einstellungen ändern.", en: "Reminder saved. You can change it in Settings." },
  reminder_pending: { de: "Bitte bestätigen Sie den Link in Ihrem Postfach.", en: "Please confirm the link in your inbox." },
  reminder_failed: { de: "Das hat nicht geklappt. Bitte versuchen Sie es erneut.", en: "That did not work. Please try again." },
  later: { de: "Später", en: "Later" },
  region: { de: "Ihre ersten Schritte", en: "Your first steps" },
  // Reverse trial: what the trial opens beyond the free sample.
  trial_value: {
    de: "In Ihrem Testzugang ist mehr offen als in der kostenlosen Probe: die ganze Fragenbank, Prüfungssimulationen mit Zeitlimit und das gezielte Üben Ihrer Fehler.",
    en: "Your trial opens more than the free sample: the whole question bank, timed exam simulations and targeted practice of your mistakes.",
  },
  trial_mock: { de: "Simulation starten", en: "Start a simulation" },
  trial_mistakes: { de: "Meine Fehler üben", en: "Practise my mistakes" },
  // Onboarding date step, one line under the subtitle.
  onb_date_why: {
    de: "Mit Ihrem Prüfungstermin planen wir jede Woche bis zu Ihrer Prüfung.",
    en: "With your exam date we plan every week up to your exam.",
  },
} as const satisfies Record<string, Pair>;

export type ActivationCopyKey = keyof typeof ACTIVATION_COPY;

const COPY_LANG: Record<string, "de" | "en"> = { de: "de" };

/** German for de, English for every other language (reviewed fallback). */
export function at(key: ActivationCopyKey, lang: string): string {
  return ACTIVATION_COPY[key][COPY_LANG[lang] ?? "en"];
}

/** Language names as they read after "auf" / "in". */
const LANGUAGE_NAMES: Record<TranslationTarget, Pair> = {
  en: { de: "Englisch", en: "English" },
  ru: { de: "Russisch", en: "Russian" },
  ar: { de: "Arabisch", en: "Arabic" },
  fr: { de: "Französisch", en: "French" },
  tr: { de: "Türkisch", en: "Turkish" },
  uk: { de: "Ukrainisch", en: "Ukrainian" },
  sr: { de: "Serbisch", en: "Serbian" },
};

export function languageName(target: TranslationTarget, lang: string): string {
  return LANGUAGE_NAMES[target][COPY_LANG[lang] ?? "en"];
}

/** The translated-explanations line, or null when none of the set is translated. */
export function translatedLine(n: number, target: TranslationTarget | null, lang: string): string | null {
  if (!target || !Number.isInteger(n) || n <= 0) return null;
  return at(n === 1 ? "translated_line_one" : "translated_line", lang).replace("{n}", String(n)).replace("{language}", languageName(target, lang));
}

export function continueBody(remaining: number, lang: string): string {
  return remaining === 1 ? at("continue_body_one", lang) : at("continue_body", lang).replace("{n}", String(remaining));
}
