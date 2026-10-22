/**
 * a-intercom-email-reach-1022: may the contact sync put an unproven account
 * address on the learner's Intercom contact?
 *
 * Decision intercom-on-now-1022 ([name], 22 Oct): every signed-up learner
 * consented to communications unless they opted out (STOP/STOPP). So with
 * MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED on, the address goes to Intercom when
 * the account has NO active mail_suppression row at all (any cause, any
 * scope), matched by user id OR by the address key, and the address is well
 * formed and not marked bounced (reachEmail). Banned, admin and staff/test
 * accounts never reach this (shouldSkip runs first).
 *
 * Fail closed: an unreadable do-not-email list means no address this time
 * (the attributes still sync; the next event or a backfill retries).
 *
 * What stays on the proven rule (contactEmail): the Messenger JWT
 * (/api/intercom/identify) and mp_marketing_opt_in. Accepted residual risk
 * (job brief): a learner who typed someone else's address puts that address
 * on their own contact, so mail that person sends to support could thread
 * onto this contact. The same holds after an address change: the next sync
 * puts the new, unproven address over the old proven one (Reviewer P2-2).
 * The 409 path never adopts a contact that already holds the address.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPPRESSION_TABLE, suppressionKey } from "@/lib/mail-suppression";
import { contactEmail, reachEmail, type SyncUserRow } from "./contact-payload";
import { intercomEmailReachEnabled } from "./api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when any active do-not-email row names this account or address. Throws on a failed read. */
export async function accountSuppressed(db: SupabaseClient, userId: string, email: string): Promise<boolean> {
  const key = suppressionKey(email);
  if (key === null || !UUID_RE.test(userId)) return true;
  const { data, error } = await db
    .from(SUPPRESSION_TABLE)
    .select("id")
    .is("lifted_at", null)
    .or(`email_key.eq.${key},user_id.eq.${userId}`)
    .limit(1);
  if (error || !Array.isArray(data)) throw new Error("suppression read failed");
  return data.length > 0;
}

export type EmailReachDecision = "proven" | "flag_off" | "no_address" | "suppressed" | "lookup_failed" | "allowed";

/**
 * The decision for one synced row. Flag off: no read, "proven" or "flag_off"
 * (the old rule). Flag on: one do-not-email read for any usable address,
 * proven or not. "suppressed" means the sync sends no unproven address and
 * marks the contact unsubscribed_from_emails (Reviewer P2-1: a STOP recorded
 * after the address reached Intercom must still stop Intercom mail, also while
 * the suppression webhook mirror is off). A proven address is still sent as
 * before; an unreadable list keeps the old rule.
 */
export async function decideEmailReach(
  row: SyncUserRow,
  check: (userId: string, email: string) => Promise<boolean>,
): Promise<EmailReachDecision> {
  const proven = contactEmail(row) !== null;
  if (!intercomEmailReachEnabled()) return proven ? "proven" : "flag_off";
  const email = contactEmail(row) ?? reachEmail(row);
  if (email === null) return "no_address";
  try {
    if (await check(row.id, email)) return "suppressed";
    return proven ? "proven" : "allowed";
  } catch {
    return proven ? "proven" : "lookup_failed";
  }
}
