/**
 * FAQ copy, one module for the visible page (page.tsx) and the FAQPage
 * JSON-LD (layout.tsx), so the marked-up answers can never drift from what
 * the page shows (a21: UX-PUB-23/24/28, LX-25, UX-ACC-50, TR-15, UX-PUB-05).
 *
 * Owners, never restated here:
 *   - prices and plan sentences: billing-copy.ts (TIERS via billingAmount)
 *   - support mailbox and reply promise: BILLING_SUPPORT_EMAIL,
 *     SUPPORT_REPLY_PROMISE
 *   - guarantee: puyp-copy.ts; referral reward: referral-copy.ts
 *   - founder statement: COMPANY in content-truth.ts; refund window: REFUND
 *   - exam names: getExamLabel
 * Formal Sie, no em dashes, no hour promise for refunds or reviews.
 */
import {
  BILLING_SUPPORT_EMAIL,
  SUPPORT_REPLY_PROMISE,
  WHOP_MANAGE_TEXT,
  billingNeutralLine,
  billingSurfaceText,
  billingTrialSummary,
} from "@/lib/billing-copy";
import { COMPANY, FREE_TIER, REFUND } from "@/lib/content-truth";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { puypDefinition, puypExamples, puypNotRefund } from "@/lib/puyp-copy";
import { referralRewardSentence, referralWindowDefinition } from "@/lib/referral-copy";

export type FaqLang = "de" | "en";
type Bi = { de: string; en: string };

const email = BILLING_SUPPORT_EMAIL;

/** The three question banks, named by the one exam-label helper. */
function banks(lang: FaqLang): string {
  const [a, b, c] = (["kenntnispruefung", "kmp_innsbruck", "pharma"] as const).map((k) => getExamLabel(k, "full", lang));
  return { de: `${a}, ${b} und ${c}`, en: `${a}, ${b} and ${c}` }[lang];
}

export const FAQ_TITLES = {
  cancellation: { de: "Wie kündige ich?", en: "How do I cancel?" },
  refund: { de: "Wie bekomme ich Geld zurück?", en: "How do I get a refund?" },
  payment: { de: "Wie kann ich bezahlen?", en: "How can I pay?" },
  puyp: { de: "Wie funktioniert die Pass-Until-You-Pass-Garantie?", en: "How does the Pass-Until-You-Pass guarantee work?" },
  referrals: { de: "Wie funktioniert das Empfehlungsprogramm?", en: "How does the referral program work?" },
  free: { de: "Was ist im kostenlosen Tarif enthalten?", en: "What is included in the free tier?" },
  perExam: { de: "Gibt es Tarife pro Prüfung?", en: "Is there per-exam pricing?" },
  who: { de: "Wer baut MedPrüf?", en: "Who builds MedPrüf?" },
  contact: { de: "Kontakt", en: "Contact" },
  exams: { de: "Prüfungen, Termine und Fragen", en: "Exams, dates and questions" },
} as const satisfies Record<string, Bi>;

/* ── Exam questions first (UX-PUB-29, TR-36) ──────────────────────────
   Short answers that send the learner to the sourced guidance page that
   owns the fact; no date, count or rule is typed here. */
export interface FaqExamItem { id: string; q: Bi; a: Bi; links: string[] }
export const FAQ_EXAM: readonly FaqExamItem[] = [
  {
    id: "welche-pruefung",
    q: { de: "Welche Prüfung betrifft mich?", en: "Which exam applies to me?" },
    a: {
      de: "Das legt Ihr Bescheid fest. Die Seite zu den Prüfungsnamen ordnet Stichprobentest (SPT), SIP4a, SIP5a, Rezeptierkunde und Gerichtsmedizin ein. Der kurze Fragebogen hilft bei der Wahl der passenden Fragenbank.",
      en: "Your Bescheid decides. The exam-names page explains the Stichprobentest (SPT), SIP4a, SIP5a, Rezeptierkunde and legal medicine. The short questionnaire helps you pick the matching question bank.",
    },
    links: ["/was-ist-was", "/find-your-path"],
  },
  {
    id: "termine",
    q: { de: "Wann sind die nächsten Termine und Anmeldefristen?", en: "When are the next sittings and registration deadlines?" },
    a: {
      de: "Der Prüfungskalender zeigt die veröffentlichten Termine und Anmeldefristen aller Prüfungsfamilien, jeweils mit Quelle und Prüfdatum. Verbindlich ist die Frist Ihrer Universität.",
      en: "The exam calendar lists the published sittings and registration deadlines for every exam family, each with its source and check date. Your university's deadline is binding.",
    },
    links: ["/pruefungskalender", "/wien-route"],
  },
  {
    id: "format",
    q: { de: "Wie sehen die Prüfungsfragen aus?", en: "What do the exam questions look like?" },
    a: {
      de: "Format, Zahl der richtigen Antworten und Bewertung stehen je Prüfung mit amtlicher Quelle auf der Seite zu Formaten und Regeln. Prüfen Sie zusätzlich die Ausschreibung Ihres Termins.",
      en: "Format, number of correct answers and scoring are listed per exam with their official source on the formats and rules page. Also check the announcement for your sitting.",
    },
    links: ["/exam-formats", "/exam-formats/praxis-vs-pruefung"],
  },
  {
    id: "herkunft",
    q: { de: "Woher stammen die Übungsfragen?", en: "Where do the practice questions come from?" },
    a: {
      de: "MedPrüf enthält kuratierte Übungsfragen aus unterschiedlichen Lernquellen. Wir bieten keine offiziellen, erinnerten oder geleakten Prüfungsfragen an. Herkunft und Grenzen jeder Fragenbank stehen auf der Seite zu Umfang und Grenzen.",
      en: "MedPrüf contains curated practice questions from different study sources. We offer no official, recalled or leaked exam questions. Origin and limits of each bank are on the scope page.",
    },
    links: ["/umfang"],
  },
  {
    id: "aktualitaet",
    q: { de: "Wie aktuell sind die Fragen?", en: "How current are the questions?" },
    a: {
      de: "Jede Prüfungsseite zeigt den Stand ihrer Fragenbank: zugeordnete Prüfungstermine, die letzte erfasste Korrektur und das Datum der Herkunftsprüfung. Korrigierte Fragen fasst die Seite zu den Korrekturen nach Monat zusammen.",
      en: "Each exam page shows the state of its bank: tagged exam sittings, the latest recorded correction and the date of the source review. The corrections page summarises corrected questions by month.",
    },
    links: ["/korrekturen"],
  },
  {
    id: "ergebnisse",
    q: { de: "Ergebnisse, Prüfungsraum und Wiederholungen", en: "Results, exam room and repeats" },
    a: {
      de: "Wann Ergebnisse erscheinen, was im Prüfungsraum erlaubt ist und wie Wiederholungen ablaufen, steht mit Quelle auf den Prüfungshilfe-Seiten.",
      en: "When results appear, what the exam room allows and how repeats work is set out with sources on the exam help pages.",
    },
    links: ["/exam-formats/haeufige-fragen", "/exam-formats/ergebnisse", "/exam-formats/kommission"],
  },
];

/* ── Cancellation (UX-PUB-24) ─────────────────────────────────────── */

export function faqCancelIntro(lang: FaqLang): string {
  return billingNeutralLine(lang);
}

export function faqCancelSteps(lang: FaqLang): string[] {
  return {
    de: [
        `Öffnen Sie ${WHOP_MANAGE_TEXT} und melden Sie sich mit der E-Mail-Adresse an, mit der Sie bezahlt haben. Die Whop-Seite ist auf Englisch.`,
        "Wählen Sie Ihre MedPrüf-Mitgliedschaft aus.",
        "Tippen Sie auf „Cancel membership“ und bestätigen Sie die Kündigung.",
      ],
    en: [
        `Open ${WHOP_MANAGE_TEXT} and sign in with the email address you paid with. The Whop page is in English.`,
        "Select your MedPrüf membership.",
        "Tap \"Cancel membership\" and confirm.",
      ],
  }[lang];
}

export function faqCancelAfter(lang: FaqLang): string {
  return {
    de: "Whop beendet die Mitgliedschaft in der Regel zum Ende des bezahlten Zeitraums; wenn Whop sie beendet, endet auch Ihr Pro-Zugang. Kündigen Sie vor dem nächsten Verlängerungsdatum, damit nicht erneut abgebucht wird.",
    en: "Whop usually ends the membership at the end of the paid period; when Whop ends it, your Pro access ends too. Cancel before the next renewal date so you are not charged again.",
  }[lang];
}

export function faqCancelHelp(lang: FaqLang): string {
  return {
    de: `Wenn Sie Hilfe brauchen, schreiben Sie an ${email}. ${SUPPORT_REPLY_PROMISE.de}`,
    en: `If you need help, email ${email}. ${SUPPORT_REPLY_PROMISE.en}`,
  }[lang];
}

/* ── Refund (UX-PUB-24, pick-refund-route A) ──────────────────────── */

export function faqRefundSteps(lang: FaqLang): string[] {
  const days = REFUND.window_days;
  return {
    de: [
        `Schreiben Sie innerhalb von ${days} Tagen nach Ihrem Kauf eine E-Mail an ${email}. Eine Begründung ist nicht nötig.`,
        "Nennen Sie die E-Mail-Adresse Ihres Whop-Kontos, damit wir die Zahlung zuordnen können.",
        "Wir veranlassen die Rückzahlung über Whop.",
      ],
    en: [
        `Email ${email} within ${days} days of your purchase. No reason is required.`,
        "Include the email address of your Whop account so we can find the payment.",
        "We issue the refund through Whop.",
      ],
  }[lang];
}

export function faqRefundAfter(lang: FaqLang): string {
  return `${SUPPORT_REPLY_PROMISE[lang]} ${puypNotRefund(lang)}`;
}

/* ── Payment (LX-25, UX-PUB-28) ───────────────────────────────────── */

export function faqPaymentCards(lang: FaqLang): string {
  return {
    de: `Sie zahlen mit Karte über Whop, unseren Zahlungsabwickler. Akzeptiert: Visa, Mastercard und Apple Pay über Whop. Karten aus Russland und Belarus werden von Whop nicht angenommen. Wenn Ihre Karte abgelehnt wird, schreiben Sie uns an ${email}.`,
    en: `You pay by card through Whop, our payment processor. Accepted: Visa, Mastercard and Apple Pay through Whop. Whop does not accept cards from Russia and Belarus. If your card is declined, write to us at ${email}.`,
  }[lang];
}

export function faqPaymentPlans(lang: FaqLang): string {
  return billingSurfaceText(({ de: "surface_27", en: "surface_28" } as const)[lang], lang) + billingNeutralLine(lang);
}

export function faqPaymentTrial(lang: FaqLang): string {
  return billingTrialSummary(lang);
}

export const FAQ_ACTIVATION: Bi = {
  de: "Ihr Zugang ist meist innerhalb weniger Minuten aktiv. Wenn nach 10 Minuten noch Free angezeigt wird, tippen Sie auf „Zugang prüfen“ auf der Zahlungsseite oder schreiben Sie uns mit der E-Mail Ihres Whop-Kontos.",
  en: "Your access is usually active within a few minutes. If Free still shows after 10 minutes, tap \"Check access\" on the payment page or write to us with the email of your Whop account.",
};

export const FAQ_PAYMENT_SAFE: Bi = {
  de: "Der Checkout läuft über Whop mit verschlüsselter Kartenzahlung. Wir speichern keine Kartendaten.",
  en: "Checkout runs through Whop with encrypted card payment. We never store your card details.",
};

/* ── Guarantee (UX-PUB-23) ────────────────────────────────────────── */

export function faqPuypAnswer(lang: FaqLang): string {
  return puypDefinition(lang);
}

export function faqPuypExamples(lang: FaqLang): string[] {
  return puypExamples(lang);
}

export const FAQ_PUYP_WHY: { q: Bi; a: Bi } = {
  q: {
    de: "Warum verlängert MedPrüf den Zugang, statt nach einem Nichtbestehen Geld zurückzuzahlen?",
    en: "Why extend access instead of refunding money after a failed exam?",
  },
  a: {
    de: "Die Garantie soll Ihnen helfen, die Prüfung doch noch zu bestehen, deshalb verlängert sie Ihren Zugang. Die Rückerstattung innerhalb von 7 Tagen nach einem Kauf gilt unabhängig davon (siehe „Wie bekomme ich Geld zurück?“). Bei einer besonderen persönlichen Situation (Krankheit, Trauerfall) schreiben Sie uns ebenfalls, wir suchen im Einzelfall eine faire Lösung.",
    en: "The guarantee is meant to help you pass after all, so it extends your access. The refund within 7 days of a purchase applies separately (see \"How do I get a refund?\"). If you face a serious personal situation (illness, bereavement), write to us as well and we look for a fair solution case by case.",
  },
};

/* ── Referrals (UX-ACC-50) ────────────────────────────────────────── */

/** The programme is invite-only (users.referrals_enabled), so the public answer says so first. */
const REFERRAL_SCOPE: Record<FaqLang, string> = {
  de: "Das Empfehlungsprogramm steht nur freigeschalteten Konten offen.",
  en: "The referral programme is open to enabled accounts only.",
};

export function faqReferralAnswer(lang: FaqLang): string {
  return `${REFERRAL_SCOPE[lang]} ${referralRewardSentence(lang)} ${referralWindowDefinition(lang)}`;
}

/* ── Free tier, per exam, founder ─────────────────────────────────── */

export function faqFreeIntro(lang: FaqLang): string {
  const per = FREE_TIER.questions_per_exam_type;
  const total = FREE_TIER.total_questions_across_exams;
  return {
    de: `Der kostenlose Tarif gibt Ihnen ${per} Fragen pro Fragenbank, ${total} Fragen insgesamt über ${banks(lang)}. Es gibt kein Ablaufdatum; Sie arbeiten die Fragen in Ihrem Tempo durch.`,
    en: `The free tier gives you ${per} questions per question bank, ${total} in total across ${banks(lang)}. There is no expiry; you work through them at your own pace.`,
  }[lang];
}

export function faqFreeBullets(lang: FaqLang): string[] {
  return {
    de: [
        "Klinische Erklärungen, wo vorhanden. Die KI-Erklärung zu jeder Frage ist den bezahlten Tarifen vorbehalten.",
        "Übungsmodus ohne Spaced Repetition, Prüfungssimulation und Lesezeichen. Sie können bis zu 10 Flash-Notes kostenlos anlegen.",
        "Ihre Antworten werden auf Ihren Geräten synchronisiert, wenn Sie angemeldet sind.",
        "Keine KI-Chat-Folgefragen (gespeicherte KI-Erklärungen bleiben lesbar).",
      ],
    en: [
        "Clinical explanations where available. AI explanations for any question are reserved for the paid tiers.",
        "Practice mode without spaced repetition, mock exams and bookmarks. You can create up to 10 flash-notes for free.",
        "Your answers are synced across your devices when you are signed in.",
        "No AI-chat follow-ups (saved AI explanations stay readable).",
      ],
  }[lang];
}

export const FAQ_FREE_UPGRADE: Bi = {
  de: "Wenn Sie bereit sind, können Sie zur Prüfungs-Kohorte oder zu einem anderen bezahlten Tarif wechseln. Ihr Fortschritt und Ihre Antworten bleiben erhalten.",
  en: "Whenever you are ready, switch to the Exam Cohort or another paid plan. Your progress and answers carry over.",
};

export function faqPerExam(lang: FaqLang): string[] {
  const per = FREE_TIER.questions_per_exam_type;
  return {
    de: [
        `Nein, jeder bezahlte Tarif enthält alle drei Fragenbanken: ${banks(lang)}. Viele Kandidatinnen und Kandidaten bereiten sich auf mehr als eine dieser Prüfungen vor.`,
        `Wenn Sie nur eine Prüfung vorbereiten, gibt Ihnen der kostenlose Tarif ${per} Fragen für genau diese Fragenbank, oft genug für einen ersten Einstieg.`,
      ],
    en: [
        `No, every paid plan unlocks all three question banks: ${banks(lang)}. Many candidates prepare for more than one of these exams.`,
        `If you only prepare for one exam, the free tier gives you ${per} questions for that question bank, often enough for a first pass.`,
      ],
  }[lang];
}

export function faqWho(lang: FaqLang): string {
  return {
    de: `${COMPANY.statement.de} [name] hat seinen Cousin durch die österreichische Nostrifizierung begleitet und dabei gesehen, wo öffentlich verfügbare Unterlagen fehlen: verstreute Karteikarten, veraltete PDFs, keine österreichspezifische Abdeckung. Die Fragenbanken sind nach Prüfung geordnet, und Fehler können Sie direkt in der App melden. Kontakt: ${email}.`,
    en: `${COMPANY.statement.en} [name] walked his cousin through Austrian nostrification and saw where publicly available material falls short: scattered flashcards, outdated PDFs, no Austria-specific coverage. The question banks are organised by exam, and you can report errors directly in the app. Contact: ${email}.`,
  }[lang];
}

/* ── Contact (UX-PUB-28, LX-31) ───────────────────────────────────── */

export const FAQ_CONTACT: { title: Bi; mail: Bi; pricing: Bi } = {
  title: { de: "Noch Fragen offen?", en: "Still have questions?" },
  mail: { de: "E-Mail schreiben", en: "Email us" },
  pricing: { de: "Zur Preisseite", en: "Back to pricing" },
};

/** Question and answer pairs for the FAQPage JSON-LD, same text as the page. */
export function faqSchemaEntries(lang: FaqLang): Array<{ q: string; a: string }> {
  return [
    ...FAQ_EXAM.map((item) => ({ q: item.q[lang], a: item.a[lang] })),
    {
      q: FAQ_TITLES.cancellation[lang],
      a: [faqCancelIntro(lang), ...faqCancelSteps(lang).map((s, i) => `${i + 1}. ${s}`), faqCancelAfter(lang), faqCancelHelp(lang)].join(" "),
    },
    {
      q: FAQ_TITLES.refund[lang],
      a: [...faqRefundSteps(lang).map((s, i) => `${i + 1}. ${s}`), faqRefundAfter(lang)].join(" "),
    },
    {
      q: FAQ_TITLES.payment[lang],
      a: [faqPaymentCards(lang), faqPaymentPlans(lang), faqPaymentTrial(lang), FAQ_ACTIVATION[lang], FAQ_PAYMENT_SAFE[lang]].join(" "),
    },
    { q: FAQ_TITLES.puyp[lang], a: [faqPuypAnswer(lang), ...faqPuypExamples(lang)].join(" ") },
    { q: FAQ_TITLES.referrals[lang], a: faqReferralAnswer(lang) },
    { q: FAQ_TITLES.free[lang], a: [faqFreeIntro(lang), ...faqFreeBullets(lang), FAQ_FREE_UPGRADE[lang]].join(" ") },
    { q: FAQ_TITLES.perExam[lang], a: faqPerExam(lang).join(" ") },
    { q: FAQ_TITLES.who[lang], a: faqWho(lang) },
  ];
}
