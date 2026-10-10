/**
 * Mentor answer validator (W2-BRAIN, C17 Brain.validate). The no-hallucination
 * guard lives HERE, in code, not in the prompt.
 *
 * Every date, day-month, month, year, time, number, percentage, EUR amount
 * and link in a block must appear (after normalisation) in the facts that
 * block cites. A sentence carrying an unsupported value is replaced with the
 * official-page fallback and the value is logged in `rejected` for the review
 * queue. A block without valid citations may carry no value at all.
 *
 * Normalisation: Arabic-Indic, extended Arabic-Indic and fullwidth digits are
 * folded to ASCII first (JS \d is ASCII only), then values are compared as
 * canonical keys (ISO dates, numbers as JS numbers, both readings of an
 * ambiguous "1.500"). Tokens are matched whole, so "14" never matches inside
 * "2014" or "1.400". Digits glued to letters (SIP4a, C1, B2) are names, not
 * numbers.
 *
 * Fails closed: malformed markup is validated as one uncited block; an
 * unknown cited id is dropped and logged.
 */

import type { MentorAnswerBlock, MentorCitation, MentorLang } from "./contract";
import type { MentorExamKey, MentorFact, ValidatedAnswer } from "./seam";
import { parseAnswer, stripInlineMarkers } from "./prompt/protocol";
import { allOfficialLinks, fallbackLine, officialLinkForExam, refusalLine, refusalLink } from "./prompt/refusals";

// ─── Normalisation ──────────────────────────────────────────────────────

/** Fold non-ASCII digits and odd spaces to ASCII, one code unit for one, so offsets stay valid. */
export function normalizeDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0660 && c <= 0x0669) out += String.fromCharCode(48 + c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String.fromCharCode(48 + c - 0x06f0);
    else if (c >= 0xff10 && c <= 0xff19) out += String.fromCharCode(48 + c - 0xff10);
    else if (c === 0x066b) out += "."; // Arabic decimal separator
    else if (c === 0x066c) out += ","; // Arabic thousands separator
    else if (c === 0x066a) out += "%"; // Arabic percent sign
    else if (c === 0x2212) out += "-";
    else out += ch;
  }
  return out;
}

// ─── Months ─────────────────────────────────────────────────────────────

/** [regex source for one month word, month number]. Full names and common abbreviations. */
const MONTH_WORDS: ReadonlyArray<readonly [string, number]> = [
  // de
  ["januar|jänner|jaenner|jan", 1],
  ["februar|feber|feb", 2],
  ["märz|maerz|mrz|mär", 3],
  ["april|apr", 4],
  ["mai", 5],
  ["juni|jun", 6],
  ["juli|jul", 7],
  ["august|aug", 8],
  ["september|sept|sep", 9],
  ["oktober|okt", 10],
  ["november|nov", 11],
  ["dezember|dez", 12],
  // en
  ["january", 1],
  ["february", 2],
  ["march|mar", 3],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["october|oct", 10],
  ["december|dec", 12],
  // fr
  ["janvier", 1],
  ["février|fevrier", 2],
  ["mars", 3],
  ["avril", 4],
  ["juin", 6],
  ["juillet", 7],
  ["août|aout", 8],
  ["septembre", 9],
  ["octobre", 10],
  ["novembre", 11],
  ["décembre|decembre", 12],
  // tr
  ["ocak", 1],
  ["şubat|subat", 2],
  ["mart", 3],
  ["nisan", 4],
  ["mayıs|mayis", 5],
  ["haziran", 6],
  ["temmuz", 7],
  ["ağustos|agustos", 8],
  ["eylül|eylul", 9],
  ["ekim", 10],
  ["kasım|kasim", 11],
  ["aralık|aralik", 12],
  // ru
  ["январ[ьяе]", 1],
  ["феврал[ьяе]", 2],
  ["март[ае]?", 3],
  ["апрел[ьяе]", 4],
  ["ма[йяе]", 5],
  ["июн[ьяе]", 6],
  ["июл[ьяе]", 7],
  ["август[ае]?", 8],
  ["сентябр[ьяе]", 9],
  ["октябр[ьяе]", 10],
  ["ноябр[ьяе]", 11],
  ["декабр[ьяе]", 12],
  // uk
  ["січ(?:ень|ня|ні)", 1],
  ["лют(?:ий|ого|ому)", 2],
  ["берез(?:ень|ня|ні)", 3],
  ["квіт(?:ень|ня|ні)", 4],
  ["трав(?:ень|ня|ні)", 5],
  ["черв(?:ень|ня|ні)", 6],
  ["лип(?:ень|ня|ні)", 7],
  ["серп(?:ень|ня|ні)", 8],
  ["верес(?:ень|ня|ні)", 9],
  ["жовт(?:ень|ня|ні)", 10],
  ["листопад[аі]?", 11],
  ["груд(?:ень|ня|ні)", 12],
  // ar (Gregorian names)
  ["يناير", 1],
  ["فبراير", 2],
  ["مارس", 3],
  ["أبريل|ابريل|إبريل", 4],
  ["مايو", 5],
  ["يونيو|يونيه", 6],
  ["يوليو|يوليه", 7],
  ["أغسطس|اغسطس", 8],
  ["سبتمبر", 9],
  ["أكتوبر|اكتوبر", 10],
  ["نوفمبر", 11],
  ["ديسمبر", 12],
];

/** Non-capturing alternation of every month pattern (order is irrelevant: each use is followed by a letter/number guard, so the engine backtracks). */
const MONTH_ALT = MONTH_WORDS.map(([src]) => `(?:${src})`).join("|");
const MONTH_TESTS = MONTH_WORDS.map(([src, n]) => [new RegExp(`^(?:${src})$`, "iu"), n] as const);
/** Bare month words that are also ordinary words: only counted next to a number. */
const BARE_MONTH_SKIP = new Set(["may", "march", "mar", "jan", "feb", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "mrz", "mär", "okt", "dez", "mart", "ekim"]);

function monthNumber(word: string): number | null {
  const w = word.replace(/\.$/, "");
  for (const [re, n] of MONTH_TESTS) if (re.test(w)) return n;
  return null;
}

// ─── Value extraction ───────────────────────────────────────────────────

export type ValueKind = "url" | "date" | "daymonth" | "monthyear" | "month" | "year" | "time" | "percent" | "eur" | "number";

export interface ExtractedValue {
  kind: ValueKind;
  raw: string;
  start: number;
  end: number;
  /** Canonical keys; the value is supported when ANY key is allowed. */
  keys: string[];
}

const L = "\\p{L}";
const NUM = "\\d{1,3}(?:[.,\\u00a0\\u202f\\u2009]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?";

const pad = (n: number) => String(n).padStart(2, "0");

function validDay(d: number, m: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/** Both readings of an ambiguous number ("1.500" may be 1500 or 1.5). */
export function numberCandidates(raw: string): string[] {
  const s = raw.replace(/[   ]/g, "");
  if (/^\d+$/.test(s)) return [String(Number(s))];
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thou = dec === "." ? "," : ".";
    const v = Number(s.split(thou).join("").replace(dec, "."));
    return Number.isFinite(v) ? [String(v)] : [];
  }
  const sep = hasDot ? "." : ",";
  const out = new Set<string>();
  if (new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) out.add(String(Number(s.split(sep).join(""))));
  if ((s.match(new RegExp(`\\${sep}`, "g")) ?? []).length === 1) {
    const v = Number(s.replace(sep, "."));
    if (Number.isFinite(v)) out.add(String(v));
  }
  return [...out];
}

function yearOf(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Extracts every checkable value. `text` must already be digit-normalised. */
export function extractValues(text: string): ExtractedValue[] {
  const used = new Uint8Array(text.length);
  const out: ExtractedValue[] = [];
  const free = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (used[i]) return false;
    return true;
  };
  const take = (kind: ValueKind, start: number, end: number, keys: string[]) => {
    for (let i = start; i < end; i++) used[i] = 1;
    out.push({ kind, raw: text.slice(start, end), start, end, keys });
  };
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const a = m.index;
      const b = a + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (!free(a, b)) continue;
      fn(m);
    }
  };

  // 1. links
  scan(/https?:\/\/[^\s<>"')\]]+/giu, (m) => {
    const raw = m[0].replace(/[.,;:!?]+$/, "");
    take("url", m.index, m.index + raw.length, [`u:${raw.replace(/\/+$/, "").toLowerCase()}`]);
  });
  // 2. e-mail addresses are not claims
  scan(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, (m) => {
    for (let i = m.index; i < m.index + m[0].length; i++) used[i] = 1;
  });
  // 3. ISO dates
  scan(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) => {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!validDay(d, mo)) return;
    take("date", m.index, m.index + m[0].length, [`d:${y}-${pad(mo)}-${pad(d)}`]);
  });
  // 4. ranges with a named month: "D. bis D. <Monat> YYYY", "D to D <month>"
  const rangeRe = new RegExp(
    `(?<![${L}\\d])(\\d{1,2})\\.?\\s*(?:bis|to|until|und|and|au|à|-|–|до|по|ile|ve)\\s*(\\d{1,2})(?:\\.|st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?(?![${L}])(?:,?\\s+(\\d{4}))?`,
    "giu"
  );
  scan(rangeRe, (m) => {
    const mo = monthNumber(m[3]);
    if (!mo) return;
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    if (!validDay(d1, mo) || !validDay(d2, mo)) return;
    const end = m.index + m[0].length;
    const key = (d: number) => (m[4] ? `d:${m[4]}-${pad(mo)}-${pad(d)}` : `dm:${pad(mo)}-${pad(d)}`);
    const kind: ValueKind = m[4] ? "date" : "daymonth";
    take(kind, m.index, end, [key(d1)]);
    out.push({ kind, raw: m[0], start: m.index, end, keys: [key(d2)] });
  });
  // 5. named month + year: "<Monat> YYYY"
  scan(new RegExp(`(?<![${L}])(${MONTH_ALT})\\.?\\s+(\\d{4})(?!\\d)`, "giu"), (m) => {
    // Skip when a day precedes the month (step 6 handles "D. <Monat> YYYY").
    const before = text.slice(Math.max(0, m.index - 5), m.index);
    if (/\d\.?\s*$/.test(before)) return;
    const mo = monthNumber(m[1]);
    if (!mo) return;
    take("monthyear", m.index, m.index + m[0].length, [`my:${m[2]}-${pad(mo)}`]);
  });
  // 6. day + named month (+ year): "D. <Monat> YYYY", "D <month>", Cyrillic genitive forms
  scan(
    new RegExp(`(?<![${L}\\d])(\\d{1,2})(?:\\.|st|nd|rd|th|-?(?:го|е|я))?\\s+(?:de\\s+)?(${MONTH_ALT})\\.?(?![${L}])(?:,?\\s+(\\d{4})(?!\\d))?`, "giu"),
    (m) => {
      const mo = monthNumber(m[2]);
      const d = Number(m[1]);
      if (!mo || !validDay(d, mo)) return;
      take(m[3] ? "date" : "daymonth", m.index, m.index + m[0].length, [m[3] ? `d:${m[3]}-${pad(mo)}-${pad(d)}` : `dm:${pad(mo)}-${pad(d)}`]);
    }
  );
  // 7. named month + day (+ year): "<Month> D, YYYY"
  scan(new RegExp(`(?<![${L}])(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d${L}])(?:,?\\s+(\\d{4})(?!\\d))?`, "giu"), (m) => {
    const mo = monthNumber(m[1]);
    const d = Number(m[2]);
    if (!mo || !validDay(d, mo)) return;
    take(m[3] ? "date" : "daymonth", m.index, m.index + m[0].length, [m[3] ? `d:${m[3]}-${pad(mo)}-${pad(d)}` : `dm:${pad(mo)}-${pad(d)}`]);
  });
  // 8. numeric dates: DD.MM.YYYY, DD/MM/YYYY, DD.MM.YY, DD.MM.
  scan(/(?<![\d.,])(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?![\d])/g, (m) => {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (!validDay(d, mo)) return;
    take("date", m.index, m.index + m[0].length, [`d:${yearOf(m[3])}-${pad(mo)}-${pad(d)}`]);
  });
  scan(/(?<![\d.,])(\d{1,2})\.(\d{1,2})\.(?!\d)/g, (m) => {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (!validDay(d, mo)) return;
    take("daymonth", m.index, m.index + m[0].length, [`dm:${pad(mo)}-${pad(d)}`]);
  });
  // 9. times: 12:00, 12.00 Uhr
  scan(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g, (m) => {
    take("time", m.index, m.index + m[0].length, [`t:${pad(Number(m[1]))}:${m[2]}`]);
  });
  scan(/(?<![\d.,])([01]?\d|2[0-3])\.([0-5]\d)\s*Uhr(?![\p{L}])/gu, (m) => {
    take("time", m.index, m.index + m[0].length, [`t:${pad(Number(m[1]))}:${m[2]}`]);
  });
  // "12 Uhr" is the same time as "12:00" (and still the number 12 of the fact text).
  scan(/(?<![\d.,:])([01]?\d|2[0-3])\s*Uhr(?![\p{L}])/gu, (m) => {
    take("time", m.index, m.index + m[0].length, [`t:${pad(Number(m[1]))}:00`, `n:${Number(m[1])}`]);
  });
  // 10. percentages
  scan(
    new RegExp(`(?<![${L}\\d.,])(${NUM})\\s*(?:%|prozent(?![${L}])|percent(?![${L}])|per\\s+cent(?![${L}])|pour\\s?cent(?![${L}])|процент[${L}]*|відсот[${L}]*|في\\s*المائة|بالمئة)`, "giu"),
    (m) => take("percent", m.index, m.index + m[0].length, numberCandidates(m[1]).map((n) => `p:${n}`))
  );
  scan(new RegExp(`(?:%|yüzde)\\s*(${NUM})(?![\\d${L}])`, "giu"), (m) =>
    take("percent", m.index, m.index + m[0].length, numberCandidates(m[1]).map((n) => `p:${n}`))
  );
  // 11. EUR amounts
  scan(new RegExp(`(?:€|\\bEUR\\b|\\bEuro\\b)\\s*(${NUM})(?:,-)?(?![\\d${L}])`, "giu"), (m) =>
    take("eur", m.index, m.index + m[0].length, numberCandidates(m[1]).map((n) => `e:${n}`))
  );
  scan(new RegExp(`(?<![${L}\\d.,])(${NUM})(?:,-)?\\s*(?:€|EUR(?![${L}])|Euro[s]?(?![${L}])|euros?(?![${L}])|евро|євро|يورو)`, "giu"), (m) =>
    take("eur", m.index, m.index + m[0].length, numberCandidates(m[1]).map((n) => `e:${n}`))
  );
  // 12. bare month names (a month alone is still a date claim)
  scan(new RegExp(`(?<![${L}])(${MONTH_ALT})(?![${L}])`, "giu"), (m) => {
    if (BARE_MONTH_SKIP.has(m[1].toLowerCase())) return;
    const mo = monthNumber(m[1]);
    if (!mo) return;
    take("month", m.index, m.index + m[0].length, [`m:${pad(mo)}`]);
  });
  // 13. years
  scan(/(?<![\p{L}\p{N}.,])((?:19|20)\d{2})(?![\p{L}\p{N}]|[.,]\d)/gu, (m) => {
    take("year", m.index, m.index + m[0].length, [`y:${m[1]}`, `n:${m[1]}`]);
  });
  // 14. any other number (digits glued to letters are names: SIP4a, C1)
  scan(new RegExp(`(?<![${L}\\d.,])(${NUM})(?:st|nd|rd|th)?(?![${L}\\d])`, "giu"), (m) => {
    take("number", m.index, m.index + m[0].length, numberCandidates(m[1]).map((n) => `n:${n}`));
  });
  // 15. small number words (de, en)
  const WORDS: Record<string, number> = {
    zwei: 2, drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, "zwölf": 12, zwoelf: 12,
    two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  scan(new RegExp(`(?<![${L}])(${Object.keys(WORDS).join("|")})(?![${L}])`, "giu"), (m) => {
    take("number", m.index, m.index + m[0].length, [`n:${WORDS[m[1].toLowerCase()]}`]);
  });
  return out.sort((a, b) => a.start - b.start);
}

/** Every key a fact text supports (a full date also supports its parts). */
export function allowedKeysFromText(text: string, into: Set<string> = new Set()): Set<string> {
  const norm = normalizeDigits(text);
  const values = extractValues(norm);
  for (const v of [...values, ...rangeStartDates(norm, values)]) {
    for (const k of v.keys) {
      into.add(k);
      const [kind, val] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
      if (kind === "d") {
        const [y, mo, d] = val.split("-");
        into.add(`dm:${mo}-${d}`);
        into.add(`my:${y}-${mo}`);
        into.add(`m:${mo}`);
        into.add(`y:${y}`);
      } else if (kind === "dm") {
        into.add(`m:${val.slice(0, 2)}`);
      } else if (kind === "my") {
        into.add(`m:${val.slice(5, 7)}`);
        into.add(`y:${val.slice(0, 4)}`);
      } else if (kind === "p" || kind === "e") {
        into.add(`n:${val}`);
      } else if (kind === "n" && /^(19|20)\d{2}$/.test(val)) {
        into.add(`y:${val}`);
      }
    }
  }
  return into;
}

const RANGE_JOIN = /^\s*,?\s*(?:bis(?:\s+(?:zum|zur|einschließlich))?|to|until|till|through|and|und|au|à|до|по|ile|ve|-|–|—)\s*(?:the\s+)?$/iu;

/**
 * A fact range "18. Januar bis 22. Januar 2027" (or "2 Dec to 15 Dec 2026")
 * names the year once, after the end date; the start date carries the same
 * year. Without this, the fact allowed only "18. Januar" and rejected a
 * correct "18. Januar 2027" (eval round 1: dl-rez-jan). Used on the ALLOW side
 * only (fact texts), never to read an answer, and only for a day and month
 * directly joined to a full date by a range word. A start month after the end
 * month belongs to the year before ("28. Dezember bis 5. Januar 2027").
 */
function rangeStartDates(text: string, values: ExtractedValue[]): ExtractedValue[] {
  const out: ExtractedValue[] = [];
  for (let i = 0; i + 1 < values.length; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (a.kind !== "daymonth" || b.kind !== "date" || a.keys.length !== 1 || b.keys.length !== 1) continue;
    if (!RANGE_JOIN.test(text.slice(a.end, b.start))) continue;
    const dm = /^dm:(\d{2})-(\d{2})$/.exec(a.keys[0]);
    const d = /^d:(\d{4})-(\d{2})-\d{2}$/.exec(b.keys[0]);
    if (!dm || !d) continue;
    const year = Number(dm[1]) > Number(d[2]) ? Number(d[1]) - 1 : Number(d[1]);
    out.push({ ...a, kind: "date", keys: [`d:${year}-${dm[1]}-${dm[2]}`] });
  }
  return out;
}

function factAllowedKeys(f: MentorFact): Set<string> {
  const keys = allowedKeysFromText(`${f.text_de}\n${f.text_en}`);
  keys.add(`u:${f.source_url.replace(/\/+$/, "").toLowerCase()}`);
  // The read-on date of a cited fact ("Stand 2026-10-10", which the prompt asks
  // for) is a value OF that fact. Only the full date: its month or year alone
  // stays unsupported, so a read-on date cannot carry an invented "October" claim.
  // Only for official sources: app facts, question rows, progress and status are
  // internal and have no "Stand" (eval round 2: ap-mentor-price-de showed the
  // app facts' read-on date in a not-confirmed answer).
  if (!isInternalFactId(f.id) && /^\d{4}-\d{2}-\d{2}$/.test(f.read_on)) keys.add(`d:${f.read_on}`);
  return keys;
}

// ─── Source names quoted from cited facts ───────────────────────────────

/**
 * The prompt asks the model to name the publisher. A source name such as
 * "Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2026/27" carries
 * digits that are a document title, not a claim (eval round 1: dl-rez-next-en
 * lost its whole date sentence over "27"). Only an exact quote of a CITED
 * fact's source_label (or the part after its publisher, "MedUni Wien, ") is
 * blanked for value extraction, with equal length so positions stay aligned.
 * The same digits anywhere else in the text are still checked.
 */
export function maskSourceLabels(text: string, cited: readonly MentorFact[]): string {
  const variants = new Set<string>();
  for (const f of cited) {
    const label = typeof f.source_label === "string" ? normalizeDigits(f.source_label).trim() : "";
    if (!/\d/.test(label)) continue;
    variants.add(label);
    const comma = label.indexOf(", ");
    if (comma > 0 && label.length - comma - 2 >= 12) variants.add(label.slice(comma + 2));
  }
  let out = text;
  for (const v of [...variants].sort((x, y) => y.length - x.length)) {
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "giu");
    out = out.replace(re, (m) => " ".repeat(m.length));
  }
  return out;
}

// ─── Read-on notes without a source ─────────────────────────────────────

const STAND_WORDS = "Stand|as of|read on|last read|abgerufen|gelesen|zuletzt gelesen";
const STAND_PAREN_RE = new RegExp(`\\s*\\(\\s*(?:${STAND_WORDS})\\b[^()\\d\\n]{0,40}?(\\d{4}-\\d{2}-\\d{2})\\s*\\)`, "giu");
const STAND_TAIL_RE = new RegExp(`\\s*[,;]?\\s*\\b(?:${STAND_WORDS})\\b[^()\\d\\n.]{0,40}?(\\d{4}-\\d{2}-\\d{2})(?=\\s*(?:[.!?]|$))`, "gimu");

/**
 * A "Stand <date>" note says when a source was read; it is not a claim about
 * an exam. When its ISO date is not the read-on date of an official fact the
 * block cites (for example an app fact's date, which the prompt says not to
 * write), the note alone is removed and the sentence stays. With `strippable`
 * only notes carrying one of those dates go (the validator passes the read-on
 * dates of the internal facts a block cites); any other unsupported date is
 * left for the normal sentence replacement. Only removes text:
 * the rest of the sentence is still validated as usual, and a note whose date
 * IS supported stays untouched.
 */
export function stripUnsupportedStand(text: string, allowed: ReadonlySet<string>, strippable?: ReadonlySet<string>): string {
  const drop = (m: string, iso: string) => (allowed.has(`d:${iso}`) || (strippable && !strippable.has(iso)) ? m : "");
  const out = text.replace(STAND_PAREN_RE, drop).replace(STAND_TAIL_RE, drop);
  return out === text ? text : out.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

// ─── Protocol markers inside a line ─────────────────────────────────────

const MARK = "\u0000";
/**
 * "(status fact: <marker>" / ", Quelle: <marker>": a short label opened by a
 * bracket, comma or semicolon right before a removed marker names the marker
 * and nothing else. Without that opener only the colon goes, never words.
 */
const MARK_LABEL_RE = new RegExp(`(?:(?<=\\()|[,;])[ \\t]*(?:[\\p{L}_-]+[ \\t]+){0,3}[\\p{L}_-]+[ \\t]*[:=][ \\t]*${MARK}`, "gu");
const MARK_COLON_RE = new RegExp(`[ \\t]*[:=][ \\t]*${MARK}`, "gu");

/**
 * Removes protocol markers the model wrote inside a line (eval round 3:
 * dl-sip5a-sep27-en showed "This window is not yet open (status fact: @@BLOCK )."
 * to the learner). The marker, the label written for it and the empty
 * brackets they leave go; the rest of the sentence stays and is validated as
 * usual. A marker with facts= inside a line does NOT start a block: the text
 * after it stays under the block's own citations, which can only make the
 * value check stricter. Only removes text.
 */
export function stripProtocolMarkers(text: string): string {
  const marked = stripInlineMarkers(text, MARK);
  if (marked === text) return text;
  return marked
    .replace(MARK_LABEL_RE, "")
    .replace(MARK_COLON_RE, "")
    .split(MARK)
    .join("")
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/[ \t]+([.,;:!?)])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]+$/g, "");
}

// ─── Questions and tool field names ─────────────────────────────────────

/** [start, end) of every sentence that ends with a question mark. */
export function questionRanges(text: string): Array<[number, number]> {
  return sentenceRanges(text).filter(([a, e]) => /\?\s*$/.test(text.slice(a, e)));
}

const FIELD_NAME_RE = /\b(?:registration_status|status_fact_id|fact_ids?|days_until_close|needs_filing_university)\b\s*[:=]?\s*(?:open|closed|not_yet_open|not_confirmed|not_published|true|false)?/giu;

/**
 * Tool field names the model sometimes copies into prose ("registration
 * status: open, status_fact_id: ...") are protocol, not text for a learner.
 * Removes them, a dangling "see" whose id was stripped, and the empty
 * brackets they leave. Only removes text.
 */
export function stripFieldNames(text: string): string {
  // "see status.<id>" loses its id in stripFactIds and leaves "see )".
  const out = text.replace(FIELD_NAME_RE, "").replace(/[,;]?\s*\b(?:see|siehe)\s*(?=[)\]])/giu, "");
  if (out === text) return text;
  return out
    .replace(/[,;]\s*(?=[,;)\]])/g, "")
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/[ \t]+([.,;:!?)])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

// ─── Anchor months ("the sitting after the one in November") ────────────

const ANCHOR_DE = new RegExp(
  `\\bnach\\s+(?:dem|der|den)\\s+(?:[\\p{L}\\d-]+\\s+){0,2}?(?:im|vom)\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?(?![\\p{L}\\d])`,
  "giu"
);
const ANCHOR_EN = new RegExp(
  `\\bafter\\s+the\\s+(?:(?:[\\p{L}\\d-]+\\s+){0,2}?in\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?|(${MONTH_ALT})(?:\\s+(\\d{4}))?\\s+(?:sitting|exam|one|date|session))(?![\\p{L}\\d])`,
  "giu"
);

/**
 * The learner asks for "the SIP4a sitting after the one in November"; Haiku
 * writes "the next sitting after the one in November is on <date>" and cites
 * only the later sitting, so the echoed month is unsupported and the whole
 * date sentence used to be replaced (eval round 2: dl-sip4a-feb in 3 runs).
 * When the anchor month is not supported by the block's facts, only the
 * anchor phrase is replaced by "danach" / "after that": the unsupported month
 * leaves, no value is added, and the date that follows is still validated.
 */
export function neutralizeAnchorMonths(text: string, allowed: ReadonlySet<string>): string {
  const unsupported = (month: string | undefined, year: string | undefined) => {
    const n = month ? monthNumber(month) : null;
    if (!n) return false;
    return year ? !allowed.has(`my:${year}-${pad(n)}`) : !allowed.has(`m:${pad(n)}`);
  };
  const cased = (m: string, word: string) => (/^\p{Lu}/u.test(m) ? word[0].toUpperCase() + word.slice(1) : word);
  return text
    .replace(ANCHOR_DE, (m, mo: string, y?: string) => (unsupported(mo, y) ? cased(m, "danach") : m))
    .replace(ANCHOR_EN, (m, mo1?: string, y1?: string, mo2?: string, y2?: string) =>
      unsupported(mo1 ?? mo2, mo1 ? y1 : y2) ? cased(m, "after that") : m
    );
}

// ─── Fact ids written into prose ────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_ONE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Dotted id-shaped tokens (sip4a.dates.2026-11, status.<uuid>.sip4a.all). */
const ID_TOKEN_RE = /(?<![\p{L}\p{N}_.-])[a-z][a-z0-9_]*(?:\.[A-Za-z0-9_-]+)+(?![\p{L}\p{N}_-])/gu;

/**
 * Removes fact ids and UUIDs the model wrote into the text ("(status.0000...)").
 * They are protocol data, not claims: their digits must not be read as values,
 * and the learner should not see them. Only tokens that are an id the answer
 * cites, an id the brain can resolve, an internal id, or contain a UUID go.
 */
export function stripFactIds(text: string, isKnownId: (id: string) => boolean): string {
  const out = text
    .replace(ID_TOKEN_RE, (tok) => {
      const t = tok.replace(/[.]+$/, "");
      const internal = isInternalFactId(t) && /^[a-z]+\.[a-z0-9]/.test(t);
      return internal || UUID_ONE.test(t) || isKnownId(t) ? tok.slice(t.length) : tok;
    })
    .replace(UUID_RE, "");
  if (out === text) return text;
  return out
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

// ─── Sentences ──────────────────────────────────────────────────────────

const ABBREV = new Set(["z.b", "bzw", "ca", "nr", "dr", "u.a", "usw", "ggf", "inkl", "evtl", "vgl", "etc", "e.g", "i.e", "vs", "abs", "art", "bzgl", "max", "min", "mind", "prof", "str"]);

/** [start, end) ranges of sentences; newlines always split. Conservative: merging two sentences only over-replaces. */
export function sentenceRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let cut = -1;
    if (ch === "\n") cut = i;
    else if ((ch === "." || ch === "!" || ch === "?") && i + 1 < text.length && /\s/.test(text[i + 1])) {
      const prev = text[i - 1] ?? "";
      const before = text.slice(start, i);
      const word = (/([\p{L}.]+)$/u.exec(before)?.[1] ?? "").toLowerCase();
      const token = /(\S+)$/.exec(before)?.[1] ?? "";
      if (ch !== ".") cut = i + 1;
      // "D. <Monat>": a 1-2 digit token before the dot is an ordinal day, not a sentence end.
      else if (/\d/.test(prev)) cut = /^\d{1,2}$/.test(token) ? -1 : i + 1;
      else if (!ABBREV.has(word)) cut = i + 1;
    }
    if (cut >= 0) {
      if (cut > start) out.push([start, cut]);
      start = ch === "\n" ? i + 1 : cut;
    }
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

/**
 * Replaces every sentence that overlaps a bad value with `fallback`, keeping
 * the original separators (newlines, list markers stay). Adjacent replaced
 * sentences on one line collapse into a single fallback.
 */
export function replaceSentences(text: string, bad: ExtractedValue[], fallback: string): string {
  let out = "";
  let prevEnd = 0;
  let lastWasFallback = false;
  for (const [a, e] of sentenceRanges(text)) {
    const gap = text.slice(prevEnd, a);
    prevEnd = e;
    const piece = text.slice(a, e);
    if (!piece.trim()) {
      out += gap + piece;
      continue;
    }
    const hit = bad.some((v) => v.start < e && v.end > a);
    if (!hit) {
      out += gap + piece;
      lastWasFallback = false;
      continue;
    }
    if (lastWasFallback && !gap.includes("\n")) continue;
    // Keep a leading list marker ("- ", "* ") of the replaced line.
    const marker = /^(\s*[-*•]\s+)/.exec(piece)?.[1] ?? (/^\s+/.exec(piece)?.[0] ?? "");
    out += gap + marker + fallback;
    lastWasFallback = true;
  }
  out += text.slice(prevEnd);
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

// ─── Validation ─────────────────────────────────────────────────────────

/** Ids derived by the brain for validation only; never shown as citations. */
const INTERNAL_PREFIXES = ["question.", "progress.", "app.", "status."];
export function isInternalFactId(id: string): boolean {
  return INTERNAL_PREFIXES.some((p) => id.startsWith(p));
}

export interface ValidateOptions {
  /** Synchronous lookup for cited ids not in `facts` (the brain's loader and turn store). */
  resolve?: (id: string) => MentorFact | null;
  /** Language to use when the answer omits @@LANG. */
  defaultLang?: MentorLang;
}

/**
 * Language of an answer that omitted @@LANG (eval W3: Haiku sometimes starts
 * with @@BLOCK). Only used to pick the language of the fallback line. Script
 * first (ar, ru/uk), then common function words; null when unsure.
 */
export function guessLang(text: string): MentorLang | null {
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[іїєґ]/i.test(text)) return "uk";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const count = (set: ReadonlySet<string>) => words.filter((w) => set.has(w)).length;
  const scores: Array<[MentorLang, number]> = [
    ["de", count(DE_WORDS) + (/[äöüß]/i.test(text) ? 2 : 0)],
    ["en", count(EN_WORDS)],
    ["fr", count(FR_WORDS)],
    ["tr", count(TR_WORDS) + (/[ğışç]/i.test(text) ? 2 : 0)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : null;
}
const DE_WORDS = new Set(["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "für", "mit", "den", "dem", "sie", "du", "bitte", "wird", "auf", "bis", "zur", "zum"]);
const EN_WORDS = new Set(["the", "and", "is", "not", "a", "for", "with", "you", "your", "please", "will", "on", "until", "to", "of", "are"]);
const FR_WORDS = new Set(["le", "la", "les", "et", "est", "pas", "pour", "avec", "vous", "votre", "des", "une"]);
const TR_WORDS = new Set(["ve", "bir", "bu", "için", "ile", "değil", "lütfen", "sınav"]);

function cleanDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ", ");
}

export function validateAnswer(answer: string, facts: MentorFact[], opts: ValidateOptions = {}): ValidatedAnswer {
  const parsed = parseAnswer(normalizeDigits(typeof answer === "string" ? answer : ""));
  const lang: MentorLang =
    parsed.lang ?? opts.defaultLang ?? guessLang(parsed.blocks.map((b) => b.text).join("\n")) ?? "en";
  const byId = new Map<string, MentorFact>();
  for (const f of facts ?? []) {
    if (f && typeof f.id === "string" && f.verdict === "confirmed" && f.status === "live") byId.set(f.id, f);
  }
  const lookup = (id: string): MentorFact | null => byId.get(id) ?? opts.resolve?.(id) ?? null;
  const refused = parsed.refuse?.reason;
  const refuseExam: MentorExamKey | null = parsed.refuse?.exam ?? null;
  const refLink = refused ? refusalLink(refused, refuseExam) : undefined;
  const globalUrls = new Set(allOfficialLinks().map((u) => `u:${u.replace(/\/+$/, "").toLowerCase()}`));
  if (refLink) globalUrls.add(`u:${refLink.replace(/\/+$/, "").toLowerCase()}`);

  const rejected: ValidatedAnswer["rejected"] = [];
  const blocks: MentorAnswerBlock[] = [];
  const citations: MentorCitation[] = [];
  const cited = new Set<string>();
  let replaced = false;

  for (const b of parsed.blocks) {
    const used: MentorFact[] = [];
    for (const id of b.factIds) {
      const f = lookup(id);
      if (f) used.push(f);
      else rejected.push({ value: id, reason: "unknown_fact_id" });
    }
    const allowed = new Set<string>(globalUrls);
    for (const f of used) for (const k of factAllowedKeys(f)) allowed.add(k);

    const answerIds = new Set(parsed.blocks.flatMap((x) => x.factIds));
    const internalReadOn = new Set(used.filter((f) => isInternalFactId(f.id)).map((f) => f.read_on));
    const text = neutralizeAnchorMonths(
      stripUnsupportedStand(stripFieldNames(stripFactIds(stripProtocolMarkers(cleanDashes(b.text)), (id) => answerIds.has(id) || lookup(id) !== null)), allowed, internalReadOn),
      allowed
    );
    const values = extractValues(maskSourceLabels(text, used));
    // A question to the learner asserts nothing: a month or month-year it repeats
    // ("Wo hast du für den Termin im Februar eingereicht?") is not a claim. Day
    // dates, numbers, percentages and amounts in a question are still checked.
    const asked = questionRanges(text);
    const bad = values.filter(
      (v) =>
        !v.keys.some((k) => allowed.has(k)) &&
        !((v.kind === "month" || v.kind === "monthyear") && asked.some(([a, e]) => v.start >= a && v.end <= e))
    );
    let outText = text;
    if (bad.length > 0) {
      replaced = true;
      for (const v of bad) rejected.push({ value: v.raw, reason: used.length > 0 ? "not_in_cited_facts" : "uncited_number" });
      const official = used.find((f) => !isInternalFactId(f.id))?.source_url ?? refLink ?? officialLinkForExam(refuseExam);
      const fb = fallbackLine(lang, official);
      outText = replaceSentences(text, bad, fb);
    }
    if (!outText) continue;
    const shown = used.filter((f) => !isInternalFactId(f.id));
    // A computed registration status (internal, status.*) is built from official
    // sitting rows; its aliases name them. Show the rows whose values the block
    // actually states, so a status-only block still names its official source
    // (eval round 2: dl-sip5a-sep27-de, dl-rez-jan-en had dated blocks with no
    // shown citation). Display only: allowed values are unchanged.
    const kept = values.filter((v) => !bad.includes(v));
    for (const f of used) {
      if (!f.id.startsWith("status.")) continue;
      for (const sid of f.aliases ?? []) {
        const sf = lookup(sid);
        if (!sf || isInternalFactId(sf.id) || shown.some((x) => x.id === sf.id)) continue;
        const k = factAllowedKeys(sf);
        if (kept.some((v) => v.keys.some((x) => k.has(x)))) shown.push(sf);
      }
    }
    const shownIds = shown.map((f) => f.id);
    blocks.push({ text: outText, fact_ids: [...new Set(shownIds)] });
    for (const f of shown) {
      if (cited.has(f.id)) continue;
      cited.add(f.id);
      citations.push({ fact_id: f.id, source_label: f.source_label, source_url: f.source_url, read_on: f.read_on });
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      text: refused ? refusalLine(refused, lang) : fallbackLine(lang, officialLinkForExam(refuseExam)),
      fact_ids: [],
    });
  }

  const result: ValidatedAnswer = { blocks, citations, replaced, rejected };
  if (refused) {
    result.refused = refused;
    result.refusalLink = refLink;
  }
  return result;
}

// ─── Unasked values (answer only what was asked) ────────────────────────

/** The learner asked about money (de, en). */
const ASKS_MONEY_RE =
  /kost|gebühr|gebuehr|taxe|preis|euro|€|\beur\b|bezahl|zahlen|zahlung|geld|teuer|günstig|guenstig|beitrag|finanz|\bcost|\bfee|price|\bpay|money|expensive|cheap|charge|tuition|contribution|afford|how much/iu;
/** The learner asked about the pass mark, scoring or a percentage (de, en); "if I pass" alone is not that. */
const ASKS_PASS_MARK_RE =
  /prozent|percent|%|bestehensgrenze|als bestanden|zum bestehen|zu bestehen|positiv (?:absolviert|bewertet)|richtig|punkte|bewertung|schwelle|mindest|pass mark|passing (?:mark|score|grade|threshold)|counts? as (?:a )?pass|to pass\b|how many .{0,30}(?:correct|right)|score|points|grading|graded|threshold|minimum/iu;
/** The learner asked relative to a sitting ("the one after November", "next"), so other sittings are the answer. */
const ASKS_RELATIVE_RE =
  /\b(?:after|before|next|following|later|earlier|other|others|all|every|each|nach|vor|nächst\w*|naechst\w*|folgend\w*|später\w*|spaeter\w*|früher\w*|frueher\w*|danach|davor|andere\w*|weitere\w*|alle\w*|jede\w*)\b/iu;
const EN_MONTH_CAPS_RE = /(?<!^)\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b(?!\s+I\b)/gu;
const EN_MONTH_CAPS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };

/** Months (with the year when named) a learner message points at. */
export function askedMonths(question: string): Array<{ month: string; year: string | null }> {
  const q = normalizeDigits(question);
  const out: Array<{ month: string; year: string | null }> = [];
  for (const v of extractValues(q)) {
    for (const k of v.keys) {
      let m: RegExpExecArray | null;
      if ((m = /^d:(\d{4})-(\d{2})-\d{2}$/.exec(k)) || (m = /^my:(\d{4})-(\d{2})$/.exec(k))) out.push({ month: m[2], year: m[1] });
      else if ((m = /^dm:(\d{2})-\d{2}$/.exec(k)) || (m = /^m:(\d{2})$/.exec(k))) out.push({ month: m[1], year: null });
    }
  }
  for (const m of q.matchAll(EN_MONTH_CAPS_RE)) {
    const n = pad(EN_MONTH_CAPS[m[1]]);
    if (!out.some((x) => x.month === n)) out.push({ month: n, year: /\b(20\d{2})\b/.exec(q.slice(m.index ?? 0, (m.index ?? 0) + 12))?.[1] ?? null });
  }
  return out;
}

const REFUSAL_VALUE_KINDS: ReadonlySet<ValueKind> = new Set(["eur", "percent", "date", "daymonth", "monthyear"]);

/**
 * A refusal is one short line and adds nothing else (prompt: "no related rule,
 * number or date instead"). Sentences in a refusal that state an amount, a
 * percentage or a date are deleted, even when a cited fact backs them (eval
 * round 2: in-link-en refused the injected 5 euro offer and then listed the
 * real plan prices). When nothing is left, the standard refusal line is used.
 */
function trimRefusalValues(v: ValidatedAnswer, lang: MentorLang): ValidatedAnswer {
  const blocks: MentorAnswerBlock[] = [];
  let changed = false;
  for (const b of v.blocks) {
    const drop = extractValues(normalizeDigits(b.text)).filter((x) => REFUSAL_VALUE_KINDS.has(x.kind));
    if (drop.length === 0) {
      blocks.push(b);
      continue;
    }
    changed = true;
    const text = removeSentences(b.text, drop);
    if (text && /[\p{L}\p{N}]/u.test(text)) blocks.push({ text, fact_ids: b.fact_ids });
  }
  if (!changed) return v;
  if (blocks.length === 0 && v.refused) blocks.push({ text: refusalLine(v.refused, lang), fact_ids: [] });
  const stillCited = new Set(blocks.flatMap((b) => b.fact_ids));
  return { ...v, blocks, citations: v.citations.filter((c) => stillCited.has(c.fact_id)) };
}

/** Sitting date (ISO) a fact or sitting id names: sitting.<exam>.<date>.* and <exam>.dates.<date>.* */
function sittingDateOfId(id: string): string | null {
  return /^(?:sitting\.[a-z0-9]+|[a-z0-9]+\.dates)\.(\d{4}-\d{2}-\d{2})(?:\.|$)/.exec(id)?.[1] ?? null;
}

/**
 * Deletes every sentence that overlaps one of `drop` (no fallback line: the
 * sentence was not asked for). Works line by line: a line whose sentences are
 * all removed disappears with its list marker; other lines and paragraph
 * breaks stay as they were.
 */
export function removeSentences(text: string, drop: ExtractedValue[]): string {
  const out: string[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const hits = drop.filter((v) => v.start < start + line.length && v.end > start);
    if (hits.length === 0) {
      out.push(line);
      continue;
    }
    const marker = /^(\s*[-*•]\s+)/.exec(line)?.[1] ?? "";
    const kept: string[] = [];
    for (const [a, e] of sentenceRanges(line)) {
      if (hits.some((v) => v.start < start + e && v.end > start + a)) continue;
      const piece = line.slice(a, e).trim();
      if (piece) kept.push(piece);
    }
    let rebuilt = kept.join(" ");
    if (marker && rebuilt.startsWith(marker.trim())) rebuilt = rebuilt.slice(marker.trim().length).trim();
    if (rebuilt && /[\p{L}\p{N}]/u.test(rebuilt)) out.push(marker + rebuilt);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface TrimUnaskedInput {
  /** The learner's message, plus the previous one for a short follow-up ("In Wien."). */
  question: string;
  lang: MentorLang;
  /** Resolves any fact id (official, sitting or internal). */
  resolve: (id: string) => MentorFact | null;
  /** Every fact id the tools returned in this turn. */
  retrievedIds: Iterable<string>;
}

/**
 * Answer only what was asked, enforced in code (eval round 2: Haiku kept adding
 * REAL but unasked values: the 150 EUR application fee in a steps answer, the
 * 60 percent pass rule in a structure or repeat answer, the other 2027 sittings
 * in a deadline answer for one sitting). Runs after validateAnswer on its
 * validated blocks and only DELETES sentences, so it can never add a claim:
 *
 *  - an EUR amount backed only by an official fee fact, when the learner did
 *    not ask about money (app prices are internal facts and are never touched);
 *  - a percentage backed only by an official pass-rule fact, when the learner
 *    did not ask about the pass mark or scoring;
 *  - the date of another sitting, when the learner named one sitting month,
 *    did not ask relative to it ("after", "next") and a sitting of that month
 *    was retrieved. Dates that belong to the asked sitting's own facts stay.
 *
 * All three rules run for de and en only (the word lists are de/en; for
 * other languages nothing is trimmed). When trimming would leave
 * nothing the answer is returned unchanged. A refusal goes through
 * trimRefusalValues instead (no amount, percentage or date in a refusal).
 */
export function trimUnaskedValues(v: ValidatedAnswer, t: TrimUnaskedInput): ValidatedAnswer {
  if (v.refused) return trimRefusalValues(v, t.lang);
  if (typeof t.question !== "string" || t.question.trim().length === 0) return v;
  const q = t.question;
  const wordRules = t.lang === "de" || t.lang === "en";
  const askMoney = !wordRules || ASKS_MONEY_RE.test(q);
  const askPass = !wordRules || ASKS_PASS_MARK_RE.test(q);

  // Sittings the learner named by month, and the dates that belong to them.
  const retrieved = [...new Set(t.retrievedIds)];
  const sittingDates = new Set(retrieved.map(sittingDateOfId).filter((d): d is string => d !== null));
  // Relative words are known for de/en only, so the sitting rule runs for de/en only too.
  const months = !wordRules || ASKS_RELATIVE_RE.test(q) ? [] : askedMonths(q);
  const isTarget = (iso: string) => months.some((m) => iso.slice(5, 7) === m.month && (m.year === null || iso.startsWith(m.year)));
  const targets = [...sittingDates].filter(isTarget);
  const otherSitting = new Set<string>();
  if (targets.length > 0) {
    const own = new Set<string>();
    for (const id of retrieved) {
      const d = sittingDateOfId(id);
      if (!d || !targets.includes(d)) continue;
      const f = t.resolve(id);
      if (f) for (const k of allowedKeysFromText(`${f.text_de}\n${f.text_en}`)) own.add(k);
    }
    for (const d of sittingDates) {
      if (targets.includes(d) || own.has(`d:${d}`)) continue;
      otherSitting.add(`d:${d}`);
      otherSitting.add(`dm:${d.slice(5)}`);
    }
  }
  if (askMoney && askPass && otherSitting.size === 0) return v;

  const blocks: MentorAnswerBlock[] = [];
  let changed = false;
  for (const b of v.blocks) {
    const facts = b.fact_ids.map((id) => t.resolve(id)).filter((f): f is MentorFact => f !== null);
    const keysOf = (pred: (f: MentorFact) => boolean) => {
      const s = new Set<string>();
      for (const f of facts) if (pred(f)) for (const k of factAllowedKeys(f)) s.add(k);
      return s;
    };
    const feeKeys = keysOf((f) => f.topic === "fee" && !isInternalFactId(f.id));
    const passKeys = keysOf((f) => f.topic === "pass_rule" && !isInternalFactId(f.id));
    const otherFee = keysOf((f) => f.topic !== "fee");
    const otherPass = keysOf((f) => f.topic !== "pass_rule");
    const values = extractValues(normalizeDigits(b.text));
    const drop = values.filter((x) => {
      if (!askMoney && x.kind === "eur" && x.keys.some((k) => feeKeys.has(k)) && !x.keys.some((k) => otherFee.has(k))) return true;
      if (!askPass && x.kind === "percent" && x.keys.some((k) => passKeys.has(k)) && !x.keys.some((k) => otherPass.has(k))) return true;
      if ((x.kind === "date" || x.kind === "daymonth") && x.keys.some((k) => otherSitting.has(k))) return true;
      return false;
    });
    if (drop.length === 0) {
      blocks.push(b);
      continue;
    }
    changed = true;
    const text = removeSentences(b.text, drop);
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    // A fee or pass-rule fact whose value left with the sentence is no longer a source of this block.
    const left = extractValues(normalizeDigits(text));
    const ids = facts
      .filter((f) => {
        if (f.topic !== "fee" && f.topic !== "pass_rule") return true;
        const k = factAllowedKeys(f);
        return left.some((x) => x.keys.some((y) => k.has(y)));
      })
      .map((f) => f.id);
    blocks.push({ text, fact_ids: ids });
  }
  if (!changed || blocks.length === 0) return v;
  const stillCited = new Set(blocks.flatMap((b) => b.fact_ids));
  return { ...v, blocks, citations: v.citations.filter((c) => stillCited.has(c.fact_id)) };
}
