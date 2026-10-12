/**
 * Access-ending reminder mail (a46, pick-renewal-copy A).
 *
 * Neutral wording for every recipient of the day-25 sweep: a one-time payer
 * and a learner whose end date was extended by hand read the same text. It
 * states the effective access end (the date the paywall enforces, from
 * users.tier_expires_at), never a subscription row's own date, and never
 * claims the learner paid. The sweep only reaches learners with no plan that
 * charges again (billing-cadence gate), so "no automatic charge" is true for
 * all of them.
 *
 * German copy uses Sie. No renewal wording: tests/unit/cron/trial-reminder.test.ts
 * enforces that on the sent body.
 */
import { BILLING_SUPPORT_EMAIL, WHOP_MANAGE_URL, WHOP_MANAGE_TEXT } from "@/lib/billing-copy";
import { COMPANY, formatEuro, TIERS, FREE_TIER } from "@/lib/content-truth";

export interface AccessEndingMailArgs {
  firstName: string | null;
  lang: "de" | "en";
  /** Effective access end (ISO). */
  accessEndsAtIso: string;
  qsAnswered: number;
  accuracyPct: number;
  streakDays: number;
  now?: Date;
}

const DAY_MS = 86_400_000;

const WORDS = {
  de: {
    locale: "de-AT",
    days: (n: number) => (n === 1 ? "Tag" : "Tagen"),
    answered: (n: number) => `${n} Fragen beantwortet`,
    correct: (n: number) => `${n} % richtig`,
    streak: (n: number) => `Serie: ${n} ${n === 1 ? "Tag" : "Tage"}`,
  },
  en: {
    locale: "en-GB",
    days: (n: number) => (n === 1 ? "day" : "days"),
    answered: (n: number) => `${n} questions answered`,
    correct: (n: number) => `${n}% correct`,
    streak: (n: number) => `${n}-day streak`,
  },
} as const;

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Whole days until the end, at least 1 (the sweep only runs on future ends). */
export function accessEndingDaysLeft(accessEndsAtIso: string, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((Date.parse(accessEndsAtIso) - now.getTime()) / DAY_MS));
}

/** The end date as the learner reads it: Vienna calendar day. */
export function formatAccessEnd(accessEndsAtIso: string, lang: "de" | "en"): string {
  return new Intl.DateTimeFormat(WORDS[lang].locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Vienna",
  }).format(new Date(accessEndsAtIso));
}

export function renderAccessEndingReminder(args: AccessEndingMailArgs): { subject: string; htmlBody: string } {
  const { firstName, lang, accessEndsAtIso, qsAnswered, accuracyPct, streakDays } = args;
  const daysLeft = accessEndingDaysLeft(accessEndsAtIso, args.now);
  const endFmt = formatAccessEnd(accessEndsAtIso, lang);
  const greetingName = firstName ? `, ${escapeHtml(firstName)}` : "";

  const w = WORDS[lang];
  const stats: string[] = [];
  if (qsAnswered > 0) stats.push(w.answered(qsAnswered));
  if (accuracyPct > 0) stats.push(w.correct(accuracyPct));
  if (streakDays > 0) stats.push(w.streak(streakDays));
  const statsLine = stats.length > 0 ? stats.join(" · ") : null;

  const cohort = formatEuro(TIERS.premium_pass_guaranteed.price_cents);
  const threeMonth = formatEuro(TIERS.first_3mo_27.price_cents);
  const singleMonth = formatEuro(TIERS.first_month_19.price_cents);
  const wrapStyle =
    "font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;";
  const btnStyle =
    "display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;";

  if (lang === "de") {
    const dayWord = w.days(daysLeft);
    const subject = `Ihr MedPrüf Pro-Zugang endet in ${daysLeft} ${dayWord}`;
    const htmlBody = `<!DOCTYPE html>
<html><body style="${wrapStyle}">
<p>Hallo${greetingName},</p>

<p>kurzer Hinweis: Ihr <strong>MedPrüf Pro-Zugang</strong> endet am <strong>${endFmt}</strong>, also in ca. ${daysLeft} ${dayWord}. Für diesen Zugang ist keine automatische Abbuchung eingerichtet. Wenn Sie nichts tun, endet er an diesem Datum, und es wird nichts abgebucht.</p>

${statsLine ? `<p><strong>Was Sie in dieser Zeit aufgebaut haben:</strong> ${statsLine}.<br>Das alles bleibt erhalten, wenn Sie weitermachen.</p>` : ""}

<p>Wenn Sie weitermachen möchten, können Sie selbst einen Tarif wählen:</p>

<ul>
  <li><strong>Prüfungs-Kohorte</strong> (${cohort} einmalig, 6 Monate, Pass-Until-You-Pass-Garantie): Einmalzahlung, kein Abo, Karten-Checkout über Whop, sofortiger Vollzugang.</li>
  <li><strong>Monatsabo</strong> (${singleMonth} pro Monat) und <strong>3-Monats-Tarif</strong> (${threeMonth} pro Quartal): das sind Abos, die bis zur Kündigung weiterlaufen. Kündigen können Sie bei Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (Mitgliedschaft auswählen, dann „Cancel membership“; die Seite ist auf Englisch).</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="${btnStyle}">Tarife ansehen →</a></p>

<p>Falls Sie nicht weitermachen möchten, ist das in Ordnung. Ihr Konto bleibt bestehen, Sie können die kostenlose Version (${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank) weiter nutzen, und wenn Sie später zurückkommen, ist alles noch da.</p>

<p>Bei Fragen: einfach auf diese Mail antworten (${BILLING_SUPPORT_EMAIL}). Wenn Sie solche Hinweise nicht mehr erhalten möchten, antworten Sie mit „Stopp“.</p>

<p>Viele Grüße, [name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.de}</small></p>
</body></html>`;
    return { subject, htmlBody };
  }

  const dayWord = w.days(daysLeft);
  const subject = `Your MedPrüf Pro access ends in ${daysLeft} ${dayWord}`;
  const htmlBody = `<!DOCTYPE html>
<html><body style="${wrapStyle}">
<p>Hi${greetingName},</p>

<p>quick heads-up: your <strong>MedPrüf Pro access</strong> ends on <strong>${endFmt}</strong>, about ${daysLeft} ${dayWord} from now. No automatic charge is set up for this access. If you do nothing, it simply ends on that date and nothing is charged.</p>

${statsLine ? `<p><strong>What you've built so far:</strong> ${statsLine}.<br>All of it stays if you continue.</p>` : ""}

<p>If you want to keep going, you can choose a plan yourself:</p>

<ul>
  <li><strong>Exam Cohort</strong> (${cohort} once, 6 months, Pass-Until-You-Pass guarantee): one-time payment, no subscription, card checkout via Whop, instant full access.</li>
  <li><strong>Single Month</strong> (${singleMonth} per month) and <strong>3-Month plan</strong> (${threeMonth} per quarter): these are subscriptions that keep running until you cancel. You can cancel at Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (select your membership, then "Cancel membership").</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="${btnStyle}">See plans →</a></p>

<p>If you want to stop, that's fine. Your account stays, you can keep using the free version (${FREE_TIER.questions_per_exam_type} questions per question bank), and if you come back later everything is still there.</p>

<p>Questions: just reply to this email (${BILLING_SUPPORT_EMAIL}). If you no longer want notes like this, reply "Stop".</p>

<p>Best, [name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.en}</small></p>
</body></html>`;
  return { subject, htmlBody };
}
