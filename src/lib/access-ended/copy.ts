/**
 * Copy of the post-expiry mail (a-renewal-pack-1019). DE Sie and EN, no em
 * dashes, no price, no plan name, no exam date. Built from the Lektor-approved
 * 19 Oct hand note (reports/backlog-out/a-renewal-dunning-diagnose-1019/drafts/
 * 0944349d-de.txt) without its beta paragraph. Lektor gate for the class:
 * reports/backlog-out/a-renewal-pack-1019/.
 */
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";

export type AccessEndedLang = "de" | "en";

export interface AccessEndedArgs {
  lang: AccessEndedLang;
  /** The pass end the learner had (ISO). */
  endedAtIso: string;
  /** Questions answered in total; 0 or unknown leaves the line out. */
  answered: number | null;
  /** users.active_exam; only the Stichprobentest bank gets a named line. */
  activeExam: string | null;
}

export const ACCESS_ENDED_PRICING_URL = "https://medpruf.com/pricing?utm_source=access_ended&utm_medium=mail&utm_campaign=renewal";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** de-AT: an Austrian January reads "Jänner" (Lektor 19 Oct). */
const DATE_LOCALE = { de: "de-AT", en: "en-GB" } as const;

export function accessEndedDate(endedAtIso: string, lang: AccessEndedLang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" })
    .format(new Date(endedAtIso));
}

export const ACCESS_ENDED_COPY = {
  de: {
    subject: "Ihr Lernstand bei MedPrüf bleibt gespeichert",
    hello: "Guten Tag,",
    lead: (date: string) => `Ihr Zugang zu MedPrüf ist am ${date} ausgelaufen. Ihr Konto und Ihr Lernstand bleiben gespeichert, und Ihre kostenlosen Probefragen stehen Ihnen weiter offen, soweit sie nicht aufgebraucht sind.`,
    answered: (n: number) => `Bisher haben Sie ${n} ${n === 1 ? "Frage" : "Fragen"} beantwortet.`,
    back: {
      kmp_innsbruck: "Wenn Sie sich weiter auf den Stichprobentest vorbereiten möchten, können Sie jederzeit wieder einsteigen.",
      other: "Wenn Sie sich weiter auf Ihre Prüfung vorbereiten möchten, können Sie jederzeit wieder einsteigen.",
    },
    plans: "Die aktuellen Pläne sehen Sie hier:",
    plansLink: "Pläne ansehen",
    pause: "Wenn Sie lieber pausieren, ist das genauso in Ordnung.",
    reply: `Und falls Ihnen etwas gefehlt hat oder etwas nicht funktioniert hat: Antworten Sie einfach auf diese E-Mail (${BILLING_SUPPORT_EMAIL}).`,
    bye: "Viele Grüße<br>[name]<br>Gründer von MedPrüf",
    stop: "Antworten Sie mit Stopp, dann schreibe ich Ihnen nicht mehr.",
  },
  en: {
    subject: "Your MedPrüf progress stays saved",
    hello: "Hello,",
    lead: (date: string) => `Your MedPrüf access ended on ${date}. Your account and your progress stay saved, and your free sample questions stay open to you, unless you have already used them up.`,
    answered: (n: number) => `So far you have answered ${n} ${n === 1 ? "question" : "questions"}.`,
    back: {
      kmp_innsbruck: "If you want to keep preparing for the Stichprobentest, you can come back at any time.",
      other: "If you want to keep preparing for your exam, you can come back at any time.",
    },
    plans: "You can see the current plans here:",
    plansLink: "See the plans",
    pause: "If you would rather take a break, that is fine too.",
    reply: `And if something was missing or did not work for you: just reply to this email (${BILLING_SUPPORT_EMAIL}).`,
    bye: "Best regards,<br>[name]<br>Founder of MedPrüf",
    stop: "Reply with Stopp and I will not write to you again.",
  },
} as const;

export function renderAccessEnded(args: AccessEndedArgs): { subject: string; htmlBody: string } {
  if (!Number.isFinite(Date.parse(args.endedAtIso))) throw new Error("Missing access end");
  const c = ACCESS_ENDED_COPY[args.lang];
  const date = accessEndedDate(args.endedAtIso, args.lang);
  const answered = args.answered && args.answered > 0 ? `<p>${esc(c.answered(args.answered))}</p>` : "";
  const back = args.activeExam === "kmp_innsbruck" ? c.back.kmp_innsbruck : c.back.other;
  const htmlBody = [
    `<p>${c.hello}</p>`,
    `<p>${esc(c.lead(date))}</p>`,
    answered,
    `<p>${esc(back)} ${esc(c.plans)} <a href="${esc(ACCESS_ENDED_PRICING_URL)}">${esc(c.plansLink)}</a>. ${esc(c.pause)}</p>`,
    `<p>${esc(c.reply)}</p>`,
    `<p>${c.bye}</p>`,
    `<p style="color:#6b7280;font-size:12px">${esc(c.stop)}</p>`,
  ].filter(Boolean).join("\n");
  return { subject: c.subject, htmlBody };
}
