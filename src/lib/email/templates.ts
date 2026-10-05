/**
 * Email templates — DE primary, EN fallback. Per-template render
 * functions return { subject, htmlBody } so callers can drop them
 * straight into sendZohoEmail().
 *
 * Voice: doctor-to-doctor `du` (per COPY-BUNDLE §10). Currency 129 €.
 * No exclamation marks except on Glückwunsch / Willkommen.
 *
 * review-2026-04-26-C1.
 */

import { formatEuro } from "@/lib/content-truth";
import { BILLING_SUPPORT_EMAIL, WHOP_MANAGE_URL, WHOP_MANAGE_TEXT } from "@/lib/billing-copy";

export interface TrialReminderArgs {
  firstName: string | null;
  lang: "de" | "en";
  expiresAtIso: string;
  /** Optional snapshot of the user's progress for endowment framing. */
  qsAnswered?: number;
  accuracyPct?: number;
  streakDays?: number;
}

export function renderTrialReminder(args: TrialReminderArgs): {
  subject: string;
  htmlBody: string;
} {
  const { firstName, lang, expiresAtIso, qsAnswered, accuracyPct, streakDays } =
    args;

  const expires = new Date(expiresAtIso);
  const daysLeft = Math.max(
    1,
    Math.ceil((expires.getTime() - Date.now()) / 86_400_000),
  );
  const expiresFmt = expires.toLocaleDateString(
    lang === "de" ? "de-AT" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" },
  );

  const greetingName = firstName ? `, ${firstName}` : "";
  const stats: string[] = [];
  if (qsAnswered && qsAnswered > 0) {
    stats.push(
      lang === "de" ? `${qsAnswered} Fragen beantwortet` : `${qsAnswered} questions answered`,
    );
  }
  if (accuracyPct && accuracyPct > 0) {
    stats.push(lang === "de" ? `${accuracyPct} % richtig` : `${accuracyPct}% correct`);
  }
  if (streakDays && streakDays > 0) {
    stats.push(lang === "de" ? `${streakDays}-Tage-Streak` : `${streakDays}-day streak`);
  }
  const statsLine = stats.length > 0 ? stats.join(" · ") : null;

  const cohort = formatEuro(12900);
  const threeMonth = formatEuro(4900);
  const singleMonth = formatEuro(1900);

  if (lang === "de") {
    const subject = "Dein MedPrüf Pro-Zugang endet in 5 Tagen";
    const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;">
<p>Hallo${greetingName},</p>

<p>kurzer Hinweis: dein aktueller <strong>MedPrüf Pro-Zeitraum</strong> endet am <strong>${expiresFmt}</strong>, also in ca. ${daysLeft} Tagen.</p>

${statsLine ? `<p><strong>Was du in dieser Zeit aufgebaut hast:</strong> ${statsLine}.<br>Das alles bleibt erhalten, wenn du verlängerst.</p>` : ""}

<p><strong>Wichtig:</strong> Einzelmonat und 3-Monats-Tarif sind Abos und verlängern sich automatisch, bis du kündigst. Wenn du einen dieser Tarife hast und nicht gekündigt hast, musst du nichts tun. Deine Möglichkeiten:</p>

<ul>
  <li><strong>Einzelmonat</strong> (${singleMonth} pro Monat) und <strong>3-Monats-Tarif</strong> (${threeMonth} pro Quartal): verlängern sich automatisch. Zum Beenden kündige vor dem nächsten Verlängerungsdatum bei Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (Mitgliedschaft auswählen, dann „Cancel membership“).</li>
  <li><strong>Prüfungs-Kohorte</strong> (${cohort} einmalig, 6 Monate, Pass-Until-You-Pass-Garantie): Einmalzahlung ohne Verlängerung, Karten-Checkout über Whop, sofortiger Vollzugang.</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;">Tarife ansehen →</a></p>

<p>Falls du nicht weitermachen willst, alles gut. Dein Konto bleibt bestehen, du kannst die kostenlose Version (150 Fragen pro Prüfung) jederzeit weiter nutzen, und wenn du in einem halben Jahr zurückkommst, ist alles noch da.</p>

<p>Bei Fragen oder Hilfe beim Kündigen: einfach auf diese Mail antworten (${BILLING_SUPPORT_EMAIL}).</p>

<p>Liebe Grüße, [name]<br>
<small style="color:#4a5568;">MedPrüf · [name] · Österreich</small></p>
</body></html>`;
    return { subject, htmlBody: html };
  }

  // EN
  const subject = "Your MedPrüf Pro access ends in 5 days";
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;">
<p>Hi${greetingName},</p>

<p>quick heads-up: your current <strong>MedPrüf Pro period</strong> ends on <strong>${expiresFmt}</strong>, about ${daysLeft} days from now.</p>

${statsLine ? `<p><strong>What you've built so far:</strong> ${statsLine}.<br>All of it stays if you continue.</p>` : ""}

<p><strong>Good to know:</strong> the Single Month and 3-Month plans are subscriptions and renew automatically until you cancel. If you are on one of those and have not cancelled, you do not need to do anything. Your options:</p>

<ul>
  <li><strong>Single Month</strong> (${singleMonth} per month) and <strong>3-Month plan</strong> (${threeMonth} per quarter): renew automatically. To stop, cancel before the next renewal date at Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (select your membership, then "Cancel membership").</li>
  <li><strong>Exam Cohort</strong> (${cohort} once, 6 months, Pass-Until-You-Pass guarantee): one-time payment with no renewal, card checkout via Whop, instant full access.</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;">See plans →</a></p>

<p>If you want to stop, that's fine. Your account stays, you can keep using the free tier (150 questions per exam) anytime, and if you come back in six months everything is still there.</p>

<p>Questions or help cancelling: just reply to this email (${BILLING_SUPPORT_EMAIL}).</p>

<p>Best, [name]<br>
<small style="color:#4a5568;">MedPrüf · [name] · Austria</small></p>
</body></html>`;
  return { subject, htmlBody: html };
}
