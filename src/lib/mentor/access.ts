/**
 * Who may open the mentor (a-mentor-open, 14 Oct 2026). One rule for the
 * availability probe, the chat and usage gates, the read-only learner routes
 * and the package/checkout gate, so the menu and the routes always agree.
 *
 * MENTOR_ACCESS_SCOPE (server env):
 *   beta       default; absent or any other value. Allowlist only (the
 *              ai_mentor_beta_override row, else MENTOR_BETA_USER_IDS).
 *   paid       allowlist, OR paid access (isPaidAccess), OR an unexpired
 *              mentor credit lot.
 *   signed_in  allowlist, OR any signed-in account (requireUser already
 *              refuses banned and signed-out callers).
 *
 * Masters (AI_FEATURES_ENABLED, MENTOR_ENABLED) and the DB flag "mentor" are
 * checked by the callers before this, unchanged.
 *
 * "allowlist" vs "scope" matters for money: the house-funded lots (Pro
 * included credits, trial and free tastes, the welcome lot, admin gifts, the
 * exam-reward lot) flow only through ensureIncludedGrants, and the chat and
 * usage handlers call it only where houseGrantsAllowed() says so. With
 * MENTOR_HOUSE_GRANTS_SCOPE unset that is the allowlist only (today's rule):
 * an account admitted by the scope spends lots it already holds (purchases,
 * referral credits, code and reward lots, earlier grants). With
 * MENTOR_HOUSE_GRANTS_SCOPE=signed_in every admitted account gets the grants
 * it is entitled to (a-free-credit-hooks, product.json L1/L3).
 *
 * Without MENTOR_PACKAGES_ENABLED a scope admission needs a live lot: an
 * account with nothing to spend and nothing to buy would only meet a dead end.
 *
 * Every read error propagates (callers fail closed).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { HouseGrantsScope } from "./credits/free-credits";

export const MENTOR_ACCESS_SCOPES = ["beta", "paid", "signed_in"] as const;
export type MentorAccessScope = (typeof MENTOR_ACCESS_SCOPES)[number];
export const MENTOR_ACCESS_SCOPE_ENV = "MENTOR_ACCESS_SCOPE";

/** Only the two exact literals widen access; anything else is beta. */
export function parseMentorAccessScope(raw: string | undefined): MentorAccessScope {
  const v = (raw ?? "").trim();
  return v === "paid" || v === "signed_in" ? v : "beta";
}

export type MentorAdmissionVia = "allowlist" | "scope";

/**
 * May this admission receive house-funded grants (ensureIncludedGrants)?
 * Allowlisted accounts always; scope-admitted ones only while
 * MENTOR_HOUSE_GRANTS_SCOPE=signed_in. A refused admission never does.
 */
export function houseGrantsAllowed(scope: HouseGrantsScope | undefined, via: MentorAdmissionVia | null): boolean {
  if (via === "allowlist") return true;
  return via === "scope" && scope === "signed_in";
}

/**
 * a-pricing-v2: the Guarantee Ticket includes Mentor credits. A ticket holder
 * admitted by the scope (not the allowlist) gets the included grant of the
 * ticket rows only while house grants are otherwise off for scope-admitted
 * accounts. [name]'s 18 Oct pick A replaced the 14 Oct "Pro and Cohort get
 * none": every Pro plan includes credits once MENTOR_HOUSE_GRANTS_SCOPE is
 * signed_in at the flip; until then only these tiers get the scope grant.
 */
// The no-card reverse trial (a-pricing-v2) includes the bounded trial taste the same way.
export const TICKET_HOUSE_GRANT_TIERS: ReadonlySet<string> = new Set(["guarantee_ticket", "reverse_trial"]);
export function ticketOnlyHouseGrants(
  scope: HouseGrantsScope | undefined,
  via: MentorAdmissionVia | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  // Only while the Cohort-level amount the ticket promises is on (ticketMentorReady):
  // otherwise no extra read for any scope-admitted account.
  return env.MENTOR_INCLUDED_RAISE_ENABLED === "true" && via === "scope" && !houseGrantsAllowed(scope, via);
}

/** Facts the scope needs beyond the allowlist. Each read throws on a DB error. */
export interface MentorScopeReads {
  /** isPaidAccess for this account (admin role or a live paid tier). */
  paidAccess(userId: string): Promise<boolean>;
  /** An unexpired, live mentor credit lot (any source). */
  holdsLiveLot(userId: string): Promise<boolean>;
  /** Optional account check for callers that did not run requireUser (false = banned or missing). */
  accountOk?(userId: string): Promise<boolean>;
}

export interface MentorAdmissionArgs {
  scope: MentorAccessScope;
  packagesEnabled: boolean;
  userId: string;
  allowlisted(userId: string): Promise<boolean>;
  reads?: MentorScopeReads;
}

export async function decideMentorAdmission(a: MentorAdmissionArgs): Promise<MentorAdmissionVia | null> {
  if (await a.allowlisted(a.userId)) return "allowlist";
  if (a.scope === "beta" || !a.reads) return null;
  if (a.reads.accountOk && !(await a.reads.accountOk(a.userId))) return null;
  if (a.scope === "paid" && !(await a.reads.paidAccess(a.userId))) {
    return (await a.reads.holdsLiveLot(a.userId)) ? "scope" : null;
  }
  // signed_in, or paid with paid access: something to spend or something to buy.
  if (a.packagesEnabled) return "scope";
  return (await a.reads.holdsLiveLot(a.userId)) ? "scope" : null;
}

type Db = Pick<SupabaseClient, "from">;

/** True when the account holds a live mentor lot that has started and not expired. */
export async function holdsLiveMentorLot(db: Db, userId: string, now: Date = new Date()): Promise<boolean> {
  const iso = now.toISOString();
  const { data, error } = await db.from("ai_credit_lot").select("id")
    .eq("user_id", userId).eq("status", "live").lte("starts_at", iso).gt("expires_at", iso).limit(1);
  if (error) throw new Error(`mentor lot read failed: ${error.code ?? "unknown"}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Route reads. `paidAccess` comes from the requireUser guard the route already
 * holds (no second users read); the lot read runs only when the rule needs it.
 */
export function mentorScopeReads(db: Db, opts: { paidAccess: boolean; now?: () => Date }): MentorScopeReads {
  return {
    paidAccess: async () => opts.paidAccess,
    holdsLiveLot: (userId) => holdsLiveMentorLot(db, userId, opts.now ? opts.now() : new Date()),
  };
}
