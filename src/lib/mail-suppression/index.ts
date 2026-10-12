/**
 * Shared do-not-email list (b39, pick-suppression-shape A).
 *
 * Every sender asks here before it mails anyone: the trial-reminder cron, the
 * R4 PUYP decision mails, the exam reminders and study nudges, and any one-off
 * segment build. Opt-outs ("Stopp"), hard bounces, complaints and manual
 * blocks live in public.mail_suppression (migration 20261113090000), keyed by
 * a sha256 of the normalized address so the list survives account erasure.
 *
 * Categories:
 *   transactional: account security, payment receipts, billing notices on an
 *                  existing contract (pre-charge notice, failed payment) and
 *                  replies to the user's own request (PUYP claim decision).
 *   marketing:     everything else (upsells, reminders, nudges, outreach, offers).
 * A row with scope "all" blocks both; scope "marketing" blocks marketing only.
 *
 * Fail closed: if the list cannot be read, or an address cannot be keyed,
 * the address counts as suppressed and nothing is sent.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendZohoEmail, type SendZohoEmailArgs, type SendZohoEmailResult } from "@/lib/email/zoho";

export type MailCategory = "transactional" | "marketing";
export type SuppressionCause = "opt_out" | "hard_bounce" | "complaint" | "manual";
export type SuppressionScope = "all" | "marketing";

export const SUPPRESSION_TABLE = "mail_suppression";
export const SUPPRESSION_CAUSES: readonly SuppressionCause[] = ["opt_out", "hard_bounce", "complaint", "manual"];
const LOOKUP_CHUNK = 100;

// Same set as the SQL btrim in mail_suppression_key(): ASCII whitespace only.
const EDGE_WHITESPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
const ADDRESS = /^[^@\s]+@[^@\s]+$/;
// Printable ASCII only: keeps lower() in Postgres and toLowerCase() here identical.
const ASCII = /^[\x21-\x7e]+$/;

/** Normalized address, or null when it cannot be keyed safely. */
export function normalizeMailAddress(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const value = email.replace(EDGE_WHITESPACE, "").toLowerCase();
  if (value.length === 0 || value.length > 254 || !ASCII.test(value) || !ADDRESS.test(value)) return null;
  return value;
}

/** sha256 hex of the normalized address; equals public.mail_suppression_key(). */
export function suppressionKey(email: string | null | undefined): string | null {
  const normalized = normalizeMailAddress(email);
  return normalized === null ? null : createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function scopeBlocks(scope: string, category: MailCategory): boolean {
  // Unknown scopes block everything (fail closed).
  return scope !== "marketing" || category === "marketing";
}

export interface SuppressionHit {
  id: string;
  cause: SuppressionCause;
  scope: SuppressionScope;
  source: string;
  created_at: string;
}

export class SuppressionLookupError extends Error {
  constructor() {
    // Never carries the database message or any address.
    super("Mail suppression lookup failed");
    this.name = "SuppressionLookupError";
  }
}

/** Active suppression rows for each key (lifted rows excluded). Throws on any read error. */
export async function loadActiveSuppressions(db: SupabaseClient, keys: string[]): Promise<Map<string, SuppressionHit[]>> {
  const unique = [...new Set(keys)];
  const out = new Map<string, SuppressionHit[]>();
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await db
      .from(SUPPRESSION_TABLE)
      .select("id, email_key, cause, scope, source, created_at")
      .in("email_key", chunk)
      .is("lifted_at", null);
    if (error || !Array.isArray(data)) throw new SuppressionLookupError();
    for (const row of data as Array<SuppressionHit & { email_key: string }>) {
      const { email_key, ...hit } = row;
      const list = out.get(email_key) ?? [];
      list.push(hit);
      out.set(email_key, list);
    }
  }
  return out;
}

export interface PartitionResult<T> {
  allowed: T[];
  /** Count only; callers log this number, never the addresses. */
  suppressed: number;
  /** Recipients whose address could not be keyed (also withheld). */
  invalid: number;
}

/**
 * Split a recipient list into the ones that may be mailed and the withheld
 * ones. Use this for every segment build and batch sender.
 */
export async function partitionRecipients<T>(
  db: SupabaseClient,
  recipients: T[],
  emailOf: (recipient: T) => string | null | undefined,
  category: MailCategory,
): Promise<PartitionResult<T>> {
  const keyed: Array<{ recipient: T; key: string }> = [];
  let invalid = 0;
  for (const recipient of recipients) {
    const key = suppressionKey(emailOf(recipient));
    if (key === null) invalid++;
    else keyed.push({ recipient, key });
  }
  const active = await loadActiveSuppressions(db, keyed.map((k) => k.key));
  const allowed: T[] = [];
  let suppressed = 0;
  for (const { recipient, key } of keyed) {
    const hits = active.get(key) ?? [];
    if (hits.some((h) => scopeBlocks(h.scope, category))) suppressed++;
    else allowed.push(recipient);
  }
  return { allowed, suppressed, invalid };
}

export type SuppressionStatus = "clear" | "suppressed" | "invalid";

/**
 * For batch senders that already abort on database errors: returns the status
 * and THROWS SuppressionLookupError when the list cannot be read, so an outage
 * surfaces as a failed run instead of a quiet skip.
 */
export async function checkSuppression(db: SupabaseClient, email: string | null | undefined, category: MailCategory): Promise<SuppressionStatus> {
  const key = suppressionKey(email);
  if (key === null) return "invalid";
  const active = await loadActiveSuppressions(db, [key]);
  return (active.get(key) ?? []).some((h) => scopeBlocks(h.scope, category)) ? "suppressed" : "clear";
}

/** True when the address must not receive mail of this category (fail closed). */
export async function isMailSuppressed(db: SupabaseClient, email: string | null | undefined, category: MailCategory): Promise<boolean> {
  const key = suppressionKey(email);
  if (key === null) return true;
  try {
    const active = await loadActiveSuppressions(db, [key]);
    return (active.get(key) ?? []).some((h) => scopeBlocks(h.scope, category));
  } catch {
    return true;
  }
}

export type GuardedSendResult =
  | SendZohoEmailResult
  | { ok: false; reason: "suppressed" | "invalid_address" | "suppression_check_failed" };

/**
 * The one door for a single mail: checks the list right before the provider
 * call. A suppressed, unkeyable or unreadable address never reaches the provider.
 */
export async function sendUnlessSuppressed(
  db: SupabaseClient,
  category: MailCategory,
  mail: SendZohoEmailArgs,
  send: (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult> = sendZohoEmail,
): Promise<GuardedSendResult> {
  const key = suppressionKey(mail.to);
  if (key === null) return { ok: false, reason: "invalid_address" };
  let active: Map<string, SuppressionHit[]>;
  try {
    active = await loadActiveSuppressions(db, [key]);
  } catch {
    return { ok: false, reason: "suppression_check_failed" };
  }
  if ((active.get(key) ?? []).some((h) => scopeBlocks(h.scope, category))) return { ok: false, reason: "suppressed" };
  // A cc copy ([name] by default) is internal; it is not checked against the list.
  return send(mail);
}

export interface AdminSuppressionFlag {
  suppressed: true;
  causes: SuppressionCause[];
  /** "all" when any active row blocks every mail, else "marketing". */
  scope: SuppressionScope;
  since: string;
}

/**
 * Do-not-email flags for the admin Users page, keyed by the address as given.
 * Clean addresses are absent from the map. An address no sender can key
 * (guarded senders withhold it) maps to "unmailable".
 */
export async function adminSuppressionFlags(db: SupabaseClient, emails: Array<string | null | undefined>): Promise<Map<string, AdminSuppressionFlag | "unmailable">> {
  const byKey = new Map<string, string[]>();
  const out = new Map<string, AdminSuppressionFlag | "unmailable">();
  for (const email of emails) {
    if (typeof email !== "string" || email.length === 0) continue;
    const key = suppressionKey(email);
    if (key === null) { out.set(email, "unmailable"); continue; }
    byKey.set(key, [...(byKey.get(key) ?? []), email]);
  }
  const active = await loadActiveSuppressions(db, [...byKey.keys()]);
  for (const [key, hits] of active) {
    if (hits.length === 0) continue;
    const flag: AdminSuppressionFlag = {
      suppressed: true,
      causes: [...new Set(hits.map((h) => h.cause))].sort(),
      scope: hits.some((h) => h.scope !== "marketing") ? "all" : "marketing",
      since: hits.map((h) => h.created_at).sort()[0],
    };
    for (const email of byKey.get(key) ?? []) out.set(email, flag);
  }
  return out;
}

export interface SuppressInput {
  email: string;
  cause: SuppressionCause;
  /** Short machine label, e.g. "unsubscribe-link", "zoho-bounce", "comms-log", "admin". */
  source: string;
  /** Who added it: "admin:<id>", "cron:trial-reminder", "track-a". */
  actor: string;
  scope?: SuppressionScope;
  userId?: string | null;
  /** Free text without personal data (no addresses, no names). */
  note?: string | null;
}

const SOURCE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

/** Adds (or confirms) a suppression through the audited RPC. Returns the active row id. */
export async function recordSuppression(db: SupabaseClient, input: SuppressInput): Promise<string> {
  if (normalizeMailAddress(input.email) === null) throw new Error("recordSuppression needs a valid address");
  if (!SUPPRESSION_CAUSES.includes(input.cause)) throw new Error("Unknown suppression cause");
  if (!SOURCE.test(input.source)) throw new Error("Invalid suppression source label");
  const actor = input.actor.trim();
  if (actor.length === 0 || actor.length > 128) throw new Error("Invalid suppression actor");
  const scope: SuppressionScope = input.cause === "hard_bounce" || input.cause === "complaint" ? "all" : (input.scope ?? "all");
  const { data, error } = await db.rpc("suppress_mail", {
    p_email: input.email,
    p_cause: input.cause,
    p_source: input.source,
    p_actor: actor,
    p_scope: scope,
    p_user_id: input.userId ?? null,
    p_note: input.note ?? null,
  });
  if (error || typeof data !== "string") throw new Error("Mail suppression write failed");
  return data;
}

/** Lifts one active row (kept as history with who and why). False when already lifted. */
export async function liftSuppression(db: SupabaseClient, id: string, actor: string, reason: string): Promise<boolean> {
  if (actor.trim().length === 0 || reason.trim().length === 0) throw new Error("Lifting needs an actor and a reason");
  const { data, error } = await db.rpc("lift_mail_suppression", { p_id: id, p_actor: actor.trim(), p_reason: reason.trim() });
  if (error || typeof data !== "boolean") throw new Error("Mail suppression lift failed");
  return data;
}
