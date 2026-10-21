/**
 * Intercom webhook rules (a-intercom-suppression-sync). Pure: no I/O.
 *
 * Signature: Intercom signs the raw JSON body with HMAC-SHA1 keyed by the
 * app's client_secret and sends "sha1=<40 hex>" in X-Hub-Signature. Compared
 * in constant time on equal-length buffers; any other shape fails.
 *
 * Payload: a notification_event with a unique id (the idempotency key), a
 * topic and data.item. The "Subscription" object of contact.unsubscribed and
 * granular.unsubscribe is not documented field by field, so the contact is
 * read defensively from data.item and its contact/user/subscriber children.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const HANDLED_TOPICS = ["contact.unsubscribed", "granular.unsubscribe"] as const;
export type HandledTopic = (typeof HANDLED_TOPICS)[number];

/** processed_webhook_events provider of the per-notification claim. */
export const INTERCOM_CLAIM_PROVIDER = "intercom";
/** Time the request waits for the work before answering 503 (Intercom resends). */
export const WORK_BUDGET_MS = 900;
/** A claim with no outcome older than this is a crashed run and may be taken over (above maxDuration 30 s). */
export const STALE_CLAIM_MS = 45_000;

/** Largest body we read; real notifications are a few KB. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

const SIGNATURE = /^sha1=([0-9a-f]{40})$/i;
const NOTIFICATION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CONTACT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HMAC over the exact bytes received (a string is taken as UTF-8). */
export function verifyIntercomSignature(rawBody: Buffer | string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const m = SIGNATURE.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha1", secret).update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody).digest();
  const given = Buffer.from(m[1].toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function isHandledTopic(topic: unknown): topic is HandledTopic {
  return typeof topic === "string" && (HANDLED_TOPICS as readonly string[]).includes(topic);
}

export interface IntercomNotification {
  id: string;
  topic: string;
  appId: string | null;
  createdAt: number | null;
  deliveryAttempts: number | null;
  item: Record<string, unknown> | null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** null when the body is not a notification_event with a usable id and topic. */
export function parseNotification(body: unknown): IntercomNotification | null {
  const b = rec(body);
  if (!b || b.type !== "notification_event") return null;
  if (typeof b.id !== "string" || !NOTIFICATION_ID.test(b.id)) return null;
  if (typeof b.topic !== "string" || b.topic.length === 0 || b.topic.length > 128) return null;
  const data = rec(b.data);
  return {
    id: b.id,
    topic: b.topic,
    appId: typeof b.app_id === "string" ? b.app_id : null,
    createdAt: typeof b.created_at === "number" ? b.created_at : null,
    deliveryAttempts: typeof b.delivery_attempts === "number" ? b.delivery_attempts : null,
    item: rec(data?.item),
  };
}

export interface NotifiedContact {
  /** Intercom contact id, when the payload carries one. */
  contactId: string | null;
  /** The contact's address, when the payload carries one (never logged). */
  email: string | null;
  /** Our user id: Intercom external_id (or legacy user_id) when it is a UUID. */
  externalUserId: string | null;
  /** The payload says the contact is unsubscribed from every email. */
  unsubscribedFromEmails: boolean;
}

const CONTACT_TYPES = new Set(["contact", "user", "lead"]);

export function extractContact(item: Record<string, unknown> | null): NotifiedContact {
  const out: NotifiedContact = { contactId: null, email: null, externalUserId: null, unsubscribedFromEmails: false };
  if (!item) return out;
  const candidates = [item, rec(item.contact), rec(item.user), rec(item.subscriber)].filter(
    (c): c is Record<string, unknown> => c !== null,
  );
  for (const c of candidates) {
    const looksLikeContact = (typeof c.type === "string" && CONTACT_TYPES.has(c.type)) || typeof c.role === "string";
    if (!out.contactId && looksLikeContact && typeof c.id === "string" && CONTACT_ID.test(c.id)) out.contactId = c.id;
    if (!out.email && typeof c.email === "string" && c.email.includes("@")) out.email = c.email;
    for (const key of ["external_id", "user_id"] as const) {
      const v = c[key];
      if (!out.externalUserId && typeof v === "string" && UUID.test(v)) out.externalUserId = v.toLowerCase();
    }
    if (c.unsubscribed_from_emails === true) out.unsubscribedFromEmails = true;
  }
  if (!out.contactId && typeof item.contact_id === "string" && CONTACT_ID.test(item.contact_id)) out.contactId = item.contact_id;
  return out;
}

/** Suppression source label for a topic (matches the recordSuppression SOURCE rule). */
export function suppressionSourceFor(topic: HandledTopic): string {
  return `intercom:${topic}`;
}
