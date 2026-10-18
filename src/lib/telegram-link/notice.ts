/**
 * "Telegram was linked to your account" (a-trial-phone-gate, Reviewer P2):
 * once the bot binds a Telegram, Telegram can sign in to the account, so the
 * address on the account gets one transactional notice through the
 * do-not-email list. Never throws; a failed send is reported, never retried.
 * No typed name in the greeting (same rule as the confirmation mail).
 * Lektor APPROVE WITH EDITS (transactional), 17 Oct 2026, applied. Formal Sie, no dashes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { sendZohoEmail, type SendZohoEmailArgs, type SendZohoEmailResult } from "@/lib/email/zoho";
import { escapeHtml as e } from "@/lib/reminders/common";
import { COMPANY } from "@/lib/content-truth";
import { captureServerError } from "@/lib/sentry-capture";

export const LINK_NOTICE_COPY = {
  de: {
    subject: "MedPrüf: Telegram wurde mit Ihrem Konto verknüpft",
    greeting: "Guten Tag,",
    body: "Ihr MedPrüf-Konto ist jetzt mit einem Telegram-Konto verknüpft. Damit können Sie sich auch mit Telegram anmelden.",
    notYou: "Waren Sie das nicht? Antworten Sie bitte auf diese E-Mail, dann trennen wir die Verknüpfung und melden Ihr Konto überall ab.",
    signoff: "Viele Grüße,",
  },
  en: {
    subject: "MedPrüf: Telegram was linked to your account",
    greeting: "Hello,",
    body: "Your MedPrüf account is now linked to a Telegram account. From now on you can also sign in with Telegram.",
    notYou: "Was this not you? Please reply to this email, and we will remove the link and sign your account out everywhere.",
    signoff: "Best regards,",
  },
} as const;

export function renderLinkNotice(lang: "de" | "en"): { subject: string; htmlBody: string } {
  const t = LINK_NOTICE_COPY[lang];
  const htmlBody = `<!DOCTYPE html><html lang="${lang}"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">`
    + `<p>${e(t.greeting)}</p><p>${e(t.body)}</p><p>${e(t.notYou)}</p>`
    + `<p style="margin-top:28px;">${e(t.signoff)}<br>[name]<br><small style="color:#4a5568;">${e(COMPANY.one_line[lang])}</small></p>`
    + `</body></html>`;
  return { subject: t.subject, htmlBody };
}

type Send = (args: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;

export async function sendLinkNotice(
  sb: SupabaseClient,
  args: { userId: string; email: string | null; languageCode: string | null; send?: Send },
): Promise<"sent" | "skipped" | "failed"> {
  if (!args.email) return "skipped";
  try {
    const mail = renderLinkNotice(args.languageCode === "de" ? "de" : "en");
    const result = await sendUnlessSuppressed(sb, "transactional", { to: args.email, subject: mail.subject, htmlBody: mail.htmlBody }, args.send ?? sendZohoEmail);
    if (result.ok) return "sent";
    if (result.reason === "suppressed" || result.reason === "invalid_address") return "skipped";
    captureServerError(new Error(`telegram link notice failed: ${result.reason}`), { route: "/api/telegram/webhook", phase: "telegram_link_notice", userId: args.userId });
    return "failed";
  } catch (err) {
    captureServerError(err, { route: "/api/telegram/webhook", phase: "telegram_link_notice", userId: args.userId });
    return "failed";
  }
}
