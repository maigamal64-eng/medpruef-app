/**
 * One formatter module for learner numbers, percent, counts, dates, durations
 * and money (UX-GLOBAL-03). Every function takes the language actually
 * rendered on screen, not the stored preference: a Russian account on the
 * English fallback formats as English.
 *
 * Rules:
 * - German groups with de-DE ("7.080"), English with en-US ("7,080").
 * - Digits stay Latin in every script (pick-arabic-digits A), so Arabic and
 *   other overlays format with the English locale plus the `latn` system.
 * - Percent is always the symbol: German "74 %" with a narrow no-break space,
 *   English "74%". "Prozent" is never spelled out.
 * - Counts go through Intl.PluralRules; units are always written.
 * - Dates are computed in Europe/Vienna.
 * - Unknown values never render as 0: callers use UNKNOWN_VALUE.
 * No en or em dashes appear in any output.
 */

export type FormatLang = 'de' | 'en' | 'ru' | 'uk' | 'tr' | 'ar';

export const VIENNA_TZ = 'Europe/Vienna';
/** Narrow no-break space used between a German number and "%" or "€". */
export const NNBSP = ' ';

/** Locale used for a rendered language. Non de/en overlays stay Latin-digit. */
export function numberLocale(lang: FormatLang): string {
  if (lang === 'de') return 'de-DE';
  if (lang === 'ru') return 'ru-RU-u-nu-latn';
  if (lang === 'uk') return 'uk-UA-u-nu-latn';
  if (lang === 'tr') return 'tr-TR-u-nu-latn';
  return 'en-US-u-nu-latn';
}

function dateLocale(lang: FormatLang): string {
  if (lang === 'de') return 'de-AT';
  if (lang === 'ar') return 'en-US-u-nu-latn';
  return numberLocale(lang);
}

const numberCache = new Map<string, Intl.NumberFormat>();
function nf(lang: FormatLang, opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(opts)}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(numberLocale(lang), opts);
    numberCache.set(key, f);
  }
  return f;
}

/** "7.080" (de) / "7,080" (en). Returns null for a non-finite value. */
export function formatNumber(value: number | null | undefined, lang: FormatLang, opts: Intl.NumberFormatOptions = {}): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return nf(lang, { maximumFractionDigits: 1, ...opts }).format(value);
}

/** "74 %" (de, narrow no-break space) / "74%" (en). Input is 0 to 100. */
export function formatPercent(value: number | null | undefined, lang: FormatLang, fractionDigits = 0): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = nf(lang, { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 }).format(value);
  return lang === 'de' || lang === 'ru' || lang === 'uk' ? `${n}${NNBSP}%` : lang === 'tr' ? `%${n}` : `${n}%`;
}

/** "19 €" or "16,33 €" with exact cents; never "~16 €". */
export function formatMoney(cents: number | null | undefined, lang: FormatLang): string | null {
  if (typeof cents !== 'number' || !Number.isInteger(cents)) return null;
  const n = nf(lang, { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
  return lang === 'de' ? `${n}${NNBSP}€` : `${n} €`;
}

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
const pluralCache = new Map<string, Intl.PluralRules>();
function pr(lang: FormatLang): Intl.PluralRules {
  let r = pluralCache.get(lang);
  if (!r) {
    r = new Intl.PluralRules(lang === 'de' ? 'de' : lang);
    pluralCache.set(lang, r);
  }
  return r;
}

/** Plural category of a count for the rendered language (ru/uk three forms, ar six). */
export function pluralCategory(count: number, lang: FormatLang): Intl.LDMLPluralRule {
  return pr(lang).select(count);
}

/** Built-in units. Overlay languages fall back to English forms until reviewed. */
const UNITS: Record<string, Partial<Record<FormatLang, PluralForms>>> = {
  day: { de: { one: '{n} Tag', other: '{n} Tage' }, en: { one: '{n} day', other: '{n} days' } },
  question: { de: { one: '{n} Frage', other: '{n} Fragen' }, en: { one: '{n} question', other: '{n} questions' } },
  answer: { de: { one: '{n} Antwort', other: '{n} Antworten' }, en: { one: '{n} answer', other: '{n} answers' } },
  topic: { de: { one: '{n} Fachgebiet', other: '{n} Fachgebiete' }, en: { one: '{n} topic', other: '{n} topics' } },
  minute: { de: { one: '{n} Minute', other: '{n} Minuten' }, en: { one: '{n} minute', other: '{n} minutes' } },
  hour: { de: { one: '{n} Stunde', other: '{n} Stunden' }, en: { one: '{n} hour', other: '{n} hours' } },
  week: { de: { one: '{n} Woche', other: '{n} Wochen' }, en: { one: '{n} week', other: '{n} weeks' } },
  note: { de: { one: '{n} Lernnotiz', other: '{n} Lernnotizen' }, en: { one: '{n} study note', other: '{n} study notes' } },
  review: { de: { one: '{n} Wiederholung', other: '{n} Wiederholungen' }, en: { one: '{n} review', other: '{n} reviews' } },
};
export type CountUnit = keyof typeof UNITS;

/**
 * "1 Tag", "2 Tage", "1 question". Custom forms may be passed for any other
 * noun; the category is chosen by Intl.PluralRules of the rendered language.
 */
export function formatCount(count: number, unit: CountUnit | PluralForms, lang: FormatLang): string {
  const forms: PluralForms = typeof unit === 'string'
    ? (UNITS[unit][lang] ?? UNITS[unit].en) as PluralForms
    : unit;
  const formsLang: FormatLang = typeof unit === 'string' && !UNITS[unit][lang] ? 'en' : lang;
  const category = pluralCategory(count, formsLang);
  const template = forms[category] ?? forms.other;
  return template.replace('{n}', formatNumber(count, formsLang, { maximumFractionDigits: 0 }) ?? String(count));
}

const dateCache = new Map<string, Intl.DateTimeFormat>();
function df(lang: FormatLang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(opts)}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(dateLocale(lang), { timeZone: VIENNA_TZ, ...opts });
    dateCache.set(key, f);
  }
  return f;
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function viennaYear(d: Date): number {
  return Number(df('en', { year: 'numeric' }).format(d));
}

export type DateStyle = 'long' | 'short' | 'numeric';

/**
 * long "14. November" (year added outside the current Vienna year, or always
 * with `withYear`), short "19. Okt." for chips, numeric "12.03.2026" for dense rows.
 */
export function formatDate(value: Date | string | number, lang: FormatLang, style: DateStyle = 'long', opts: { withYear?: boolean; now?: Date } = {}): string | null {
  const d = toDate(value);
  if (!d) return null;
  const needsYear = opts.withYear || viennaYear(d) !== viennaYear(opts.now ?? new Date());
  if (style === 'numeric') {
    return df(lang, { day: '2-digit', month: '2-digit', ...(needsYear ? { year: 'numeric' as const } : {}) }).format(d);
  }
  return df(lang, { day: 'numeric', month: style === 'long' ? 'long' : 'short', ...(needsYear ? { year: 'numeric' as const } : {}) }).format(d);
}

/** 24 h "21:40" in Vienna time. */
export function formatTime(value: Date | string | number, lang: FormatLang): string | null {
  const d = toDate(value);
  if (!d) return null;
  return df(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** "vor 2 Tagen" / "2 days ago". */
export function formatRelativeDays(days: number, lang: FormatLang): string {
  return new Intl.RelativeTimeFormat(dateLocale(lang), { numeric: 'auto' }).format(days, 'day');
}

/** "2 Std. 14 Min." / "2 h 14 min"; under one hour only minutes. */
export function formatDuration(ms: number | null | undefined, lang: FormatLang): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const [hu, mu] = lang === 'de' ? ['Std.', 'Min.'] : ['h', 'min'];
  return h > 0 ? `${h} ${hu} ${m} ${mu}` : `${m} ${mu}`;
}

/** Running clock "hh:mm:ss"; render inside dir=ltr with tabular digits. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Placeholder for a value that failed to load or does not exist. An ASCII
 * hyphen, never 0 and never an en or em dash. The accessible text says why.
 */
export const UNKNOWN_VALUE = '-';
export function unknownValueLabel(reason: 'failed' | 'empty', lang: FormatLang): string {
  if (lang === 'de') return reason === 'failed' ? 'Nicht verfügbar' : 'Noch keine Daten';
  return reason === 'failed' ? 'Not available' : 'No data yet';
}
