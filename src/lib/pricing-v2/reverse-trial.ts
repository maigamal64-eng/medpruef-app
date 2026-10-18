/**
 * The 3-day reverse trial (a-pricing-v2), pure rules.
 *
 * Why the earlier no-card trial was retired (commit c23b157b, 9 Jul 2026,
 * [name]): one tap gave 7 days of full Pro with no card, so (1) nothing showed
 * the learner was serious, (2) Pro burns real AI credit, and (3) there was no
 * conversion hook. This design answers each reason:
 *   1. Seriousness and abuse: only an account created after
 *      REVERSE_TRIAL_SINCE, at most 7 days old, with a linked Telegram id
 *      (a-trial-phone-gate, [name] 17 Oct: one trial per Telegram account,
 *      which stands for one phone number; a confirmed email alone no longer
 *      starts it), once per account, once per normalised
 *      address (sha256 key, the row outlives the account) and Telegram id,
 *      and at most REVERSE_TRIAL_MAX_PER_IP starts per network in 24 hours
 *      (salted IP hash, never the address).
 *   2. AI cost: 3 days, not 7; the Mentor gets only the bounded trial_taste
 *      lot (a trial subscription row, isTrialSub), the legacy AI daily limits
 *      and the USD monthly per-user cap are unchanged, and the shared AI
 *      spend cap still applies. Worst case per trial is the trial_taste lot
 *      plus three days of the existing per-user limits.
 *   3. Conversion: the end is fixed (start plus 3 days, a dated users.tier
 *      'pro' and a dated trial row, never open-ended); the in-app banner
 *      counts down and links /pricing with "When is your exam?", and a
 *      trialist can buy at any time (checkout treats trial-only access as no
 *      access, so the paid window starts at once).
 * The 7-day card trial stays in the code but is dormant while this is on
 * (/api/whop/trial answers 503 and the trial tiles hide).
 */
import { createHash } from "node:crypto";
import { REVERSE_TRIAL_DAYS } from "./constants";

export { REVERSE_TRIAL_DAYS };
export const REVERSE_TRIAL_MAX_AGE_DAYS = 7;
export const REVERSE_TRIAL_DEFAULT_MAX_PER_IP = 3;

const DAY_MS = 86_400_000;

/**
 * Normalised address for the once-per-person wall: trimmed, lower-cased,
 * "+tag" removed, and for Gmail the dots too (googlemail = gmail). The key is
 * the sha256 of that string, never the address.
 */
export function normaliseTrialEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (!local) return null;
  return `${local}@${domain}`;
}

export function trialEmailKey(email: string | null | undefined): string | null {
  const normalised = normaliseTrialEmail(email);
  return normalised ? createHash("sha256").update(`reverse-trial:${normalised}`).digest("hex") : null;
}

/** Salted network hash (the salt is server-side); null without both. */
export function trialIpHash(ip: string | null | undefined, salt: string | null | undefined): string | null {
  const cleaned = typeof ip === "string" ? ip.split(",")[0].trim() : "";
  if (!cleaned || !salt) return null;
  return createHash("sha256").update(`${salt}:${cleaned}`).digest("hex").slice(0, 32);
}

export interface TrialCandidate {
  createdAt: string | null;
  role: string | null;
  tier: string | null;
  tierExpiresAt: string | null;
}

/**
 * Cheap pre-check before any read: could this account start the trial now?
 * The database function repeats every check under a row lock.
 */
export function mayStartReverseTrial(u: TrialCandidate, since: Date, now: Date = new Date()): boolean {
  if (u.role === "admin" || u.tier === "admin") return false;
  const created = u.createdAt ? Date.parse(u.createdAt) : NaN;
  if (!Number.isFinite(created) || created < since.getTime()) return false;
  if (created < now.getTime() - REVERSE_TRIAL_MAX_AGE_DAYS * DAY_MS) return false;
  if (u.tier === "pro") {
    if (!u.tierExpiresAt) return false;
    const end = Date.parse(u.tierExpiresAt);
    if (!Number.isFinite(end) || end > now.getTime()) return false;
  }
  return true;
}

/** Days left (rounded up) for the banner; 0 when ended. */
export function trialDaysLeft(endsAt: string | null | undefined, now: Date = new Date()): number {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  if (!Number.isFinite(end) || end <= now.getTime()) return 0;
  return Math.ceil((end - now.getTime()) / DAY_MS);
}
