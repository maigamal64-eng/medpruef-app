/**
 * Sign-in card lines for a visitor on their way into the Germany route
 * (a-dekp-walkfix-1120). The login page imports only this file, so no Austrian
 * copy module names the Germany track: the route test and the wording live here.
 * Keyed on the sign-in `next`, so every other sign-in is byte identical.
 */
import { deKpCopy, type DeKpLang } from "@/lib/de-kp/copy";

const GERMANY_ROUTE = "/kenntnispruefung-deutschland";

/** True when the sign-in returns into the Germany route (path only; the query never counts). */
export function isDeKpReturn(next: string | null | undefined): boolean {
  if (!next) return false;
  const path = next.split(/[?#]/)[0].replace(/\/$/, "");
  return path === GERMANY_ROUTE || path.startsWith(`${GERMANY_ROUTE}/`);
}

/** The Germany language of a next link: English only when the link says lang=en. */
export function deKpReturnLang(next: string | null | undefined, fallback: string): DeKpLang {
  try {
    const q = new URL(next ?? "", "https://medpruf.com").searchParams.get("lang");
    if (q) return q.toLowerCase().startsWith("en") ? "en" : "de";
  } catch { /* fall through to the page language */ }
  return fallback.toLowerCase().startsWith("en") ? "en" : "de";
}

export function deKpLoginTagline(lang: DeKpLang): string { return deKpCopy(lang).login.tagline; }
export function deKpLoginContext(lang: DeKpLang): string { return deKpCopy(lang).login.context; }
