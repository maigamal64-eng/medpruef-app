/**
 * Marketing consent record (a-intercom-marketing-consent).
 *
 * One owner for the rule a marketing sender reads: a learner may get a
 * marketing or news email only when users.marketing_opt_in is true. Today the
 * Intercom consent mirror, send-one and the learner-watch rail read it; the
 * older marketing-category senders (day-1 sitting ask, trial-end notice,
 * access-ending reminder, study nudge) check only the do-not-email list and
 * must be gated on marketingAllowed (or ruled transactional) before the
 * consent flag goes on (Reviewer P2-c, a-intercom-into-n2n3-1021). Default
 * false (migration 20270114090000). Only the learner changes it: the unticked
 * register checkbox or the Settings switch. Transactional mail never reads it.
 *
 * Flag NEXT_PUBLIC_MARKETING_CONSENT_ENABLED (build time, only the literal
 * "true"): shows the checkbox, the Settings card and the privacy text, and
 * lets the register path record a tick. Withdrawal (opt_in false) works
 * whenever the column exists, flag or not, so nobody is stuck opted in.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureServerError } from "@/lib/sentry-capture";
import { MARKETING_CONSENT_VERSION } from "./copy";

export { MARKETING_CONSENT_VERSION };

export function marketingConsentEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MARKETING_CONSENT_ENABLED === "true";
}

/** "intercom": a withdrawal the learner made at Intercom, pulled back by the reconcile. */
export type ConsentSource = "register" | "settings" | "intercom";

export interface ConsentState {
  optIn: boolean;
  consentAt: string | null;
  version: string | null;
  hasEmail: boolean;
  /** Confirmed by a link and not unverified or bounced: marketing can reach it. */
  addressProven: boolean;
}

interface ConsentRow {
  email: string | null;
  email_verified_at: string | null;
  email_status: string | null;
  marketing_opt_in: boolean | null;
  marketing_consent_at: string | null;
  marketing_consent_version: string | null;
}

/**
 * The address is proven to belong to the learner: confirmed by a link
 * (email_verified_at) and not marked unverified or bounced since. Without it
 * a tick could come from someone who typed another person's address.
 */
export function addressProven(row: { email_verified_at?: unknown; email_status?: unknown } | null | undefined): boolean {
  if (!row || typeof row.email_verified_at !== "string" || row.email_verified_at.length === 0) return false;
  return row.email_status !== "unverified" && row.email_status !== "bounced";
}

/**
 * A marketing sender's decision for one account row (fail closed): a stored
 * opt-in AND a proven address. Senders select marketing_opt_in,
 * email_verified_at and email_status for it.
 */
export function marketingAllowed(row: { marketing_opt_in?: unknown; email_verified_at?: unknown; email_status?: unknown } | null | undefined): boolean {
  return row?.marketing_opt_in === true && addressProven(row);
}

/** Strict body parse: only a real boolean counts, never "true" or 1. */
export function parseOptIn(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Throws on a read error (column missing before the migration included). */
export async function readMarketingConsent(sb: SupabaseClient, userId: string): Promise<ConsentState | null> {
  const { data, error } = await sb
    .from("users")
    .select("email, email_verified_at, email_status, marketing_opt_in, marketing_consent_at, marketing_consent_version")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`marketing consent read failed: ${error.code ?? "unknown"}`);
  if (!data) return null;
  const row = data as ConsentRow;
  return {
    optIn: row.marketing_opt_in === true,
    consentAt: row.marketing_consent_at ?? null,
    version: row.marketing_consent_version ?? null,
    hasEmail: typeof row.email === "string" && row.email.includes("@"),
    addressProven: addressProven(row),
  };
}

export type SetConsentResult =
  | { ok: true; changed: boolean; state: { optIn: boolean; consentAt: string | null; version: string | null } }
  | { ok: false; reason: "not_found" | "db_error" };

/**
 * Records the learner's decision. Compare-and-set on the current value, so a
 * repeated tap writes nothing and keeps the earlier time. Every change writes
 * time and text version (the CHECK refuses an opt-in without both) and one
 * user_events row (marketing_consent_changed: opt_in, version, source; no
 * address), written even while analytics writes are paused.
 */
export async function setMarketingConsent(
  sb: SupabaseClient,
  userId: string,
  optIn: boolean,
  source: ConsentSource,
  now: Date = new Date(),
): Promise<SetConsentResult> {
  const at = now.toISOString();
  const { data, error } = await sb
    .from("users")
    .update({ marketing_opt_in: optIn, marketing_consent_at: at, marketing_consent_version: MARKETING_CONSENT_VERSION })
    .eq("id", userId)
    .eq("marketing_opt_in", !optIn)
    .select("marketing_opt_in, marketing_consent_at, marketing_consent_version");
  if (error) return { ok: false, reason: "db_error" };
  if (Array.isArray(data) && data.length === 1) {
    // The trail keeps every decision (the row keeps only the latest): one
    // retry, then Sentry, so a lost row is seen and can be restored by hand.
    const event = { user_id: userId, event_type: "marketing_consent_changed", event_data: { opt_in: optIn, version: MARKETING_CONSENT_VERSION, source, at } };
    let eventError = (await sb.from("user_events").insert(event)).error;
    if (eventError) eventError = (await sb.from("user_events").insert(event)).error;
    if (eventError) {
      console.warn("[marketing-consent] event write failed", userId.slice(0, 8), eventError.code ?? "unknown");
      captureServerError(new Error("marketing consent event write failed"), { route: "marketing-consent", userId, step: `event_${optIn ? "opt_in" : "opt_out"}_${source}` });
    }
    return { ok: true, changed: true, state: { optIn, consentAt: at, version: MARKETING_CONSENT_VERSION } };
  }
  // No row moved: either the value already matches or the account is gone.
  let current: ConsentState | null;
  try {
    current = await readMarketingConsent(sb, userId);
  } catch {
    return { ok: false, reason: "db_error" };
  }
  if (!current) return { ok: false, reason: "not_found" };
  return { ok: true, changed: false, state: { optIn: current.optIn, consentAt: current.consentAt, version: current.version } };
}
