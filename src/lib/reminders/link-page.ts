import { NextResponse } from "next/server";
import { escapeHtml as e, noStore } from "./common";

// a30: the pages behind reminder links (b19 security finding S4). A GET never
// changes consent: the confirmation link opens a page whose button POSTs the
// token, so a mail link scanner cannot confirm on the recipient's behalf.
// Unsubscribe stays one tap (GET), which a scanner can at worst trigger as an
// opt-out. Pages are self-contained (no scripts, no external assets), DE/EN.
export type LinkLang = "de" | "en";
export function linkLang(value: string | null | undefined): LinkLang {
  return value === "de" ? "de" : "en";
}

type Kind = "exam" | "study";
const COPY = {
  de: {
    title: { exam: "Fristerinnerungen", study: "Lernerinnerungen" },
    confirmLead: { exam: "Möchten Sie die Erinnerungen an Ihre Anmeldefristen einschalten?", study: "Möchten Sie die Lernerinnerungen für diese E-Mail-Adresse einschalten?" },
    confirmButton: "Ja, einschalten",
    confirmed: { exam: "Danke. Wir erinnern Sie 14, 7, 3 und 1 Tag vor dem Anmeldeschluss.", study: "Danke. Die Lernerinnerungen sind eingeschaltet. Sie können sie in den Einstellungen jederzeit ändern." },
    unsubscribed: { exam: "Sie erhalten keine Fristerinnerungen mehr.", study: "Sie erhalten keine Lernerinnerungen mehr." },
    invalid: "Dieser Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
    retry: "Das hat gerade nicht geklappt. Bitte versuchen Sie es in einigen Minuten erneut.",
    home: "Zu MedPrüf",
  },
  en: {
    title: { exam: "Deadline reminders", study: "Study reminders" },
    confirmLead: { exam: "Turn on reminders about your registration deadlines?", study: "Turn on study reminders for this email address?" },
    confirmButton: "Yes, turn on",
    confirmed: { exam: "Thank you. We will remind you 14, 7, 3 and 1 day before registration closes.", study: "Thank you. Study reminders are on. You can change them in your settings at any time." },
    unsubscribed: { exam: "You will not receive deadline reminders any more.", study: "You will not receive study reminders any more." },
    invalid: "This link is invalid or has expired. Please request a new one.",
    retry: "That did not work just now. Please try again in a few minutes.",
    home: "Go to MedPrüf",
  },
} as const;

function page(lang: LinkLang, kind: Kind, inner: string, status: number) {
  const t = COPY[lang];
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MedPrüf: ${e(t.title[kind])}</title><style>:root{color-scheme:light dark}body{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;margin:0;padding:24px 16px;background:#F7F9FC;color:#1A2B3C;line-height:1.55}main{max-width:480px;margin:10vh auto 0}h1{font-size:22px;margin:0 0 12px}button{font:inherit;font-weight:600;min-height:44px;padding:10px 20px;border:0;border-radius:8px;background:#003A8C;color:#fff;cursor:pointer}a{color:#003A8C}@media (prefers-color-scheme:dark){body{background:#0F172A;color:#E2E8F0}button{background:#4D8DF0;color:#001B3D}a{color:#8AB4F8}}</style></head><body><main><h1>${e(t.title[kind])}</h1>${inner}<p><a href="https://medpruf.com/">${e(t.home)}</a></p></main></body></html>`;
  return new NextResponse(html, { status, headers: { ...noStore, "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
}

/** GET ?confirm=: a button that POSTs the token; nothing is written yet. */
export function confirmFormPage(lang: LinkLang, kind: Kind, action: string, token: string) {
  const t = COPY[lang];
  return page(lang, kind, `<p>${e(t.confirmLead[kind])}</p><form method="post" action="${e(action)}"><input type="hidden" name="confirm" value="${e(token)}"><input type="hidden" name="lang" value="${lang}"><button type="submit">${e(t.confirmButton)}</button></form>`, 200);
}
export function resultPage(lang: LinkLang, kind: Kind, outcome: "confirmed" | "unsubscribed" | "invalid" | "retry") {
  const t = COPY[lang];
  const text = outcome === "confirmed" ? t.confirmed[kind] : outcome === "unsubscribed" ? t.unsubscribed[kind] : outcome === "invalid" ? t.invalid : t.retry;
  return page(lang, kind, `<p role="status">${e(text)}</p>`, outcome === "invalid" ? 400 : outcome === "retry" ? 503 : 200);
}
/** Reads the confirm token and language from a form POST, or null when the body is not a form. */
export async function readConfirmForm(req: Request): Promise<{ token: string; lang: LinkLang } | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return { token: "", lang: "en" };
  try {
    const form = new URLSearchParams((await req.text()).slice(0, 4096));
    const token = form.get("confirm");
    return { token: token ?? "", lang: linkLang(form.get("lang")) };
  } catch { return null; }
}
