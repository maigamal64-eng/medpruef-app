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

/** Public support promise ([name] 2026-10-11): replies in 1 to 2 working days. */
export const SUPPORT_REPLY_PROMISE = {
  de: "Wir antworten in der Regel innerhalb von 1 bis 2 Werktagen.",
  en: "We usually reply within 1 to 2 working days.",
} as const;

/** Which plans renew, which do not. */
export function billingPlansSummary(lang: BillingLang): string {
  const monthly = billingAmount(TIERS.first_month_19.price_cents, lang);
  const quarter = billingAmount(TIERS.first_3mo_27.price_cents, lang);
  const cohort = billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang);
  return lang === "de"
    ? `Einzelmonat (${monthly} pro Monat) und 3-Monats-Tarif (${quarter} pro Quartal) sind Abos: Sie verlängern sich automatisch alle 30 bzw. 90 Tage und werden jeweils zum Verlängerungsdatum abgebucht, bis Sie kündigen. Die Prüfungs-Kohorte (${cohort} für 6 Monate) ist eine Einmalzahlung und verlängert sich nicht.`
    : `The Single Month (${monthly} per month) and 3-Month (${quarter} per quarter) plans are subscriptions: they renew automatically every 30 or 90 days and are charged on each renewal date until you cancel. The Exam Cohort (${cohort} for 6 months) is a one-time payment and does not renew.`;
}

/** The Pro trial conversion, stated plainly. */
export function billingTrialSummary(lang: BillingLang): string {
  const amount = billingAmount(TIERS.first_month_19.price_cents, lang);
  return lang === "de"
    ? `Der Pro-Test startet mit hinterlegter Karte: 0 € heute, 7 Tage Pro. Wenn Sie nicht während des Pro-Tests kündigen, werden danach ${amount} pro Monat abgebucht.`
    : `The Pro trial starts with a card on file: 0 € today, 7 days of Pro. If you do not cancel during the Pro trial, ${amount} per month is charged afterwards.`;
}

/** How to cancel (plain text, safe for JSON-LD and emails). */
export function billingCancelSummary(lang: BillingLang): string {
  return lang === "de"
    ? `Verwalten Sie Ihre Mitgliedschaft bei Whop unter ${WHOP_MANAGE_TEXT} (Mitgliedschaft auswählen, dann „Cancel membership“; die Whop-Seite ist auf Englisch). Kündigen Sie vor dem nächsten Verlängerungsdatum, damit nicht erneut abgebucht wird. Wenn Sie Hilfe brauchen, schreiben Sie an ${BILLING_SUPPORT_EMAIL}.`
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
  // The charge condition is a term of the plan (SoT section 2: every trial
  // line states the card, the auto-charge and cancelling before it), not a
  // promise about the self-serve path, so it is never hidden.
  // VERIFIED_CANCEL_PATH only gates "So kündigen Sie" links.
  const zero = billingAmount(0, lang);
  return lang === 'de'
    ? `Pro ${data.trialDays} Tage testen: Karte nötig, heute ${zero}. ${date ? `Am ${date}` : 'Nach dem Pro-Test'} werden ${amount} abgebucht, danach monatlich, wenn Sie nicht vorher kündigen.`
    : `Try Pro for ${data.trialDays} days: card required, ${zero} today. ${date ? `On ${date}` : 'After the trial'} ${amount} is charged, then monthly, unless you cancel before.`;
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
    unmatched: { de: 'Die Zahlung konnte Ihrem Konto noch nicht zugeordnet werden.', en: 'Payment could not yet be linked to your account.' },
    failed: { de: 'Zahlung oder Zugang konnte nicht geprüft werden.', en: 'Payment or access could not be checked.' },
    granted: { de: 'Ihr Pro-Zugang ist aktiv.', en: 'Your Pro access is active.' },
  };
  return copy[state][lang];
}

/** Existing reviewed money sentences, collected here so surfaces cannot own prices. */
const SURFACE_COPY = {
  "referrals_page_tsx_0": "Teilen Sie Ihren Link. Sobald zwei Kolleginnen und Kollegen den Pro-Test starten (Karte hinterlegt, {zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt) und aktiv üben, erhalten Sie MedPrüf Pro bis zum Ende Ihres Prüfungsfensters. Wir bestätigen das persönlich.",
  "referrals_page_tsx_1": "Share your link. Once two colleagues start the Pro trial (card on file, {zero} today, then {monthly} per month unless cancelled before) and are actively practising, you receive MedPrüf Pro until the end of your exam window. We confirm this personally.",
  "referrals_page_tsx_2": "Eine Kollegin oder ein Kollege zählt, sobald sie sich über Ihren Link anmelden, den Pro-Test starten (Karte hinterlegt, {zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt) und mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantworten.",
  "referrals_page_tsx_3": "A colleague counts once they sign up through your link, start the Pro trial (card on file, {zero} today, then {monthly} per month unless cancelled before) and answer at least 20 different questions on at least 2 different days.",
  "referrals_page_tsx_4": "Jede Person hinterlegt eine Karte und startet den Pro-Test: {zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt. Das ist der Pro-Test Ihrer Kollegin oder Ihres Kollegen; Ihnen wird nichts berechnet.",
  "referrals_page_tsx_5": "Each person links a card and starts the Pro trial: {zero} today, then {monthly} per month unless cancelled before. This is your colleague's trial; you are never charged.",
  "pharmakologie_pruefung_wien_page_tsx_0": "{cohort}",
  "pharmakologie_pruefung_wien_page_tsx_1": "Pharma-Prüfungstermine hängen von Ihrer Medizinischen Universität und Ihrem Studienplan ab. Prüfen Sie Ihren Nostrifikationsbescheid oder fragen Sie Ihre Universität nach dem nächsten Termin. MedPrüf zeigt keinen allgemeinen jährlichen Pharma-Termin an. Die Prüfungs-Kohorte kostet {cohort} für sechs Monate.",
  "pharmakologie_pruefung_wien_page_tsx_2": "Pharma exam dates depend on your Medical University and study plan. Check your nostrification decision or ask your university for the next date. MedPrüf does not show one general annual Pharma date. The Exam Cohort costs {cohort} for six months.",
  "pharmakologie_pruefung_wien_page_tsx_3": "Die Prüfungs-Kohorte bietet sechs Monate Zugang für {cohort}. Wenn Sie nach mindestens 70 % bearbeiteter Fragenbank nicht bestehen und Ihr offizielles Prüfungsergebnis hochladen, verlängern wir Ihren Zugang kostenlos bis zum nächsten offiziellen Termin mit offener Anmeldung plus 14 Tage, höchstens zweimal. Das ist eine Zugangsverlängerung, keine Geldrückerstattung. Die Rückerstattung innerhalb von 7 Tagen nach dem Kauf bleibt davon unberührt.",
  "pharmakologie_pruefung_wien_page_tsx_4": "The Exam Cohort provides six months of access for {cohort}. If you do not pass after working through at least 70 % of the question bank and upload your official exam result, we extend your access free until the next official sitting with open registration plus 14 days, at most twice. This is an access extension, not a cash refund. The refund within 7 days of purchase is not affected.",
  "pharmakologie_pruefung_wien_layout_tsx_0": "Free tier: 150 questions. Exam Cohort: {cohort} one-time for six months. See /pricing for current plans.",
  "faq_layout_tsx_0": "Die Pass-Until-You-Pass-Garantie gilt nur für die Prüfungs-Kohorte ({cohort}). Wenn Sie nach mindestens 70 % bearbeiteter Fragenbank nicht bestehen, laden Sie Ihr offizielles Prüfungsergebnis hoch. Wir prüfen den Nachweis in der Regel innerhalb weniger Werktage und verlängern Ihren Zugang kostenlos bis zum nächsten offiziellen Termin mit offener Anmeldung plus 14 Tage, höchstens zweimal. Das ist eine Zugangsverlängerung, keine Geldrückerstattung.",
  "faq_layout_tsx_1": "Jede Person mit freigeschaltetem Empfehlungsprogramm erhält einen persönlichen Link. Sie erhalten Pro bis zum Ende Ihres Prüfungsfensters, sobald zwei Kolleginnen und Kollegen über Ihren Link den Pro-Test starten (Karte hinterlegt, {zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt), ihn aktiv halten und jeweils mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantworten. Wir bestätigen das persönlich. Die Belohnung ist Pro-Zugang, keine Geldzahlung.",
  "quiz_page_tsx_0": "Teilen Sie Ihren Empfehlungslink: Wenn zwei Kolleginnen und Kollegen den Pro-Test starten ({zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt) und aktiv üben, erhalten Sie Pro bis zum Ende Ihres Prüfungsfensters.",
  "quiz_page_tsx_1": "Share your referral link: once two colleagues start the Pro trial ({zero} today, then {monthly} per month unless cancelled before) and are actively practising, you receive Pro until the end of your exam window.",
  "surface_0": "Klinisches Wissen üben mit den Fragenbanken Kenntnisprüfung Wien, Stichprobentest und Pharmakologie. MedPrüf bietet über 10.000 kuratierte Übungsfragen. Die Wiener Bank enthält SIP4a/SIP5a-basierte Multiple-Choice-Übungen, keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin. MedPrüf gibt es ab {monthly} pro Monat.",
  "surface_1": "Practise clinical knowledge with the Kenntnisprüfung Vienna, Stichprobentest and Pharmakologie question banks. MedPrüf offers over 10,000 curated practice questions. The Vienna bank contains SIP4a/SIP5a-based multiple-choice exercises, not a simulation of the postgraduate ÖÄK general medicine exam. Plans start at {monthly} per month.",
  "surface_2": "Monatsabo · {monthly} pro Monat",
  "surface_3": "Monthly · {monthly} per month",
  "surface_4": "Vollzugang · verlängert sich monatlich",
  "surface_5": "Full access · renews monthly",
  "surface_6": "Karte, {zero} heute, dann {monthly} pro Monat, wenn nicht vorher gekündigt",
  "surface_7": "Card, {zero} today, then {monthly} per month unless cancelled before",
  "surface_8": "{zero}",
  "surface_9": "{cohort}",
  "surface_10": "{zero}",
  "surface_11": "Karte hinterlegen, {zero} heute, dann {monthly} pro Monat, wenn Sie nicht vorher kündigen. Die Mitgliedschaft verwalten Sie bei Whop.",
  "surface_12": "Add a card, {zero} today, then {monthly} per month unless you cancel before. You manage the membership at Whop.",
  "surface_14": "Klinisches Wissen üben. MedPrüf ab {monthly} pro Monat.",
  "surface_15": "Practise clinical knowledge. MedPrüf from {monthly} per month.",
  "surface_16": "6 Monate Vollzugang, {cohort} einmalig, zahlbar mit Karte. Mit Pass-Until-You-Pass-Garantie.",
  "surface_17": "6 months of full access, {cohort} once, payable by card. With the Pass-Until-You-Pass guarantee.",
  "surface_18": "3 Monate · {quarter}",
  "surface_19": "3 months · {quarter}",
  "surface_20": "Monatsabo · {monthly} pro Monat",
  "surface_21": "Monthly · {monthly} per month",
  "surface_22": "Nur für freigeschaltete Konten. Sie erhalten Pro bis zum Ende Ihres Prüfungsfensters, sobald zwei Kolleginnen und Kollegen über Ihren Link den Pro-Test starten (Karte nötig, {zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt) und aktiv üben. Wir bestätigen das persönlich.",
  "surface_23": "Enabled accounts only. You receive Pro until the end of your exam window once two colleagues start the Pro trial through your link (card required, {zero} today, then {monthly} per month unless cancelled before) and practise actively. We confirm this personally.",
  "surface_24": "At most two extensions, each until the next official sitting of your exam with open registration plus 14 days.",
  "surface_25": "Die Pass-Until-You-Pass-Garantie gilt nur für die Prüfungs-Kohorte ({cohort}). Der 3-Monats-Tarif ({quarter}) und das Monatsabo ({monthly}) enthalten die Garantie nicht.",
  "surface_26": "The Pass-Until-You-Pass guarantee applies to the Exam Cohort ({cohort}) only. The 3-month plan ({quarter}) and the monthly plan ({monthly}) do not include it.",
  "surface_27": "Verfügbar sind das Monatsabo ({monthly} pro Monat), der 3-Monats-Tarif ({quarter} pro Quartal), die Prüfungs-Kohorte ({cohort} einmalig für 6 Monate) und der kostenlose Tarif. ",
  "surface_28": "Available are the monthly plan ({monthly} per month), the 3-month plan ({quarter} per quarter), the Exam Cohort ({cohort} once for 6 months), and the free tier. ",
  "surface_29": "Eine Empfehlung zählt erst, wenn diese Person den Pro-Test startet: Karte hinterlegt, {zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt.",
  "surface_30": "A referral only counts once that person starts the Pro trial: card on file, {zero} today, then {monthly} per month unless cancelled before.",
  "surface_31": "Die kostenlose Version umfasst bis zu 150 Fragen pro Fragenbank. Das Monatsabo kostet {monthly} pro Monat und verlängert sich automatisch alle 30 Tage. Der 3-Monats-Tarif kostet {quarter} pro Quartal und verlängert sich automatisch alle 90 Tage. Beide Abos werden zum jeweiligen Verlängerungsdatum über Whop abgebucht, bis Sie kündigen. Die Prüfungs-Kohorte kostet einmalig {cohort} für sechs Monate und verlängert sich nicht automatisch.",
  "surface_32": "The free version includes up to 150 questions per question bank. The monthly plan costs {monthly} per month and renews automatically every 30 days. The 3-month plan costs {quarter} per quarter and renews automatically every 90 days. Both subscriptions are charged through Whop on each renewal date until you cancel. The Exam Cohort costs {cohort} once for six months and does not renew automatically.",
  "surface_33": "Pass-Until-You-Pass: Für die Prüfungs-Kohorte ({cohort}) verlängern wir Ihren Zugang kostenlos bis zum nächsten offiziellen Termin mit offener Anmeldung plus 14 Tage, wenn Sie nach mindestens 70 % bearbeiteter Fragenbank nicht bestehen und Ihr offizielles Ergebnis hochladen, höchstens zweimal. Details: /faq.",
  "surface_34": "Pass-Until-You-Pass: for the Exam Cohort ({cohort}) we extend your access free until the next official sitting with open registration plus 14 days if you do not pass after working through at least 70 % of the question bank and upload your official result, at most twice. Details at /faq.",
  "surface_35": "Laden Sie zwei Kolleginnen und Kollegen ein: Wenn beide den Pro-Test starten ({zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt) und aktiv üben, erhalten Sie Pro bis zum Ende Ihres Prüfungsfensters.",
  "surface_36": "Invite two colleagues: once both start the Pro trial ({zero} today, then {monthly} per month unless cancelled before) and practise actively, you receive Pro until the end of your exam window.",
  "surface_37": "Teilen Sie ihn mit zwei Kolleginnen und Kollegen: Sobald beide den Pro-Test starten ({zero} heute, danach {monthly} pro Monat, wenn nicht vorher gekündigt) und aktiv üben, erhalten Sie Pro bis zum Ende Ihres Prüfungsfensters.",
  "surface_38": "Share it with two colleagues: once both start the Pro trial ({zero} today, then {monthly} per month unless cancelled before) and practise actively, you receive Pro until the end of your exam window."
} as const;
export function billingSurfaceText(key: keyof typeof SURFACE_COPY, lang: BillingLang): string {
  const values: Record<string, string> = { monthly: billingAmount(TIERS.first_month_19.price_cents, lang), quarter: billingAmount(TIERS.first_3mo_27.price_cents, lang), cohort: billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang), zero: billingAmount(0, lang), quarterMonthly: billingAmount(Math.round(TIERS.first_3mo_27.price_cents / TIERS.first_3mo_27.duration_months), lang) };
  return SURFACE_COPY[key].replace(/\{(monthly|quarter|cohort|zero|quarterMonthly)\}/g, (_, name: string) => values[name]);
}

/** @deprecated The invite lives in src/lib/referral-copy.ts (written to the friend, discloses the reward). */
export function billingReferralShare(lang: BillingLang, link: string): string {
  const trial = billingTrialSummary(lang);
  return lang === 'de'
    ? `Laden Sie zwei Kolleginnen und Kollegen ein: Pro-Test mit Karte und aktive Teilnahme sind erforderlich. ${trial} Wenn beide die Aktivitätsbedingungen erfüllen, können Sie Pro bis zu Ihrem Prüfungsfenster erhalten: ${link}`
    : `Invite two colleagues: a card-based Pro trial and active study are required. ${trial} Once both meet the activity requirements, you can receive Pro through your exam window: ${link}`;
}
export function billingAuthContext(lang: BillingLang, intent: 'free' | 'trial', terms?: { trialDays: number; priceAfterCents: number }): string {
  return intent === 'free'
    ? lang === 'de' ? `Kostenlos, ohne Karte: ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank. Ihr Konto speichert Ihren Fortschritt.` : `Free, no card: ${FREE_TIER.questions_per_exam_type} questions per bank. Your account saves your progress.`
    : terms ? billingTrialLine(lang, terms) : lang === 'de' ? 'Pro-Test: Karte nötig. Die aktuellen Kosten und Termine sehen Sie vor dem Start auf der Preisseite.' : 'Pro trial: card required. Review current charges and dates on the pricing page before starting.';
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
    ? `Pro ${data.trialDays} Tage testen: Karte nötig, heute ${billingAmount(0, lang)}, danach ${amount} pro Monat.`
    : `Try Pro for ${data.trialDays} days: card required, ${billingAmount(0, lang)} today, then ${amount} per month.`;
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
  if (sub.status === 'past_due' || sub.provider_status === 'past_due') return de ? 'Zahlung überfällig. Bitte prüfen Sie Ihre Abrechnung bei Whop.' : 'Payment overdue. Please check your billing at Whop.';
  if (sub.cancel_at_period_end || ['cancelled', 'canceled', 'canceling'].includes(sub.provider_status ?? sub.status)) {
    return sub.access_active && accessEnd
      ? de ? `Gekündigt. Pro bleibt bis ${accessEnd} aktiv.` : `Canceled. Pro remains active through ${accessEnd}.`
      : de ? 'Gekündigt. Pro-Zugang aus diesem Tarif ist beendet.' : 'Canceled. Pro access from this plan has ended.';
  }
  if (!sub.access_active || sub.status === 'expired') return de ? 'Pro-Zugang aus diesem Tarif ist abgelaufen.' : 'Pro access from this plan has expired.';
  if (sub.billing_cadence === 'one_time') return accessEnd
    ? de ? `Einmalzahlung. Ihr Zugang endet am ${accessEnd} und verlängert sich nicht.` : `One-time payment. Your access ends on ${accessEnd} and does not renew.`
    : de ? 'Einmalzahlung. Ihr Zugang verlängert sich nicht automatisch.' : 'One-time payment. Your access does not renew automatically.';
  const chargeDate = date(sub.next_charge_at);
  const amount = sub.next_charge_amount_cents;
  if (sub.provider_state_verified && sub.billing_cadence === 'auto_renews' && chargeDate && sub.next_charge_at && Date.parse(sub.next_charge_at) > Date.now() && amount != null && Number.isInteger(amount) && amount >= 0 && sub.billing_interval_days) {
    const money = billingAmount(amount, lang);
    const cadence = sub.billing_interval_days === 30 ? (de ? 'pro Monat' : 'per month') : (de ? `alle ${sub.billing_interval_days} Tage` : `every ${sub.billing_interval_days} days`);
    return sub.is_trial
      ? de ? `Pro-Test bis ${chargeDate}, danach ${money} ${cadence}.` : `Pro trial through ${chargeDate}, then ${money} ${cadence}.`
      : de ? `Verlängert sich am ${chargeDate} mit ${money}, danach ${cadence}.` : `Renews on ${chargeDate} at ${money}, then ${cadence}.`;
  }
  return de ? 'Wir zeigen Ihnen die Details, sobald sie vorliegen. Ihre Abrechnung sehen Sie bei Whop.' : 'We will show details once they are available. You can see your billing at Whop.';
}

export function billingPrechargeReminder(date: string, cents: number, lang: BillingLang): { subject: string; sentence: string; steps: string } {
  const amount = billingAmount(cents, lang);
  return lang === 'de' ? {
    subject: `Ihr Pro-Test endet am ${date}`,
    sentence: `Am ${date} werden ${amount} abgebucht, danach pro Monat. Wenn Sie nicht weitermachen möchten, kündigen Sie vorher.`,
    steps: 'Melden Sie sich bei Whop mit derselben E-Mail an, wählen Sie Ihre Mitgliedschaft und dann „Cancel membership“. Die Whop-Seite ist auf Englisch.',
  } : {
    subject: `Your Pro trial ends on ${date}`,
    sentence: `On ${date}, ${amount} is charged, then per month. If you do not want to continue, cancel beforehand.`,
    steps: 'Log in to Whop with the same email, select your membership, then "Cancel membership".',
  };
}
