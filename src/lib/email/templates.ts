/**
 * Email templates — DE primary, EN fallback. Per-template render
 * functions return { subject, htmlBody } so callers can drop them
 * straight into sendZohoEmail().
 *
 * Voice: doctor-to-doctor `du` (per COPY-BUNDLE §10). Currency 114 €.
 * No exclamation marks except on Glückwunsch / Willkommen.
 *
 * review-2026-04-26-C1.
 */

import { formatEuro } from "@/lib/content-truth";

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

  const cohort = formatEuro(11400);
  const sixMo = formatEuro(14900);
  const twelveMo = formatEuro(22900);
  const monthly = formatEuro(2900);

  if (lang === "de") {
    const subject = "Dein MedPrüf Pro-Zugang endet in 5 Tagen";
    const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;">
<p>Hallo${greetingName},</p>

<p>kurzer Hinweis: dein <strong>MedPrüf Pro-Zugang</strong> läuft am <strong>${expiresFmt}</strong> aus, also in ca. ${daysLeft} Tagen.</p>

${statsLine ? `<p><strong>Was du in dieser Zeit aufgebaut hast:</strong> ${statsLine}.<br>Das alles bleibt erhalten, wenn du verlängerst.</p>` : ""}

<p>Es gibt <strong>keine automatische Verlängerung</strong>, du entscheidest aktiv. Vier Optionen:</p>

<ul>
  <li><strong>Prüfungs-Kohorte</strong> (${cohort}, 6 Monate, Pass-Until-You-Pass-Garantie), wenn deine Prüfung im September oder Oktober ist.</li>
  <li><strong>12 Monate</strong> (${twelveMo}): wenn du den langen Weg gehst und PUYP brauchst.</li>
  <li><strong>6 Monate</strong> (${sixMo}, mit PUYP): solider Mittelweg.</li>
  <li><strong>Monatlich</strong> (${monthly}/Monat, sobald Karten-Zahlung live ist): nur einen Monat probieren.</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;">Tarife ansehen →</a></p>

<p>Falls du nicht weitermachen willst, alles gut. Dein Konto bleibt bestehen, du kannst die kostenlose Version (150 Fragen pro Prüfung) jederzeit weiter nutzen, und wenn du in einem halben Jahr zurückkommst, ist alles noch da.</p>

<p>Bei Fragen: einfach auf diese Mail antworten.</p>

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

<p>quick heads-up: your <strong>MedPrüf Pro access</strong> expires on <strong>${expiresFmt}</strong>, about ${daysLeft} days from now.</p>

${statsLine ? `<p><strong>What you've built so far:</strong> ${statsLine}.<br>All of it stays if you continue.</p>` : ""}

<p>There is <strong>no auto-renewal</strong>, you actively decide. Four options:</p>

<ul>
  <li><strong>Exam Cohort</strong> (${cohort}, 6 months, Pass-Until-You-Pass guarantee), if your exam is in September or October.</li>
  <li><strong>12 months</strong> (${twelveMo}, with PUYP): long road, full guarantee.</li>
  <li><strong>6 months</strong> (${sixMo}, with PUYP): middle ground.</li>
  <li><strong>Monthly</strong> (${monthly}/mo, once card payment goes live): just try one more month.</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;">See plans →</a></p>

<p>If you want to stop, that's fine. Your account stays, you can keep using the free tier (150 questions per exam) anytime, and if you come back in six months everything is still there.</p>

<p>Questions: just reply to this email.</p>

<p>Best, [name]<br>
<small style="color:#4a5568;">MedPrüf · [name] · Austria</small></p>
</body></html>`;
  return { subject, htmlBody: html };
}
