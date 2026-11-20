/**
 * Sign-in card lines for a visitor on their way into the Germany route
 * (a-dekp-walkfix-1120). The login page imports only this file, so no Austrian
 * copy module names the Germany track: the route test and the wording live here. It imports only
 * lib/de-kp/login-copy, so the sign-in and payment-return bundles carry two strings, not the Germany copy.
 * Keyed on the sign-in `next`, so every other sign-in is byte identical.
 */
import { DE_KP_LOGIN, planStepPath } from "@/lib/de-kp/login-copy";

type DeKpLang = "de" | "en";

const GERMANY_ROUTE = "/kenntnispruefung-deutschland";

/** True when the sign-in returns into the Germany route (path only; the query never counts). */
export function isDeKpReturn(next: string | null | undefined): boolean {
  if (!next) return false;
  const path = next.split(/[?#]/)[0].replace(/\/$/, "");
  return path === GERMANY_ROUTE || path.startsWith(`${GERMANY_ROUTE}/`);
}

/** The sign-in shows the Germany lines only while the Germany flag is on AND the sign-in returns into its route. */
export function isDeKpSignIn(flagOn: boolean, next: string | null | undefined): boolean {
  return flagOn && isDeKpReturn(next);
}

/** The Germany language of a next link: English only when the link says lang=en. */
export function deKpReturnLang(next: string | null | undefined, fallback: string): DeKpLang {
  try {
    const q = new URL(next ?? "", "https://medpruf.com").searchParams.get("lang");
    if (q) return q.toLowerCase().startsWith("en") ? "en" : "de";
  } catch { /* fall through to the page language */ }
  return fallback.toLowerCase().startsWith("en") ? "en" : "de";
}

export function deKpLoginTagline(lang: DeKpLang): string { return DE_KP_LOGIN[lang].tagline; }
export function deKpLoginContext(lang: DeKpLang): string { return DE_KP_LOGIN[lang].context; }

/**
 * Where the payment return page sends a learner whose payment was not found when the stored
 * sign-in entry points into the Germany route: its own plan step, never the general price page
 * (which shows the Austrian exams). Null for every other entry, so that page keeps "/pricing".
 */
export function deKpPlanRetry(next: string | null | undefined, fallback: string): string | null {
  return isDeKpReturn(next) ? planStepPath(deKpReturnLang(next, fallback)) : null;
}
