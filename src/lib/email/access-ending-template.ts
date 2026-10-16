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
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { planName, planPrice } from "@/lib/pricing-v2/price-facts";
import { winbackCopy } from "@/lib/winback-copy";
import type { ExamSourceId } from "@/lib/topics";

export interface AccessEndingMailArgs {
  firstName: string | null;
  lang: "de" | "en";
  /** Effective access end (ISO). */
  accessEndsAtIso: string;
  qsAnswered: number;
  accuracyPct: number;
  streakDays: number;
  now?: Date;
  /**
   * J11: win-back credits this learner will receive when the access ends.
   * Only passed while REWARDS_WINBACK_ENABLED is on and the grant would
   * follow (winbackMailPromise); renders one line after the plan list.
   */
  winback?: { credits: number; days: number } | null;
  /**
   * a-pricing-v2-fit: the learner's active question bank (users.active_exam)
   * picks the next-step paragraph (copy-audit F05); unknown = the neutral one.
   */
  activeExam?: string | null;
  /**
   * a-pricing-v2-fit (decision returning-payer-price, D-A): the learner has a
   * succeeded Whop payment and RETURNING_PAYER_PRICES_ENABLED is on, so the
   * plan block also names the old recurring plans, price last. Only with the
   * v2 offer on; the caller decides (src/lib/pricing-v2/returning-payer.ts).
   */
  returningPrices?: boolean;
  /**
   * a-renew-early: the checkout would accept a booking now with the new time
   * from this end date (WHOP_EXTENSIONS_ENABLED on and the access is Whop-owned
   * and pinned, whop-extension.ts). The caller decides per learner; only then
   * does the line "booking is not possible before then" give way.
   */
  canRenewEarly?: boolean;
}

/** a-renew-early: the line that replaces "Vorher ist eine Buchung hier noch nicht möglich" (Lektor APPROVE with edits, 15 Oct 2026). */
export const RENEW_EARLY_LINE = {
  de: (end: string) => `<p>Wenn Sie weitermachen möchten, können Sie schon jetzt einen Tarif buchen. Die neue Laufzeit beginnt erst, wenn Ihr jetziger Zugang am <strong>${end}</strong> endet, also ohne Lücke und ohne verlorene Tage.</p>`,
  en: (end: string) => `<p>If you want to continue, you can book a plan now. The new period only starts when your current access ends on <strong>${end}</strong>, so there is no gap and no days are lost.</p>`,
} as const;

/**
 * copy-audit F05 (Lektor, 15 Oct 2026), byte-exact: the next-step paragraph
 * before the plan list (journey M5 to M6: next track first, price last).
 * One of three first sentences by bank, then the reply line. {END} is the
 * access end the mail already states. tests/unit/a-pricing-v2-fit pins the
 * sha256 of the audit's proposed block.
 */
export const F05_NEXT_STEP = {
  de: {
    neutral: "Was steht bei Ihnen als Nächstes an? Tragen Sie Ihre nächste Prüfung und den Termin in den Einstellungen ein, dann bleibt Ihr Lernplan auf Kurs. Ihr Lernstand bleibt gespeichert.",
    stichprobentest: "Nach dem Stichprobentest folgen für fast alle Nostrifikantinnen und Nostrifikanten Rezeptierkunde und Gerichtsmedizin; Ihr Ergebnis bestimmt, welche weiteren Prüfungen dazukommen. Ihr Lernstand bleibt gespeichert.",
    sip: "Welcher SIP-Block oder welche Prüfung kommt als Nächstes? Wählen Sie sie in den Einstellungen aus, dann läuft Ihr Plan weiter. Ihr Lernstand bleibt gespeichert.",
    reply: "Liegt Ihr nächster Prüfungstermin vor dem {ENDDATUM}? Antworten Sie einfach auf diese E-Mail.",
    placeholder: "{ENDDATUM}",
  },
  en: {
    neutral: "What is next for you? Add your next exam and sitting in your settings and your study plan stays on course. Your progress stays saved.",
    stichprobentest: "After the Stichprobentest, Rezeptierkunde and Gerichtsmedizin follow for almost every Nostrifikant; your result decides which further exams are added. Your progress stays saved.",
    sip: "Which SIP block or exam comes next? Pick it in your settings and your plan carries on. Your progress stays saved.",
    reply: "Is your next exam before {ENDDATE}? Just reply to this email.",
    placeholder: "{ENDDATE}",
  },
} as const;

/** Which F05 first sentence a bank (users.active_exam) gets; any other bank gets the neutral one. */
const F05_BANK_SENTENCE: Partial<Record<ExamSourceId, "stichprobentest" | "sip">> = { kmp_innsbruck: "stichprobentest", kenntnispruefung: "sip" };

/** The F05 paragraph for one learner: the bank's first sentence, then the reply line. */
export function nextStepParagraphs(lang: "de" | "en", activeExam: string | null | undefined, endFmt: string): [string, string] {
  const c = F05_NEXT_STEP[lang];
  const kind = activeExam && Object.prototype.hasOwnProperty.call(F05_BANK_SENTENCE, activeExam) ? F05_BANK_SENTENCE[activeExam as ExamSourceId] : undefined;
  const first = kind ? c[kind] : c.neutral;
  return [first, c.reply.replace(c.placeholder, endFmt)];
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
  // After the plans and their button, never before them (price last still binds).
  const winbackLine = args.winback ? `\n<p>${escapeHtml(winbackCopy(lang).mailLine(args.winback.credits, args.winback.days))}</p>\n` : "";

  const cohort = formatEuro(TIERS.premium_pass_guaranteed.price_cents);
  const threeMonth = formatEuro(TIERS.first_3mo_27.price_cents);
  const singleMonth = formatEuro(TIERS.first_month_19.price_cents);
  // a-pricing-v2: the v2 offer for new bookings (PRICING_V2_ENABLED).
  // a-pricing-v2-fit: names and amounts from the one price source.
  const v2 = pricingV2Enabled();
  const returning = v2 && args.returningPrices === true;
  const p = (tier: Parameters<typeof planPrice>[0]) => planPrice(tier, lang);
  const n = (tier: Parameters<typeof planName>[0]) => planName(tier, lang);
  const V2_PLAN_LIST = {
    de: `<ul>
  <li><strong>${n("sitting_pass")}</strong>: ${p("sitting_pass")} einmalig, Zugang bis zum Tag nach Ihrem gewählten Prüfungstermin (mindestens 30 Tage, höchstens 3 Monate). Kein Abo.</li>
  <li><strong>${n("flex_month")}</strong>: ${p("flex_month")} pro Monat, abgebucht alle 30 Tage.</li>
  <li><strong>${n("half_year")}</strong>: ${p("half_year")} alle 180 Tage; sobald Ihr Prüfungstermin vorbei ist, verlängert er sich nicht mehr.</li>
  <li><strong>${n("guarantee_ticket")}</strong>: ${p("guarantee_ticket")} einmalig für 12 Monate, mit bis zu zwei Verlängerungsjahren ohne Abbuchung auf Nachweis. Kein Abo.</li>
</ul>`,
    en: `<ul>
  <li><strong>${n("sitting_pass")}</strong>: ${p("sitting_pass")} once, access until the day after the sitting you choose (at least 30 days, at most 3 months). No subscription.</li>
  <li><strong>${n("flex_month")}</strong>: ${p("flex_month")} per month, charged every 30 days.</li>
  <li><strong>${n("half_year")}</strong>: ${p("half_year")} every 180 days; it stops renewing once your exam date has passed.</li>
  <li><strong>${n("guarantee_ticket")}</strong>: ${p("guarantee_ticket")} once for 12 months, with up to two renewal years without a charge, on proof. No subscription.</li>
</ul>`,
  };
  // D-A: the old recurring plans for a returning payer, price last, no deadline.
  const RETURNING_LIST = {
    de: `<p>Weil Sie schon bei uns gebucht haben, können Sie auch unsere bisherigen Tarife buchen:</p>
<ul>
  <li><strong>${n("first_month_19")} (bisheriger Tarif)</strong>: abgebucht alle 30 Tage, bis Sie kündigen, ${p("first_month_19")} pro Monat.</li>
  <li><strong>${n("first_3mo_27")}</strong>: abgebucht alle 90 Tage, bis Sie kündigen, ${p("first_3mo_27")} für 3 Monate.</li>
</ul>`,
    en: `<p>Because you have booked with us before, you can also book our earlier plans:</p>
<ul>
  <li><strong>${n("first_month_19")} (earlier plan)</strong>: charged every 30 days until you cancel, ${p("first_month_19")} per month.</li>
  <li><strong>${n("first_3mo_27")}</strong>: charged every 90 days until you cancel, ${p("first_3mo_27")} for 3 months.</li>
</ul>`,
  };
  const [nextStep, nextReply] = nextStepParagraphs(lang, args.activeExam ?? null, endFmt);
  const wrapStyle =
    "font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;";
  const btnStyle =
    "display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;";

  if (lang === "de") {
    const dayWord = w.days(daysLeft);
    // D2 ([name] 14 Oct, Lektor APPROVE): recurring plans first, 3 Monate recommended, Cohort last.
    // Lead "Vorher ist eine Buchung hier noch nicht möglich" / "Booking is not possible here before then" stays for every
    // learner the checkout would refuse; RENEW_EARLY_LINE replaces it only where canRenewEarly (a-renew-early, Lektor gate).
    const subject = `Ihr MedPrüf Pro-Zugang endet in ${daysLeft} ${dayWord}`;
    const htmlBody = `<!DOCTYPE html>
<html><body style="${wrapStyle}">
<p>Hallo${greetingName},</p>

<p>kurzer Hinweis: Ihr <strong>MedPrüf Pro-Zugang</strong> endet am <strong>${endFmt}</strong>, also in ca. ${daysLeft} ${dayWord}. Für diesen Zugang ist keine automatische Abbuchung eingerichtet. Wenn Sie nichts tun, endet er an diesem Datum, und es wird nichts abgebucht.</p>

${statsLine ? `<p><strong>Was Sie in dieser Zeit aufgebaut haben:</strong> ${statsLine}.<br>Das alles bleibt erhalten, wenn Sie weitermachen.</p>` : ""}

<p>${nextStep}</p>
<p>${nextReply}</p>

${args.canRenewEarly ? RENEW_EARLY_LINE.de(endFmt) : `<p>Wenn Sie danach weitermachen möchten: Sobald Ihr Zugang am <strong>${endFmt}</strong> endet, können Sie jederzeit selbst einen Tarif buchen. Vorher ist eine Buchung hier noch nicht möglich.</p>`}
${v2 ? V2_PLAN_LIST.de : `<ul>
  <li><strong>3 Monate</strong> (empfohlen): ${threeMonth} für 3 Monate, danach alle 90 Tage wieder ${threeMonth}.</li>
  <li><strong>Monatsabo</strong>: ${singleMonth} pro Monat, abgebucht alle 30 Tage.</li>
  <li><strong>Prüfungs-Kohorte</strong>: ${cohort} einmalig für 6 Monate, mit Pass-Until-You-Pass-Garantie. Einmalzahlung, kein Abo.</li>
</ul>`}
${returning ? RETURNING_LIST.de : ""}
<p>${returning ? "„Monatsabo“ und „3 Monate“ laufen weiter, bis Sie kündigen; „6 Monate“ läuft weiter, bis Sie kündigen oder Ihr Prüfungstermin vorbei ist." : v2 ? "„Monatsabo“ läuft weiter, bis Sie kündigen; „6 Monate“ läuft weiter, bis Sie kündigen oder Ihr Prüfungstermin vorbei ist." : "„3 Monate“ und „Monatsabo“ sind Abos, die bis zur Kündigung weiterlaufen."} Kündigen können Sie bei Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (Mitgliedschaft auswählen, dann „Cancel membership“; die Seite ist auf Englisch). Gebucht wird per Karten-Checkout über Whop.</p>
<p><a href="https://medpruf.com/pricing" style="${btnStyle}">Tarife ansehen →</a></p>
${winbackLine}
<p>Falls Sie nicht weitermachen möchten, ist das in Ordnung. Ihr Konto bleibt bestehen, Sie können die kostenlose Probe (${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank) weiter nutzen, und wenn Sie später zurückkommen, ist alles noch da.</p>

<p>Bei Fragen: einfach auf diese Mail antworten (${BILLING_SUPPORT_EMAIL}). Wenn Sie solche Hinweise nicht mehr erhalten möchten, antworten Sie mit „Stopp“.</p>

<p>Viele Grüße, [name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.de}</small></p>
</body></html>`;
    return { subject, htmlBody };
  }

  const dayWord = w.days(daysLeft);
  // Same D2 order and WHOP_EXTENSIONS_ENABLED coupling as the German branch.
  const subject = `Your MedPrüf Pro access ends in ${daysLeft} ${dayWord}`;
  const htmlBody = `<!DOCTYPE html>
<html><body style="${wrapStyle}">
<p>Hi${greetingName},</p>

<p>quick heads-up: your <strong>MedPrüf Pro access</strong> ends on <strong>${endFmt}</strong>, about ${daysLeft} ${dayWord} from now. No automatic charge is set up for this access. If you do nothing, it simply ends on that date and nothing is charged.</p>

${statsLine ? `<p><strong>What you've built so far:</strong> ${statsLine}.<br>All of it stays if you continue.</p>` : ""}

<p>${nextStep}</p>
<p>${nextReply}</p>

${args.canRenewEarly ? RENEW_EARLY_LINE.en(endFmt) : `<p>If you want to continue afterwards: once your access ends on <strong>${endFmt}</strong>, you can book a plan yourself at any time. Booking is not possible here before then.</p>`}
${v2 ? V2_PLAN_LIST.en : `<ul>
  <li><strong>3 months</strong> (recommended): ${threeMonth} for 3 months, then ${threeMonth} again every 90 days.</li>
  <li><strong>Monthly plan</strong>: ${singleMonth} per month, charged every 30 days.</li>
  <li><strong>Exam Cohort</strong>: ${cohort} once for 6 months, with the Pass-Until-You-Pass guarantee. One-time payment, no subscription.</li>
</ul>`}
${returning ? RETURNING_LIST.en : ""}
<p>${returning ? "The monthly plans and \"3 months\" keep running until you cancel; \"6 months\" runs until you cancel or your exam date has passed." : v2 ? "\"Monthly plan\" keeps running until you cancel; \"6 months\" runs until you cancel or your exam date has passed." : "\"3 months\" and \"Monthly plan\" are subscriptions that keep running until you cancel."} You can cancel at Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (select your membership, then "Cancel membership"). Booking is by card checkout through Whop.</p>
<p><a href="https://medpruf.com/pricing" style="${btnStyle}">See plans →</a></p>
${winbackLine}
<p>If you want to stop, that's fine. Your account stays, you can keep using the free sample (${FREE_TIER.questions_per_exam_type} questions per question bank), and if you come back later everything is still there.</p>

<p>Questions: just reply to this email (${BILLING_SUPPORT_EMAIL}). If you no longer want notes like this, reply "Stop".</p>

<p>Best, [name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.en}</small></p>
</body></html>`;
  return { subject, htmlBody };
}
