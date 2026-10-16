/**
 * Learner copy of the part-aware cram plan (a-cram-part-plan). German in Sie,
 * English; other languages render English (REVIEWED_LANGS = de, en). No em
 * dashes, no exclamation marks, no pass promise, no medical line, no price.
 * Exam names are the learner's own (SIP4a, SIP5a). The SIP4a block rule and
 * its source link reuse the approved ExamResults strings (i18n-exam
 * result_blocks_rule, result_rule_source). The weighting is the split of
 * MedPrüf's own mock exam, never presented as official weights.
 * Lektor gate 15 Oct 2026: APPROVE WITH EDITS, all edits applied (MedPrüf's
 * own subject assignment and mock-exam split instead of "Blueprint",
 * "Richtwert", "zur {exam}", "Nachbereitung" for the drill day, a singular
 * run line, the no-forecast line next to every subject list).
 */
import { studyLang } from "@/lib/i18n-study";

type Pair = { de: string; en: string };

export const CRAM_COPY = {
  part_title: { de: "Ihr Plan für die {exam}", en: "Your plan for {exam}" },
  part_body: {
    de: "Der Plan umfasst nur die Fächer, die MedPrüf der {exam} zuordnet: {list}.",
    en: "The plan covers only the subjects MedPrüf assigns to {exam}: {list}.",
  },
  part_weights: {
    de: "MedPrüf gewichtet die Fächer nach der Aufteilung der eigenen Probeprüfung, nicht nach einer offiziellen Gewichtung der MedUni Wien.",
    en: "MedPrüf weights the subjects by the split of its own mock exam, not by an official MedUni Wien weighting.",
  },
  part_runs: {
    de: "Probeprüfungen zur {exam} mit Zeitlimit in Ihrem Plan: {dates}. Am Tag danach üben Sie die Fächer, die in der Probeprüfung unter 60 Prozent lagen.",
    en: "Timed {exam} mock exams in your plan: {dates}. The day after, you practice the subjects that were below 60 percent in that mock exam.",
  },
  part_runs_one: {
    de: "Probeprüfung zur {exam} mit Zeitlimit in Ihrem Plan: {dates}. Am Tag danach üben Sie die Fächer, die in der Probeprüfung unter 60 Prozent lagen.",
    en: "Timed {exam} mock exam in your plan: {dates}. The day after, you practice the subjects that were below 60 percent in that mock exam.",
  },
  rule_sip5: {
    de: "Für die SIP5a nutzt MedPrüf 60 Prozent je Fach als eigenen Übungsrichtwert, nicht als offizielle Bestehensregel.",
    en: "For SIP5a, MedPrüf uses 60 percent per subject as its own practice benchmark, not as an official pass rule.",
  },
  latest_blocks: {
    de: "Ihre letzte Probeprüfung zur {exam} vom {date}: unter 60 Prozent in {list}.",
    en: "Your last {exam} mock exam on {date}: below 60 percent in {list}.",
  },
  latest_none: {
    de: "Ihre letzte Probeprüfung zur {exam} vom {date}: kein Fach unter 60 Prozent.",
    en: "Your last {exam} mock exam on {date}: no subject below 60 percent.",
  },
  no_forecast: { de: "Das ist keine Vorhersage Ihres Ergebnisses.", en: "This is not a forecast of your result." },
  kaf_link: { de: "KAF-Übung mit Zeitlimit öffnen", en: "Open timed KAF practice" },
  sim_label_part: { de: "Probeprüfung {exam}", en: "{exam} mock exam" },
  drill_pending: {
    de: "Nachbereitung der Probeprüfung vom Vortag: Sie üben die Fächer, die darin unter 60 Prozent lagen.",
    en: "Drill day after the mock exam: the subjects that were below 60 percent in it.",
  },
  drill_blocks: {
    de: "Nachbereitung Ihrer Probeprüfung vom {date}: Fächer unter 60 Prozent.",
    en: "Drill day after your mock exam on {date}: subjects below 60 percent.",
  },
  drill_none: {
    de: "Nachbereitung Ihrer Probeprüfung vom {date}: kein Fach unter 60 Prozent, Sie üben nach Plan weiter.",
    en: "Drill day after your mock exam on {date}: no subject below 60 percent, you continue with the plan.",
  },
} as const satisfies Record<string, Pair>;

export type CramCopyKey = keyof typeof CRAM_COPY;

/** de for German, English for every other language (the study pages' rendered language). */
export function cramLang(lang: string | null | undefined): "de" | "en" {
  return studyLang(lang);
}

export function cpt(key: CramCopyKey, lang: string | null | undefined, vars?: Record<string, string | number>): string {
  let text: string = CRAM_COPY[key][cramLang(lang)];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

/** The sourced SIP4a rules page in the rendered language. */
export function sip4aRuleHref(lang: string | null | undefined): string {
  return cramLang(lang) === "en" ? "/exam-formats/sip4a?lang=en" : "/exam-formats/sip4a";
}

/** The learner's exam name for a part (never translated). */
export function cramExamName(examKey: "sip4a" | "sip5a"): string {
  return examKey === "sip4a" ? "SIP4a" : "SIP5a";
}
