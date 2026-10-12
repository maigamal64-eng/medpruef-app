/**
 * Money and legal copy in the learner's language (a29, LX-20).
 *
 * billing-copy.ts owns the facts and the German/English sentences; the ru,
 * uk and tr drafts live in master-learning/billing-copy-i18n.ts (Arabic is
 * empty until [name] signs it off, pick-arabic A). This facade decides which
 * language a money sentence may render in:
 *
 *   - de and en: the billing-copy.ts sentences, unchanged.
 *   - ru, uk, tr, ar: only when all three hold: the UI review gate lists the
 *     language (REVIEWED_LANGS), its money drafts are signed off by a native
 *     reviewer (BILLING_I18N_SIGNED_OFF, Arabic by [name]) and no key of the
 *     minimum set is missing. Otherwise the complete English block renders,
 *     never a half-translated mix of renewal and refund sentences (ACC-40).
 *
 * Today every gate is closed, so every non-German preference reads English.
 * This module imports both owners and is imported by neither, so there is
 * no module cycle. No em dashes.
 */
import { REVIEWED_LANGS, type UiLanguage } from "@/lib/language-model";
import { REFUND } from "@/lib/content-truth";
import {
  billingAmount,
  billingCancelSummary,
  billingNeutralLine,
  billingPlansSummary,
  billingTrialLine,
  billingTrialSummary,
  type BillingLang,
} from "@/lib/billing-copy";
import {
  BILLING_I18N,
  BILLING_I18N_SIGNED_OFF,
  missingBillingKeys,
  type BillingI18nLang,
  type BillingKey,
} from "@/lib/master-learning/billing-copy-i18n";

declare const moneyBrand: unique symbol;
/**
 * A language that passed the gate. Only moneyCopyLang() produces one, so a
 * raw preference such as "ru" can never reach a translated sentence by
 * accident.
 */
export type MoneyCopyLang = (BillingLang | BillingI18nLang) & { readonly [moneyBrand]: true };
type RawMoneyLang = BillingLang | BillingI18nLang;

const I18N_LANGS: readonly BillingI18nLang[] = ["ru", "uk", "tr", "ar"];

const LOCALE: Record<RawMoneyLang, string> = {
  de: "de-DE",
  en: "en-US",
  ru: "ru-RU",
  uk: "uk-UA",
  tr: "tr-TR",
  ar: "ar-EG",
};

function raw(lang: MoneyCopyLang): RawMoneyLang {
  return lang as RawMoneyLang;
}

function isI18nLang(value: string): value is BillingI18nLang & MoneyCopyLang {
  return (I18N_LANGS as readonly string[]).includes(value);
}

/** Whether a translated money block may render for this language. */
export function moneyCopyReady(
  lang: BillingI18nLang,
  reviewed: readonly UiLanguage[] = REVIEWED_LANGS,
  signedOff: Record<BillingI18nLang, boolean> = BILLING_I18N_SIGNED_OFF,
): boolean {
  return reviewed.includes(lang) && signedOff[lang] === true && missingBillingKeys(lang).length === 0;
}

/**
 * The language money copy renders in for a stored preference: German for
 * German, the translated block when it is ready, English otherwise.
 */
export function moneyCopyLang(
  preference: string | null | undefined,
  reviewed: readonly UiLanguage[] = REVIEWED_LANGS,
  signedOff: Record<BillingI18nLang, boolean> = BILLING_I18N_SIGNED_OFF,
): MoneyCopyLang {
  if (preference === "de") return "de" as MoneyCopyLang;
  if (preference && isI18nLang(preference) && moneyCopyReady(preference, reviewed, signedOff)) return preference as MoneyCopyLang;
  return "en" as MoneyCopyLang;
}

function i18n(lang: BillingI18nLang, key: BillingKey): string {
  return BILLING_I18N[lang][key];
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Euro amount in the money language's own number format. */
export function moneyAmount(cents: number, lang: MoneyCopyLang): string {
  if (lang === "de" || lang === "en") return billingAmount(cents, lang);
  return `${new Intl.NumberFormat(LOCALE[raw(lang)], {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)} €`;
}

/** Calendar date in Vienna time, in the money language's own format. */
export function moneyDate(iso: string, lang: MoneyCopyLang): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(LOCALE[raw(lang)], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Vienna",
  }).format(new Date(time));
}

export function plansSummaryFor(lang: MoneyCopyLang): string {
  return isI18nLang(lang) ? i18n(lang, "plans") : billingPlansSummary(lang);
}

export function trialSummaryFor(lang: MoneyCopyLang): string {
  return isI18nLang(lang) ? i18n(lang, "trial") : billingTrialSummary(lang);
}

export function cancelSummaryFor(lang: MoneyCopyLang): string {
  return isI18nLang(lang) ? i18n(lang, "cancel") : billingCancelSummary(lang);
}

export function neutralLineFor(lang: MoneyCopyLang): string {
  return isI18nLang(lang) ? i18n(lang, "neutral") : billingNeutralLine(lang);
}

export function refundSummaryFor(lang: MoneyCopyLang): string {
  return isI18nLang(lang) ? i18n(lang, "refund") : REFUND.copy[raw(lang) as BillingLang];
}

/**
 * The "Whop shows English" steps for a translated block; null for German and
 * English, whose cancel sentences already name the English Whop page.
 */
export function whopEnglishNoteFor(lang: MoneyCopyLang): string | null {
  return isI18nLang(lang) ? i18n(lang, "whopEnglish") : null;
}

/** The trial line with a charge date, as billingTrialLine, in the money language. */
export function trialLineFor(
  lang: MoneyCopyLang,
  data: { priceAfterCents: number; trialDays: number; chargeAt?: string | null },
): string {
  if (!isI18nLang(lang)) return billingTrialLine(lang, data);
  const valid =
    Number.isInteger(data.priceAfterCents) && data.priceAfterCents >= 0 && Number.isInteger(data.trialDays) && data.trialDays > 0;
  // Invalid terms never render a translated money sentence; the English
  // fallback line points to the terms instead.
  if (!valid) return billingTrialLine("en", data);
  const date = data.chargeAt ? moneyDate(data.chargeAt, lang) : null;
  return fill(i18n(lang, date ? "trialDated" : "trialUndated"), {
    days: String(data.trialDays),
    zero: moneyAmount(0, lang),
    amount: moneyAmount(data.priceAfterCents, lang),
    date: date ?? "",
  });
}

/**
 * RenewalPrompt lines for a one-time plan (pick-renewal-copy A): the neutral
 * access-ending sentence and the action label. `date` is already formatted
 * in the money language (moneyLocale).
 */
export function accessEndLineFor(lang: MoneyCopyLang, date: string, lapsed: boolean): string {
  if (isI18nLang(lang)) return fill(i18n(lang, lapsed ? "accessEnded" : "accessEnds"), { date });
  const copy = {
    de: `Ihr Pro-Zugang ${lapsed ? "endete" : "endet"} am ${date} und verlängert sich nicht.`,
    en: `Your Pro access ${lapsed ? "ended" : "ends"} on ${date} and does not renew.`,
  };
  return copy[raw(lang) as BillingLang];
}

export function continueAfterLabelFor(lang: MoneyCopyLang, date: string): string {
  if (isI18nLang(lang)) return fill(i18n(lang, "continueAfter"), { date });
  const copy = { de: `Weiterlernen nach dem ${date}`, en: `Continue studying after ${date}` };
  return copy[raw(lang) as BillingLang];
}

/** BCP 47 locale for numbers and dates in the money language. */
export function moneyLocale(lang: MoneyCopyLang): string {
  return LOCALE[raw(lang)];
}

/**
 * The complete translated terms block (plans, trial, cancel with the English
 * Whop steps, refund) for a preference whose money copy is ready; null for
 * German, English and every language whose gate is still closed.
 */
export function localizedBillingTerms(
  preference: string | null | undefined,
  reviewed: readonly UiLanguage[] = REVIEWED_LANGS,
  signedOff: Record<BillingI18nLang, boolean> = BILLING_I18N_SIGNED_OFF,
): { lang: BillingI18nLang; dir: "ltr" | "rtl"; lines: string[] } | null {
  const lang = moneyCopyLang(preference, reviewed, signedOff);
  if (!isI18nLang(lang)) return null;
  return {
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    lines: [
      plansSummaryFor(lang),
      trialSummaryFor(lang),
      cancelSummaryFor(lang),
      whopEnglishNoteFor(lang) ?? "",
      refundSummaryFor(lang),
    ].filter(Boolean),
  };
}
