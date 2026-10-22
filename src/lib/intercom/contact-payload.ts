/**
 * Pure mapping from a users row to the Intercom contact body
 * (a-intercom-contact-sync). No fetch, no env, no clock except `now`.
 *
 * The nine custom attributes (create them in the workspace first, see
 * scripts/intercom/create-data-attributes.ts):
 *   mp_exam            string   users.active_exam
 *   mp_sitting_date    date     users.exam_date at 00:00 UTC (the learner's own entry)
 *   mp_tier            string   "pro" | "free" by the paywall rule (tier + tier_expires_at), as of this sync
 *   mp_plan_ends_at    date     users.tier_expires_at while the tier is pro, else absent (null)
 *   mp_ui_lang         string   users.language_code
 *   mp_signup_at       date     users.created_at
 *   mp_last_active_at  date     time of the learner action that caused the sync (backfill: last study day)
 *   mp_telegram_linked boolean  users.telegram_id is set
 *   mp_marketing_opt_in boolean users.marketing_opt_in AND a proven, not bounced address (the sender rule
 *                               marketingAllowed of a-intercom-marketing-consent); false before migration
 *                               20270114090000 is applied (the column is read with a fallback)
 * Dates are unix seconds, as Intercom date attributes expect.
 */

export interface SyncUserRow {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  tier?: string | null;
  tier_expires_at?: string | null;
  active_exam?: string | null;
  exam_date?: string | null;
  language_code?: string | null;
  created_at?: string | null;
  telegram_id?: number | string | null;
  email_verified_at?: string | null;
  email_status?: string | null;
  is_banned?: boolean | null;
  /** Read only where the column exists (migration 20270114090000); absent = false. */
  marketing_opt_in?: boolean | null;
}

export const SYNC_USER_COLUMNS =
  "id, email, first_name, last_name, role, tier, tier_expires_at, active_exam, exam_date, language_code, created_at, telegram_id, email_verified_at, email_status, is_banned";

/** The same columns plus the consent record (a-intercom-into-n2n3-1021). */
export const SYNC_USER_COLUMNS_WITH_CONSENT = `${SYNC_USER_COLUMNS}, marketing_opt_in`;

/**
 * True when a users read failed only because marketing_opt_in does not exist
 * yet (migration 20270114090000 not applied): the caller retries without it.
 */
export function isMissingConsentColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (error.code === "42703") return true;
  return /marketing_opt_in/.test(message) && (error.code === "PGRST204" || /does not exist|could not find/i.test(message));
}

/** The sender rule (marketingAllowed) on a sync row: a stored opt-in on a proven, not bounced address. */
export function contactMarketingOptIn(row: SyncUserRow): boolean {
  return row.marketing_opt_in === true && contactEmail(row) !== null && row.email_status !== "bounced";
}

export const MP_ATTRIBUTES = [
  { name: "mp_exam", data_type: "string", description: "MedPruef active exam bank" },
  { name: "mp_sitting_date", data_type: "date", description: "Exam date the learner entered (own entry, not an official date)" },
  { name: "mp_tier", data_type: "string", description: "pro or free by the paywall rule at last sync" },
  { name: "mp_plan_ends_at", data_type: "date", description: "End of paid access while pro" },
  { name: "mp_ui_lang", data_type: "string", description: "Stored interface language" },
  { name: "mp_signup_at", data_type: "date", description: "MedPruef account created" },
  { name: "mp_last_active_at", data_type: "date", description: "Last learner action seen by the sync" },
  { name: "mp_telegram_linked", data_type: "boolean", description: "A Telegram account is linked" },
  { name: "mp_marketing_opt_in", data_type: "boolean", description: "Recorded marketing opt-in (false until consent is recorded)" },
] as const;

export type MpAttributeName = (typeof MP_ATTRIBUTES)[number]["name"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function seconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Same rule as isPaidTier (free-tier.ts) with an injected clock. */
export function effectiveTier(tier: string | null | undefined, expiresAt: string | null | undefined, now: Date): "pro" | "free" {
  if (tier !== "pro") return "free";
  if (!expiresAt) return "pro";
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) && ms > now.getTime() ? "pro" : "free";
}

/**
 * The address goes to Intercom (contact and Messenger JWT) only when the
 * learner proved it: email_verified_at is set and the address was not
 * changed since (email-update marks it email_status "unverified"). Anyone can
 * type someone else's address at signup; an unproven address on a contact
 * could pull that person's support mail or Messenger history onto it.
 * email_verified is never sent.
 */
export function contactEmail(row: SyncUserRow): string | null {
  if (!row.email_verified_at || row.email_status === "unverified") return null;
  const email = (row.email ?? "").trim().toLowerCase();
  return email && EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

export function contactName(row: SyncUserRow): string | null {
  const name = [row.first_name, row.last_name]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
  return name || null;
}

export interface ContactBody {
  role: "user";
  external_id: string;
  email?: string;
  name?: string;
  signed_up_at?: number;
  unsubscribed_from_emails?: true;
  custom_attributes: Record<MpAttributeName, string | number | boolean | null>;
}

export interface BuildOptions {
  now: Date;
  /** Unix seconds of the last learner action, or null to leave the attribute out. */
  lastActiveAt: number | null;
  /**
   * a-intercom-email-reach-1022: the caller checked MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED
   * and the do-not-email list for this account (no active row by user id or address key)
   * and found it clear. Only then may an unproven address go on the contact (reachEmail).
   * Absent or false: the proven rule of contactEmail alone, byte for byte.
   */
  emailReachAllowed?: boolean;
  /**
   * a-intercom-email-reach-1022: an active do-not-email row names the account:
   * the body carries unsubscribed_from_emails true (never false; lifting a row
   * does not resubscribe).
   */
  markUnsubscribed?: boolean;
}

/**
 * a-intercom-email-reach-1022 (decision intercom-on-now-1022: every signed-up
 * learner consented unless they opted out): the account address for the
 * contact without the proof contactEmail asks for. Well formed and not marked
 * bounced; the caller adds the flag and the do-not-email check
 * (emailReachAllowed). Never for the Messenger JWT and never for
 * mp_marketing_opt_in, which stay on contactEmail.
 */
export function reachEmail(row: SyncUserRow): string | null {
  if (row.email_status === "bounced") return null;
  const email = (row.email ?? "").trim().toLowerCase();
  return email && EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

export function buildContactPayload(row: SyncUserRow, opts: BuildOptions): ContactBody {
  const tier = effectiveTier(row.tier, row.tier_expires_at, opts.now);
  const examDate = typeof row.exam_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.exam_date)
    ? seconds(`${row.exam_date}T00:00:00Z`)
    : null;
  const signup = seconds(row.created_at);
  const custom: Record<string, string | number | boolean | null> = {
    mp_exam: typeof row.active_exam === "string" && row.active_exam ? row.active_exam.slice(0, 40) : null,
    mp_sitting_date: examDate,
    mp_tier: tier,
    mp_plan_ends_at: tier === "pro" ? seconds(row.tier_expires_at) : null,
    mp_ui_lang: typeof row.language_code === "string" && row.language_code ? row.language_code.slice(0, 10) : null,
    mp_signup_at: signup,
    mp_telegram_linked: row.telegram_id !== null && row.telegram_id !== undefined && String(row.telegram_id) !== "",
    mp_marketing_opt_in: contactMarketingOptIn(row),
  };
  if (opts.lastActiveAt !== null) custom.mp_last_active_at = opts.lastActiveAt;
  const body: ContactBody = {
    role: "user",
    external_id: row.id,
    custom_attributes: custom as ContactBody["custom_attributes"],
  };
  const email = contactEmail(row) ?? (opts.emailReachAllowed === true ? reachEmail(row) : null);
  if (email) body.email = email;
  const name = contactName(row);
  if (name) body.name = name;
  if (signup !== null) body.signed_up_at = signup;
  if (opts.markUnsubscribed === true) body.unsubscribed_from_emails = true;
  return body;
}

/** A contact body without the email field (the 409 retry). */
export function withoutEmail(body: ContactBody): ContactBody {
  const rest = { ...body };
  delete rest.email;
  return rest;
}
