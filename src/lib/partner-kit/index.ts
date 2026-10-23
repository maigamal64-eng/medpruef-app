/**
 * Partner kit (a-partner-kit, community lead). One code per partner: an
 * organiser who says yes gets a handout (A4 PDF for print, square PNG for
 * chats that bar links), a public page (/kooperation) and a privacy-safe
 * cohort read of their own code, all from the existing code kinds (campaign
 * credits, seed seat). Migration-free.
 *
 * PARTNER_KIT_ENABLED (server, default OFF, literal "true"): /kooperation and
 * the report page answer 404 while off, and the admin handout route 404s.
 * The offline script (scripts/partner-kit/render.ts) needs no flag, so Empfang
 * can attach handouts to the first contacts before any deploy.
 *
 * PARTNER_CODES (server env, comma or space separated): the allowlist of codes
 * that are partner codes. A code outside the list gets no handout and no
 * report link, whatever its kind. Pure, no I/O.
 */
import { normalizeCampaignCode } from "@/lib/mentor/credits/free-credits";

type Env = Record<string, string | undefined>;

export const PARTNER_PATH = "/kooperation";
export const PARTNER_REPORT_PATH = "/kooperation/bericht";

export function partnerKitEnabled(env: Env = process.env): boolean {
  return env.PARTNER_KIT_ENABLED === "true";
}

/** The allowlist, normalised like campaign codes, de-duplicated, at most 200 entries. */
export function parsePartnerCodes(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const code = normalizeCampaignCode(part);
    if (code) out.add(code);
    if (out.size >= 200) break;
  }
  return [...out];
}

export function partnerCodes(env: Env = process.env): string[] {
  return parsePartnerCodes(env.PARTNER_CODES);
}

export function isPartnerCode(code: unknown, env: Env = process.env): code is string {
  const c = normalizeCampaignCode(code);
  return !!c && partnerCodes(env).includes(c);
}

/**
 * Decision partner-code-account-age-1022: a partner code redeems only on an
 * account at most 7 days old at redemption (an acquisition lever for the
 * partner's members, not a top-up for existing learners). Applies to both
 * code kinds (credits and seed seat) while PARTNER_KIT_ENABLED is on; off,
 * every code keeps its kind's own limit.
 */
export const PARTNER_MAX_ACCOUNT_AGE_DAYS = 7;

/** The account age limit for this code: the kind's own limit, capped at 7 days for a partner code. */
export function partnerAccountMaxAgeDays(code: unknown, kindDefaultDays: number, env: Env = process.env): number {
  if (!partnerKitEnabled(env) || !isPartnerCode(code, env)) return kindDefaultDays;
  return Math.min(kindDefaultDays, PARTNER_MAX_ACCOUNT_AGE_DAYS);
}

/** A count below this is never shown (organiser read, scoreboard shares the rule). */
export const SMALL_CELL = 5;

/** Report links last 120 days unless the script says otherwise. */
export const REPORT_LINK_DAYS = 120;
export const REPORT_LINK_MAX_DAYS = 400;

export type PartnerLang = "de" | "en";
export const partnerLang = (value: string | string[] | undefined | null): PartnerLang => (value === "en" ? "en" : "de");

/** What a code is, as far as a handout needs: the kind and its numbers. */
export interface PartnerCodeInfo {
  code: string;
  kind: "credits" | "seat";
  credits: number;
  /** Mentor credit validity after redemption (credits kind). */
  expiryDays: number;
  /** Pro days of a seat (seat kind). */
  proDays: number | null;
  /** Account age limit in days for this kind. */
  maxAccountAgeDays: number;
  /** ISO end of the code's own window. */
  endsAt: string;
}
