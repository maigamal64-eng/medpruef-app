import { escapeHtml as e, SITE } from "@/lib/reminders/common";
import { COMPANY } from "@/lib/content-truth";
import { DAY1_COPY, type Day1Lang } from "./copy";

/** Starter set: ten questions. Plain link, no tracking parameters (rulebook v1 point 10); attribution is the signed token and the holdout. */
export function day1StarterUrl(): string {
  return `${SITE}/quiz?limit=10`;
}

export interface Day1MailInput {
  lang: Day1Lang;
  /** Absolute one-tap sitting link (sittingLinkUrl with a signed day1 token). */
  sittingUrl: string;
}

export function renderDay1Ask(input: Day1MailInput): { subject: string; htmlBody: string } {
  const t = DAY1_COPY[input.lang];
  const starter = day1StarterUrl();
  return {
    subject: t.subject,
    htmlBody: `<!DOCTYPE html><html lang="${input.lang}"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;"><h1 style="font-size:20px;">${e(t.heading)}</h1><p>${e(t.lead)}</p><p><a href="${e(input.sittingUrl)}" style="display:inline-block;padding:12px 18px;background:#003a8c;color:#ffffff;text-decoration:none;border-radius:8px;">${e(t.pickCta)}</a></p><p>${e(t.starterLead)} <a href="${e(starter)}">${e(t.starterCta)}</a></p><p style="color:#4a5568;font-size:13px;">${e(t.why)}</p><p>${e(t.stop)}</p><p>${e(t.signoff)}<br><small style="color:#4a5568;">${e(COMPANY.one_line[input.lang])}</small></p></body></html>`,
  };
}
