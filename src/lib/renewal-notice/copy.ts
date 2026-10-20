/**
 * Copy of the pre-charge renewal notice (a-renewal-pack-1019). DE Sie and EN,
 * no em dashes. Only Whop's own terms are stated: the charge day, the amount
 * of this buyer's next charge and the renewal interval. No plan name, no list
 * price, no offer. Lektor gate: reports/backlog-out/a-renewal-pack-1019/.
 *
 * The cancel steps are the reviewed sentence of billingPrechargeReminder, shown
 * only once VERIFIED_CANCEL_PATH is true; until then the notice offers the
 * Whop membership page plus "reply and we stop it for you".
 */
import { BILLING_SUPPORT_EMAIL, VERIFIED_CANCEL_PATH, WHOP_MANAGE_URL, billingAmount, billingPrechargeReminder } from "@/lib/billing-copy";

export type RenewalNoticeLang = "de" | "en";

export interface RenewalNoticeArgs {
  lang: RenewalNoticeLang;
  /** Whop's next charge instant (ISO). */
  chargeAtIso: string;
  /** This buyer's next charge in cents (Whop formatted_renewal_price). */
  amountCents: number;
  /** Whop renewal interval in days (30, 90 or 180). */
  intervalDays: number;
  /** Whop's buyer-side manage link for this membership, already validated. */
  manageUrl: string | null;
  /** Override for tests; defaults to the reviewed constant. */
  verifiedCancelPath?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** de-AT: an Austrian January reads "Jänner" (Lektor 19 Oct). */
const DATE_LOCALE = { de: "de-AT", en: "en-GB" } as const;

export function renewalNoticeDate(chargeAtIso: string, lang: RenewalNoticeLang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" })
    .format(new Date(chargeAtIso));
}

export const RENEWAL_NOTICE_COPY = {
  de: {
    subject: (date: string) => `Ihr MedPrüf-Abo verlängert sich am ${date}`,
    hello: "Guten Tag,",
    lead: (date: string, amount: string, days: number) =>
      `Ihr MedPrüf-Abo verlängert sich am ${date} automatisch. An diesem Tag werden ${amount} über Whop abgebucht, danach alle ${days} Tage, bis Sie kündigen.`,
    keep: "Wenn Sie weiterlernen möchten, müssen Sie nichts tun.",
    stop: (date: string) => `Wenn Sie nicht verlängern möchten, kündigen Sie bitte vor dem ${date} bei Whop.`,
    manage: "Mitgliedschaft bei Whop verwalten",
    assist: "Sie können auch einfach vor dem Tag der Abbuchung auf diese E-Mail antworten, dann beenden wir die Verlängerung für Sie.",
    help: `Fragen? Antworten Sie einfach auf diese E-Mail (${BILLING_SUPPORT_EMAIL}).`,
    why: "Sie erhalten diesen Hinweis, weil sich Ihr Abo automatisch verlängert.",
    bye: "Viele Grüße<br>[name]<br>MedPrüf",
  },
  en: {
    subject: (date: string) => `Your MedPrüf subscription renews on ${date}`,
    hello: "Hello,",
    lead: (date: string, amount: string, days: number) =>
      `Your MedPrüf subscription renews automatically on ${date}. On that day ${amount} is charged through Whop, then every ${days} days until you cancel.`,
    keep: "If you want to keep studying, you do not need to do anything.",
    stop: (date: string) => `If you do not want to renew, please cancel at Whop before ${date}.`,
    manage: "Manage your membership at Whop",
    assist: "You can also just reply to this email before the day of the charge and we will stop the renewal for you.",
    help: `Questions? Just reply to this email (${BILLING_SUPPORT_EMAIL}).`,
    why: "You receive this note because your subscription renews automatically.",
    bye: "Best regards,<br>[name]<br>MedPrüf",
  },
} as const;

export function renderRenewalNotice(args: RenewalNoticeArgs): { subject: string; htmlBody: string } {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0 || !Number.isInteger(args.intervalDays) || args.intervalDays <= 0) {
    throw new Error("Missing provider billing terms");
  }
  if (!Number.isFinite(Date.parse(args.chargeAtIso))) throw new Error("Missing provider billing terms");
  const c = RENEWAL_NOTICE_COPY[args.lang];
  const date = renewalNoticeDate(args.chargeAtIso, args.lang);
  const amount = billingAmount(args.amountCents, args.lang);
  const href = esc(args.manageUrl ?? WHOP_MANAGE_URL);
  const verified = args.verifiedCancelPath ?? VERIFIED_CANCEL_PATH;
  const steps = verified ? `<p>${esc(billingPrechargeReminder(date, args.amountCents, args.lang).steps)}</p>` : "";
  const htmlBody = [
    `<p>${c.hello}</p>`,
    `<p>${esc(c.lead(date, amount, args.intervalDays))}</p>`,
    `<p>${esc(c.keep)}</p>`,
    `<p>${esc(c.stop(date))} <a href="${href}">${esc(c.manage)}</a></p>`,
    steps,
    `<p>${esc(c.assist)}</p>`,
    `<p>${esc(c.help)}</p>`,
    `<p>${c.bye}</p>`,
    `<p style="color:#6b7280;font-size:12px">${esc(c.why)}</p>`,
  ].filter(Boolean).join("\n");
  return { subject: c.subject(date), htmlBody };
}
