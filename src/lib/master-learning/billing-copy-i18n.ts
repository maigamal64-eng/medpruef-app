/**
 * Money and legal copy in ru, uk and tr (LX-20-R). Pure. Same facts as
 * src/lib/billing-copy.ts (the hot owner of the facts), keyed off the same
 * constants: prices from content-truth TIERS, the Whop address and support
 * email from billing-copy. billing-copy.ts only has to widen BillingLang and
 * delegate (track-A).
 *
 * Arabic stays empty until [name] signs it off. Native-reviewer sign-off per
 * language is pending: see handover needs-track-a note.
 */
import { TIERS } from "@/lib/content-truth";
import { BILLING_SUPPORT_EMAIL, WHOP_MANAGE_TEXT } from "@/lib/billing-copy";

export type BillingI18nLang = "ru" | "uk" | "tr" | "ar";

export const BILLING_KEYS = [
  "plans",
  "trial",
  "cancel",
  "neutral",
  "refund",
  "whopEnglish",
] as const;
export type BillingKey = (typeof BILLING_KEYS)[number];

const MONTHLY = TIERS.first_month_19.price_cents / 100;
const QUARTERLY = TIERS.first_3mo_27.price_cents / 100;
const COHORT = TIERS.premium_pass_guaranteed.price_cents / 100;
const COHORT_MONTHS = TIERS.premium_pass_guaranteed.duration_months;
/** Trial length and refund window as stated in billing-copy.ts and the terms. */
export const TRIAL_DAYS = 7;
export const REFUND_DAYS = 7;
/** The exact English label on Whop's screen, quoted as is. */
export const WHOP_CANCEL_LABEL = "Cancel membership";

type Copy = Record<BillingKey, string>;

const ru: Copy = {
  plans: `Тарифы «Месяц» (${MONTHLY} € в месяц) и «3 месяца» (${QUARTERLY} € за квартал) являются подписками: они продлеваются автоматически каждые 30 или 90 дней, и деньги списываются в дату каждого продления, пока вы не отмените подписку. Экзаменационная когорта (${COHORT} € на ${COHORT_MONTHS} месяцев) оплачивается один раз и не продлевается.`,
  trial: `Пробный период Pro начинается с привязанной картой: сегодня 0 €, ${TRIAL_DAYS} дней Pro. Если вы не отмените подписку в течение пробной недели, дальше будет списываться ${MONTHLY} € в месяц.`,
  cancel: `Отменить подписку можно в любое время на Whop: ${WHOP_MANAGE_TEXT} (выберите подписку, затем "${WHOP_CANCEL_LABEL}", интерфейс Whop на английском). Отмените до даты следующего продления, чтобы деньги не списались снова. Если нужна помощь, напишите на ${BILLING_SUPPORT_EMAIL}.`,
  neutral: `Тарифы «Месяц» и «3 месяца» продлеваются автоматически до отмены. Экзаменационная когорта оплачивается один раз.`,
  refund: `Возврат в течение ${REFUND_DAYS} дней: напишите на ${BILLING_SUPPORT_EMAIL}.`,
  whopEnglish: `Whop показывает английский интерфейс, вот как отменить: 1. Откройте ${WHOP_MANAGE_TEXT}. 2. Выберите подписку. 3. Нажмите "${WHOP_CANCEL_LABEL}".`,
};

const uk: Copy = {
  plans: `Тарифи «Місяць» (${MONTHLY} € на місяць) і «3 місяці» (${QUARTERLY} € за квартал) є підписками: вони продовжуються автоматично кожні 30 або 90 днів, і гроші списуються в дату кожного продовження, доки ви не скасуєте підписку. Екзаменаційна когорта (${COHORT} € на ${COHORT_MONTHS} місяців) оплачується один раз і не продовжується.`,
  trial: `Пробний період Pro починається з прив'язаною карткою: сьогодні 0 €, ${TRIAL_DAYS} днів Pro. Якщо ви не скасуєте підписку протягом пробного тижня, далі списуватиметься ${MONTHLY} € на місяць.`,
  cancel: `Скасувати підписку можна будь-коли на Whop: ${WHOP_MANAGE_TEXT} (оберіть підписку, потім "${WHOP_CANCEL_LABEL}", інтерфейс Whop англійською). Скасуйте до дати наступного продовження, щоб гроші не списалися знову. Якщо потрібна допомога, напишіть на ${BILLING_SUPPORT_EMAIL}.`,
  neutral: `Тарифи «Місяць» і «3 місяці» продовжуються автоматично до скасування. Екзаменаційна когорта оплачується один раз.`,
  refund: `Повернення коштів протягом ${REFUND_DAYS} днів: напишіть на ${BILLING_SUPPORT_EMAIL}.`,
  whopEnglish: `Whop показує англійський інтерфейс, ось як скасувати: 1. Відкрийте ${WHOP_MANAGE_TEXT}. 2. Оберіть підписку. 3. Натисніть "${WHOP_CANCEL_LABEL}".`,
};

const tr: Copy = {
  plans: `"Tek Ay" (ayda ${MONTHLY} €) ve "3 Ay" (çeyrek başına ${QUARTERLY} €) planları aboneliktir: her 30 veya 90 günde otomatik olarak yenilenir ve siz iptal edene kadar her yenileme tarihinde tahsil edilir. Sınav Kohortu (${COHORT_MONTHS} ay için ${COHORT} €) tek seferlik ödemedir ve yenilenmez.`,
  trial: `Pro denemesi kayıtlı bir kartla başlar: bugün 0 €, ${TRIAL_DAYS} gün Pro. Deneme haftasında iptal etmezseniz, sonrasında ayda ${MONTHLY} € tahsil edilir.`,
  cancel: `Aboneliği istediğiniz zaman Whop üzerinden iptal edebilirsiniz: ${WHOP_MANAGE_TEXT} (üyeliğinizi seçin, ardından "${WHOP_CANCEL_LABEL}", Whop arayüzü İngilizcedir). Tekrar tahsilat olmaması için bir sonraki yenileme tarihinden önce iptal edin. Yardıma ihtiyacınız olursa ${BILLING_SUPPORT_EMAIL} adresine yazın.`,
  neutral: `"Tek Ay" ve "3 Ay" planları iptal edilene kadar otomatik yenilenir. Sınav Kohortu tek seferlik ödemedir.`,
  refund: `${REFUND_DAYS} gün içinde iade: ${BILLING_SUPPORT_EMAIL} adresine yazın.`,
  whopEnglish: `Whop İngilizce gösterir, iptal şöyle yapılır: 1. ${WHOP_MANAGE_TEXT} adresini açın. 2. Üyeliğinizi seçin. 3. "${WHOP_CANCEL_LABEL}" düğmesine basın.`,
};

/** Arabic is intentionally empty until [name] signs it off. */
const ar: Copy = { plans: "", trial: "", cancel: "", neutral: "", refund: "", whopEnglish: "" };

export const BILLING_I18N: Record<BillingI18nLang, Copy> = { ru, uk, tr, ar };

export const BILLING_I18N_SIGNED_OFF: Record<BillingI18nLang, boolean> = {
  ru: false,
  uk: false,
  tr: false,
  ar: false,
};

export function billingPlansSummaryI18n(lang: BillingI18nLang): string {
  return BILLING_I18N[lang].plans;
}
export function billingTrialSummaryI18n(lang: BillingI18nLang): string {
  return BILLING_I18N[lang].trial;
}
export function billingCancelSummaryI18n(lang: BillingI18nLang): string {
  return BILLING_I18N[lang].cancel;
}
export function billingNeutralLineI18n(lang: BillingI18nLang): string {
  return BILLING_I18N[lang].neutral;
}
export function billingRefundSummaryI18n(lang: BillingI18nLang): string {
  return BILLING_I18N[lang].refund;
}
export function billingWhopEnglishNoteI18n(lang: BillingI18nLang): string {
  return BILLING_I18N[lang].whopEnglish;
}

/** Keys that are empty or absent for a language; [] means the minimum set is complete. */
export function missingBillingKeys(lang: BillingI18nLang): BillingKey[] {
  return BILLING_KEYS.filter((k) => !BILLING_I18N[lang][k] || BILLING_I18N[lang][k].trim() === "");
}
