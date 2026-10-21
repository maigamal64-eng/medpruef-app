/**
 * Mirror one do-not-email row into Intercom (a-intercom-suppression-sync).
 *
 * Every recordSuppression asks here after its row is written: when the
 * address has an Intercom contact, that contact gets
 * unsubscribed_from_emails = true, so an Intercom campaign never reaches
 * someone our list blocks. Best effort: a failed mirror never fails the
 * suppression (the row is the source of truth) and is reported to Sentry
 * without the address.
 *
 * Dark unless MEDPRUF_INTERCOM_WEBHOOK_ENABLED is "true" and the MedPruef
 * access token is set. Loop guard: a row that came from Intercom's own
 * contact.unsubscribed is never written back (the contact is already
 * unsubscribed); a granular.unsubscribe row is, because our list has one
 * marketing scope and blocks every list. The PUT may echo back as a
 * contact.unsubscribed notification, which the webhook writes idempotently
 * and does not mirror again.
 */
import * as Sentry from "@sentry/nextjs";

import {
  INTERCOM_FETCH_TIMEOUT_MS,
  intercomAccessToken,
  intercomHeaders,
  intercomRestBase,
  intercomWebhookEnabled,
} from "@/lib/intercom/api";

export type MirrorOutcome =
  | "disabled"
  | "not_configured"
  | "loop_skip"
  | "no_contact"
  | "already_unsubscribed"
  | "updated"
  | "failed";

export interface MirrorInput {
  /** Address of the suppression row (never logged). */
  email: string;
  /** The suppression source label; "intercom:contact.unsubscribed" is never mirrored. */
  source: string;
  /** Known Intercom contact id (webhook path): skips the search. */
  contactId?: string | null;
  /** The contact is already unsubscribed in Intercom (webhook payload said so). */
  alreadyUnsubscribed?: boolean;
}

/** At most this many contacts share one address (user plus leads). */
const MAX_CONTACTS = 5;
const CONTACT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function mirrorSkippedForSource(source: string): boolean {
  return source === "intercom:contact.unsubscribed";
}

type FetchFn = typeof fetch;

interface ContactHit {
  id: string;
  unsubscribed: boolean;
}

async function call(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
  return fetchFn(url, { ...init, signal: AbortSignal.timeout(INTERCOM_FETCH_TIMEOUT_MS), redirect: "error", cache: "no-store" });
}

async function findContacts(fetchFn: FetchFn, base: string, token: string, email: string): Promise<ContactHit[] | null> {
  const res = await call(fetchFn, `${base}/contacts/search`, {
    method: "POST",
    headers: intercomHeaders(token),
    body: JSON.stringify({ query: { field: "email", operator: "=", value: email }, pagination: { per_page: MAX_CONTACTS } }),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  if (!body || !Array.isArray(body.data)) return null;
  const hits: ContactHit[] = [];
  for (const raw of body.data.slice(0, MAX_CONTACTS)) {
    const c = raw as { id?: unknown; unsubscribed_from_emails?: unknown };
    if (typeof c.id === "string" && CONTACT_ID.test(c.id)) hits.push({ id: c.id, unsubscribed: c.unsubscribed_from_emails === true });
  }
  return hits;
}

async function unsubscribe(fetchFn: FetchFn, base: string, token: string, id: string): Promise<"updated" | "no_contact" | "failed"> {
  const res = await call(fetchFn, `${base}/contacts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: intercomHeaders(token),
    body: JSON.stringify({ unsubscribed_from_emails: true }),
  });
  if (res.ok) return "updated";
  if (res.status === 404) return "no_contact";
  return "failed";
}

export async function mirrorSuppressionToIntercom(input: MirrorInput, fetchFn: FetchFn = fetch): Promise<MirrorOutcome> {
  if (!intercomWebhookEnabled()) return "disabled";
  if (mirrorSkippedForSource(input.source)) return "loop_skip";
  if (input.alreadyUnsubscribed) return "already_unsubscribed";
  const token = intercomAccessToken();
  const base = intercomRestBase();
  if (!token || !base) return "not_configured";
  try {
    let targets: ContactHit[];
    if (input.contactId && CONTACT_ID.test(input.contactId)) {
      targets = [{ id: input.contactId, unsubscribed: false }];
    } else {
      const found = await findContacts(fetchFn, base, token, input.email.trim().toLowerCase());
      if (found === null) throw new Error("contact search failed");
      // Search is eventually consistent: a contact created minutes ago may be
      // missing; the next suppression or the contact sync covers it.
      if (found.length === 0) return "no_contact";
      targets = found;
    }
    const open = targets.filter((t) => !t.unsubscribed);
    if (open.length === 0) return "already_unsubscribed";
    let updated = false;
    let missing = false;
    for (const t of open) {
      const r = await unsubscribe(fetchFn, base, token, t.id);
      if (r === "failed") throw new Error("contact update failed");
      if (r === "updated") updated = true;
      else missing = true;
    }
    return updated ? "updated" : missing ? "no_contact" : "already_unsubscribed";
  } catch (err) {
    Sentry.captureMessage(`Intercom suppression mirror failed (source=${input.source}): ${err instanceof Error ? err.name : "error"}`, "warning");
    return "failed";
  }
}
