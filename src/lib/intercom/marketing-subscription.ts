/**
 * Mirrors users.marketing_opt_in to the MedPrüf Intercom opt-in subscription
 * type (a-intercom-marketing-consent). Our database stays the record; Intercom
 * only gets a copy so its campaigns can respect it.
 *
 * Config (otherwise "off", no network): MEDPRUF_INTERCOM_ACCESS_TOKEN,
 * MEDPRUF_INTERCOM_REGION us (default) and MEDPRUF_INTERCOM_NEWS_SUBSCRIPTION_ID
 * (digits, the live opt-in email type). Never INTERCOM_ACCESS_TOKEN or BLINK_*.
 *   Removing (opt out) needs nothing more, like erasure: a learner who
 *   withdraws after a rollback of the flags is still removed at Intercom.
 *   Adding (opt in) also needs NEXT_PUBLIC_MARKETING_CONSENT_ENABLED=true (the
 *   build carries the privacy text naming the transfer) and
 *   MEDPRUF_INTERCOM_CONSENT_SYNC_ENABLED=true.
 *
 * Target: subscribed exactly when marketingAllowed (opt-in AND a proven
 * address); an opt-in on an unproven address is kept as false at Intercom.
 * Opt in: POST /contacts/{id}/subscriptions {id, consent_type: "opt_in"},
 * only to a type that reads live, opt_in, email (checked at most every 60 s).
 * Opt out: DELETE /contacts/{id}/subscriptions/{type id} (404 = already off).
 * The contact is found by external_id = users.id and must carry that
 * external_id with role user; no contact yet means nothing to mirror.
 *
 * Trigger "change" (the learner just decided in the app): the app decision
 * is the newest and is written. Trigger "reconcile" (catch-up, no fresh
 * decision), checked before the attach gate: our type listed as opt_out on
 * the contact is a withdrawal made at Intercom: the database is set to false
 * (source "intercom") and nothing is attached (a later in-app opt-in
 * re-attaches, which replaces that record). A global unsubscribed_from_emails
 * is only held ("blocked_at_intercom", nothing attached, record untouched):
 * our attach cannot clear it, so writing it back would undo every later
 * in-app opt-in; the suppression rail (a-intercom-suppression-sync) stops our
 * own marketing for it. Unknown state attaches and writes nothing.
 *
 * After every write the consent is read again and the mirror repeats (at most
 * 3 rounds) until Intercom matches the latest value. Any failure while the
 * database says false gets one more DELETE. Logs carry uid8 and status only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { intercomRequest, intercomRestBase, uid8, type IntercomConfig, type RequestOptions } from "./api";
import { marketingAllowed, marketingConsentEnabled, setMarketingConsent } from "@/lib/marketing-consent";

const US_BASE = "https://api.intercom.io";
const MAX_ROUNDS = 3;
const TYPE_CHECK_TTL_MS = 60_000;

export interface ConsentMirrorConfig extends IntercomConfig {
  subscriptionId: string;
  /** Opt-ins may be written (both switches on); opt-outs always may. */
  attachAllowed: boolean;
}

export function consentMirrorConfig(): ConsentMirrorConfig | null {
  const token = process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN?.trim();
  const base = intercomRestBase(process.env.MEDPRUF_INTERCOM_REGION);
  const subscriptionId = process.env.MEDPRUF_INTERCOM_NEWS_SUBSCRIPTION_ID?.trim() ?? "";
  if (!token || base !== US_BASE || !/^\d{1,20}$/.test(subscriptionId)) return null;
  const attachAllowed = marketingConsentEnabled() && process.env.MEDPRUF_INTERCOM_CONSENT_SYNC_ENABLED === "true";
  return { base, token, subscriptionId, attachAllowed };
}

export type MirrorOutcome =
  | "off"
  | "attached"
  | "detached"
  | "no_contact"
  | "type_not_live"
  | "withdrawn_at_intercom"
  /** Reconcile: the contact unsubscribed from all emails at Intercom; nothing attached, our record untouched. */
  | "blocked_at_intercom"
  /** Our record says subscribe, but adding is switched off (removals still run). */
  | "attach_off"
  | "consent_unreadable"
  | "failed";

let typeCheck: { id: string; ok: boolean; at: number } | null = null;

/** Test seam. */
export function resetConsentMirrorCache(): void {
  typeCheck = null;
}

async function subscriptionTypeLive(cfg: ConsentMirrorConfig, opts: RequestOptions): Promise<boolean | null> {
  const now = Date.now();
  if (typeCheck && typeCheck.id === cfg.subscriptionId && now - typeCheck.at < TYPE_CHECK_TTL_MS) return typeCheck.ok;
  const res = await intercomRequest(cfg, "GET", "/subscription_types", undefined, opts);
  if (!res.ok) return null;
  const list = (res.body as { data?: Array<Record<string, unknown>> } | null)?.data;
  const type = Array.isArray(list) ? list.find((t) => String(t.id) === cfg.subscriptionId) : undefined;
  const contentTypes = Array.isArray(type?.content_types) ? (type?.content_types as unknown[]) : [];
  const ok = !!type && type.state === "live" && type.consent_type === "opt_in" && contentTypes.includes("email");
  typeCheck = { id: cfg.subscriptionId, ok, at: now };
  return ok;
}

/** unsubscribed: null when Intercom did not say (never read as a withdrawal). */
interface Contact { id: string; unsubscribed: boolean | null }

async function findContact(cfg: ConsentMirrorConfig, userId: string, opts: RequestOptions): Promise<Contact | null | "error"> {
  const res = await intercomRequest(cfg, "GET", `/contacts/find_by_external_id/${encodeURIComponent(userId)}`, undefined, opts);
  if (res.ok) {
    const body = res.body as { id?: unknown; external_id?: unknown; role?: unknown; unsubscribed_from_emails?: unknown } | null;
    if (typeof body?.id !== "string" || body.external_id !== userId || body.role !== "user") return null;
    const u = body.unsubscribed_from_emails;
    return { id: body.id, unsubscribed: typeof u === "boolean" ? u : null };
  }
  // 404 none yet, 410 merged away: nothing of ours to mirror onto.
  if (res.status === 404 || res.status === 410) return null;
  return "error";
}

/** True when the contact opted out of our type at Intercom; null when unreadable. */
async function optedOutOfType(cfg: ConsentMirrorConfig, contactId: string, opts: RequestOptions): Promise<boolean | null> {
  const res = await intercomRequest(cfg, "GET", `/contacts/${encodeURIComponent(contactId)}/subscriptions`, undefined, opts);
  if (!res.ok) return null;
  const list = (res.body as { data?: Array<Record<string, unknown>> } | null)?.data;
  if (!Array.isArray(list)) return null;
  return list.some((t) => String(t.id) === cfg.subscriptionId && t.consent_type === "opt_out");
}

interface ConsentRead { optIn: boolean; target: boolean }

/** target = what Intercom should hold: opt-in AND a proven address. */
async function readConsent(sb: SupabaseClient, userId: string): Promise<ConsentRead | null> {
  const { data, error } = await sb.from("users").select("marketing_opt_in, email_verified_at, email_status").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const row = data as { marketing_opt_in?: unknown; email_verified_at?: unknown; email_status?: unknown };
  return { optIn: row.marketing_opt_in === true, target: marketingAllowed(row) };
}

async function detach(cfg: ConsentMirrorConfig, contactId: string, opts: RequestOptions): Promise<boolean> {
  const res = await intercomRequest(cfg, "DELETE", `/contacts/${encodeURIComponent(contactId)}/subscriptions/${encodeURIComponent(cfg.subscriptionId)}`, undefined, opts);
  return res.ok || res.status === 404;
}

async function attach(cfg: ConsentMirrorConfig, contactId: string, opts: RequestOptions): Promise<boolean> {
  const res = await intercomRequest(cfg, "POST", `/contacts/${encodeURIComponent(contactId)}/subscriptions`, { id: cfg.subscriptionId, consent_type: "opt_in" }, opts);
  return res.ok;
}

export interface MirrorDeps extends RequestOptions {
  config?: ConsentMirrorConfig | null;
  /** "change" (default): a decision the learner just made in the app. */
  trigger?: "change" | "reconcile";
}

/** Never throws. Reads the current consent itself; the caller passes no value. */
export async function mirrorMarketingConsent(sb: SupabaseClient, userId: string, deps: MirrorDeps = {}): Promise<MirrorOutcome> {
  const cfg = deps.config === undefined ? consentMirrorConfig() : deps.config;
  if (!cfg) return "off";
  const tag = uid8(userId);
  let contact: Contact | null = null;
  // One more DELETE when anything fails while our record says no.
  const settleOptOut = async (): Promise<MirrorOutcome> => {
    if (contact && (await readConsent(sb, userId))?.target === false && (await detach(cfg, contact.id, deps))) return "detached";
    return "failed";
  };
  try {
    const first = await readConsent(sb, userId);
    if (!first) return "consent_unreadable";
    let target = first.target;
    // A change that could only add stops before any network; a reconcile
    // still looks for a withdrawal made at Intercom.
    if (target && !cfg.attachAllowed && deps.trigger !== "reconcile") return "attach_off";
    const found = await findContact(cfg, userId, deps);
    if (found === "error") {
      console.warn(`[intercom-consent] ${tag} contact lookup failed`);
      return "failed";
    }
    if (!found) return "no_contact";
    contact = found;

    if (first.optIn && deps.trigger === "reconcile") {
      // Unknown state attaches nothing and withdraws nothing.
      if (found.unsubscribed === null) {
        console.warn(`[intercom-consent] ${tag} contact consent state unreadable`);
        return "failed";
      }
      if (found.unsubscribed) return "blocked_at_intercom";
      const typeOptOut = await optedOutOfType(cfg, found.id, deps);
      if (typeOptOut === null) {
        console.warn(`[intercom-consent] ${tag} contact consent state unreadable`);
        return "failed";
      }
      if (typeOptOut) {
        const set = await setMarketingConsent(sb, userId, false, "intercom");
        console.warn(`[intercom-consent] ${tag} withdrawn at Intercom${set.ok ? "" : "; database write failed"}`);
        return set.ok ? "withdrawn_at_intercom" : "failed";
      }
    }

    let applied: boolean | null = null;
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      if (round > 0) {
        const again = await readConsent(sb, userId);
        if (!again) return "consent_unreadable";
        target = again.target;
      }
      if (applied === target) return target ? "attached" : "detached";
      if (round === MAX_ROUNDS) break;
      if (target && !cfg.attachAllowed) return "attach_off";
      if (target) {
        // Before every attach: a draft, archived or opt-out type never gets one.
        const live = await subscriptionTypeLive(cfg, deps);
        if (live !== true) {
          console.warn(`[intercom-consent] ${tag} ${live === null ? "type read failed" : "type not live opt_in email"}`);
          return live === null ? "failed" : "type_not_live";
        }
      }
      const ok = target ? await attach(cfg, found.id, deps) : await detach(cfg, found.id, deps);
      if (!ok) {
        console.warn(`[intercom-consent] ${tag} ${target ? "attach" : "detach"} failed`);
        return settleOptOut();
      }
      applied = target;
    }
    console.warn(`[intercom-consent] ${tag} consent kept changing; reconcile later`);
    return settleOptOut();
  } catch (err) {
    console.warn(`[intercom-consent] ${tag} error`, err instanceof Error ? err.name : "unknown");
    return settleOptOut().catch(() => "failed" as const);
  }
}
