/**
 * Marketing attribution capture (2026-07-02, Reddit-ads probe).
 *
 * Reddit (and any campaign) lands users on /landing with
 * ?utm_source=reddit&utm_campaign=...&utm_content=...  plus Reddit's own
 * ?rdt_cid=... click id. We persist that FIRST-TOUCH to localStorage and
 * attach it to the register call, so a Reddit-attributed signup is
 * ground-truth queryable in our own DB (not only in Reddit Ads Manager),
 * and so rdt_cid can feed the Conversions-API SignUp (dedup + attribution).
 *
 * Best-effort everywhere: never throws, never blocks a page or the signup.
 */

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  rdt_cid?: string;
  captured_at?: string;
}

const KEY = "medpruef_attribution";
const FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "rdt_cid",
] as const;

/**
 * Pure + isomorphic: keep only known keys, as trimmed strings, length-capped.
 * Safe to run on the server against an untrusted request body.
 */
export function sanitizeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Attribution = {};
  for (const f of FIELDS) {
    const v = o[f];
    if (typeof v === "string" && v.trim()) out[f] = v.trim().slice(0, 200);
  }
  if (typeof o.captured_at === "string") out.captured_at = o.captured_at.slice(0, 40);
  return Object.keys(out).length ? out : null;
}

/**
 * Client: first-touch capture from the current URL into localStorage.
 * No-op server-side, when there are no attribution params, or once one is
 * already stored (first-touch preserves the original acquisition source).
 */
export function captureAttributionFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(KEY)) return; // first-touch wins
    const p = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = p.get(f);
      if (v) found[f] = v.slice(0, 200);
    }
    if (!Object.keys(found).length) return;
    found.captured_at = new Date().toISOString();
    window.localStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    /* attribution is best-effort, never break the page */
  }
}

/** Client: read the stored attribution for the register payload (or null). */
export function getStoredAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? sanitizeAttribution(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
