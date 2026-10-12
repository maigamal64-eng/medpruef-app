import type { MentorLang } from "./contract";

/** Fail closed for outcome/chance claims. Exam rules are unaffected outside study mode. */
const PREDICTION = /(?:\b(?:chance\w*|probabilit\w*|likelihood|guarantee\w*|pass(?:ed|ing)?|will\s+(?:definitely\s+)?pass|certain\w*\s+(?:to\s+)?pass|you\s+(?:can|should)\s+pass)|\b(?:besteh\w*|bestanden|wahrscheinlichkeit\w*|erfolgschanc\w*|garant\w*)|(?:шанс|вероятност|ймовірніст|імовірніст|сдашь|сдадите|сдать|здаси|здати|складеш|скласти|составишь|гарант)|(?:geçecek|geçersin|geçebilirsiniz|geçmek|geçme|başarı\s+şans|olasılık|ihtimal)|(?:فرص|احتمال|هتنجح|ستنجح|تنجح|نجاحك|مضمون))/iu;
const GERMAN_ORDER = /\b(?:Zuerst|Danach|Zum\s+Schluss)\b/iu;
/**
 * Time passing is not an exam outcome (gate7 run 1: st-sip-en lost a correct plan over
 * "before 37 days pass"). Only a time noun directly followed by pass/passes/passed/passing
 * is removed before the check; "you pass", "will pass", "pass the exam" stay refused.
 */
const TIME_PASSES = /\b(?:days?|weeks?|months?|years?|hours?|time)\s+(?:pass(?:es|ed)?|passing)\b(?!\s+(?:the|your|this|it)\b)/giu;
export function studySentenceViolation(text: string, lang: MentorLang): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/u)) {
    if (PREDICTION.test(sentence.replace(TIME_PASSES, " "))) return "outcome_prediction";
    if (lang !== "de" && GERMAN_ORDER.test(sentence)) return "mixed_ordering_language";
  }
  return null;
}
