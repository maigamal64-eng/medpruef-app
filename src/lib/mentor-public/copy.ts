/**
 * Public KI-Mentor copy (a39: MUX-87/88 pricing line and ladder, MUX-109 /
 * OW-26 privacy and FAQ). Pure strings; the components under
 * src/components/mentor/public/ render them only when
 * mentorPublicCopyEnabled() is true. Numbers from ladder.ts (seed-checked)
 * and TIERS via billingAmount; billing sentences from MENTOR_BILLING.
 * Formal Sie, no em dashes, Austrian framing, no pass-rate or
 * real-exam-question claims.
 */
import { TIERS } from "@/lib/content-truth";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { billingAmount, MENTOR_BILLING, type BillingLang } from "@/lib/billing-copy";
import { MENTOR_LADDER, includedMentorCredits, type IncludedPlan } from "./ladder";

/** One line on a paid plan card: "KI-Erklärungen und 200 Credits für den KI-Mentor je 30 Tage inklusive" (Lektor F7). */
export function mentorIncludedLine(plan: IncludedPlan, lang: BillingLang): string {
  const n = includedMentorCredits(plan);
  const days = MENTOR_LADDER[plan].periodDays;
  const line = {
    de: `KI-Erklärungen und ${n} Credits für den KI-Mentor je ${days} Tage inklusive`,
    en: `AI explanations and ${n} AI Mentor credits per ${days} days included`,
  };
  return line[lang];
}

export interface LadderRow {
  key: "free" | "basis" | "pro";
  name: string;
  price: string | null;
  detail: string;
}

export interface BasisOffer {
  price_eur_cents: number;
  credits: number;
}

/**
 * Three text rows: free sample, Mentor Basis, Pro. Basis from the live offer when given.
 * `included` (mentorIncludedCopyEnabled) decides whether the Pro row may say it
 * includes mentor credits; off, it says packages can be added. `v2`
 * (pricingV2Enabled) prints the v2 Monthly plan (flex_month) instead of the
 * hidden v1 first month, so a v2 buyer never sees the old price (Lektor F2).
 */
export function mentorLadderRows(lang: BillingLang, basis?: BasisOffer | null, included = false, v2 = pricingV2Enabled()): LadderRow[] {
  const de = lang === "de";
  const basisCents = basis?.price_eur_cents ?? MENTOR_LADDER.basis.priceCents;
  const basisCredits = basis?.credits ?? MENTOR_LADDER.basis.credits;
  const basisPrice = billingAmount(basisCents, lang);
  const proPrice = billingAmount((v2 ? TIERS.flex_month : TIERS.first_month_19).price_cents, lang);
  const proCredits = MENTOR_LADDER.pro.credits;
  const proDays = MENTOR_LADDER.pro.periodDays;
  return [
    {
      key: "free",
      name: de ? "Kostenlose Probe" : "Free sample",
      price: null,
      detail: de ? "Fragenbank-Auszug, gespeicherte Erklärungen" : "A sample of the question bank, saved explanations",
    },
    {
      key: "basis",
      name: "Mentor Basis",
      price: de ? `${basisPrice} alle ${MENTOR_LADDER.basis.periodDays} Tage` : `${basisPrice} every ${MENTOR_LADDER.basis.periodDays} days`,
      detail: de ? `${basisCredits} Credits, ohne Pro nutzbar` : `${basisCredits} credits, usable without Pro`,
    },
    {
      key: "pro",
      name: v2 ? (de ? "Monatsabo" : "Monthly plan") : "Pro",
      price: v2
        ? (de ? `${proPrice} alle ${proDays} Tage` : `${proPrice} every ${proDays} days`)
        : (de ? `${proPrice} pro Monat` : `${proPrice} per month`),
      detail: included
        ? (de ? `alle Fragen, ${proCredits} Credits für den KI-Mentor je ${proDays} Tage inklusive` : `all questions, ${proCredits} AI Mentor credits per ${proDays} days included`)
        : (de ? "alle Fragen, Mentor-Pakete zusätzlich buchbar" : "all questions, mentor packages can be added"),
    },
  ];
}

export const MENTOR_LADDER_UI = {
  heading: { de: "So passt der KI-Mentor zu Ihrem Tarif", en: "How the AI mentor fits your plan" },
  included: { de: "Enthalten:", en: "Included:" },
  link: { de: "Pro-Tarife ansehen", en: "See Pro plans" },
} as const;

/** Privacy: processor purpose for the mentor (model provider Anthropic, see src/lib/ai/anthropic). */
export const MENTOR_PRIVACY = {
  processorName: "Anthropic (KI-Mentor)",
  processorPurpose: {
    de: "Antworten des KI-Mentors. Übermittelt werden Ihre Nachricht an den Mentor, der bisherige Gesprächsverlauf und die dazu passenden Fragen- und Faktendaten.",
    en: "Answers from the AI mentor. Your message to the mentor, the conversation so far and the matching question and fact data are shared.",
  },
  heading: { de: "KI-Mentor: Chatverlauf gespeichert, löschbar", en: "AI mentor: chat history stored, deletable" },
  intro: {
    de: "Wenn Sie den KI-Mentor nutzen, speichern wir:",
    en: "When you use the AI mentor, we store:",
  },
  items: {
    de: [
      "Ihre Nachrichten an den Mentor und seine Antworten (Chatverlauf), bis Sie ihn löschen.",
      "Eine fertige Antwort zur Wiederherstellung nach einem Verbindungsabbruch, für 24 Stunden.",
      "Stichproben von Antworten zur Qualitätsprüfung, für bis zu 30 Tage.",
      "Ihre Meldungen zu einer Antwort, die nach 30 Tagen gelöscht werden.",
      "Ihr Credit- und Nutzungsverlauf (gutgeschriebene und verbrauchte Credits), den wir für die Buchhaltung aufbewahren.",
    ],
    en: [
      "Your messages to the mentor and its answers (chat history), until you delete them.",
      "A finished answer for recovery after a lost connection, for 24 hours.",
      "Samples of answers for quality review, for up to 30 days.",
      "Your reports about an answer, deleted after 30 days.",
      "Your credit and usage history (credits added and used), kept for accounting.",
    ],
  },
  erasure: {
    de: "Sie können Ihren Mentor-Chatverlauf jederzeit im Mentor und in den Einstellungen löschen. Dabei werden auch Ihre Meldungen und gespeicherten Antwort-Stichproben entfernt; Ihr Credit-Guthaben bleibt erhalten.",
    en: "You can delete your mentor chat history at any time in the mentor and in Settings. This also removes your reports and stored answer samples; your credit balance stays.",
  },
} as const;

/** The billing rule sentence (answer-page claim m.billing-rule quotes it). */
export const MENTOR_BILLING_RULE = {
  de: "Credits werden nur für fertige, vollständige Antworten des Mentors abgezogen; eine fehlgeschlagene Antwort kostet nichts.",
  en: "Credits are deducted only for finished, complete Mentor answers; a failed answer costs nothing.",
} as const;

/**
 * FAQ entry: what the mentor is and what Pro includes. CEO decision 18 Oct
 * ([name]'s 14 Oct keep-quiet rule, SoT §2.y, decision mentor-packages-quiet):
 * the public FAQ names no Mentor package price; included credits are stated
 * in the plan cards and in the app only (Lektor F1, F1b, F3, F5).
 */
export const MENTOR_FAQ_TITLE = {
  de: "Was ist der KI-Mentor und was ist in Pro enthalten?",
  en: "What is the AI Mentor and what does Pro include?",
} as const;

export function mentorFaqAnswer(lang: BillingLang, included = false, v2 = pricingV2Enabled()): string[] {
  const de = lang === "de";
  const days = MENTOR_LADDER.pro.periodDays;
  // The 400 plan: the Guarantee Ticket under the v2 offer, the Exam Cohort before it (as /terms includedV1).
  const top = v2 ? (de ? "das Garantie-Ticket" : "the Guarantee Ticket") : (de ? "die Prüfungs-Kohorte" : "the Exam Cohort");
  return [
    de
      ? "Der KI-Mentor beantwortet Ihre Fragen zur Vorbereitung auf die österreichischen Prüfungen und erklärt Übungsfragen. Antworten zu Fristen und Regeln nennen ihre Quelle und das Datum, an dem diese zuletzt geprüft wurde. Der Mentor ersetzt keine offiziellen Informationen der Universitäten oder Behörden: Prüfen Sie wichtige Angaben dort."
      : "The AI mentor answers your questions about preparing for the Austrian exams and explains practice questions. Answers about deadlines and rules name their source and the date it was last checked. The mentor does not replace official information from the universities or authorities: check important details there.",
    included
      ? (de
        ? `${MENTOR_BILLING_RULE.de} Jeder Pro-Tarif enthält ${MENTOR_LADDER.pro.credits} Credits für den KI-Mentor je ${days} Tage, ${top} ${MENTOR_LADDER.cohort.credits}.`
        : `${MENTOR_BILLING_RULE.en} Every Pro plan includes ${MENTOR_LADDER.pro.credits} AI Mentor credits per ${days} days, ${top} ${MENTOR_LADDER.cohort.credits}.`)
      : MENTOR_BILLING_RULE[lang],
    included ? MENTOR_BILLING.includedRule[lang] : MENTOR_BILLING.rollover[lang],
    de
      ? "Ihren Chatverlauf können Sie jederzeit im Mentor und in den Einstellungen löschen."
      : "You can delete your chat history at any time in the mentor and in Settings.",
  ];
}

const CANCEL_LABEL = { de: "Kündigung: ", en: "Cancellation: " } as const;

/** Terms paragraphs, in order. The "included" sentence only with `included` (mentorIncludedCopyEnabled). */
export function mentorTermsParagraphs(lang: BillingLang, included = false, v2 = pricingV2Enabled()): string[] {
  const b = MENTOR_BILLING;
  return [
    `${b.renewal[lang]} ${b.grace[lang]} ${b.rollover[lang]}`,
    included ? `${(v2 ? b.included : b.includedV1)[lang]} ${b.topup[lang]}` : b.topup[lang],
    b.refund[lang],
    `${CANCEL_LABEL[lang]}${b.cancel[lang]}`,
    b.support[lang],
  ];
}

export const MENTOR_TERMS_HEADING = { de: "KI-Mentor und Mentor-Credits", en: "AI mentor and mentor credits" } as const;
