/**
 * The page behind the confirmation link (a-email-confirm-trial). Same shape
 * as the a30 reminder link pages: self-contained HTML, no scripts, no
 * external assets, strict CSP, noindex, no-store. GET shows a button that
 * POSTs the token as a form; only the POST writes. DE/EN by the link's lang.
 */
import { NextResponse } from "next/server";
import { escapeHtml as e, noStore } from "@/lib/reminders/common";
import { EMAIL_CONFIRM_COPY, type ConfirmLang } from "./copy";

export type PageState = "confirmed" | "already" | "invalid" | "expired" | "retry";

function page(lang: ConfirmLang, inner: string, status: number): NextResponse {
  const t = EMAIL_CONFIRM_COPY[lang].page;
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>MedPrüf: ${e(t.title)}</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;margin:0;padding:24px 16px;background:#F7F9FC;color:#1A2B3C;line-height:1.55}main{max-width:480px;margin:10vh auto 0}h1{font-size:22px;margin:0 0 12px}p{overflow-wrap:anywhere}button{font:inherit;font-weight:600;min-height:44px;padding:10px 20px;border:0;border-radius:8px;background:#003A8C;color:#fff;cursor:pointer;max-width:100%}button:focus-visible,a:focus-visible{outline:3px solid #3A7CA5;outline-offset:2px}a{color:#003A8C;display:inline-block;min-height:44px;line-height:44px}@media (prefers-color-scheme:dark){body{background:#0F172A;color:#E2E8F0}button{background:#4D8DF0;color:#001B3D}a{color:#8AB4F8}}</style></head><body><main><h1>${e(t.title)}</h1>${inner}<p><a href="/">${e(t.home)}</a></p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      ...noStore,
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

/** GET: a button that POSTs the token; nothing is written yet. */
export function confirmFormPage(lang: ConfirmLang, token: string): NextResponse {
  const t = EMAIL_CONFIRM_COPY[lang].page;
  return page(lang, `<p>${e(t.lead)}</p><form method="post" action="/confirm-email"><input type="hidden" name="t" value="${e(token)}"><input type="hidden" name="lang" value="${lang}"><button type="submit">${e(t.button)}</button></form>`, 200);
}

export function confirmResultPage(lang: ConfirmLang, state: PageState, trialActive = false): NextResponse {
  const t = EMAIL_CONFIRM_COPY[lang].page;
  const text = state === "confirmed" ? t.confirmed : state === "already" ? t.already : state === "expired" ? t.expired : state === "invalid" ? t.invalid : t.retry;
  const trial = trialActive && (state === "confirmed" || state === "already") ? ` ${t.trial}` : "";
  const status = state === "invalid" ? 400 : state === "expired" ? 410 : state === "retry" ? 503 : 200;
  return page(lang, `<p role="status">${e(text + trial)}</p>`, status);
}

/** Reads the token and language from a form POST; null when the body is not a form. */
export async function readConfirmPost(req: Request): Promise<{ token: string; lang: ConfirmLang } | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return { token: "", lang: "en" };
  try {
    const form = new URLSearchParams((await req.text()).slice(0, 4096));
    return { token: form.get("t") ?? "", lang: form.get("lang") === "de" ? "de" : "en" };
  } catch {
    return null;
  }
}
