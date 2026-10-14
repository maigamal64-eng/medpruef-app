/**
 * Referral copy: the ONE reward sentence and the ONE invite message
 * (UX-ACC-50 option A, TR-27, UX-PUB-39). Used by /referrals, the /pricing
 * referral block, the FAQ and every share button, so the reward promise can
 * never drift between surfaces again.
 *
 * Facts (owner: MEDPRUF-SOT.md section 2.x, src/lib/referral-exam-reward.ts):
 *   - two referees, each signed up with the link, with the card Pro trial
 *     active and at least 20 different questions on at least 2 different days
 *   - the reward is Pro through the referrer's exam window (next official
 *     sitting of their exam plus 14 days), confirmed by a person, never cash
 *   - the trial is named with its full terms (card, 0 EUR today, then the
 *     monthly price unless cancelled before), amounts from plan data
 * While REFERRAL_MENTOR_CREDITS_ENABLED is on (a-mentor-open, wording by
 * Lektor 14 Oct), the referrer also receives 50 mentor credits on a referee's
 * first Pro payment (src/lib/referral-mentor-credits.ts); callers pass the
 * credit amount from /api/referrals/status (`mentorCredits`, null when off)
 * so the line, its terms and the disclosure appear only then.
 * The invite is written to the friend and discloses the sender's reward in
 * the first person (TR-27). Formal Sie, no em dashes, no past sitting date,
 * no timing promise. Arabic stays out until [name] signs it off.
 */
import { FREE_TIER } from "./content-truth";
import { billingAmount, type BillingLang } from "./billing-copy";
import { TIERS } from "./content-truth";

const monthly = (lang: BillingLang) => billingAmount(TIERS.first_month_19.price_cents, lang);
const zero = (lang: BillingLang) => billingAmount(0, lang);

/**
 * Copy by language. A record, not inline ternaries, so a reviewed language
 * is one more key (LX-19); ru, uk and tr fall back to English until native
 * review, Arabic until [name] signs it off.
 */
const COPY: Record<BillingLang, {
  window: string;
  reward: (zero: string, monthly: string) => string;
  bullets: string[];
  invite: (free: number, zero: string, monthly: string, link: string) => string;
  disclosure: string;
  rows: Record<"signed_up" | "learning_no_trial" | "counts", string>;
  empty: string;
  mentorLine: (credits: number) => string;
  mentorTerms: string;
  mentorInvite: (credits: number) => string;
  mentorDisclosure: string;
}> = {
  de: {
    window: "Ihr Prüfungsfenster reicht bis zum nächsten offiziellen Termin Ihrer Prüfung mit offener Anmeldung, plus 14 Tage.",
    reward: (z, m) => `Sie erhalten Pro bis zum Ende Ihres Prüfungsfensters, sobald zwei Kolleginnen und Kollegen über Ihren Link den Pro-Test starten (Karte nötig, heute ${z}, danach ${m} pro Monat, wenn nicht vorher gekündigt), ihn aktiv halten und jeweils mindestens 20 verschiedene Fragen an mindestens 2 verschiedenen Tagen beantworten. Wir bestätigen das persönlich. Die Belohnung ist Pro-Zugang, keine Geldzahlung.`,
    bullets: [
      "Zwei Kolleginnen und Kollegen melden sich über Ihren Link an und starten den Pro-Test (Karte nötig).",
      "Beide beantworten jeweils mindestens 20 verschiedene Fragen an mindestens 2 Tagen.",
      "Wir bestätigen das persönlich, dann erhalten Sie Pro bis zum Ende Ihres Prüfungsfensters.",
    ],
    invite: (f, z, m, link) => `Ich bereite mich mit MedPrüf auf meine Prüfung in Österreich vor. Sie können ${f} Fragen pro Fragenbank kostenlos und ohne Karte üben. Es gibt auch einen Pro-Test: Karte nötig, heute ${z}, danach ${m} pro Monat, wenn Sie nicht vorher kündigen. Offen gesagt: Ich erhalte Pro kostenlos, wenn Sie und eine weitere Person über meinen Link den Pro-Test starten und üben. ${link}`,
    disclosure: "Ihre Einladung sagt offen, dass Sie eine Belohnung erhalten, wenn Ihre Kolleginnen und Kollegen den Pro-Test starten.",
    rows: { signed_up: "Angemeldet", learning_no_trial: "Lernt, Pro-Test fehlt", counts: "Zählt" },
    empty: "Noch hat niemand über Ihren Link angefangen. Teilen Sie ihn mit Ihrer Lerngruppe.",
    mentorLine: (c) => `Zusätzlich erhalten Sie ${c} Credits für den KI-Mentor, sobald eine Kollegin oder ein Kollege über Ihren Link zum ersten Mal für Pro bezahlt (der Start des Pro-Tests allein zählt noch nicht).`,
    mentorTerms: "Nur für neue Konten, die über Ihren Link angelegt wurden. Die Credits gelten 30 Tage, höchstens 3 solche Belohnungen pro Kalendermonat, und sie entfallen wieder, wenn diese Zahlung erstattet wird.",
    mentorInvite: (c) => `Außerdem erhalte ich ${c} Credits für den KI-Mentor, wenn Sie über meinen Link zum ersten Mal für Pro bezahlen.`,
    mentorDisclosure: "Ihre Einladung sagt offen, dass Sie eine Belohnung erhalten, wenn Ihre Kolleginnen und Kollegen den Pro-Test starten oder zum ersten Mal für Pro bezahlen.",
  },
  en: {
    window: "Your exam window runs until the next official sitting of your exam with open registration, plus 14 days.",
    reward: (z, m) => `You receive Pro until the end of your exam window once two colleagues start the Pro trial through your link (card required, ${z} today, then ${m} per month unless cancelled before), keep it active and each answer at least 20 different questions on at least 2 different days. We confirm this personally. The reward is Pro access, not a cash payment.`,
    bullets: [
      "Two colleagues sign up through your link and start the Pro trial (card required).",
      "Each answers at least 20 different questions on at least 2 days.",
      "We confirm this personally, then you receive Pro until the end of your exam window.",
    ],
    invite: (f, z, m, link) => `I am preparing for my exam in Austria with MedPrüf. You can practise ${f} questions per question bank for free, no card needed. There is also a Pro trial: card required, ${z} today, then ${m} per month unless you cancel before. To be open: I receive Pro for free if you and one other person start the Pro trial through my link and practise. ${link}`,
    disclosure: "Your invite says openly that you receive a reward when your colleagues start the Pro trial.",
    rows: { signed_up: "Signed up", learning_no_trial: "Learning, no Pro trial yet", counts: "Counts" },
    empty: "Nobody has started through your link yet. Share it with your study group.",
    mentorLine: (c) => `In addition, you receive ${c} AI Mentor credits once a colleague pays for Pro for the first time through your link (starting the Pro trial alone does not count yet).`,
    mentorTerms: "New accounts created through your link only. Credits are valid for 30 days, with at most 3 such rewards per calendar month, and they are removed if that payment is refunded.",
    mentorInvite: (c) => `I also receive ${c} AI Mentor credits if you pay for Pro for the first time through my link.`,
    mentorDisclosure: "Your invite says openly that you receive a reward when your colleagues start the Pro trial or pay for Pro for the first time.",
  },
};

/** "Prüfungsfenster", defined once. */
export function referralWindowDefinition(lang: BillingLang): string {
  return COPY[lang].window;
}

/** The one reward sentence, conditions included. */
export function referralRewardSentence(lang: BillingLang): string {
  return COPY[lang].reward(zero(lang), monthly(lang));
}

/** Three short bullets for the /pricing block (UX-PUB-39). */
export function referralRewardBullets(lang: BillingLang): string[] {
  return [...COPY[lang].bullets];
}

/**
 * The invite message sent to a colleague (native share, Telegram, WhatsApp,
 * copy). Free path first, the trial named with its terms, and the sender's
 * own reward disclosed in the first person (TR-27).
 */
export function referralInviteMessage(lang: BillingLang, link: string, mentorCredits?: number | null): string {
  const base = COPY[lang].invite(FREE_TIER.questions_per_exam_type, zero(lang), monthly(lang), link);
  if (!mentorCredits || mentorCredits <= 0) return base;
  // The extra disclosure goes after the "Offen gesagt" sentence, before the link.
  const at = base.lastIndexOf(` ${link}`);
  return at < 0 ? `${base} ${COPY[lang].mentorInvite(mentorCredits)}` : `${base.slice(0, at)} ${COPY[lang].mentorInvite(mentorCredits)}${base.slice(at)}`;
}

/** Disclosure line for any surface that shows a share button without the full invite. */
export function referralDisclosure(lang: BillingLang, mentorCredits?: number | null): string {
  return mentorCredits && mentorCredits > 0 ? COPY[lang].mentorDisclosure : COPY[lang].disclosure;
}

/** The referral mentor-credit line and its conditions, or null while the program is off. */
export function referralMentorCreditsCopy(lang: BillingLang, mentorCredits?: number | null): { line: string; terms: string } | null {
  if (!mentorCredits || mentorCredits <= 0) return null;
  return { line: COPY[lang].mentorLine(mentorCredits), terms: COPY[lang].mentorTerms };
}

/** Row states for invited colleagues (UX-ACC-50). */
export function referralRowState(state: "signed_up" | "learning_no_trial" | "counts", lang: BillingLang): string {
  return COPY[lang].rows[state];
}

export function referralEmptyLine(lang: BillingLang): string {
  return COPY[lang].empty;
}
