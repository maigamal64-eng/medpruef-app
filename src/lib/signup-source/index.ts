/**
 * Signup source (a-signup-source-1029). Pure, server and client.
 *
 * Why: 79 percent of signups carried no source. The first-touch key
 * (src/lib/first-touch) is only set when the browser stored a campaign link,
 * a typed code, an arrival page or a Telegram/Facebook referrer, so a direct
 * visit, a Google or any other referrer, a pending referral code and a plain
 * bot or Mini App sign-in all ended untagged.
 *
 * Every new account now gets exactly one key on `users.signup_source` (while
 * SIGNUP_SOURCE_ENABLED is the literal "true"). Precedence, pinned by tests:
 *   1. utm_* campaign link          utm:<src> | tg_post:<c> | tg_start:<c>
 *   2. partner or referral code     code:<c> | gratis:<c> | referral
 *   3. Telegram signed signals      tg_start:<c> (start param) | tg_welcome
 *   4. landing first touch          the stored organic arrival page
 *                                   (lernplan | blog:<s> | sitting:<s> ...) or
 *                                   Telegram/Facebook referrer record
 *                                   (tg_ref | fb_ref), else the first external
 *                                   referrer as a known channel ref:<channel>
 *                                   (ref:other for any host not on the list)
 *   5. Telegram sign-in method      tg:<bot_deeplink|miniapp|widget>
 *   6. native app shell             app_shell (user agent MedPrufApp/)
 *   7. nothing at all               direct
 * The arrival page ranks with the referrer (Argus P2, 29 Oct) so the answer
 * page lever matches the first-touch key; the bare Telegram method is only
 * how the account signed in, so it yields to any first touch.
 *
 * Every key matches SIGNUP_SOURCE_RE: lower-case slug characters, length
 * capped, never a raw URL, host, address, name, referral code or id.
 */
import type { Attribution } from "@/lib/attribution";
import { firstTouchFromAttribution, firstTouchFromHint, firstTouchFromStartParam } from "@/lib/first-touch";

type Env = Record<string, string | undefined>;

/** Server-side runtime flag, default OFF: only the literal "true" writes the column. */
export function signupSourceEnabled(env: Env = process.env): boolean {
  return env.SIGNUP_SOURCE_ENABLED === "true";
}

const SLUG = "[a-z0-9][a-z0-9_-]{0,79}";
const CHANNEL = "[a-z0-9]{1,24}";

/** The only shapes a stored signup source may take (mirrored by the DB CHECK). */
export const SIGNUP_SOURCE_RE = new RegExp(
  `^(direct|app_shell|referral|lernplan|selbsttest|tg_welcome|tg_ref|fb_ref|tg:(?:bot_deeplink|miniapp|widget)|ref:${CHANNEL}|(?:utm|code|gratis|blog|sitting|tg_post|tg_start):${SLUG})$`,
);

export type SignupSourceBasis = "utm" | "code" | "telegram" | "referrer" | "app_shell" | "direct";

export interface SignupSource {
  key: string;
  basis: SignupSourceBasis;
}

export type TelegramMethod = "bot_deeplink" | "miniapp" | "widget";

export interface SignupSourceInput {
  /** The sanitized first-touch record the browser sent (sanitizeAttribution). */
  attribution?: Attribution | null;
  /** The browser holds a referral code from ?ref= that it will claim after signup. */
  pendingReferral?: unknown;
  /** Signed Mini App start_param (initData only). */
  startParam?: unknown;
  /** Client hint (only "tg_welcome" counts). */
  hint?: unknown;
  /** Set for a Telegram signup: how the account was created. */
  telegramMethod?: TelegramMethod | null;
  /** First-touch external referrer host the browser stored (untrusted). */
  refHost?: unknown;
  /** Request user agent. */
  userAgent?: string | null;
}

/** Hosts that are this site; a referrer from them is not a source. */
const OWN_HOSTS = ["medpruf.com", "medpruef.com", "vercel.app", "localhost"];

/** Leading labels that name the same site (m.facebook.com is facebook.com). */
const STRIP_LABELS = /^(?:www\d?|m|l|lm|mobile|web)\./;

/**
 * Known channels. A raw host is never stored: a personal blog subdomain or an
 * employer intranet could name a person (Argus P2, 29 Oct), so any host off
 * this list becomes "other". Each entry matches the host or a subdomain;
 * search engines match every country domain (google.at, google.com.eg).
 * First match wins, so the google.com products come before google.
 */
const CHANNELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\.)gemini\.google\.com$/, "gemini"],
  [/(^|\.)copilot\.microsoft\.com$/, "copilot"],
  [/^com\.google\.android\.gm$|(^|\.)mail\.google\.com$/, "gmail"],
  [/^com\.google\.android\.youtube$/, "youtube"],
  // Search only: google.<country>; docs., sites. and the like are people's links (other).
  [/^google\.(?:com?\.)?[a-z]{2,3}$|^com\.google\.android\.googlequicksearchbox$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\.(?:com?\.)?[a-z]{2,3}$/, "yahoo"],
  [/(^|\.)ecosia\.org$/, "ecosia"],
  [/(^|\.)yandex\.(?:com?\.)?[a-z]{2,3}$/, "yandex"],
  [/(^|\.)(t\.me|telegram\.me|telegram\.org)$/, "telegram"],
  [/^org\.telegram(\.|$)|^org\.thunderdog\.challegram$/, "telegram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.me|messenger\.com)$/, "facebook"],
  [/^com\.facebook(\.|$)/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/^com\.instagram(\.|$)/, "instagram"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/^com\.whatsapp(\.|$)/, "whatsapp"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"],
  [/(^|\.)(chatgpt\.com|openai\.com)$/, "chatgpt"],
  [/(^|\.)perplexity\.ai$/, "perplexity"],
  [/(^|\.)claude\.ai$/, "claude"],
];

/**
 * The host a referrer names, normalized, or null. Pure, browser side.
 * https: and http: give the hostname without www./m./l. labels; an Android
 * app referrer (android-app://<package>/) gives the package. Own hosts,
 * IP literals and anything malformed give null. The browser keeps this host
 * locally only; the server reduces it to a channel (refChannel).
 */
export function refHostFromReferrer(referrer: unknown): string | null {
  if (typeof referrer !== "string" || !referrer || referrer.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(referrer);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "android-app:") return null;
  return normalizeRefHost(u.hostname);
}

/** Validate and normalize a host string (untrusted input), or null. */
export function normalizeRefHost(host: unknown): string | null {
  if (typeof host !== "string" || !host || host.length > 253) return null;
  let h = host.trim().toLowerCase().replace(/\.$/, "");
  // Strip only while a dotted name is left (m.me stays m.me).
  while (STRIP_LABELS.test(h) && h.replace(STRIP_LABELS, "").includes(".")) h = h.replace(STRIP_LABELS, "");
  if (!h || h.length > 100) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(h) || !h.includes(".")) return null; // no "localhost", no IPv6
  if (/^\d+(?:\.\d+){3}$/.test(h)) return null; // IPv4 literal
  if (OWN_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))) return null;
  return h;
}

/** The channel a referrer host names ("google", "telegram", ...), "other" for any valid host off the list, or null. */
export function refChannel(host: unknown): string | null {
  const h = normalizeRefHost(host);
  if (!h) return null;
  for (const [re, name] of CHANNELS) if (re.test(h)) return name;
  return "other";
}

/** The native app shell appends "MedPrufApp/<version>" to its user agent. */
export function isAppShellUserAgent(ua: unknown): boolean {
  return typeof ua === "string" && /\bMedPrufApp\//.test(ua);
}

function checked(key: string | null | undefined, basis: SignupSourceBasis): SignupSource | null {
  return key && SIGNUP_SOURCE_RE.test(key) ? { key, basis } : null;
}

/** Arrival keys that name a partner code page rather than organic content. */
function isCodeArrival(key: string): boolean {
  return key.startsWith("gratis:");
}

export function deriveSignupSource(input: SignupSourceInput): SignupSource {
  const stored = firstTouchFromAttribution(input.attribution ?? null);

  // 1. A real campaign link.
  if (stored?.basis === "utm") {
    const s = checked(stored.key, "utm");
    if (s) return s;
  }

  // 2. A partner or typed code (a /gratis/<code> landing is a code too),
  //    then a referral code waiting to be claimed. The referral code itself
  //    names a learner, so only the kind is stored.
  if (stored?.basis === "code" || (stored?.basis === "arrival" && isCodeArrival(stored.key))) {
    const s = checked(stored.key, "code");
    if (s) return s;
  }
  if (input.pendingReferral === true) return { key: "referral", basis: "code" };

  // 3. Telegram signed signals: the start parameter, then the /tg-welcome hint.
  const tg = firstTouchFromStartParam(input.startParam) ?? firstTouchFromHint(input.hint);
  if (tg) {
    const s = checked(tg.key, "telegram");
    if (s) return s;
  }

  // 4. The landing first touch: the stored arrival page or Telegram/Facebook
  //    referrer record, else the first external referrer as a channel.
  if (stored && (stored.basis === "referral" || stored.basis === "arrival")) {
    const s = checked(stored.key, "referrer");
    if (s) return s;
  }
  const channel = refChannel(input.refHost);
  if (channel) {
    const s = checked(`ref:${channel}`, "referrer");
    if (s) return s;
  }

  // 5. How a Telegram account signed in, when nothing above names a lever.
  if (input.telegramMethod) {
    const s = checked(`tg:${input.telegramMethod}`, "telegram");
    if (s) return s;
  }

  // 6. The native app shell.
  if (isAppShellUserAgent(input.userAgent)) return { key: "app_shell", basis: "app_shell" };

  // 7. Nothing: the account still records that it came direct.
  return { key: "direct", basis: "direct" };
}
