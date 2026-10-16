/**
 * Copy of the reverse-trial end notice (a-reverse-trial-end-mail). DE Sie and
 * EN. No exam date, no price, no deadline wording: the only time named is the
 * real end of the 3-day trial ("in about 24 hours"). The sitting question
 * reuses the approved SITTING_LINK_MAIL_LINE of a-sitting-one-tap.
 */
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { COMPANY, FREE_TIER } from "@/lib/content-truth";
import { SITTING_LINK_MAIL_LINE } from "@/lib/sitting-link/copy";

export type NoticeLang = "de" | "en";

export interface NoticeArgs {
  lang: NoticeLang;
  firstName: string | null;
  /** Questions answered in total; 0 or unknown leaves the number out. */
  answered: number | null;
  /** In-app link (Home shows the trial-end card). */
  appUrl: string;
  /** Signed one-tap sitting link, only when no sitting is named. */
  sittingUrl: string | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const T = {
  de: {
    subject: "Ihr MedPrüf-Test endet in etwa 24 Stunden",
    lead: "Ihr Test mit vollem Zugang endet in etwa 24 Stunden.",
    saved: (n: number) => `Bisher haben Sie ${n} ${n === 1 ? "Frage" : "Fragen"} beantwortet. Ihr Fortschritt bleibt gespeichert.`,
    savedNoCount: "Ihr Fortschritt bleibt gespeichert.",
    free: `Danach steht Ihnen weiterhin die kostenlose Auswahl zur Verfügung (${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank, soweit noch nicht genutzt).`,
    plan: "In MedPrüf sehen Sie, welcher Tarif zu Ihrem Prüfungstermin passt. Sie entscheiden in Ruhe, es wird nichts automatisch gebucht.",
    cta: "Ihren passenden Tarif ansehen",
    stop: "Wenn Sie solche Hinweise nicht mehr erhalten möchten, antworten Sie mit „Stopp“.",
    help: `Bei Fragen: einfach auf diese Mail antworten (${BILLING_SUPPORT_EMAIL}).`,
    hello: (n: string) => `Hallo${n},`,
    bye: "Viele Grüße, [name]",
    company: COMPANY.one_line.de,
    tg: (n: string) => `Hallo${n}, Ihr MedPrüf-Test mit vollem Zugang endet in etwa 24 Stunden. Ihr Fortschritt bleibt gespeichert, und die kostenlose Auswahl (${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank, soweit noch nicht genutzt) bleibt Ihnen. Dies ist die einzige Nachricht dazu.`,
    tgBtn: "Passenden Tarif ansehen",
    tgSitting: SITTING_LINK_MAIL_LINE.de,
  },
  en: {
    subject: "Your MedPrüf trial ends in about 24 hours",
    lead: "Your full-access trial ends in about 24 hours.",
    saved: (n: number) => `So far you have answered ${n} ${n === 1 ? "question" : "questions"}. Your progress stays saved.`,
    savedNoCount: "Your progress stays saved.",
    free: `Afterwards the free sample stays available (${FREE_TIER.questions_per_exam_type} questions per question bank, as far as not already used).`,
    plan: "In MedPrüf you can see which plan fits your exam sitting. Take your time: nothing is booked automatically.",
    cta: "See the plan that fits you",
    stop: "If you no longer want to receive notes like this, reply with “Stopp”.",
    help: `Questions? Just reply to this email (${BILLING_SUPPORT_EMAIL}).`,
    hello: (n: string) => `Hi${n},`,
    bye: "Best regards, [name]",
    company: COMPANY.one_line.en,
    tg: (n: string) => `Hi${n}, your MedPrüf full-access trial ends in about 24 hours. Your progress stays saved, and the free sample (${FREE_TIER.questions_per_exam_type} questions per question bank, as far as not already used) stays available. This is the only message about this.`,
    tgBtn: "See the plan that fits you",
    tgSitting: SITTING_LINK_MAIL_LINE.en,
  },
} as const;

const wrapStyle =
  "font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;";
const btnStyle =
  "display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;";

function greeting(firstName: string | null): string {
  const n = (firstName ?? "").trim();
  return n ? ` ${esc(n)}` : "";
}

export function renderNoticeMail(a: NoticeArgs): { subject: string; htmlBody: string } {
  const t = T[a.lang];
  const saved = a.answered && a.answered > 0 ? t.saved(a.answered) : t.savedNoCount;
  const sitting = a.sittingUrl
    ? `<p>${t.tgSitting.text}<br><a href="${esc(a.sittingUrl)}">${t.tgSitting.cta}</a></p>`
    : "";
  const htmlBody = `<!DOCTYPE html>
<html lang="${a.lang}"><body style="${wrapStyle}">
<p>${t.hello(greeting(a.firstName))}</p>
<p><strong>${t.lead}</strong> ${saved}</p>
<p>${t.free}</p>
${sitting}
<p>${t.plan}</p>
<p><a href="${esc(a.appUrl)}" style="${btnStyle}">${t.cta} →</a></p>
<p>${t.help} ${t.stop}</p>
<p>${t.bye}<br>
<small style="color:#4a5568;">${t.company}</small></p>
</body></html>`;
  return { subject: t.subject, htmlBody };
}

/** Plain text for the customer bot, with URL buttons (the sitting link only when no sitting is named). */
export function renderNoticeTelegram(a: NoticeArgs): { text: string; buttons: { text: string; url: string }[] } {
  const t = T[a.lang];
  const buttons: { text: string; url: string }[] = [{ text: t.tgBtn, url: a.appUrl }];
  let text = t.tg(greeting(a.firstName).replace(/&amp;|&lt;|&gt;|&quot;/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' }[m] as string)));
  if (a.sittingUrl) {
    text += `\n\n${t.tgSitting.text}`;
    buttons.push({ text: t.tgSitting.cta, url: a.sittingUrl });
  }
  return { text, buttons };
}

export const NOTICE_APP_PATH = "https://medpruf.com/";
export function noticeAppUrl(channel: "email" | "telegram"): string {
  return `${NOTICE_APP_PATH}?utm_source=trial_end_notice&utm_medium=${channel === "email" ? "mail" : "telegram"}&utm_campaign=reverse_trial`;
}
