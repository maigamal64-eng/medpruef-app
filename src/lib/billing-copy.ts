import { FREE_TIER, TIERS } from "./content-truth";
/**
 * Billing-truth copy: the ONE place that states which paid plans renew
 * and how to cancel. Used by /terms, /faq (visible + FAQ JSON-LD),
 * /pricing, /settings and the expiry reminder email, so the renewal claim
 * can never drift between surfaces again (audit MP-TRUTH-01/02/19).
 *
 * Facts (owner: MEDPRUF-SOT.md section 2, verified against the live Whop
 * plans 2026-10-02):
 *   - Monthly  plan_redacted8f2b848b : 19 EUR, renews every 30 days
 *   - Quarterly plan_redacted145e2752 : 49 EUR, renews every 90 days
 *   - Exam Cohort plan_redacted324decbc : 129 EUR, ONE-TIME, 6 months
 *   - Pro trial plan_redactedec56d4df : 7 days, 0 EUR today, then 19 EUR/month
 * Legacy one-time 19/49 plans exist for grandfathered buyers only.
 *
 * Customers manage and cancel at Whop (buyer side). No em dashes.
 */

export type BillingLang = "de" | "en";

/**
 * The Whop plans listed above that renew automatically (monthly, quarterly,
 * and the trial that converts to monthly). Data, not copy: read by
 * src/lib/billing-cadence.ts so the renewal banner and the reminder cron
 * never offer a second plan to someone whose plan already renews.
 * Any other plan id (the Exam Cohort, the legacy one-time 19/49 plans) is
 * treated as one-time.
 */
export const AUTO_RENEWING_WHOP_PLAN_IDS: ReadonlySet<string> = new Set([
  "plan_redacted8f2b848b", // Monthly, 19 EUR every 30 days
  "plan_redacted145e2752", // Quarterly, 49 EUR every 90 days
  "plan_redactedec56d4df", // Pro trial, then 19 EUR every 30 days
]);

/** Whop's buyer-side membership page (documented in Whop's own help docs). */
export const WHOP_MANAGE_URL = "https://whop.com/@me/settings/memberships";
/** Same address without scheme, for plain-text copy. */
export const WHOP_MANAGE_TEXT = "whop.com/@me/settings/memberships";
export const BILLING_SUPPORT_EMAIL = "user-b7e46e80@example.com";

/** Which plans renew, which do not. */
export function billingPlansSummary(lang: BillingLang): string {
  const monthly = billingAmount(TIERS.first_month_19.price_cents, lang);
  const quarter = billingAmount(TIERS.first_3mo_27.price_cents, lang);
  const cohort = billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang);
  return lang === "de"
    ? `Einzelmonat (${monthly} pro Monat) und 3-Monats-Tarif (${quarter} pro Quartal) sind Abos: Sie verlängern sich automatisch alle 30 bzw. 90 Tage und werden jeweils zum Verlängerungsdatum abgebucht, bis du kündigst. Die Prüfungs-Kohorte (${cohort} für 6 Monate) ist eine Einmalzahlung und verlängert sich nicht.`
    : `The Single Month (${monthly} per month) and 3-Month (${quarter} per quarter) plans are subscriptions: they renew automatically every 30 or 90 days and are charged on each renewal date until you cancel. The Exam Cohort (${cohort} for 6 months) is a one-time payment and does not renew.`;
}

/** The Pro trial conversion, stated plainly. */
export function billingTrialSummary(lang: BillingLang): string {
  const amount = billingAmount(TIERS.first_month_19.price_cents, lang);
  return lang === "de"
    ? `Der Pro-Test startet mit hinterlegter Karte: 0 € heute, 7 Tage Pro. Wenn du nicht innerhalb der Pro-Test kündigst, werden danach ${amount} pro Monat abgebucht.`
    : `The Pro trial starts with a card on file: 0 € today, 7 days of Pro. If you do not cancel during the Pro trial, ${amount} per month is charged afterwards.`;
}

/** How to cancel (plain text, safe for JSON-LD and emails). */
export function billingCancelSummary(lang: BillingLang): string {
  return lang === "de"
    ? `Verwalte deine Mitgliedschaft bei Whop unter ${WHOP_MANAGE_TEXT} (Mitgliedschaft auswählen, dann „Cancel membership“, die Whop-Oberfläche ist auf Englisch). Kündige vor dem nächsten Verlängerungsdatum, damit nicht erneut abgebucht wird. Wenn du Hilfe brauchst, schreib an ${BILLING_SUPPORT_EMAIL}.`
    : `You can manage your membership at Whop via ${WHOP_MANAGE_TEXT} (select your membership, then "Cancel membership"). Cancel before the next renewal date so you are not charged again. If you need help, email ${BILLING_SUPPORT_EMAIL}.`;
}

/** Short neutral line for places that cannot tell which plan the user is on. */
export function billingNeutralLine(lang: BillingLang): string {
  return lang === "de"
    ? "Einzelmonat und 3-Monats-Tarif verlängern sich automatisch bis zur Kündigung. Die Prüfungs-Kohorte ist eine Einmalzahlung."
    : "The Single Month and 3-Month plans renew automatically until you cancel. The Exam Cohort is a one-time payment.";
}

/** Default OFF until an end-to-end buyer cancellation receipt is recorded. */
export const VERIFIED_CANCEL_PATH = false;
export function billingAmount(cents: number, lang: BillingLang): string {
  return `${new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(cents / 100)} €`;
}
export function billingTrialLine(lang: BillingLang, data: { priceAfterCents: number; trialDays: number; chargeAt?: string | null }): string {
  if (!Number.isInteger(data.priceAfterCents) || data.priceAfterCents < 0 || !Number.isInteger(data.trialDays) || data.trialDays <= 0) {
    return lang === 'de' ? 'Testbedingungen ansehen.' : 'View trial terms.';
  }
  const amount = billingAmount(data.priceAfterCents, lang);
  const chargeTime = data.chargeAt ? Date.parse(data.chargeAt) : NaN;
  const date = Number.isFinite(chargeTime) ? new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date(chargeTime)) : null;
  const cancel = VERIFIED_CANCEL_PATH
    ? lang === 'de' ? ', wenn du nicht vorher bei Whop kündigst' : ', unless you cancel at Whop beforehand'
    : '';
  return lang === 'de'
    ? `Pro ${data.trialDays} Tage testen: Karte nötig, heute 0 €. ${date ? `Am ${date}` : 'Nach der Pro-Test'} werden ${amount} abgebucht, danach pro Monat${cancel}.`
    : `Try Pro for ${data.trialDays} days: card required, 0 € today. ${date ? `On ${date}` : 'After the trial'} ${amount} is charged, then per month${cancel}.`;
}
export function billingPlanLine(lang: BillingLang, data: { amountCents: number; cadenceDays?: number; accessMonths?: number }): string {
  const amount = billingAmount(data.amountCents, lang);
  return data.cadenceDays
    ? lang === 'de' ? `Heute ${amount}, dann alle ${data.cadenceDays} Tage ${amount}.` : `${amount} today, then ${amount} every ${data.cadenceDays} days.`
    : lang === 'de' ? `Einmalzahlung: ${amount}, ${data.accessMonths} Monate Zugang, keine Verlängerung.` : `One-time payment: ${amount}, ${data.accessMonths} months of access, no renewal.`;
}
export type PaymentState = 'pending' | 'unmatched' | 'failed' | 'granted';
export function paymentStatusText(state: PaymentState, lang: BillingLang): string {
  const copy = {
    pending: { de: 'Zahlung wird geprüft, Zugang noch nicht aktiv.', en: 'Payment is being checked. Access is not active yet.' },
    unmatched: { de: 'Zahlung konnte deinem Konto noch nicht zugeordnet werden.', en: 'Payment could not yet be linked to your account.' },
    failed: { de: 'Zahlung oder Zugang konnte nicht geprüft werden.', en: 'Payment or access could not be checked.' },
    granted: { de: 'Dein Pro-Zugang ist aktiv.', en: 'Your Pro access is active.' },
  };
  return copy[state][lang];
}

/** Existing reviewed money sentences, collected here so surfaces cannot own prices. */
const SURFACE_COPY = {
  "referrals_page_tsx_0": "Teile deinen Link. Sobald beide den kostenlosen Pro-Test starten (Karte hinterlegt, {zero} heute, danach {monthly} pro Monat) und wirklich aktiv üben, bekommst du MedPrüf Pro kostenlos durch dein Prüfungsfenster. Für dich als Empfehlenden komplett kostenlos.",
  "referrals_page_tsx_1": "Share your link. Once both start the free Pro trial (card on file, {zero} today, then {monthly} per month) and are actively practising, you get MedPrüf Pro free through your exam window. Completely free for you as the referrer.",
  "referrals_page_tsx_2": "Ein Kollege oder eine Kollegin zählt, sobald sie sich mit deinem Link anmelden, den kostenlosen Pro-Test starten (Karte hinterlegt, {zero} heute, Mitgliedschaft bei Whop verwalten, danach {monthly} pro Monat) und mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantworten.",
  "referrals_page_tsx_3": "A colleague counts once they sign up with your link, start the free Pro trial (card on file, {zero} today, manage the membership at Whop, then {monthly} per month), and answer at least 20 different questions across at least 2 different days.",
  "referrals_page_tsx_4": "Jede Person hinterlegt eine Karte und startet den Pro-Test: {zero} heute, Mitgliedschaft bei Whop verwalten, danach {monthly} pro Monat. Das ist der Trial deines Kollegen oder deiner Kollegin, dir wird nichts berechnet.",
  "referrals_page_tsx_5": "Each person links a card and starts the Pro trial: {zero} today, manage the membership at Whop, then {monthly} per month. This is your colleague's trial, you are never charged.",
  "pharmakologie_pruefung_wien_page_tsx_0": "{cohort}",
  "pharmakologie_pruefung_wien_page_tsx_1": "Pharma-Prüfungstermine hängen von deiner Medizinischen Universität und deinem Studienplan ab. Prüfe deinen Nostrifikationsbescheid oder frage deine Universität nach dem nächsten Termin. MedPrüf zeigt keinen allgemeinen jährlichen Pharma-Termin an. Die Prüfungs-Kohorte kostet {cohort} für sechs Monate.",
  "pharmakologie_pruefung_wien_page_tsx_2": "Pharma exam dates depend on your Medical University and study plan. Check your nostrification decision or ask your university for the next date. MedPrüf does not show one general annual Pharma date. The Exam Cohort costs {cohort} for six months.",
  "pharmakologie_pruefung_wien_page_tsx_3": "Die Prüfungs-Kohorte bietet sechs Monate Zugang für {cohort}. Bestehst du nicht, verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin (max. 2 zusätzliche Zyklen), vorausgesetzt, du hast mindestens 70% der Fragenbank bearbeitet und lädst dein offizielles Prüfungsergebnis hoch. Ein Admin verifiziert manuell innerhalb von 72 Stunden. Die separate 7-Tage-Rückerstattung nach einem Kauf bleibt davon unberührt. Nach Ablauf dieser Frist sieht die Pass-Until-You-Pass-Garantie eine Zugangsverlängerung statt einer Rückerstattung vor.",
  "pharmakologie_pruefung_wien_page_tsx_4": "The Exam Cohort provides six months of access for {cohort}. If you fail, we extend your access free through the next exam date (max 2 additional cycles), provided you completed at least 70% of the question bank and upload your official exam result. An admin verifies manually within 72 hours. The separate 7-day purchase-refund window still applies. After that window, the Pass-Until-You-Pass guarantee provides an access extension rather than a refund.",
  "pharmakologie_pruefung_wien_layout_tsx_0": "Free tier: 150 questions. Exam Cohort: {cohort} one-time for six months. See /pricing for current plans.",
  "faq_layout_tsx_0": "Die Pass-Until-You-Pass-Garantie (PUYP) gilt für die Prüfungs-Kohorte ({cohort}). Statt einer Cash-Rückerstattung verlängern wir deinen Zugang kostenlos bis zum nächsten Prüfungstermin, wenn du durchfällst: Du lädst dein offizielles Prüfungsergebnis hoch, musst mindestens 70 % der relevanten Fragenbank bearbeitet haben, ein Admin verifiziert innerhalb von 72 Stunden, und bei Bestätigung verlängert sich dein Abo automatisch, maximal zwei zusätzliche Zyklen pro Nutzer:in.",
  "faq_layout_tsx_1": "Jede:r Nutzer:in bekommt einen persönlichen Empfehlungscode. Lad zwei Kolleginnen oder Kollegen ein, die wirklich mit dir für deine Prüfung lernen, und sobald beide qualifiziert sind, bekommst du MedPrüf Pro kostenlos durch das Prüfungsfenster. Eine Empfehlung qualifiziert sich erst, wenn diese Person den kostenlosen Pro-Test startet (Karte hinterlegt, {zero} heute, Kündigung während des Pro-Tests über Kontakt, danach {monthly} pro Monat) und mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantwortet. Die Belohnung ist Pro-Zugang, keine Geldzahlung.",
  "quiz_page_tsx_0": "Teile deinen Empfehlungscode: wenn zwei Kolleg:innen den Pro-Test starten ({zero} heute, danach {monthly} pro Monat) und aktiv üben, bekommst du Pro kostenlos durchs Prüfungsfenster.",
  "quiz_page_tsx_1": "Share your referral code: once two colleagues start the Pro trial ({zero} today, then {monthly} per month) and are actively practising, you get Pro free through the exam window.",
  "surface_0": "Klinisches Wissen üben mit den Fragenbanken Kenntnisprüfung Wien, Stichprobentest und Pharmakologie. MedPrüf bietet über 10.000 kuratierte Übungsfragen. Die Wiener Bank enthält SIP4a/SIP5a-basierte Multiple-Choice-Übungen, keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin. MedPrüf gibt es ab {monthly} pro Monat.",
  "surface_1": "Practise clinical knowledge with the Kenntnisprüfung Vienna, Stichprobentest and Pharmakologie question banks. MedPrüf offers over 10,000 curated practice questions. The Vienna bank contains SIP4a/SIP5a-based multiple-choice exercises, not a simulation of the postgraduate ÖÄK general medicine exam. Plans start at {monthly} per month.",
  "surface_2": "Einzelmonat · {monthly} pro Monat",
  "surface_3": "Single month · {monthly} per month",
  "surface_4": "Vollzugang · verlängert sich monatlich",
  "surface_5": "Full access · renews monthly",
  "surface_6": "Karte, {zero} heute, dann {monthly} pro Monat",
  "surface_7": "Card, {zero} today, then {monthly} per month",
  "surface_8": "{zero}",
  "surface_9": "{cohort}",
  "surface_10": "{zero}",
  "surface_11": "Karte hinterlegen, {zero} heute, dann {monthly} pro Monat. Verwalte deine Mitgliedschaft bei Whop.",
  "surface_12": "Add a card, {zero} today, then {monthly} per month. Manage your membership at Whop.",
  "surface_14": "Klinisches Wissen üben. MedPrüf ab {monthly} pro Monat.",
  "surface_15": "Practise clinical knowledge. MedPrüf from {monthly} per month.",
  "surface_16": "6 Monate Vollzugang, {cohort}, zahlbar mit Karte. Inklusive Pass-Until-You-Pass-Garantie.",
  "surface_17": "6 months of full access, {cohort}, payable by card. Pass-Until-You-Pass guarantee included.",
  "surface_18": "3-Monats-Einstieg · {quarterMonthly} pro Monat",
  "surface_19": "3-Month Starter · {quarterMonthly} per month",
  "surface_20": "Einzelmonat · {monthly} pro Monat",
  "surface_21": "Single month · {monthly} per month",
  "surface_22": "Nur freigeschaltete Konten können teilnehmen. Teile deinen Empfehlungslink: Sobald zwei Kolleg:innen den Pro-Test mit Karte starten ({zero} heute, danach {monthly} pro Monat, sofern nicht während der Pro-Test gekündigt) und die Aktivitätsbedingungen erfüllen, kannst du Pro bis zu deinem nächsten Prüfungsfenster erhalten.",
  "surface_23": "Only enabled accounts can participate. Share your referral link: once two colleagues start the card-based Pro trial ({zero} today, then {monthly} per month unless cancelled during the Pro trial) and meet the activity requirements, you can receive Pro through your next exam window.",
  "surface_24": "Up to two additional cycles, up to 18 months of access from one {cohort} payment.",
  "surface_25": "PUYP gilt für die Prüfungs-Kohorte ({cohort}). Der 3-Monats-Einstieg ({quarter}) und der Einzelmonat ({monthly}) enthalten die Garantie nicht.",
  "surface_26": "PUYP applies to the Exam Cohort ({cohort}). The 3-month starter ({quarter}) and the single-month tier ({monthly}) don't include the guarantee.",
  "surface_27": "Verfügbar sind der Einzelmonat ({monthly} pro Monat), der 3-Monats-Tarif ({quarter} pro Quartal), die Prüfungs-Kohorte ({cohort} einmalig für 6 Monate) und der kostenlose Tarif. ",
  "surface_28": "Available are the Single Month ({monthly} per month), the 3-Month plan ({quarter} per quarter), the Exam Cohort ({cohort} once for 6 months), and the free tier. ",
  "surface_29": "Eine Empfehlung qualifiziert sich erst, wenn diese Person den kostenlosen Pro-Test startet: Karte hinterlegt, {zero} heute, danach {monthly} pro Monat.",
  "surface_30": "A referral only qualifies once that person starts the free Pro trial: card on file, {zero} today, then {monthly} per month.",
  "surface_31": "Die kostenlose Version umfasst bis zu 150 Fragen pro Prüfungstyp. Der Einzelmonat kostet {monthly} pro Monat und verlängert sich automatisch alle 30 Tage. Der 3-Monats-Tarif kostet {quarter} pro Quartal und verlängert sich automatisch alle 90 Tage. Beide Abos werden zum jeweiligen Verlängerungsdatum über Whop abgebucht, bis du kündigst. Die Prüfungs-Kohorte kostet einmalig {cohort} für sechs Monate und verlängert sich nicht automatisch. Der 3-Monats-Tarif ist auf einen Kauf pro Konto begrenzt.",
  "surface_32": "The free version includes up to 150 questions per exam type. The Single Month plan costs {monthly} per month and renews automatically every 30 days. The 3-Month plan costs {quarter} per quarter and renews automatically every 90 days. Both subscriptions are charged through Whop on each renewal date until you cancel. The Exam Cohort costs {cohort} once for six months and does not renew automatically. The 3-Month plan is capped at one purchase per account.",
  "surface_33": "Pass-Until-You-Pass: Auf der Prüfungs-Kohorte ({cohort}) verlängern wir deinen Zugang kostenlos, wenn du nach mindestens 70 % bearbeiteter Fragenbank durchfällst und einen offiziellen Bescheid einreichst (max. zwei Verlängerungen). Details: /faq.",
  "surface_34": "Pass-Until-You-Pass: On the Exam Cohort ({cohort}), we extend your access free if you fail after working through at least 70 % of the question bank and submit an official result (max. two extensions). Details at /faq.",
  "surface_35": "Lad zwei Kolleg:innen ein: Pro-Test starten ({zero} heute, danach {monthly} pro Monat, in der Pro-Test bei Whop verwaltbar) und wirklich lernen, dann bekommst du Pro kostenlos durchs Prüfungsfenster.",
  "surface_36": "Invite two colleagues: start the Pro trial ({zero} today, then {monthly} per month, manage cancellation at Whop during the Pro trial) and really study, then you get Pro free through the exam window.",
  "surface_37": "Teile ihn mit zwei Kolleg:innen: sobald beide den Pro-Test starten ({zero} heute, danach {monthly} pro Monat) und aktiv üben, bekommst du Pro kostenlos durchs Prüfungsfenster.",
  "surface_38": "Share it with two colleagues: once both start the Pro trial ({zero} today, then {monthly} per month) and are actively practising, you get Pro free through the exam window."
} as const;
export function billingSurfaceText(key: keyof typeof SURFACE_COPY, lang: BillingLang): string {
  const values: Record<string, string> = { monthly: billingAmount(TIERS.first_month_19.price_cents, lang), quarter: billingAmount(TIERS.first_3mo_27.price_cents, lang), cohort: billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang), zero: billingAmount(0, lang), quarterMonthly: billingAmount(Math.round(TIERS.first_3mo_27.price_cents / TIERS.first_3mo_27.duration_months), lang) };
  return SURFACE_COPY[key].replace(/\{(monthly|quarter|cohort|zero|quarterMonthly)\}/g, (_, name: string) => values[name]);
}

export function billingReferralShare(lang: BillingLang, link: string): string {
  const trial = billingTrialSummary(lang);
  return lang === 'de'
    ? `Lad zwei Kolleg:innen ein: Pro-Test mit Karte und aktive Teilnahme sind erforderlich. ${trial} Wenn beide die Aktivitätsbedingungen erfüllen, kannst du Pro bis zu deinem Prüfungsfenster erhalten: ${link}`
    : `Invite two colleagues: a card-based Pro trial and active study are required. ${trial} Once both meet the activity requirements, you can receive Pro through your exam window: ${link}`;
}
export function billingAuthContext(lang: BillingLang, intent: 'free' | 'trial', terms?: { trialDays: number; priceAfterCents: number }): string {
  return intent === 'free'
    ? lang === 'de' ? `Kostenlos, ohne Karte: ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank. Dein Konto speichert deinen Fortschritt.` : `Free, no card: ${FREE_TIER.questions_per_exam_type} questions per bank. Your account saves your progress.`
    : terms ? billingTrialLine(lang, terms) : lang === 'de' ? 'Pro-Test: Karte nötig. Die aktuellen Kosten und Termine siehst du vor dem Start auf der Preisseite.' : 'Pro trial: card required. Review current charges and dates on the pricing page before starting.';
}

export function billingFreeOffer(lang: BillingLang, amountCents: number = TIERS.first_month_19.price_cents): string {
  const amount = billingAmount(amountCents, lang);
  return lang === 'de'
    ? `${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank mit Erklärungen, wo vorhanden, ohne Karte. Danach sind neue Fragen gesperrt. Pro ab ${amount} pro Monat.`
    : `${FREE_TIER.questions_per_exam_type} questions per bank with explanations where available, no card. New questions are locked after the limit. Pro from ${amount} per month.`;
}

export function billingTrialRibbonLine(lang: BillingLang, data: { trialDays: number; priceAfterCents: number }): string {
  const amount = billingAmount(data.priceAfterCents, lang);
  return lang === 'de'
    ? `Pro ${data.trialDays} Tage testen: Karte nötig, danach ${amount} pro Monat.`
    : `Try Pro for ${data.trialDays} days: card required, then ${amount} per month.`;
}

/** Personal billing sentences use provider renewal fields independently of access expiry. */
export function billingAccountSentence(sub: import('./subscription-display').SubscriptionCardSnapshot, lang: BillingLang): string {
  const de = lang === 'de';
  const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(de ? 'de-DE' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date(value)) : null;
  const accessEnd = date(sub.expires_at);
  if (sub.status === 'refunded' && sub.revocation_reason === 'unknown') return de ? 'Zahlung rückgängig gemacht. Pro-Zugang aus dieser Zahlung ist beendet.' : 'Payment reversed. Pro access from this payment has ended.';
  if (sub.status === 'refunded') return de ? 'Zahlung erstattet. Pro-Zugang aus dieser Zahlung ist beendet.' : 'Payment refunded. Pro access from this payment has ended.';
  if (['chargeback', 'disputed'].includes(sub.status)) return de ? 'Zahlung zurückgebucht. Pro-Zugang aus dieser Zahlung ist beendet.' : 'Payment charged back. Pro access from this payment has ended.';
  if (sub.status === 'past_due' || sub.provider_status === 'past_due') return de ? 'Zahlung überfällig. Bitte prüfe deine Abrechnung bei Whop.' : 'Payment overdue. Please check your billing at Whop.';
  if (sub.cancel_at_period_end || ['cancelled', 'canceled', 'canceling'].includes(sub.provider_status ?? sub.status)) {
    return sub.access_active && accessEnd
      ? de ? `Gekündigt. Pro bleibt bis ${accessEnd} aktiv.` : `Canceled. Pro remains active through ${accessEnd}.`
      : de ? 'Gekündigt. Pro-Zugang aus diesem Tarif ist beendet.' : 'Canceled. Pro access from this plan has ended.';
  }
  if (!sub.access_active || sub.status === 'expired') return de ? 'Pro-Zugang aus diesem Tarif ist abgelaufen.' : 'Pro access from this plan has expired.';
  if (sub.billing_cadence === 'one_time') return accessEnd
    ? de ? `Einmalzahlung. Dein Zugang endet am ${accessEnd} und verlängert sich nicht.` : `One-time payment. Your access ends on ${accessEnd} and does not renew.`
    : de ? 'Einmalzahlung. Dein Zugang verlängert sich nicht automatisch.' : 'One-time payment. Your access does not renew automatically.';
  const chargeDate = date(sub.next_charge_at);
  const amount = sub.next_charge_amount_cents;
  if (sub.provider_state_verified && sub.billing_cadence === 'auto_renews' && chargeDate && sub.next_charge_at && Date.parse(sub.next_charge_at) > Date.now() && amount != null && Number.isInteger(amount) && amount >= 0 && sub.billing_interval_days) {
    const money = billingAmount(amount, lang);
    const cadence = sub.billing_interval_days === 30 ? (de ? 'pro Monat' : 'per month') : (de ? `alle ${sub.billing_interval_days} Tage` : `every ${sub.billing_interval_days} days`);
    return sub.is_trial
      ? de ? `Pro-Test bis ${chargeDate}, danach ${money} ${cadence}.` : `Pro trial through ${chargeDate}, then ${money} ${cadence}.`
      : de ? `Verlängert sich am ${chargeDate} mit ${money}, danach ${cadence}.` : `Renews on ${chargeDate} at ${money}, then ${cadence}.`;
  }
  return de ? 'Wir zeigen dir die Details, sobald sie vorliegen. Deine Abrechnung siehst du bei Whop.' : 'We will show details once they are available. You can see your billing at Whop.';
}

export function billingPrechargeReminder(date: string, cents: number, lang: BillingLang): { subject: string; sentence: string; steps: string } {
  const amount = billingAmount(cents, lang);
  return lang === 'de' ? {
    subject: `Dein Pro-Test endet am ${date}`,
    sentence: `Am ${date} werden ${amount} abgebucht, danach pro Monat. Wenn du nicht weitermachen willst, kündige vorher.`,
    steps: 'Logg dich bei Whop mit derselben E-Mail ein, wähle deine Mitgliedschaft und dann „Cancel membership“. Die Whop-Seite ist auf Englisch.',
  } : {
    subject: `Your Pro trial ends on ${date}`,
    sentence: `On ${date}, ${amount} is charged, then per month. If you do not want to continue, cancel beforehand.`,
    steps: 'Log in to Whop with the same email, select your membership, then "Cancel membership".',
  };
}
