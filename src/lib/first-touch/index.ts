/**
 * First touch per signup (a-first-touch, growth lead). Pure, server and client.
 *
 * One short key per new account that names the lever which brought it:
 * a campaign link, a typed or /gratis code, an organic arrival page, a
 * Telegram start parameter or the Mini App welcome. The server writes it on
 * the account's single `user_registered` row (`event_data.first_touch`) while
 * FIRST_TOUCH_ENABLED is the literal "true"; the Monday read is
 * scripts/growth/first-touch-count.ts.
 *
 * Every key matches FIRST_TOUCH_KEY_RE (ARRIVAL_CAMPAIGN_RE style): lower-case
 * slug characters, length-capped, never a raw referrer, address, name or id.
 * Anything else is dropped, never stored.
 *
 * Precedence (same as captureAttributionFromUrl, pinned by a test): the
 * stored browser first touch (a real utm link, else a typed code, else an
 * organic arrival page) > the verified Telegram start parameter > a client
 * hint. A stored Telegram or Facebook referrer record ranks below the start
 * parameter and the hint (it is a guess from the host), above nothing else.
 */
import { ARRIVAL_CAMPAIGN_RE, type Attribution } from "@/lib/attribution";
import { parseCampaignStart } from "@/lib/campaign-links";

type Env = Record<string, string | undefined>;

export function firstTouchEnabled(env: Env = process.env): boolean {
  return env.FIRST_TOUCH_ENABLED === "true";
}

const SLUG = "[a-z0-9][a-z0-9_-]{0,79}";

/** The only shapes a stored first-touch key may take. */
export const FIRST_TOUCH_KEY_RE = new RegExp(
  `^(lernplan|selbsttest|tg_welcome|tg_ref|fb_ref|(?:blog|sitting|gratis|code|tg_post|tg_start|utm):${SLUG})$`,
);

/** Client hints the server accepts (the literal, nothing else). */
export const FIRST_TOUCH_HINTS: ReadonlySet<string> = new Set(["tg_welcome"]);

export type FirstTouchBasis = "utm" | "code" | "arrival" | "referral" | "start_param" | "hint";

export interface FirstTouch {
  key: string;
  basis: FirstTouchBasis;
}

/** A free value as a key slug ("Reddit Ads" -> "reddit-ads"), or null. */
export function touchSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, 80)
    .replace(/[-_]+$/, "");
  return s && new RegExp(`^${SLUG}$`).test(s) ? s : null;
}

function checked(key: string | null, basis: FirstTouchBasis): FirstTouch | null {
  return key && FIRST_TOUCH_KEY_RE.test(key) ? { key, basis } : null;
}

/** The key the stored browser first touch names, or null. */
export function firstTouchFromAttribution(attr: Attribution | null | undefined): FirstTouch | null {
  if (!attr) return null;
  const source = (attr.utm_source ?? "").toLowerCase();
  const campaign = (attr.utm_campaign ?? "").toLowerCase();
  if (source === "arrival") return ARRIVAL_CAMPAIGN_RE.test(campaign) ? checked(campaign, "arrival") : null;
  if (source === "code") {
    const c = touchSlug(campaign);
    return c ? checked(`code:${c}`, "code") : null;
  }
  const medium = (attr.utm_medium ?? "").toLowerCase();
  // a-landing-fresh-referrer-1019: an untagged arrival from a Telegram or
  // Facebook host (captureAttributionFromUrl writes medium "referral").
  if (medium === "referral" && source === "telegram") return checked("tg_ref", "referral");
  if (medium === "referral" && source === "facebook") return checked("fb_ref", "referral");
  if (source === "telegram") {
    const c = touchSlug(campaign);
    if (c && medium === "post") return checked(`tg_post:${c}`, "utm");
    if (c && medium === "bot") return checked(`tg_start:${c}`, "utm");
  }
  const s = touchSlug(source);
  return s ? checked(`utm:${s}`, "utm") : null;
}

/** A bot campaign start parameter ("c_<slug>") as `tg_start:<slug>`, or null. */
export function firstTouchFromStartParam(startParam: unknown): FirstTouch | null {
  if (typeof startParam !== "string" || startParam.length > 64) return null;
  const slug = parseCampaignStart(startParam);
  return slug ? checked(`tg_start:${slug}`, "start_param") : null;
}

/** A client hint, only when it is one of FIRST_TOUCH_HINTS. */
export function firstTouchFromHint(hint: unknown): FirstTouch | null {
  return typeof hint === "string" && FIRST_TOUCH_HINTS.has(hint) ? checked(hint, "hint") : null;
}

export function deriveFirstTouch(input: {
  attribution?: Attribution | null;
  startParam?: unknown;
  hint?: unknown;
}): FirstTouch | null {
  const stored = firstTouchFromAttribution(input.attribution);
  // A referrer is only a guess from the host (a Mini App inside Telegram Web
  // has web.telegram.org as its referrer), so the signed start parameter and
  // the tg_welcome hint name the lever more precisely and win over it.
  if (stored?.basis === "referral") {
    return firstTouchFromStartParam(input.startParam) ?? firstTouchFromHint(input.hint) ?? stored;
  }
  return stored ?? firstTouchFromStartParam(input.startParam) ?? firstTouchFromHint(input.hint);
}

/**
 * The `start_param` inside a Mini App initData string. Call only after the
 * string passed verifyInitData: the value is part of the signed check string.
 */
export function initDataStartParam(initData: string): string | null {
  try {
    const v = new URLSearchParams(initData).get("start_param");
    return v && v.length <= 64 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Bot sign-in payload that carries a campaign: "web_login_c_<slug>" with the
 * optional _de/_en suffix. Accepted whatever the flag says, so links the bot
 * already sent keep signing in. Same slug rule as parseCampaignStart.
 */
const WEB_LOGIN_CAMPAIGN_RE = /^web_login_c_([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(?:_(?:de|en))?$/;

export function parseWebLoginCampaign(payload: string | undefined | null): string | null {
  const m = typeof payload === "string" ? payload.match(WEB_LOGIN_CAMPAIGN_RE) : null;
  return m ? m[1] : null;
}

/** The sign-in deep link payload for a welcome: campaign-tagged only when on and known. */
export function webLoginPayload(campaign: string | null, langSuffix: "_de" | "_en", on: boolean): string {
  return on && campaign ? `web_login_c_${campaign}${langSuffix}` : `web_login${langSuffix}`;
}

/** Lever groups for the Monday read (the 20 Oct levers). */
export type Lever =
  | "codes"
  | "partner_codes"
  | "telegram"
  | "answer_pages"
  | "lernplan"
  | "selbsttest"
  | "tg_welcome"
  | "sitting_pages"
  | "other_campaign"
  | "untagged"
  | "no_row";

/** Lever of a stored key. Partner codes are the codes in PARTNER_CODES. */
export function leverOf(key: string | null | undefined, partnerCodes: ReadonlySet<string> = new Set()): Lever {
  if (!key || !FIRST_TOUCH_KEY_RE.test(key)) return "untagged";
  if (key === "lernplan") return "lernplan";
  if (key === "selbsttest") return "selbsttest";
  if (key === "tg_welcome") return "tg_welcome";
  if (key === "tg_ref") return "telegram";
  const [kind, rest] = key.split(":", 2);
  if (kind === "code" || kind === "gratis") return partnerCodes.has(rest) ? "partner_codes" : "codes";
  if (kind === "tg_post" || kind === "tg_start") return "telegram";
  if (kind === "blog") return "answer_pages";
  if (kind === "sitting") return "sitting_pages";
  return "other_campaign";
}
