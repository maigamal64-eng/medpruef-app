/**
 * Value extraction for grading (W2-EVAL). Deliberately independent of the
 * mentor's own validator (src/lib/mentor/validator.ts): the eval must be able
 * to catch the validator missing something, so it does not reuse its code.
 *
 * German and English only (v1 languages). Pure functions, no I/O.
 */

export interface FoundDate {
  /** Four-digit year when the text carried one. */
  year: number | null;
  month: number;
  day: number;
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januar: 1, jaenner: 1, jänner: 1, jaen: 1, jän: 1,
  feb: 2, february: 2, februar: 2, feber: 2,
  mar: 3, march: 3, mär: 3, maer: 3, märz: 3, maerz: 3,
  apr: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dez: 12, dezember: 12,
};

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const SEP = String.raw`\s*(?:to|bis|until|und|and|-|–|—)\s*`;

// Ordered; earlier patterns claim their span first.
const P_ISO = /(?<![\d-])(20\d\d)-(\d\d)-(\d\d)(?!\d)/g;
const P_NUM = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(?:(20\d\d)(?!\d))?/g;
const P_DM_RANGE = new RegExp(String.raw`(?<![\d.:])(\d{1,2})(?:st|nd|rd|th)?\.?${SEP}(\d{1,2})(?:st|nd|rd|th)?\.?\s+(${MONTH_ALT})\b\.?(?:,?\s+(20\d\d)(?!\d))?`, "gi");
const P_DM = new RegExp(String.raw`(?<![\d.:])(\d{1,2})(?:st|nd|rd|th)?\.?\s+(${MONTH_ALT})\b\.?(?:,?\s+(20\d\d)(?!\d))?`, "gi");
const P_MD = new RegExp(String.raw`\b(${MONTH_ALT})\b\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d|:)(?:,?\s+(20\d\d)(?!\d))?`, "gi");

function validDay(y: number | null, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const year = y ?? 2028; // a leap year, so a year-less 29th of February is not rejected
  const t = new Date(Date.UTC(year, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Every calendar date in the text, in order. Month-only and year-only mentions are not dates. */
export function extractDates(text: string): FoundDate[] {
  const out: Array<FoundDate & { start: number; end: number }> = [];
  const taken: Array<[number, number]> = [];
  const free = (s: number, e: number) => taken.every(([a, b]) => e <= a || s >= b);
  const add = (s: number, e: number, y: number | null, m: number, d: number, raw: string) => {
    if (!validDay(y, m, d)) return;
    out.push({ year: y, month: m, day: d, raw, start: s, end: e });
  };
  const claim = (s: number, e: number) => taken.push([s, e]);

  for (const mt of text.matchAll(P_ISO)) {
    const s = mt.index ?? 0;
    add(s, s + mt[0].length, Number(mt[1]), Number(mt[2]), Number(mt[3]), mt[0]);
    claim(s, s + mt[0].length);
  }
  for (const mt of text.matchAll(P_DM_RANGE)) {
    const s = mt.index ?? 0;
    const e = s + mt[0].length;
    if (!free(s, e)) continue;
    const m = MONTHS[mt[3].toLowerCase()];
    const y = mt[4] ? Number(mt[4]) : null;
    add(s, e, y, m, Number(mt[1]), mt[0]);
    add(s, e, y, m, Number(mt[2]), mt[0]);
    claim(s, e);
  }
  for (const mt of text.matchAll(P_DM)) {
    const s = mt.index ?? 0;
    const e = s + mt[0].length;
    if (!free(s, e)) continue;
    add(s, e, mt[3] ? Number(mt[3]) : null, MONTHS[mt[2].toLowerCase()], Number(mt[1]), mt[0]);
    claim(s, e);
  }
  for (const mt of text.matchAll(P_MD)) {
    const s = mt.index ?? 0;
    const e = s + mt[0].length;
    if (!free(s, e)) continue;
    add(s, e, mt[3] ? Number(mt[3]) : null, MONTHS[mt[1].toLowerCase()], Number(mt[2]), mt[0]);
    claim(s, e);
  }
  for (const mt of text.matchAll(P_NUM)) {
    const s = mt.index ?? 0;
    const e = s + mt[0].length;
    if (!free(s, e)) continue;
    add(s, e, mt[3] ? Number(mt[3]) : null, Number(mt[2]), Number(mt[1]), mt[0]);
    claim(s, e);
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  // "23 Nov to 27 Nov 2026": a year-less date joined by a range word to a dated one inherits that year.
  const joiner = new RegExp(`^${SEP}$`, "i");
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a.year === null && b.year !== null && b.start >= a.end && joiner.test(text.slice(a.end, b.start))) {
      a.year = a.month > b.month ? b.year - 1 : b.year;
    }
  }
  return out.map((d) => ({ year: d.year, month: d.month, day: d.day, raw: d.raw }));
}

export function parseIso(iso: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** A found date equals an ISO date; a year-less found date matches on day and month only. */
export function dateEquals(found: FoundDate, iso: string): boolean {
  const t = parseIso(iso);
  if (found.month !== t.month || found.day !== t.day) return false;
  return found.year === null || found.year === t.year;
}

export function dateInSet(found: FoundDate, isoSet: Iterable<string>): boolean {
  for (const iso of isoSet) if (dateEquals(found, iso)) return true;
  return false;
}

/** ISO dates found in text with a year (used to turn facts and the user message into allowed sets). */
export function isoDatesIn(text: string): string[] {
  const set = new Set<string>();
  for (const d of extractDates(text)) {
    if (d.year !== null) set.add(`${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`);
  }
  return [...set];
}

// ─── Money, percentages, numbers, links ─────────────────────────────────

function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sepIdx = Math.max(lastDot, lastComma);
    const digitsAfter = s.length - sepIdx - 1;
    const sepCount = (s.match(/[.,]/g) ?? []).length;
    // "1.000" or "1,000": a thousands separator; "19,50" or "19.5": a decimal.
    s = digitsAfter === 3 || sepCount > 1 ? s.replace(/[.,]/g, "") : s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT = String.raw`\d+(?:[.,]\d+)*`;
const P_EUR_AFTER = new RegExp(String.raw`(?<![\d.,])(${AMOUNT})\s*(?:€|EUR\b|Euro\b|euros?\b)`, "gi");
const P_EUR_BEFORE = new RegExp(String.raw`(?:€|\bEUR\b)\s*(${AMOUNT})`, "gi");

/** EUR amounts (as euros, so 19,50 is 19.5). */
export function extractEur(text: string): number[] {
  const out: number[] = [];
  for (const re of [P_EUR_AFTER, P_EUR_BEFORE]) {
    for (const mt of text.matchAll(re)) {
      const raw = mt[1].replace(/[.,]+$/, "");
      const n = parseAmount(raw);
      if (n !== null) out.push(n);
    }
  }
  return out;
}

const P_PERCENT = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:%|Prozent\b|percent\b|per cent\b)/gi;

export function extractPercents(text: string): number[] {
  const out: number[] = [];
  for (const mt of text.matchAll(P_PERCENT)) {
    const n = parseAmount(mt[1]);
    if (n !== null) out.push(n);
  }
  return out;
}

/** True when the integer appears as a standalone number (not inside a longer number or a date). */
export function containsNumber(text: string, n: number): boolean {
  const re = new RegExp(String.raw`(?<![\d.,])${n}(?![\d]|[.,]\d)`);
  return re.test(text);
}

const P_URL = /\b(?:https?:\/\/|www\.)[^\s)\]>"'<]+/gi;

export function extractUrls(text: string): string[] {
  return [...text.matchAll(P_URL)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
}

/** The text without its links (a link's digits, "%C3" and dates must not be read as claims). */
export function stripUrls(text: string): string {
  return text.replace(P_URL, " ");
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function includesTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

/** `*` glob over a fact id (everything else literal). */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`);
}

export function matchesAnyGlob(id: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(id));
}
