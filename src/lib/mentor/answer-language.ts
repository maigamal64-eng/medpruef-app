/**
 * Answer language check (track-A decision, 12 Oct, gate round 4): when an
 * answer is not in the requested language, the turn loop regenerates it once
 * with an explicit language instruction (turn.ts). Gate round 3:
 * r3-explain-gloss-6-tr and -8-tr came back entirely in German although the
 * model wrote @@LANG tr, so the model's own header is never trusted here.
 *
 * Arabic is an answer language like the others since a-ai-fix-1106 ([name], 6 Nov:
 * the Mentor refused to answer in Arabic; pick-arabic A, the English fallback, is
 * retired under his 29 Oct auto-approval ruling for Arabic lines).
 *
 * Conservative on purpose: a mismatch is reported only when the prose is
 * clearly in another language. Bracket glosses, quoted option texts and the
 * protocol lines are ignored, since German exam terms stay German in every
 * language. A doubtful answer is never retried (the retry costs the house).
 */

import type { MentorLang } from "./contract";

/** The language an answer must be in: the requested one (Arabic included since a-ai-fix-1106). */
export function expectedAnswerLang(lang: MentorLang): MentorLang {
  return lang;
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
export function detectAnswerLang(raw: string): MentorLang | null {
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
function expectedAbsent(p: ProseScores, expected: MentorLang, detected: MentorLang): boolean {
  // Arabic is told by its script, like Cyrillic: German terms in Latin letters inside an Arabic answer are expected.
  if (expected === "ar") return p.arabic < p.letters * 0.2;
  if (expected === "ru" || expected === "uk") {
    if (p.cyrillic < p.letters * 0.2) return true;
    return expected === "uk" ? p.ukOnly === 0 && p.ruOnly > 0 : p.ruOnly === 0 && p.ukOnly > 0;
  }
  if (p.cyrillic + p.arabic > p.letters * 0.5 || p.words[expected] <= 1) return true;
  // A few requested-language words ("Seçenek", "Seçenekler") inside prose that is
  // otherwise in another language (gate6 run 1: r3-explain-gloss-8-tr, German prose
  // with two Turkish words) is still that other language.
  const other = detected in p.words ? p.words[detected as keyof typeof WORDS] : 0;
  return p.words[expected] <= 3 && other >= 8 * Math.max(1, p.words[expected]);
}

/**
 * The detected language when the prose is clearly in another language and the
 * requested one is nearly absent, else null. Refusal answers are code-owned
 * copy and never checked.
 */
export function answerLanguageMismatch(raw: string, requested: MentorLang): MentorLang | null {
  if (typeof raw !== "string" || /^\s*@@REFUSE\b/m.test(raw)) return null;
  const expected = expectedAnswerLang(requested);
  const detected = detectAnswerLang(raw);
  if (detected === null || detected === expected) return null;
  return expectedAbsent(proseScores(raw), expected, detected) ? detected : null;
}

const LANGUAGE_NAMES: Record<MentorLang, string> = {
  de: "German",
  en: "English",
  ru: "Russian",
  uk: "Ukrainian",
  tr: "Turkish",
  fr: "French",
  ar: "Arabic",
};

/** The instruction appended to the retried call. Contains no learner text. */
export function languageRetryInstruction(requested: MentorLang, detected: string): string {
  const lang = expectedAnswerLang(requested);
  const name = LANGUAGE_NAMES[lang];
  const was = LANGUAGE_NAMES[detected as MentorLang] ?? detected;
  return (
    `Language check: the learner reads ${name} (lang=${lang}), and an answer in ${was} cannot be shown. ` +
    `Write the whole answer in ${name}, every sentence, with the same @@ protocol lines, facts and citations. ` +
    `Keep German exam terms in German${lang === "ar" ? " (in Latin letters)" : ""} with a ${name} gloss in brackets where the rules ask for one. Do not mention this check.`
  );
}

/**
 * The language the learner wrote this message in, when the text makes it clear, else null
 * (a-ai-fix-1106, [name] 6 Nov: the Mentor answers in the language the learner writes in).
 * Arabic is told by its script at any length (the 5 Nov repro was a 20-letter Arabic
 * question sent with lang=en); every other language needs the clear margin of
 * detectAnswerLang (20+ letters, 4+ function words), so a short "Wien" or a fixed
 * "Noch ein Hinweis" button text never changes the answer language.
 */
export function learnerMessageLang(message: unknown): MentorLang | null {
  if (typeof message !== "string") return null;
  const p = proseScores(message);
  if (p.letters >= 2 && p.arabic / p.letters > 0.5) return "ar";
  return detectAnswerLang(message);
}

/** The answer language of a turn: the learner's writing language when clear, else the requested one. */
export function effectiveAnswerLang(message: unknown, requested: MentorLang): MentorLang {
  return learnerMessageLang(message) ?? requested;
}
