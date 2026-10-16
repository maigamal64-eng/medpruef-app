/**
 * The two v2 reminder mails (a-pricing-v2), formal Sie, no em dashes.
 *   - Guarantee Ticket: 30 days before it ends, with the renewal-on-proof
 *     link while renewal years are left (TICKET_REMINDER_EMAILS_ENABLED).
 *   - 6 months: 7 days before every renewal charge, with the Whop manage
 *     link (HALF_YEAR_REMINDER_EMAILS_ENABLED). A billing notice on an
 *     existing contract counts as transactional (mail-suppression rules).
 *   - 6 months, renewal guard (a-pricing-v2-fit): the renewal would fall in
 *     the 14 days before the sitting, so it is stopped and access runs on
 *     without a charge to the day after the sitting. Replaces the 7-day
 *     reminder for that renewal.
 * Dates in Vienna time. Pure.
 */
import { BILLING_SUPPORT_EMAIL, WHOP_MANAGE_URL, billingAmount, type BillingLang } from "@/lib/billing-copy";
import { TICKET_MAX_RENEWALS } from "./ticket";

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function viennaDate(iso: string, lang: BillingLang): string {
  const locale = { de: "de-AT", en: "en-GB" }[lang];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(iso));
}

export interface Mail { subject: string; htmlBody: string }

export function ticketEndingMail(args: { lang: BillingLang; endsAt: string; renewalsUsed: number; formUrl: string }): Mail {
  const de = args.lang === "de";
  const date = viennaDate(args.endsAt, args.lang);
  const left = Math.max(0, TICKET_MAX_RENEWALS - args.renewalsUsed);
  const link = escapeHtml(args.formUrl);
  const renew = left > 0
    ? de
      ? `<p>Sie können noch ${left === 1 ? "ein kostenloses Verlängerungsjahr" : `${left} kostenlose Verlängerungsjahre`} erhalten, wenn Sie eines davon nachweisen: ein offizielles Ergebnis, mit dem Sie eine Prüfung nicht bestanden haben, oder eine Anmeldebestätigung für einen Prüfungstermin nach dem ${escapeHtml(date)}.</p><p><a href="${link}">Nachweis hochladen</a></p>`
      : `<p>You can still receive ${left === 1 ? "one free renewal year" : `${left} free renewal years`} when you prove one of these: an official result showing you did not pass an exam, or a registration confirmation for a sitting after ${escapeHtml(date)}.</p><p><a href="${link}">Upload your proof</a></p>`
    : de
      ? "<p>Sie haben beide kostenlosen Verlängerungsjahre bereits erhalten.</p>"
      : "<p>You have already received both free renewal years.</p>";
  return de
    ? {
        subject: `MedPrüf: Ihr Garantie-Ticket endet am ${date}`,
        htmlBody: `<p>Guten Tag,</p><p>Ihr Garantie-Ticket bei MedPrüf endet am ${escapeHtml(date)}. Es verlängert sich nicht automatisch, und es wird nichts abgebucht.</p>${renew}<p>Fragen beantworten wir unter ${BILLING_SUPPORT_EMAIL}.</p><p>Ihr MedPrüf-Team</p>`,
      }
    : {
        subject: `MedPrüf: your Guarantee Ticket ends on ${date}`,
        htmlBody: `<p>Hello,</p><p>Your MedPrüf Guarantee Ticket ends on ${escapeHtml(date)}. It does not renew automatically and nothing will be charged.</p>${renew}<p>Questions: ${BILLING_SUPPORT_EMAIL}.</p><p>The MedPrüf team</p>`,
      };
}

export function halfYearRenewalMail(args: { lang: BillingLang; chargeAt: string; amountCents: number | null; manageUrl: string | null }): Mail {
  const de = args.lang === "de";
  const date = viennaDate(args.chargeAt, args.lang);
  const manage = escapeHtml(args.manageUrl ?? WHOP_MANAGE_URL);
  const amount = args.amountCents !== null ? billingAmount(args.amountCents, args.lang) : null;
  return de
    ? {
        subject: `MedPrüf: Ihr 6-Monats-Tarif verlängert sich am ${date}`,
        htmlBody: `<p>Guten Tag,</p><p>Ihr 6-Monats-Tarif bei MedPrüf verlängert sich am ${escapeHtml(date)}${amount ? ` mit ${escapeHtml(amount)}` : ""} um weitere 6 Monate. Liegt Ihr Prüfungstermin bis dahin hinter Ihnen, beenden wir die Verlängerung für Sie.</p><p>Wenn Sie nicht verlängern möchten, kündigen Sie bei Whop vor diesem Datum: <a href="${manage}">Mitgliedschaft bei Whop verwalten</a> (Seite auf Englisch).</p><p>Fragen beantworten wir unter ${BILLING_SUPPORT_EMAIL}.</p><p>Ihr MedPrüf-Team</p>`,
      }
    : {
        subject: `MedPrüf: your 6-month plan renews on ${date}`,
        htmlBody: `<p>Hello,</p><p>Your MedPrüf 6-month plan renews on ${escapeHtml(date)}${amount ? ` at ${escapeHtml(amount)}` : ""} for another 6 months. If your exam date has passed by then, we stop the renewal for you.</p><p>If you do not want to renew, cancel at Whop before that date: <a href="${manage}">Manage your membership at Whop</a>.</p><p>Questions: ${BILLING_SUPPORT_EMAIL}.</p><p>The MedPrüf team</p>`,
      };
}

/** After the renewal stop (review P3): the plan will not charge again; access runs to the period end. */
export function halfYearStoppedMail(args: { lang: BillingLang; accessUntil: string | null }): Mail {
  const de = args.lang === "de";
  const until = args.accessUntil ? viennaDate(args.accessUntil, args.lang) : null;
  return de
    ? {
        subject: "MedPrüf: Ihr 6-Monats-Tarif verlängert sich nicht mehr",
        htmlBody: `<p>Guten Tag,</p><p>Ihr Prüfungstermin ist vorbei, deshalb haben wir die Verlängerung Ihres 6-Monats-Tarifs beendet. Es wird nichts mehr abgebucht.${until ? ` Ihr Zugang läuft bis ${escapeHtml(until)}.` : ""}</p><p>Wenn Sie weiter üben möchten, buchen Sie danach einfach einen neuen Tarif. Fragen beantworten wir unter ${BILLING_SUPPORT_EMAIL}.</p><p>Ihr MedPrüf-Team</p>`,
      }
    : {
        subject: "MedPrüf: your 6-month plan will not renew",
        htmlBody: `<p>Hello,</p><p>Your exam date has passed, so we stopped the renewal of your 6-month plan. Nothing more will be charged.${until ? ` Your access runs until ${escapeHtml(until)}.` : ""}</p><p>If you want to keep practising, simply book a new plan afterwards. Questions: ${BILLING_SUPPORT_EMAIL}.</p><p>The MedPrüf team</p>`,
      };
}

/**
 * a-pricing-v2-fit, the renewal guard (decision renewal-guard): sent when the
 * app stopped a renewal that would have fallen in the 14 days before the
 * learner's sitting. Says plainly: no charge, until when access runs, what to
 * do afterwards. Lektor re-gate before the switch-on.
 */
export function halfYearGuardMail(args: { lang: BillingLang; chargeAt: string; accessUntil: string }): Mail {
  const de = args.lang === "de";
  const charge = escapeHtml(viennaDate(args.chargeAt, args.lang));
  // accessUntil is the first instant after the day after the sitting; the
  // learner reads the last full day.
  const until = escapeHtml(viennaDate(new Date(Date.parse(args.accessUntil) - 1).toISOString(), args.lang));
  return de
    ? {
        subject: "MedPrüf: Ihr 6-Monats-Tarif verlängert sich nicht vor Ihrer Prüfung",
        htmlBody: `<p>Guten Tag,</p><p>Ihr 6-Monats-Tarif hätte sich am ${charge} verlängert, also in den 14 Tagen vor Ihrem Prüfungstermin. Deshalb verlängert er sich nicht mehr, und es wird nichts mehr abgebucht. Ihr Zugang läuft bis einschließlich ${until}, dem Tag nach Ihrem Termin.</p><p>Wenn Sie danach weiter üben möchten, buchen Sie einfach einen neuen Tarif. Fragen beantworten wir unter ${BILLING_SUPPORT_EMAIL}.</p><p>Viele Grüße, [name]</p>`,
      }
    : {
        subject: "MedPrüf: your 6-month plan will not renew before your exam",
        htmlBody: `<p>Hello,</p><p>Your 6-month plan would have renewed on ${charge}, in the 14 days before your exam. So it will not renew, and nothing more will be charged. Your access runs through ${until}, the day after your sitting.</p><p>If you want to keep practising afterwards, simply book a new plan. Questions: ${BILLING_SUPPORT_EMAIL}.</p><p>Best, [name]</p>`,
      };
}
