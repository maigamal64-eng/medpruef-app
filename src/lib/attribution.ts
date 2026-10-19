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
 * Arrival paths that reach learners without a campaign link (a-arrival-paths):
 * an answer page /blog/<slug>, /lernplan, a sitting page /pruefungskalender/<slug> and a /gratis/<code> landing. The key
 * is a short, lower-case label ("blog:<slug>", "lernplan", "sitting:<slug>", "gratis:<code>")
 * used as the first-touch campaign when the URL carries no utm_* of its own.
 * Pure; null for every other path (including the /blog index).
 */
export function arrivalPathKey(pathname: string): string | null {
  const parts = String(pathname || "").split("?")[0].split("/").filter(Boolean);
  const clean = (v: string) => {
    let d = v;
    try { d = decodeURIComponent(v); } catch { /* keep raw */ }
    d = d.toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(d) ? d : null;
  };
  if (parts.length === 1 && parts[0].toLowerCase() === "lernplan") return "lernplan";
  // a-public-selftest: the no-account self-check.
  if (parts.length === 1 && parts[0].toLowerCase() === "selbsttest") return "selbsttest";
  if (parts.length === 2 && parts[0].toLowerCase() === "blog") {
    const s = clean(parts[1]);
    return s ? `blog:${s}` : null;
  }
  if (parts.length === 2 && parts[0].toLowerCase() === "pruefungskalender") {
    const s = clean(parts[1]);
    return s ? `sitting:${s}` : null;
  }
  if (parts.length === 2 && parts[0].toLowerCase() === "gratis") {
    const c = clean(parts[1]);
    return c ? `gratis:${c}` : null;
  }
  return null;
}

export type ReferralSource = "telegram" | "facebook";

/** Web hosts (and their subdomains) whose referrer names a channel. */
const REFERRAL_WEB_HOSTS: ReadonlyArray<readonly [string, ReferralSource]> = [
  ["t.me", "telegram"],
  ["telegram.me", "telegram"],
  ["telegram.org", "telegram"], // web.telegram.org
  ["facebook.com", "facebook"], // m., l., lm., web.
  ["fb.com", "facebook"],
  ["fb.me", "facebook"],
];
/**
 * Android apps that open the browser send an android-app://<package>/
 * referrer, so the "host" is the app package (Telegram, Telegram X,
 * Facebook, Messenger, Facebook Lite).
 */
const REFERRAL_APP_PACKAGES: ReadonlyArray<readonly [string, ReferralSource]> = [
  ["org.telegram", "telegram"],
  ["org.thunderdog.challegram", "telegram"],
  ["com.facebook", "facebook"],
];

/**
 * a-landing-fresh-referrer-1019: the channel a referrer names, or null.
 * Pure. Reads the host only; the referrer itself is never stored (only the
 * derived source is).
 */
export function referrerSource(referrer: unknown): ReferralSource | null {
  if (typeof referrer !== "string" || !referrer || referrer.length > 2048) return null;
  let protocol: string;
  let host: string;
  try {
    const u = new URL(referrer);
    protocol = u.protocol;
    host = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  if (!host) return null;
  if (protocol === "http:" || protocol === "https:") {
    for (const [d, src] of REFERRAL_WEB_HOSTS) if (host === d || host.endsWith(`.${d}`)) return src;
    return null;
  }
  if (protocol === "android-app:") {
    for (const [pkg, src] of REFERRAL_APP_PACKAGES) if (host === pkg || host.startsWith(`${pkg}.`)) return src;
  }
  return null;
}

/** A stored record a later, stronger first touch may replace. */
type StoredKind = "none" | "arrival" | "referral" | "set";
function storedKind(raw: string | null): StoredKind {
  if (!raw) return "none";
  try {
    const o = JSON.parse(raw);
    if (o?.utm_source === "arrival") return "arrival";
    // Only records this file wrote from a referrer carry the marker, so a
    // tagged link that happens to use medium "referral" stays a campaign link.
    if (o?.via === "referrer") return "referral";
  } catch { /* treat as set */ }
  return "set";
}

/**
 * Client: first-touch capture from the current URL into localStorage.
 * No-op server-side, when there are no attribution params, or once one is
 * already stored (first-touch preserves the original acquisition source).
 *
 * Precedence (pinned by tests): a real campaign link (utm_* / rdt_cid) >
 * a typed code > a Telegram or Facebook referrer > an organic arrival page.
 * A weaker stored record gives way to a stronger later one; never the reverse.
 */
export function captureAttributionFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const kind = storedKind(window.localStorage.getItem(KEY));
    if (kind === "set") return;
    const p = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = p.get(f);
      if (v) found[f] = v.slice(0, 200);
    }
    if (!Object.keys(found).length) {
      const key = arrivalPathKey(window.location.pathname);
      // No campaign link: a post shared on Telegram or Facebook without utm
      // still names its channel through the referrer host (medium referral;
      // the answer page or /lernplan it opened stays as the campaign).
      const ref = kind === "referral" ? null : referrerSource(typeof document === "undefined" ? "" : document.referrer);
      if (ref) {
        found.utm_source = ref;
        found.utm_medium = "referral";
        found.via = "referrer"; // local marker; sanitizeAttribution drops it
        if (key) found.utm_campaign = key.slice(0, 200);
      } else {
        if (kind !== "none") return;
        // An answer page, /lernplan or /gratis code arrival is still a first
        // touch worth attributing (organic, same storage as utm).
        if (!key) return;
        found.utm_source = "arrival";
        found.utm_medium = "organic";
        found.utm_campaign = key.slice(0, 200);
      }
    }
    found.captured_at = new Date().toISOString();
    window.localStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    /* attribution is best-effort, never break the page */
  }
}

/**
 * A code typed before signup (a-code-front-door) is the first touch unless a
 * real campaign link already is: only an empty store, an organic arrival or a
 * referrer record gives way (same precedence as captureAttributionFromUrl). The kind of
 * code is not known pre-signup; the server records it on `code_redeemed`.
 */
export function captureTypedCodeAttribution(code: string): void {
  if (typeof window === "undefined") return;
  try {
    if (storedKind(window.localStorage.getItem(KEY)) === "set") return;
    window.localStorage.setItem(KEY, JSON.stringify({ utm_source: "code", utm_medium: "typed", utm_campaign: code.toLowerCase().slice(0, 40), captured_at: new Date().toISOString() }));
  } catch { /* best-effort */ }
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

/**
 * The campaign fields a signup event carries (a20, ADM-18 A / OW-46): the
 * four utm_* values only. The ad click id stays in user_activity_log, so the
 * user_registered event (read by the admin Growth "Sources" table) holds no
 * per-click identifier. Null when nothing is left.
 */
export function attributionForEvent(attr: Attribution | null): Pick<Attribution, "utm_source" | "utm_medium" | "utm_campaign" | "utm_content"> | null {
  if (!attr) return null;
  const out: Pick<Attribution, "utm_source" | "utm_medium" | "utm_campaign" | "utm_content"> = {};
  for (const f of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) {
    if (attr[f]) out[f] = attr[f];
  }
  return Object.keys(out).length ? out : null;
}

/** Server-side shape check for the arrival pair sent by the landing beacon. */
export const ARRIVAL_CAMPAIGN_RE = /^(lernplan|selbsttest|blog:[a-z0-9][a-z0-9_-]{0,79}|sitting:[a-z0-9][a-z0-9_-]{0,79}|gratis:[a-z0-9][a-z0-9_-]{0,79})$/;
