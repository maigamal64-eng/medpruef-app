/**
 * Learner contact sync into the MedPrüf Intercom workspace
 * (a-intercom-contact-sync). Flag MEDPRUF_INTERCOM_SYNC_ENABLED, default off:
 * while off nothing here reads the database or calls Intercom.
 *
 * Upsert by external_id (= users.id):
 *   GET /contacts/find_by_external_id/{id}
 *     200 -> PUT /contacts/{intercom id}
 *     404 -> POST /contacts (role user)
 *     410 -> merged: PUT the canonical contact only when its external_id is ours
 *   POST 409 (the email already sits on another contact, often a lead):
 *     never adopt that contact; POST again without the email.
 *   PUT 409 (email owned by another contact): PUT again without the email.
 *   PUT 404 (deleted in between): POST.
 *   429, 5xx, timeout: no inline retry; the next event or the backfill reconciles.
 * Admin, staff/test and banned accounts are never synced.
 * The address goes on the contact when proven (contactEmail), or, with
 * MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED on, when the account has no active
 * do-not-email row (email-reach.ts, a-intercom-email-reach-1022).
 */
import { getServiceClient } from "@/lib/supabase";
import { afterResponse } from "@/lib/after-response";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import {
  intercomConfig,
  intercomRequest,
  intercomSyncEnabled,
  canonicalIdFromLink,
  intercomErrorCode,
  uid8,
  type IntercomConfig,
  type RequestOptions,
} from "./api";
import {
  buildContactPayload,
  withoutEmail,
  isMissingConsentColumn,
  SYNC_USER_COLUMNS,
  SYNC_USER_COLUMNS_WITH_CONSENT,
  type ContactBody,
  type SyncUserRow,
} from "./contact-payload";
import { mirrorMarketingConsent } from "./marketing-subscription";
import { accountSuppressed, decideEmailReach } from "./email-reach";

export type SyncReason =
  | "register"
  | "login"
  | "tier_change"
  | "exam_set"
  | "language_change"
  | "email_change"
  | "backfill"
  /** a-intercom-into-n2n3-1021: consent withdrawn at Intercom (mp_marketing_opt_in follows). */
  | "consent_change";

/** Reasons that are a learner acting right now (stamp mp_last_active_at). */
const LEARNER_ACTION: ReadonlySet<SyncReason> = new Set(["register", "login", "exam_set", "language_change", "email_change"]);

export type SyncOutcome =
  | "disabled"
  | "skipped_missing"
  | "skipped_staff"
  | "skipped_banned"
  | "skipped_debounced"
  | "updated"
  | "updated_without_email"
  | "created"
  | "created_without_email"
  | "merged_skipped"
  | "failed";

export interface SyncResult {
  outcome: SyncOutcome;
  status?: number;
  code?: string | null;
}

// Per-instance debounce for login: a learner who signs in on three devices
// within ten minutes costs one sync, not three.
const LOGIN_DEBOUNCE_MS = 10 * 60_000;
const DEBOUNCE_CAP = 2000;
const lastSynced = new Map<string, number>();

function debounced(userId: string, reason: SyncReason, nowMs: number): boolean {
  if (reason !== "login") return false;
  const last = lastSynced.get(userId);
  return last !== undefined && nowMs - last < LOGIN_DEBOUNCE_MS;
}

function remember(userId: string, nowMs: number) {
  if (lastSynced.size >= DEBOUNCE_CAP) {
    const oldest = lastSynced.keys().next().value;
    if (oldest !== undefined) lastSynced.delete(oldest);
  }
  lastSynced.delete(userId);
  lastSynced.set(userId, nowMs);
}

/** Test seam. */
export function resetIntercomSyncDebounce() {
  lastSynced.clear();
}

export function shouldSkip(row: SyncUserRow): SyncOutcome | null {
  if (row.role === "admin" || row.tier === "admin" || isStaffOrTestAccount(row)) return "skipped_staff";
  if (row.is_banned) return "skipped_banned";
  return null;
}

function log(userId: string, reason: SyncReason, result: SyncResult) {
  if (result.outcome === "failed") {
    console.warn(`[intercom-sync] ${uid8(userId)} ${reason} failed status=${result.status ?? 0} code=${result.code ?? "-"}`);
  }
}

/** Upsert one contact body. Exported for the backfill and tests. */
export async function upsertContact(cfg: IntercomConfig, body: ContactBody, opts: RequestOptions = {}): Promise<SyncResult> {
  const externalId = encodeURIComponent(body.external_id);
  const found = await intercomRequest(cfg, "GET", `/contacts/find_by_external_id/${externalId}`, undefined, opts);

  let contactId: string | null = null;
  if (found.ok) {
    contactId = typeof (found.body as { id?: unknown })?.id === "string" ? (found.body as { id: string }).id : null;
    if (!contactId) return { outcome: "failed", status: found.status, code: "no_contact_id" };
  } else if (found.status === 410) {
    const canonical = canonicalIdFromLink(found.headers);
    if (!canonical) return { outcome: "merged_skipped", status: 410 };
    const target = await intercomRequest(cfg, "GET", `/contacts/${encodeURIComponent(canonical)}`, undefined, opts);
    const ext = (target.body as { external_id?: unknown } | null)?.external_id;
    if (!target.ok || ext !== body.external_id) return { outcome: "merged_skipped", status: target.status };
    contactId = canonical;
  } else if (found.status !== 404) {
    return { outcome: "failed", status: found.status, code: intercomErrorCode(found.body) ?? found.reason };
  }

  if (contactId) {
    const path = `/contacts/${encodeURIComponent(contactId)}`;
    const put = await intercomRequest(cfg, "PUT", path, body, opts);
    if (put.ok) return { outcome: "updated", status: put.status };
    if (put.status === 409 && body.email) {
      const retry = await intercomRequest(cfg, "PUT", path, withoutEmail(body), opts);
      if (retry.ok) return { outcome: "updated_without_email", status: retry.status };
      return { outcome: "failed", status: retry.status, code: intercomErrorCode(retry.body) ?? retry.reason };
    }
    if (put.status !== 404) return { outcome: "failed", status: put.status, code: intercomErrorCode(put.body) ?? put.reason };
    // 404: deleted between the lookup and the update; create it below.
  }

  const post = await intercomRequest(cfg, "POST", "/contacts", body, opts);
  if (post.ok) return { outcome: "created", status: post.status };
  if (post.status === 409 && body.email) {
    const retry = await intercomRequest(cfg, "POST", "/contacts", withoutEmail(body), opts);
    if (retry.ok) return { outcome: "created_without_email", status: retry.status };
    return { outcome: "failed", status: retry.status, code: intercomErrorCode(retry.body) ?? retry.reason };
  }
  return { outcome: "failed", status: post.status, code: intercomErrorCode(post.body) ?? post.reason };
}

export interface SyncOptions extends RequestOptions {
  now?: Date;
  /** Test seam: the users row instead of a database read. */
  loadUser?: (userId: string) => Promise<SyncUserRow | null>;
  /** Test seam: the consent mirror run after a contact CREATE. */
  mirror?: (userId: string) => Promise<unknown>;
  /** Test seam (a-intercom-email-reach-1022): true when a do-not-email row names the account or address; throws when unreadable. */
  suppressed?: (userId: string, email: string) => Promise<boolean>;
}

async function loadUserRow(userId: string): Promise<SyncUserRow | null> {
  const db = getServiceClient();
  const first = await db.from("users").select(SYNC_USER_COLUMNS_WITH_CONSENT).eq("id", userId).maybeSingle();
  if (!first.error) return (first.data as SyncUserRow | null) ?? null;
  // Before migration 20270114090000 the consent column is missing: sync
  // without it (mp_marketing_opt_in false), never fail the whole sync.
  if (!isMissingConsentColumn(first.error)) throw new Error("users read failed");
  const { data, error } = await db.from("users").select(SYNC_USER_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw new Error("users read failed");
  return (data as SyncUserRow | null) ?? null;
}

/** Read the learner and upsert the contact. Never throws. */
export async function syncIntercomContact(userId: string, reason: SyncReason, opts: SyncOptions = {}): Promise<SyncResult> {
  const cfg = intercomConfig();
  if (!cfg) return { outcome: "disabled" };
  const now = opts.now ?? new Date();
  if (debounced(userId, reason, now.getTime())) return { outcome: "skipped_debounced" };
  let result: SyncResult;
  try {
    const row = await (opts.loadUser ?? loadUserRow)(userId);
    if (!row) return { outcome: "skipped_missing" };
    const skip = shouldSkip(row);
    if (skip) return { outcome: skip };
    // a-intercom-email-reach-1022: an unproven address only with the flag on
    // and no active do-not-email row (fails closed: no address this time).
    const reach = await decideEmailReach(row, opts.suppressed ?? ((id: string, email: string) => accountSuppressed(getServiceClient(), id, email)));
    const body = buildContactPayload(row, {
      now,
      lastActiveAt: LEARNER_ACTION.has(reason) ? Math.floor(now.getTime() / 1000) : null,
      emailReachAllowed: reach === "allowed",
    });
    result = await upsertContact(cfg, body, opts);
    // a-intercom-into-n2n3-1021: a register-time tick was mirrored before
    // this contact existed (no_contact). Mirror once more right after the
    // CREATE so the opt-in reaches the subscription type without the daily
    // reconcile. The mirror keeps its own gates (flags, proven address, type).
    if ((result.outcome === "created" || result.outcome === "created_without_email") && row.marketing_opt_in === true) {
      await (opts.mirror ?? ((id: string) => mirrorMarketingConsent(getServiceClient(), id)))(userId).catch(() => undefined);
    }
  } catch {
    result = { outcome: "failed", code: "exception" };
  }
  if (result.outcome !== "failed") remember(userId, now.getTime());
  log(userId, reason, result);
  return result;
}

/**
 * Hook for routes: queue the sync after the response. Returns at once and
 * does nothing (no read, no timer) while the flag is off.
 */
export function scheduleIntercomContactSync(userId: string | null | undefined, reason: SyncReason): void {
  if (!userId || !intercomSyncEnabled()) return;
  void afterResponse("intercom-sync", async () => {
    await syncIntercomContact(userId, reason);
  });
}

export type EraseOutcome = "no_token" | "deleted" | "not_found" | "merged_skipped" | "failed";

/**
 * Account erasure: DELETE the learner's contact. Intercom answers with the
 * contact in pending_deletion and completes the permanent deletion itself
 * (GET /contacts/deleted then lists it as permanently_deleted). A contact
 * that is already gone counts as success.
 */
export async function eraseIntercomContact(userId: string, opts: RequestOptions = {}): Promise<{ outcome: EraseOutcome; status?: number }> {
  const cfg = intercomConfig({ requireFlag: false });
  if (!cfg) return { outcome: "no_token" };
  const found = await intercomRequest(cfg, "GET", `/contacts/find_by_external_id/${encodeURIComponent(userId)}`, undefined, opts);
  let contactId: string | null = null;
  if (found.ok) {
    const id = (found.body as { id?: unknown } | null)?.id;
    contactId = typeof id === "string" ? id : null;
  } else if (found.status === 404) {
    return { outcome: "not_found", status: 404 };
  } else if (found.status === 410) {
    const canonical = canonicalIdFromLink(found.headers);
    if (canonical) {
      const target = await intercomRequest(cfg, "GET", `/contacts/${encodeURIComponent(canonical)}`, undefined, opts);
      if (target.ok && (target.body as { external_id?: unknown } | null)?.external_id === userId) contactId = canonical;
    }
    if (!contactId) return { outcome: "merged_skipped", status: 410 };
  } else {
    return { outcome: "failed", status: found.status };
  }
  if (!contactId) return { outcome: "failed", status: found.status };
  const del = await intercomRequest(cfg, "DELETE", `/contacts/${encodeURIComponent(contactId)}`, undefined, opts);
  if (del.ok) return { outcome: "deleted", status: del.status };
  if (del.status === 404) return { outcome: "not_found", status: 404 };
  console.warn(`[intercom-erase] ${uid8(userId)} failed status=${del.status}`);
  return { outcome: "failed", status: del.status };
}
