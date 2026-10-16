/**
 * Learner copy for the Home moments (a-journey-engine). DE and EN are
 * authored; every other language renders English until a native review, and
 * Arabic until [name] signs it off.
 *
 * Lines marked F16 are byte-exact from the course-correction copy audit
 * (finding F16; sha256 of the whole de and en blocks recorded there):
 * tests/unit/a-journey-engine/copy.test.ts pins each line's own sha256. The
 * M6 title is owned by src/lib/results-route-copy.ts once a-results-route is
 * merged; this file only carries the hand-off link with the same words.
 * Lines marked J7 are the journey section 7 pillar examples. Every other line
 * passed the Lektor gate on 15 Oct (shas pinned in copy.test.ts).
 * Sie, no em or en dashes, no exclamation marks, no prices, no dates.
 */

export type JourneyCopyKey =
  | "region"
  | "registered_button"
  | "registered_confirmation"
  | "registered_saving"
  | "registered_failed"
  | "cram_body"
  | "cram_mock"
  | "cram_kaf"
  | "later"
  | "exam_day"
  | "results_handoff"
  | "ask_title"
  | "ask_body"
  | "ask_button";

const DE: Record<JourneyCopyKey, string> = {
  region: "Ihr Prüfungstermin",
  // F16 M3, button under the deadline line.
  registered_button: "Ich habe mich angemeldet",
  // F16 M3, confirmation.
  registered_confirmation: "Sie sind angemeldet. Ab jetzt planen wir jede Woche bis zu Ihrem Termin.",
  registered_saving: "Wird gespeichert",
  registered_failed: "Nicht gespeichert. Bitte versuchen Sie es noch einmal.",
  // J7 M4 pillar.
  cram_body: "Noch vier Wochen. Jetzt zählt das Üben unter Prüfungsbedingungen: mit Zeitlimit und mit Erklärungen in Ihrer Sprache.",
  cram_mock: "Probeprüfung mit Zeitlimit starten",
  cram_kaf: "KAF-Übung öffnen",
  later: "Später",
  // F16 M5, on the exam day.
  exam_day: "Alles Gute für heute. Ihr Lernstand bleibt gespeichert.",
  // F16 M6 card title (owner: results-route-copy.ts), used as the hand-off link.
  results_handoff: "Ihr Termin ist vorbei. Wie ist es gelaufen?",
  ask_title: "Wann ist Ihre Prüfung?",
  ask_body: "Wählen Sie Ihren offiziellen Termin. Dann zeigen wir Ihnen die veröffentlichten Fristen und planen bis dahin.",
  ask_button: "Termin wählen",
};

const EN: Record<JourneyCopyKey, string> = {
  region: "Your exam sitting",
  registered_button: "I have registered",
  registered_confirmation: "You are registered. From here we plan every week up to your sitting.",
  registered_saving: "Saving",
  registered_failed: "Not saved. Please try again.",
  cram_body: "Four weeks to go. Now practise under exam conditions: timed, with explanations in your language.",
  cram_mock: "Start a timed mock exam",
  cram_kaf: "Open KAF practice",
  later: "Later",
  exam_day: "All the best today. Your progress stays saved.",
  results_handoff: "Your sitting is over. How did it go?",
  ask_title: "When is your exam?",
  ask_body: "Choose your official sitting. Then we show you the published deadlines and plan up to it.",
  ask_button: "Choose your sitting",
};

/** Reviewed copy languages: everything else falls back to English. */
const REVIEWED: Partial<Record<string, Record<JourneyCopyKey, string>>> = { de: DE, en: EN };

export function jt(key: JourneyCopyKey, lang: string): string {
  return (REVIEWED[lang] ?? EN)[key];
}

/** For the copy tests and the Lektor gate. */
export const JOURNEY_COPY = { de: DE, en: EN } as const;
