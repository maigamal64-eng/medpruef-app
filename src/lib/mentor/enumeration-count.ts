/**
 * Live trust gate round 7 (a-mentor-gate7): a count that counts the answer's own
 * enumeration is not a fact value.
 *
 * Every gate round lost a correct answer to the same validator class: the model
 * points back at items it has just listed ("The first two are subscriptions",
 * "the mechanism that separates the two", "die ersten zwei Optionen") and the
 * value check deletes the sentence over the bare number, then appends a
 * not-confirmed notice (gate6 run 2: ap-prices-en; gate5: r2-trust-explain-
 * shuffled-en). Earlier rounds patched single phrasings (dropCountWords,
 * dropStudyCountWords); this module exempts the class.
 *
 * Strict on purpose. A number is exempt only when ALL of these hold:
 *   1. It is a bare count (validator kind "number", 2..12): no unit, currency,
 *      date, time, dose or percentage was attached by the extractor.
 *   2. It directly follows a determiner that points at a known set ("the",
 *      "these", "die", "diese", "les", "ces", "эти", "ці", "bu", ...), optionally
 *      with an ordinal or "other" word ("the first", "die letzten", "ilk").
 *   3. What follows is the end of the phrase (punctuation), an item noun
 *      (options, plans, drugs, Optionen, Tarife, ...) or a verb/function word
 *      from a closed list. Any other noun is refused (German: any capitalised
 *      word that is not an item noun).
 *   4. The sentence names no value noun: attempts, times, days, weeks, months,
 *      years, hours, minutes, questions, points, exams, sittings, deadlines,
 *      parts, credits, places, universities, euros, percent (all languages).
 *      Question counts and exam counts therefore stay strictly validated.
 *   5. The count equals the number of items the answer itself enumerates
 *      nearest to it in the same block: a list run ("- a / - b / - c") or a
 *      coordinated series ("A, B and C") before it, or after it when a colon
 *      follows the count ("the two: A and B"). With an ordinal or "other"
 *      ("the first two") it must be smaller than that series instead.
 *   6. No item of that list is headed by a value noun ("a first attempt and a
 *      retake"), no value noun names it before a colon, a colon list never
 *      counts in a sentence naming an exam, and no other unsupported value lies
 *      in the sentences of the count and the list (the caller checks this
 *      last one, so a count never outlives a deleted list).
 * The count then only restates the size of a list the answer already wrote, and
 * every item of that list is validated as usual. Nothing is added to the text.
 */

import type { ExtractedValue } from "./validator";

const CONJ = "and|or|as well as|und|oder|sowie|et|ou|и|или|і|й|та|або|ve|veya|ya da";
const LIST_LINE_RE = /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/u;

/** Determiner (+ optional subset word) right before the count, per language. */
const DET_BEFORE_RE = new RegExp(
  "(?<![\\p{L}])(?:" +
    "(?:the|these|those|all)(?:\\s+(first|last|other|remaining|following|above|latter|former|previous|preceding|listed|named))?" +
    "|(?:die|diese|dieser|diesen|den|der|alle)(?:\\s+(ersten|letzten|anderen|übrigen|uebrigen|restlichen|folgenden|genannten|vorigen))?" +
    "|(?:les|ces)" +
    "|(?:эти|те|первые|последние|все|остальные|другие)" +
    "|(?:ці|ті|перші|останні|усі|всі|інші)" +
    "|(?:bu|şu|ilk|İlk|son|diğer)" +
  ")\\s+$",
  "iu"
);
/** Single-word determiners that already mean a subset ("первые 2", "ilk 2"). */
const SUBSET_DET_RE = /(?<![\p{L}])(?:первые|последние|остальные|другие|перші|останні|інші|ilk|İlk|son|diğer)\s+$/iu;
/** Ordinal written after the count ("die zwei ersten", "les 2 premiers"). */
const ORDINAL_AFTER_RE = /^\s+(ersten|letzten|anderen|übrigen|premiers|premières|derniers|dernières|autres)(?![\p{L}])/iu;

const ITEM_NOUNS =
  "options?|answers?|choices?|plans?|drugs?|medicines?|substances?|classes|groups|items|ones|terms|mechanisms?|signs?|symptoms?|findings?|reasons?|distractors?|packages?|subscriptions?|tariffs?|topics|areas" +
  "|Optionen|Antworten|Antwortmöglichkeiten|Möglichkeiten|Pläne|Tarife|Pakete|Abos|Abonnements|Medikamente|Wirkstoffe|Substanzen|Klassen|Gruppen|Begriffe|Mechanismen|Zeichen|Symptome|Befunde|Gründe|Distraktoren|Themen|Bereiche" +
  "|réponses|choix|médicaments|formules|offres" +
  "|варианта|варианты|вариантов|ответа|ответы|препарата|препараты|тарифа|тарифы" +
  "|варіанти|відповіді|препарати|тарифи" +
  "|seçenek|seçenekler|cevap|ilaç|paket|plan";
const FOLLOW_WORDS =
  "are|is|were|was|have|has|had|can|could|may|might|will|would|should|must|do|does|did|differ|renew|share|cover|act|work|cause|block|belong|look|seem|refer|both|also|only|each|together|here|above|below|listed|named|mentioned|shown|given|that|which|of|in|on|from|apart|compared|but" +
  "|sind|haben|hatten|werden|können|könnten|müssen|unterscheiden|gelten|erneuern|verlängern|wirken|blockieren|gehören|ähneln|sowie|auch|nur|zusammen|oben|unten|von|aus|im|in|bei|aber|dagegen|hingegen" +
  "|sont|ont|peuvent|se|aussi|ci-dessus";
const ITEM_RE = new RegExp(`^\\s+(?:${ITEM_NOUNS})(?![\\p{L}])`, "u");
const ITEM_RE_I = new RegExp(`^\\s+(?:${ITEM_NOUNS})(?![\\p{L}])`, "iu");
const FOLLOW_RE = new RegExp(`^\\s+(?:${FOLLOW_WORDS})(?![\\p{L}])`, "iu");
const BARE_END_RE = /^\s*(?:[,;:.!?)]|$)/u;

/** A value noun anywhere in the sentence keeps every bare count in it strict (attempts, questions, exams, time, money). */
const VALUE_NOUN_RE = new RegExp(
  "(?<![\\p{L}])(?:" +
    "attempts?|tries|times|days?|weeks?|months?|monthly|years?|yearly|hours?|minutes?|questions?|points?|exams?|examinations?|sittings?|sessions?|dates?|deadlines?|parts?|blocks|tertials?|semesters?|credits?|messages?|percent|euros?|universit(?:y|ies)|places|seats|attempt|chances?|retakes?|try|resits?|subjects?|sections?|stations?|cases?" +
    "|antritt\\p{L}*|versuch\\p{L}*|mal|tag|tage|tagen|woche\\p{L}*|monat\\p{L}*|jahr\\p{L}*|stunde\\p{L}*|minute\\p{L}*|frage|fragen|punkt\\p{L}*|prüfung\\p{L}*|termin\\p{L}*|frist\\p{L}*|teil|teile|teilen|blöcke|tertial\\p{L}*|semester\\p{L}*|nachricht\\p{L}*|prozent|universität\\p{L}*|plätze|anmelde\\p{L}*|chance\\p{L}*|wiederholung\\p{L}*|anl[äa]uf\\p{L}*|fächer|fäll\\p{L}*|\\p{L}*(?:prüfung|termin|antritt)\\p{L}*" +
    "|tentatives?|fois|jours?|semaines?|mois|ans|années?|heures?|questions?|examens?|sessions?|épreuves?|crédits?|pourcent" +
    "|попыт\\p{L}*|раз|раза|дн\\p{L}*|недел\\p{L}*|месяц\\p{L}*|год\\p{L}*|лет|час\\p{L}*|минут\\p{L}*|вопрос\\p{L}*|балл\\p{L}*|экзамен\\p{L}*|сесси\\p{L}*|процент\\p{L}*" +
    "|спроб\\p{L}*|рази|дні|днів|тижн\\p{L}*|місяц\\p{L}*|рок\\p{L}*|годин\\p{L}*|хвилин\\p{L}*|питан\\p{L}*|бал\\p{L}*|іспит\\p{L}*|відсот\\p{L}*" +
    "|deneme\\p{L}*|kez|defa|gün\\p{L}*|hafta\\p{L}*|ay|ayda|yıl\\p{L}*|saat\\p{L}*|dakika\\p{L}*|soru\\p{L}*|puan\\p{L}*|sınav\\p{L}*|oturum\\p{L}*|yüzde" +
  ")(?![\\p{L}])",
  "iu"
);
/** Money or a percentage sign in the sentence keeps its counts strict too. */
const MONEY_SIGN_RE = /[€%$£]/u;

const SENTENCE_END_RE = /[.!?](?=\s|$)|\n/gu;

interface Enumeration { start: number; end: number; count: number }

/** Sentence [start, end) around position `at` (newlines and ". " end a sentence). */
function sentenceAround(text: string, at: number): [number, number] {
  let a = 0;
  SENTENCE_END_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END_RE.exec(text))) {
    const cut = m.index + m[0].length;
    if (cut > at) return [a, m[0] === "\n" ? m.index : cut];
    a = cut;
  }
  return [a, text.length];
}

const CHUNK_SPLIT_RE = new RegExp(`\\s*[,;]\\s*(?:(?:${CONJ})\\s+)?|\\s+(?:${CONJ})\\s+`, "iu");
const HAS_CONJ_RE = new RegExp(`(?<![\\p{L}])(?:${CONJ})(?![\\p{L}])`, "iu");

/**
 * Items of a coordinated series ("A, B and C") in `seg`; null without a conjunction or
 * with a chunk longer than `maxWords` (a clause run, not an item).
 */
function seriesCount(seg: string, maxWords: number, names: readonly string[]): number | null {
  if (!HAS_CONJ_RE.test(seg)) return null;
  const chunks = seg.split(CHUNK_SPLIT_RE).map((c) => c.trim()).filter((c) => /\p{L}|\d/u.test(c));
  if (chunks.length < 2) return null;
  if (chunks.some((c) => c.split(/\s+/).length > maxWords)) return null;
  // A list of attempts, sittings or other value nouns makes its size a fact (review P2).
  if (chunks.some((c) => valueItem(c, names))) return null;
  return chunks.length;
}

/** A price with its period ("19 € per month", "129 € for 6 months"): the price is validated, its period word is not a counted thing. */
const PRICE_PERIOD_RE = /(?:\d[\d.,]*\s*(?:€|EUR(?![\p{L}])|Euro(?![\p{L}]))|(?:€|EUR)\s*\d[\d.,]*)(?:\s+(?:per|pro|je|a|an|im|every|alle)\s+\p{L}+|\s+(?:for|für|pour)\s+\d+\s+\p{L}+)?/gu;
/** Capitalised names: two or more words ("Single Month", "Exam Cohort") or one hyphenated word ("Prüfungs-Kohorte"). */
const NAME_RUN_RE = /\p{Lu}[\p{L}]*-[\p{L}-]+|\p{Lu}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*)+/gu;

/**
 * The item names a value noun ("a first attempt", "Written exam", "eine Wiederholung"),
 * so the list's size is a fact. Not counted: tokens with a digit ("3-Month"), a price
 * with its period, and a capitalised name the cited facts write verbatim ("Single Month",
 * "Exam Cohort" in app.billing.plans).
 */
function valueItem(chunk: string, names: readonly string[]): boolean {
  let rest = chunk.replace(LIST_MARKER_RE, " ").replace(PRICE_PERIOD_RE, " ");
  rest = rest.replace(NAME_RUN_RE, (m) => (names.some((t) => t.includes(m)) ? " " : m));
  rest = rest.split(/\s+/).filter((w) => !/\d/.test(w)).join(" ");
  return VALUE_NOUN_RE.test(rest);
}
const LIST_MARKER_RE = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/u;

/** List runs ("- a\n- b\n- c") of the block. */
function listRuns(text: string, names: readonly string[]): Enumeration[] {
  const out: Enumeration[] = [];
  let offset = 0;
  let run: Enumeration | null = null;
  for (const line of text.split("\n")) {
    const end = offset + line.length;
    if (LIST_LINE_RE.test(line)) {
      if (run) { run.count++; run.end = end; } else run = { start: offset, end, count: 1 };
    } else if (line.trim()) {
      if (run && run.count >= 2) out.push(run);
      run = null;
    }
    offset = end + 1;
  }
  if (run && run.count >= 2) out.push(run);
  return out.filter((r) => !text.slice(r.start, r.end).split("\n").some((line) => valueItem(line, names)));
}

/** The series in `text[a, b)`: only after its last colon (the lead "three plans:" is not an item). */
function seriesIn(text: string, a: number, b: number, names: readonly string[], maxWords = 12): Enumeration | null {
  const seg = text.slice(a, b);
  const colon = seg.lastIndexOf(":");
  const body = colon >= 0 ? seg.slice(colon + 1) : seg;
  // "two attempts: ..." names what is counted; a value noun there keeps the count strict.
  if (colon >= 0 && VALUE_NOUN_RE.test(/(\p{L}+)\s*$/u.exec(seg.slice(0, colon))?.[1] ?? "")) return null;
  const n = seriesCount(body, maxWords, names);
  return n === null ? null : { start: a + (colon >= 0 ? colon + 1 : 0), end: b, count: n };
}

/** The enumeration a count at [s, e) points at, nearest first; null when none is written. */
function nearestEnumeration(text: string, s: number, e: number, cataphoric: boolean, names: readonly string[]): Enumeration | null {
  const lists = listRuns(text, names);
  if (cataphoric) {
    // "the two: A and B" or "die drei Optionen:\n- a\n- b\n- c"
    const colon = text.indexOf(":", e);
    const after = lists.find((r) => r.start > e);
    const lineEnd = text.indexOf("\n", colon);
    const rest = text.slice(colon + 1, lineEnd < 0 ? text.length : lineEnd);
    if (rest.trim()) {
      const [, sEnd] = sentenceAround(text, colon + 1);
      // Items after a colon are short names; a longer clause there is an explanation, not a list.
      return seriesIn(text, colon + 1, Math.max(sEnd, colon + 1), names, 6);
    }
    return after ?? null;
  }
  const [sa] = sentenceAround(text, s);
  const candidates: Enumeration[] = [];
  const same = seriesIn(text, sa, s, names);
  if (same) candidates.push(same);
  // The two sentences before, in the same block.
  let cursor = sa;
  for (let i = 0; i < 2 && cursor > 0; i++) {
    const [pa, pe] = sentenceAround(text, Math.max(0, cursor - 1));
    if (pe <= pa) break;
    const prev = seriesIn(text, pa, pe, names);
    if (prev) candidates.push(prev);
    cursor = pa;
  }
  for (const r of lists) if (r.end <= s) candidates.push(r);
  if (!candidates.length) return null;
  return candidates.reduce((best, c) => (c.end > best.end ? c : best));
}

/** Exam names: a colon list in a sentence naming an exam may be its parts (review P3). */
const EXAM_IN_SENTENCE_RE = /(?<![\p{L}])(?:SIP|SPT|KAF|Stichprobentest|Rezeptierkunde|Pharmakologie|Gerichtsmedizin|Kenntnisprüfung|Fachsprachprüfung|FSP|C1)/u;

/**
 * The text span [start, end) a bare count `v` relies on when it counts the
 * answer's own enumeration: the sentences holding the count and the list it
 * counts (see the module comment for every condition); null when it does not.
 * `text` is the block text the value was extracted from (same offsets); `names`
 * are the cited facts' texts (item names they write verbatim are not value nouns). The
 * caller exempts the count only when no other unsupported value lies in that
 * span, so a count never outlives a deleted list (review P1).
 */
export function ownEnumerationSpan(v: ExtractedValue, text: string, names: readonly string[] = []): [number, number] | null {
  if (v.kind !== "number") return null;
  const n = v.keys.map((k) => (k.startsWith("n:") ? Number(k.slice(2)) : NaN)).find((x) => Number.isInteger(x));
  if (n === undefined || n < 2 || n > 12) return null;
  const before = text.slice(Math.max(0, v.start - 40), v.start);
  const det = DET_BEFORE_RE.exec(before);
  if (!det) return null;
  const [sa, se] = sentenceAround(text, v.start);
  const sentence = text.slice(sa, se);
  if (VALUE_NOUN_RE.test(sentence) || MONEY_SIGN_RE.test(sentence)) return null;
  let after = text.slice(v.end, se);
  const ordAfter = ORDINAL_AFTER_RE.exec(after);
  if (ordAfter) after = after.slice(ordAfter[0].length);
  const subset = Boolean(det[1] || det[2] || SUBSET_DET_RE.test(before) || ordAfter);
  // German nouns are capitalised: any capitalised word that is not an item noun is refused.
  const item = ITEM_RE.exec(after) ?? (/^\s+\p{Ll}/u.test(after) ? ITEM_RE_I.exec(after) : null);
  let tail = after;
  if (item) tail = after.slice(item[0].length);
  else if (!BARE_END_RE.test(after) && !FOLLOW_RE.test(after)) return null;
  const fits = (en: Enumeration | null): en is Enumeration => en !== null && (subset ? n < en.count : n === en.count);
  const span = (en: Enumeration): [number, number] => [Math.min(sa, sentenceAround(text, en.start)[0]), Math.max(se, sentenceAround(text, Math.max(en.start, en.end - 1))[1])];
  // A colon after the count may introduce the items ("the two: A and B") or an explanation;
  // either the items after it or the nearest ones before it must match. Never in a sentence
  // naming an exam, where a colon list may be its parts.
  if (/^\s*:/.test(tail) && !EXAM_IN_SENTENCE_RE.test(sentence)) {
    const ahead = nearestEnumeration(text, v.start, v.end, true, names);
    if (fits(ahead)) return span(ahead);
  }
  const back = nearestEnumeration(text, v.start, v.end, false, names);
  return fits(back) ? span(back) : null;
}

/** True when the bare count `v` counts the answer's own enumeration (span-free form, for tests). */
export function countsOwnEnumeration(v: ExtractedValue, text: string, names: readonly string[] = []): boolean {
  return ownEnumerationSpan(v, text, names) !== null;
}
