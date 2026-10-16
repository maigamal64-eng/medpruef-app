/**
 * Learner copy for the results-day route (a-results-route) on the Settings
 * exam report card. de and en are authored; every other preference renders
 * English until a native review, Arabic until [name] signs it off.
 *
 * The five M6 lines marked F16 are byte-exact from the course-correction copy
 * audit (finding F16, sha256 of the whole de and en blocks recorded there);
 * tests/unit/a-results-route pins each line's own sha256. `{LINK}` is
 * replaced by a link to the official page, never by our own summary.
 * Every other line passed the Lektor gate (shas in the release note).
 * Sie, no em or en dashes, no exclamation marks, no prices, no pass claims,
 * and the Stichprobentest is never framed as passed or failed.
 */

import type { RouteOutcome } from "./results-route";
import { rewardsLang, type RewardsLang } from "./rewards-copy";

export const LINK_TOKEN = "{LINK}";

export interface ResultsRouteCopy {
  /** F16 M6 card title. */
  title: string;
  /** F16 M6 after the Stichprobentest. */
  afterSpt: string;
  /** F16 M6 part passed. */
  partPassed: string;
  /** F16 M6 block not passed; contains {LINK}. */
  rescue: string;
  /** F16 M6 experience; shown only while the experience reward can reach the learner. */
  experience: string;
  sptQuestion: string;
  /** Journey section 7, M1 SPT stakes pillar. */
  sptHelper: string;
  sipQuestion: string;
  outcome: Record<RouteOutcome, string>;
  chooseMissing: string;
  submit: string;
  sending: string;
  failed: string;
  waitingSaved: string;
  notSatSaved: string;
  change: string;
  /** "{exam}" is replaced by getExamLabel. */
  continueWith: string;
  practiseGm: string;
  switchFailed: string;
  /** Contains {LINK}. */
  officialNext: string;
  studyPlan: string;
  shareExperience: string;
  referral: string;
  invite: string;
}

const DE: ResultsRouteCopy = {
  title: "Ihr Termin ist vorbei. Wie ist es gelaufen?",
  afterSpt: "Nach dem Stichprobentest folgen für fast alle Nostrifikantinnen und Nostrifikanten Rezeptierkunde und Gerichtsmedizin. Ihr Lernstand bleibt gespeichert.",
  partPassed: "Gratulation. Welche Prüfung kommt bei Ihnen als Nächstes? Wählen Sie sie aus, und Ihr Plan läuft weiter.",
  rescue: "Nicht alle Blöcke bestanden? Die offiziellen Wiederholungsregeln finden Sie hier: {LINK}. Ihre schwachen Fächer sind gespeichert, und der Plan bis zum nächsten Termin steht bereit.",
  experience: "Was hat Ihnen geholfen? Zwei Sätze genügen. Dafür erhalten Sie Credits für den KI-Mentor.",
  sptQuestion: "Welche Prüfungen folgen bei Ihnen?",
  sptHelper: "Ihr Ergebnis im Stichprobentest bestimmt, welche Prüfungen danach folgen.",
  sipQuestion: "Wie ist Ihr Ergebnis?",
  outcome: {
    rez_gm: "Rezeptierkunde und Gerichtsmedizin",
    rez_gm_sip: "Rezeptierkunde, Gerichtsmedizin und dazu SIP-Prüfungen (SIP4a, SIP5a oder beide)",
    passed: "Alle Blöcke bestanden",
    not_all_passed: "Nicht alle Blöcke bestanden",
    waiting: "Mein Ergebnis ist noch nicht da",
    not_sat: "Ich habe an diesem Termin nicht teilgenommen",
  },
  chooseMissing: "Bitte wählen Sie eine Antwort.",
  submit: "Antwort speichern",
  sending: "Wird gespeichert …",
  failed: "Nicht gespeichert. Bitte versuchen Sie es erneut.",
  waitingSaved: "Danke. Wir fragen Sie später noch einmal.",
  notSatSaved: "Danke für Ihre Antwort.",
  change: "Antwort ändern",
  continueWith: "Mit {exam} weitermachen",
  practiseGm: "Gerichtsmedizin üben",
  switchFailed: "Die Prüfung konnte nicht gewechselt werden. Bitte versuchen Sie es erneut.",
  officialNext: "Die offiziellen Informationen zu diesen Prüfungen finden Sie hier: {LINK}.",
  studyPlan: "Zum Lernplan",
  shareExperience: "Erfahrung teilen",
  referral: "Bereitet sich eine Kollegin oder ein Kollege gerade vor? Laden Sie sie oder ihn zu MedPrüf ein.",
  invite: "Einladen",
};

const EN: ResultsRouteCopy = {
  title: "Your sitting is over. How did it go?",
  afterSpt: "After the Stichprobentest, Rezeptierkunde and Gerichtsmedizin follow for almost every Nostrifikant. Your progress stays saved.",
  partPassed: "Congratulations. Which exam comes next for you? Pick it, and your plan carries on.",
  rescue: "Not every block passed? The official retake rules are here: {LINK}. Your weak subjects are saved, and your plan to the next sitting is ready.",
  experience: "What helped you? Two sentences are enough. You receive AI Mentor credits for it.",
  sptQuestion: "Which exams follow for you?",
  sptHelper: "Your Stichprobentest result decides which exams follow.",
  sipQuestion: "What is your result?",
  outcome: {
    rez_gm: "Rezeptierkunde and Gerichtsmedizin",
    rez_gm_sip: "Rezeptierkunde, Gerichtsmedizin and SIP exams as well (SIP4a, SIP5a or both)",
    passed: "All blocks passed",
    not_all_passed: "Not every block passed",
    waiting: "My result is not here yet",
    not_sat: "I did not take part in this sitting",
  },
  chooseMissing: "Please choose an answer.",
  submit: "Save answer",
  sending: "Saving …",
  failed: "Not saved. Please try again.",
  waitingSaved: "Thank you. We will ask you again later.",
  notSatSaved: "Thank you for your answer.",
  change: "Change answer",
  continueWith: "Continue with {exam}",
  practiseGm: "Practise Gerichtsmedizin",
  switchFailed: "The exam could not be switched. Please try again.",
  officialNext: "The official information on these exams is here: {LINK}.",
  studyPlan: "Open study plan",
  shareExperience: "Share your experience",
  referral: "Is a colleague preparing right now? Invite them to MedPrüf.",
  invite: "Invite",
};

const COPY: Record<RewardsLang, ResultsRouteCopy> = { de: DE, en: EN };

export function resultsRouteCopy(lang: string | null | undefined): ResultsRouteCopy {
  return COPY[rewardsLang(lang)];
}

/** Split a line around {LINK} so the caller can render the official link in place. */
export function splitLink(line: string): [string, string] {
  const i = line.indexOf(LINK_TOKEN);
  return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + LINK_TOKEN.length)];
}
