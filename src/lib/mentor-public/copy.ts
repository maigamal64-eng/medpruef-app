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
import { billingAmount, MENTOR_BILLING, type BillingLang } from "@/lib/billing-copy";
import { MENTOR_LADDER, includedMentorCredits, type IncludedPlan } from "./ladder";

/** One line on a paid plan card: "KI-Erklärungen und 50 Mentor-Credits pro Monat inklusive". */
export function mentorIncludedLine(plan: IncludedPlan, lang: BillingLang): string {
  const n = includedMentorCredits(plan);
  const line = {
    de: `KI-Erklärungen und ${n} Mentor-Credits pro Monat inklusive`,
    en: `AI explanations and ${n} mentor credits a month included`,
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

/** Three text rows: Gratis, Mentor Basis, Pro. Basis from the live offer when given. */
export function mentorLadderRows(lang: BillingLang, basis?: BasisOffer | null): LadderRow[] {
  const de = lang === "de";
  const basisCents = basis?.price_eur_cents ?? MENTOR_LADDER.basis.priceCents;
  const basisCredits = basis?.credits ?? MENTOR_LADDER.basis.credits;
  const basisPrice = billingAmount(basisCents, lang);
  const proPrice = billingAmount(TIERS.first_month_19.price_cents, lang);
  const proCredits = MENTOR_LADDER.pro.credits;
  return [
    {
      key: "free",
      name: de ? "Gratis" : "Free",
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
      name: "Pro",
      price: de ? `${proPrice} pro Monat` : `${proPrice} per month`,
      detail: de ? `alle Fragen, ${proCredits} Mentor-Credits pro Monat inklusive` : `all questions, ${proCredits} mentor credits a month included`,
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
    de: "Sie können Ihren Mentor-Chatverlauf jederzeit im Mentor und in den Einstellungen löschen. Dabei werden auch Ihre Meldungen und gespeicherten Antwort-Stichproben entfernt; Ihr Credit-Guthaben bleibt erhalten. Wenn Sie Ihr Konto löschen lassen, trennen wir die verbleibenden Mentor-Daten von Ihrer Person (Anonymisierung), damit die Buchhaltung vollständig bleibt.",
    en: "You can delete your mentor chat history at any time in the mentor and in Settings. This also removes your reports and stored answer samples; your credit balance stays. If you have your account deleted, we separate the remaining mentor data from your person (anonymization) so the accounting records stay complete.",
  },
} as const;

/** FAQ entry: what the mentor is and what it costs. */
export const MENTOR_FAQ_TITLE = {
  de: "Was ist der KI-Mentor und was kostet er?",
  en: "What is the AI mentor and what does it cost?",
} as const;

export function mentorFaqAnswer(lang: BillingLang): string[] {
  const de = lang === "de";
  const basisPrice = billingAmount(MENTOR_LADDER.basis.priceCents, lang);
  return [
    de
      ? "Der KI-Mentor beantwortet Ihre Fragen zur Vorbereitung auf die österreichischen Prüfungen und erklärt Übungsfragen. Antworten zu Fristen und Regeln nennen ihre Quelle und das Datum, an dem diese zuletzt geprüft wurde. Der Mentor ersetzt keine offiziellen Informationen der Universitäten oder Behörden: Prüfen Sie wichtige Angaben dort."
      : "The AI mentor answers your questions about preparing for the Austrian exams and explains practice questions. Answers about deadlines and rules name their source and the date it was last checked. The mentor does not replace official information from the universities or authorities: check important details there.",
    de
      ? `Jede Nachricht verbraucht Credits. Pro enthält ${MENTOR_LADDER.pro.credits} Mentor-Credits pro Monat, die Prüfungs-Kohorte ${MENTOR_LADDER.cohort.credits}. Ohne Pro können Sie Mentor Basis buchen: ${basisPrice} alle ${MENTOR_LADDER.basis.periodDays} Tage für ${MENTOR_LADDER.basis.credits} Credits.`
      : `Each message uses credits. Pro includes ${MENTOR_LADDER.pro.credits} mentor credits a month, the Exam Cohort ${MENTOR_LADDER.cohort.credits}. Without Pro you can book Mentor Basis: ${basisPrice} every ${MENTOR_LADDER.basis.periodDays} days for ${MENTOR_LADDER.basis.credits} credits.`,
    `${MENTOR_BILLING.grace[lang]} ${MENTOR_BILLING.rollover[lang]}`,
    de
      ? "Ihren Chatverlauf können Sie jederzeit im Mentor und in den Einstellungen löschen."
      : "You can delete your chat history at any time in the mentor and in Settings.",
  ];
}

const CANCEL_LABEL = { de: "Kündigung: ", en: "Cancellation: " } as const;

/** Terms paragraphs, in order. */
export function mentorTermsParagraphs(lang: BillingLang): string[] {
  const b = MENTOR_BILLING;
  return [
    `${b.renewal[lang]} ${b.grace[lang]} ${b.rollover[lang]}`,
    `${b.included[lang]} ${b.topup[lang]}`,
    b.refund[lang],
    `${CANCEL_LABEL[lang]}${b.cancel[lang]}`,
    b.support[lang],
  ];
}

export const MENTOR_TERMS_HEADING = { de: "KI-Mentor und Mentor-Credits", en: "AI mentor and mentor credits" } as const;
