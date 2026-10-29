/**
 * Browser side of the signup source (a-signup-source-1029). Best-effort
 * everywhere: never throws, never blocks a page or the signup.
 *
 * The first external referrer host is kept in localStorage (host only, never
 * the path or query), first write wins, so the register call can name it
 * when nothing stronger is stored. Same moment and same host rule as the
 * landing beacon's ref_host.
 */
import { refHostFromReferrer } from "./index";

const REF_HOST_KEY = "medpruef_first_ref_host";
/** Written by login/page.tsx and LandingClient from ?ref=; claimed after signup. */
const REF_CODE_KEY = "medpruef_ref_code";

/** Store the first external referrer host, once. */
export function captureFirstRefHost(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    if (window.localStorage.getItem(REF_HOST_KEY)) return;
    const host = refHostFromReferrer(document.referrer);
    if (host) window.localStorage.setItem(REF_HOST_KEY, host);
  } catch {
    /* best-effort */
  }
}

/** The fields every /api/auth call adds so a new account records its source. */
export function signupSourceHints(): { refHost?: string; pendingReferral?: true } {
  if (typeof window === "undefined") return {};
  try {
    const out: { refHost?: string; pendingReferral?: true } = {};
    const host = window.localStorage.getItem(REF_HOST_KEY);
    if (host) out.refHost = host.slice(0, 120);
    if (window.localStorage.getItem(REF_CODE_KEY)) out.pendingReferral = true;
    return out;
  } catch {
    return {};
  }
}
