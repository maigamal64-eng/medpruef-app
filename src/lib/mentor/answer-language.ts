/**
 * Answer language check (track-A decision, 12 Oct, gate round 4): when an
 * answer is not in the requested language, the turn loop regenerates it once
 * with an explicit language instruction (turn.ts). Gate round 3:
 * r3-explain-gloss-6-tr and -8-tr came back entirely in German although the
 * model wrote @@LANG tr, so the model's own header is never trusted here.
 *
 * Conservative on purpose: a mismatch is reported only when the prose is
 * clearly in another language. Bracket glosses, quoted option texts and the
 * protocol lines are ignored, since German exam terms stay German in every
 * language. A doubtful answer is never retried (the retry costs the house).
 */

import type { MentorLang } from "./contract";

/** The language an answer must be in: Arabic falls back to English (pick-arabic A). */
export function expectedAnswerLang(lang: MentorLang): Exclude<MentorLang, "ar"> {
  return lang === "ar" ? "en" : lang;
}

const WORDS: Record<"de" | "en" | "fr" | "tr", ReadonlySet<string>> = {
  de: new Set(
    ("der die das den dem des ein eine einer einem eines und oder ist sind nicht kein keine mit für auf zu im vom von bei nach wenn wie was " +
      "wird werden wirkt kann auch noch es sie ihr ihre ihnen weil daher deshalb zur zum aber sondern durch gegen über unter als dass diese dieser " +
      "dieses gehört gehören richtige richtig falsch andere anderen übrigen erst wieder bei").split(" ")
  ),
  en: new Set(
    ("the a and or is are not no with for of to on at by from that this these those if how what when which why it its be been " +
      "because but than then there their they you your does do can would should correct wrong other others only into").split(" ")
  ),
  fr: new Set(
    ("le la les un une des et ou est sont pas ne avec pour de du dans sur par que qui ce cette ces il elle ils vous votre parce donc mais " +
      "aussi plus bonne correcte autres").split(" ")
  ),
  tr: new Set(
    ("ve bir bu şu için ile değil ki ama çünkü bu yüzden olarak olan olduğu doğru yanlış diğer seçenek seçenekler cevap soru " +
      "neden gibi daha ise veya hem çok sonra önce eder edilir").split(" ")
  ),
};

/** Text that carries the answer's language: no protocol lines, glosses, quotes or bracketed terms. */
export function proseOf(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !/^\s*@@/.test(line))
    .join("\n")
    .replace(/\([^()\n]*\)|\[[^\]\n]*\]/g, " ")
    .replace(/„[^“”\n]*[“”]|“[^”\n]*”|"[^"\n]*"|«[^»\n]*»|»[^«\n]*«/g, " ");
}

interface ProseScores {
  letters: number;
  arabic: number;
  cyrillic: number;
  ukOnly: number;
  ruOnly: number;
  words: Record<keyof typeof WORDS, number>;
}

function proseScores(raw: string): ProseScores {
  const text = proseOf(raw);
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (k: keyof typeof WORDS) => words.filter((w) => WORDS[k].has(w)).length;
  return {
    letters: (text.match(/\p{L}/gu) ?? []).length,
    arabic: (text.match(/[\u0600-\u06ff]/gu) ?? []).length,
    cyrillic: (text.match(/[\u0400-\u04ff]/gu) ?? []).length,
    ukOnly: (text.match(/[іїєґ]/giu) ?? []).length,
    ruOnly: (text.match(/[ыэъё]/giu) ?? []).length,
    words: { de: score("de"), en: score("en"), fr: score("fr"), tr: score("tr") + 2 * Math.min(3, (text.match(/[ğışİı]/gu) ?? []).length) },
  };
}

/**
 * The prose language when it is clear, else null. Script first (Arabic,
 * Cyrillic), then function-word counts with a clear margin.
 */
export function detectAnswerLang(raw: string): Exclude<MentorLang, "ar"> | "ar" | null {
  const p = proseScores(raw);
  if (p.letters < 20) return null;
  if (p.arabic / p.letters > 0.5) return "ar";
  if (p.cyrillic / p.letters > 0.5) {
    if (p.ukOnly > 0 && p.ruOnly === 0) return "uk";
    if (p.ruOnly > 0 && p.ukOnly === 0) return "ru";
    return null;
  }
  if (p.arabic + p.cyrillic > p.letters * 0.2) return null;
  const scores = (Object.entries(p.words) as Array<[keyof typeof WORDS, number]>).sort((a, b) => b[1] - a[1]);
  const [top, second] = scores;
  return top[1] >= 4 && top[1] >= 2 * Math.max(1, second[1]) ? top[0] : null;
}

/** The requested language is nearly absent from the prose (review P2: quoted German option text inside an English answer is not a mismatch). */
function expectedAbsent(p: ProseScores, expected: Exclude<MentorLang, "ar">): boolean {
  if (expected === "ru" || expected === "uk") {
    if (p.cyrillic < p.letters * 0.2) return true;
    return expected === "uk" ? p.ukOnly === 0 && p.ruOnly > 0 : p.ruOnly === 0 && p.ukOnly > 0;
  }
  return p.cyrillic + p.arabic > p.letters * 0.5 || p.words[expected] <= 1;
}

/**
 * The detected language when the prose is clearly in another language and the
 * requested one is nearly absent, else null. Refusal answers are code-owned
 * copy and never checked.
 */
export function answerLanguageMismatch(raw: string, requested: MentorLang): Exclude<MentorLang, "ar"> | "ar" | null {
  if (typeof raw !== "string" || /^\s*@@REFUSE\b/m.test(raw)) return null;
  const expected = expectedAnswerLang(requested);
  const detected = detectAnswerLang(raw);
  if (detected === null || detected === expected) return null;
  return expectedAbsent(proseScores(raw), expected) ? detected : null;
}

const LANGUAGE_NAMES: Record<Exclude<MentorLang, "ar">, string> = {
  de: "German",
  en: "English",
  ru: "Russian",
  uk: "Ukrainian",
  tr: "Turkish",
  fr: "French",
};

/** The instruction appended to the retried call. Contains no learner text. */
export function languageRetryInstruction(requested: MentorLang, detected: string): string {
  const lang = expectedAnswerLang(requested);
  const name = LANGUAGE_NAMES[lang];
  const was = LANGUAGE_NAMES[detected as Exclude<MentorLang, "ar">] ?? detected;
  return (
    `Language check: the learner reads ${name} (lang=${lang}), and an answer in ${was} cannot be shown. ` +
    `Write the whole answer in ${name}, every sentence, with the same @@ protocol lines, facts and citations. ` +
    `Keep German exam terms in German with a ${name} gloss in brackets where the rules ask for one. Do not mention this check.`
  );
}
