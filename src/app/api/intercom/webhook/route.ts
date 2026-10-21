/**
 * POST /api/intercom/webhook (a-intercom-suppression-sync).
 *
 * Intercom's unsubscribes feed our one do-not-email list (mail_suppression),
 * so a learner who says stop in Intercom gets no Zoho marketing mail either.
 * Behind MEDPRUF_INTERCOM_WEBHOOK_ENABLED (default off: HEAD and POST 404,
 * nothing read).
 *
 *   HEAD   200 (Intercom validates the URL with HEAD when it is saved).
 *   POST   verify X-Hub-Signature (HMAC-SHA1 of the raw body, client_secret,
 *          constant time) before parsing; a missing or forged signature is 401.
 *          contact.unsubscribed and granular.unsubscribe write one opt_out row
 *          with scope marketing: Intercom has no transactional list, so even
 *          its global unsubscribe stops marketing only and transactional mail
 *          (receipts, dunning, replies) keeps flowing. Other topics are acked.
 *
 * Idempotent on the notification id: a processed_webhook_events claim
 * (provider "intercom") before the write; a replay answers 200 duplicate.
 * The claim payload never carries an address. Intercom resends anything not
 * answered 200 within 5 s: the work gets 900 ms; when it is late the request
 * answers 503 and the work finishes in the background (it marks the claim, or
 * releases it on failure so the resend starts over). A failed write releases
 * the claim and answers 503. The Intercom write-back runs after the response.
 */
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { afterResponse } from "@/lib/after-response";
import {
  INTERCOM_FETCH_TIMEOUT_MS,
  intercomAccessToken,
  intercomClientSecret,
  intercomHeaders,
  intercomRestBase,
  intercomWebhookEnabled,
} from "@/lib/intercom/api";
import {
  INTERCOM_CLAIM_PROVIDER,
  MAX_WEBHOOK_BYTES,
  STALE_CLAIM_MS,
  WORK_BUDGET_MS,
  extractContact,
  isHandledTopic,
  parseNotification,
  suppressionSourceFor,
  verifyIntercomSignature,
  type HandledTopic,
  type IntercomNotification,
  type NotifiedContact,
} from "@/lib/intercom/webhook";
import { normalizeMailAddress, recordSuppression } from "@/lib/mail-suppression";
import { setMarketingConsent } from "@/lib/marketing-consent";
import { scheduleIntercomContactSync } from "@/lib/intercom/sync";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Budget for the contact read when the payload has neither address nor user id. */
const CONTACT_READ_TIMEOUT_MS = 600;

type Db = ReturnType<typeof getServiceClient>;
type Outcome = "suppressed" | "no_address" | "foreign_app";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function HEAD(): Promise<NextResponse> {
  if (!intercomWebhookEnabled()) return notFound();
  // A misconfigured endpoint must not pass Intercom's URL check.
  return new NextResponse(null, { status: intercomClientSecret() ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

async function readCapped(req: NextRequest): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function claimPayload(n: IntercomNotification, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { topic: n.topic, created_at: n.createdAt, delivery_attempts: n.deliveryAttempts, ...extra };
}

type ClaimResult = "claimed" | "duplicate" | "in_progress" | "error";

async function claim(db: Db, n: IntercomNotification): Promise<ClaimResult> {
  const insert = () =>
    db.from("processed_webhook_events").insert({ provider: INTERCOM_CLAIM_PROVIDER, event_id: n.id, payload: claimPayload(n, { phase: "claimed" }) });
  const { error } = await insert();
  if (!error) return "claimed";
  if (error.code !== "23505") return "error";
  const { data, error: readErr } = await db
    .from("processed_webhook_events")
    .select("processed_at, payload")
    .eq("provider", INTERCOM_CLAIM_PROVIDER)
    .eq("event_id", n.id)
    .maybeSingle();
  if (readErr) return "error";
  if (!data) return "in_progress"; // released between insert and read: the resend retries
  const payload = (data.payload ?? {}) as { outcome?: unknown };
  if (typeof payload.outcome === "string") return "duplicate";
  const at = Date.parse(String(data.processed_at ?? ""));
  if (!Number.isFinite(at) || Date.now() - at < STALE_CLAIM_MS) return "in_progress";
  // A crashed run left the claim without an outcome: take it over once
  // (compare-and-set on processed_at), then claim again.
  const { data: removed, error: delErr } = await db
    .from("processed_webhook_events")
    .delete()
    .eq("provider", INTERCOM_CLAIM_PROVIDER)
    .eq("event_id", n.id)
    .eq("processed_at", data.processed_at)
    .select("event_id");
  if (delErr || !Array.isArray(removed) || removed.length === 0) return "in_progress";
  const again = await insert();
  if (!again.error) return "claimed";
  return again.error.code === "23505" ? "in_progress" : "error";
}

async function markOutcome(db: Db, n: IntercomNotification, outcome: Outcome, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db
    .from("processed_webhook_events")
    .update({ payload: claimPayload(n, { phase: "done", outcome, ...extra }) })
    .eq("provider", INTERCOM_CLAIM_PROVIDER)
    .eq("event_id", n.id);
  if (error) Sentry.captureMessage(`Intercom webhook claim ${n.id} could not record outcome ${outcome}`, "warning");
}

async function releaseClaim(db: Db, n: IntercomNotification): Promise<void> {
  const { error } = await db.from("processed_webhook_events").delete().eq("provider", INTERCOM_CLAIM_PROVIDER).eq("event_id", n.id);
  if (error) Sentry.captureMessage(`Intercom webhook claim ${n.id} could not be released; the resend is deduped`, "error");
}

type ContactRead = { kind: "email"; email: string } | { kind: "absent" } | { kind: "unavailable" };

/**
 * Address of an Intercom contact by id (short budget). "absent" only when
 * Intercom answered that the contact has no address or does not exist;
 * anything else (no token, timeout, 429, 5xx) is "unavailable" and the
 * notification is retried, never acked without a row.
 */
async function readContactEmail(contactId: string): Promise<ContactRead> {
  const token = intercomAccessToken();
  const base = intercomRestBase();
  if (!token || !base) return { kind: "unavailable" };
  try {
    const res = await fetch(`${base}/contacts/${encodeURIComponent(contactId)}`, {
      headers: intercomHeaders(token),
      signal: AbortSignal.timeout(Math.min(CONTACT_READ_TIMEOUT_MS, INTERCOM_FETCH_TIMEOUT_MS)),
      redirect: "error",
      cache: "no-store",
    });
    if (res.status === 404) return { kind: "absent" };
    if (!res.ok) return { kind: "unavailable" };
    const body = (await res.json().catch(() => null)) as { email?: unknown } | null;
    if (!body) return { kind: "unavailable" };
    return typeof body.email === "string" && body.email.length > 0 ? { kind: "email", email: body.email } : { kind: "absent" };
  } catch {
    return { kind: "unavailable" };
  }
}

class WorkError extends Error {}

/**
 * True when the learner's recorded consent decision predates the notification
 * (or none is recorded, or the notification carries no time). False when the
 * learner decided in the app after Intercom created the notification, or the
 * row cannot be read (best effort: the suppression row above stands either way).
 */
async function consentOlderThan(db: Db, userId: string, notifiedAt: number | null): Promise<boolean> {
  try {
    const { data, error } = await db.from("users").select("marketing_opt_in, marketing_consent_at").eq("id", userId).maybeSingle();
    if (error || !data || data.marketing_opt_in !== true) return false;
    if (notifiedAt === null || !data.marketing_consent_at) return true;
    const decided = Date.parse(String(data.marketing_consent_at));
    return !Number.isFinite(decided) || decided < notifiedAt * 1000;
  } catch {
    return false;
  }
}

async function suppressFor(db: Db, topic: HandledTopic, contact: NotifiedContact, notifiedAt: number | null = null): Promise<{ rows: number; matchedUser: boolean }> {
  const addresses = new Map<string, string>();
  const add = (email: string | null | undefined) => {
    const norm = normalizeMailAddress(email);
    if (norm && !addresses.has(norm)) addresses.set(norm, email as string);
  };
  const contactEmail = normalizeMailAddress(contact.email);
  let userId: string | null = null;
  if (contact.externalUserId) {
    const { data, error } = await db.from("users").select("id, email").eq("id", contact.externalUserId).maybeSingle();
    if (error) throw new WorkError("user read failed");
    const accountEmail = normalizeMailAddress(data?.email as string | null | undefined);
    // external_id is only as trustworthy as the Messenger identity: the account
    // address is used only when the contact has none of its own, and the row is
    // linked to the account only when the two addresses agree.
    if (data && (contactEmail === null || accountEmail === contactEmail)) {
      userId = data.id as string;
      if (contactEmail === null) add(data.email as string | null);
    }
  }
  add(contact.email);
  if (addresses.size === 0 && contact.contactId) {
    const read = await readContactEmail(contact.contactId);
    if (read.kind === "unavailable") throw new WorkError("contact read unavailable");
    if (read.kind === "email") add(read.email);
  }
  let rows = 0;
  for (const email of addresses.values()) {
    const fromContact = normalizeMailAddress(contact.email) === normalizeMailAddress(email);
    try {
      await recordSuppression(
        db,
        {
          email,
          cause: "opt_out",
          scope: "marketing",
          source: suppressionSourceFor(topic),
          actor: "webhook:intercom",
          userId,
          note: `Intercom ${topic}`,
        },
        {
          mirror: "after",
          intercomContactId: fromContact ? contact.contactId : null,
          intercomAlreadyUnsubscribed: fromContact && contact.unsubscribedFromEmails,
        },
      );
    } catch {
      throw new WorkError("suppression write failed");
    }
    rows++;
  }
  // a-intercom-into-n2n3-1021: an unsubscribe at Intercom also withdraws the
  // learner's recorded marketing opt-in (compare-and-set, only a true flips),
  // so our own senders and the consent mirror agree with Intercom. Best
  // effort: the suppression row above is the binding record; before migration
  // 20270114090000 the column is missing and this is a no-op.
  // Reviewer P2-a: a late resend never undoes a newer in-app opt-in, so the
  // withdrawal applies only when the recorded decision is older than the
  // notification (or there is none).
  if (userId && rows > 0 && (await consentOlderThan(db, userId, notifiedAt))) {
    const withdrawn = await setMarketingConsent(db, userId, false, "intercom").catch(() => null);
    if (!withdrawn?.ok) {
      console.warn("[intercom-webhook] consent withdrawal not recorded", userId.replace(/-/g, "").slice(0, 8));
    } else if (withdrawn.changed) {
      // mp_marketing_opt_in on the contact follows (a no-op while the sync is off).
      scheduleIntercomContactSync(userId, "consent_change");
    }
  }
  return { rows, matchedUser: userId !== null };
}

async function work(db: Db, n: IntercomNotification, topic: HandledTopic): Promise<Outcome> {
  try {
    const contact = extractContact(n.item);
    const { rows, matchedUser } = await suppressFor(db, topic, contact, n.createdAt);
    if (rows === 0) {
      Sentry.captureMessage(`Intercom ${topic} ${n.id} carried no usable address; nothing suppressed`, "warning");
      await markOutcome(db, n, "no_address", { matched_user: matchedUser });
      return "no_address";
    }
    await markOutcome(db, n, "suppressed", { rows, matched_user: matchedUser });
    return "suppressed";
  } catch (err) {
    await releaseClaim(db, n);
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!intercomWebhookEnabled()) return notFound();
  const secret = intercomClientSecret();
  if (!secret) return json({ error: "Webhook not configured" }, 503);

  const raw = await readCapped(req);
  if (raw === null) return json({ error: "Payload too large" }, 413);
  if (!verifyIntercomSignature(raw, req.headers.get("x-hub-signature"), secret)) {
    return json({ error: "Invalid signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const n = parseNotification(body);
  if (!n) return json({ ok: true, ignored: "not_a_notification" });
  if (!isHandledTopic(n.topic)) return json({ ok: true, ignored: "topic" });
  const topic = n.topic;
  const appId = process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID?.trim();
  if (appId && n.appId && n.appId !== appId) {
    Sentry.captureMessage(`Intercom webhook ${n.id} from another workspace ignored`, "warning");
    return json({ ok: true, ignored: "foreign_app" });
  }

  const db = getServiceClient();
  let claimed: ClaimResult;
  try {
    claimed = await claim(db, n);
  } catch {
    claimed = "error";
  }
  if (claimed === "duplicate") return json({ ok: true, duplicate: true });
  if (claimed === "in_progress") return json({ error: "In progress; retry" }, 503);
  if (claimed === "error") return json({ error: "Claim failed; retry" }, 503);

  const running = work(db, n, topic);
  type Raced = { kind: "done"; outcome: Outcome } | { kind: "failed" } | { kind: "late" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raced: Raced = await Promise.race([
    running.then((outcome): Raced => ({ kind: "done", outcome }), (): Raced => ({ kind: "failed" })),
    new Promise<Raced>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "late" }), WORK_BUDGET_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (raced.kind === "done") return json({ ok: true, outcome: raced.outcome });
  if (raced.kind === "failed") {
    Sentry.captureMessage(`Intercom webhook ${n.id} not processed; claim released, 503 for Intercom's resend`, "warning");
    return json({ error: "Suppression pending; retry" }, 503);
  }
  // Late: finish in the background; the claim records the outcome or is released.
  await afterResponse("intercom-webhook-late", async () => {
    await running.catch(() => {
      Sentry.captureMessage(`Intercom webhook ${n.id} failed in the background; claim released, waiting for Intercom's resend`, "warning");
    });
  });
  return json({ error: "Processing; retry" }, 503);
}
