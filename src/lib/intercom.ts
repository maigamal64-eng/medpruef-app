import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-side Intercom integration (the "MedPruf Integration" app on workspace
 * x1d573f1). Uses INTERCOM_ACCESS_TOKEN for the REST API and
 * INTERCOM_CLIENT_SECRET to verify inbound Canvas Kit request signatures.
 * Both are server-only env vars — never expose them to the client.
 */

const API_BASE = "https://api.intercom.io"; // US region (workspace x1d573f1)
const API_VERSION = "2.11";

/**
 * Verify an inbound Canvas Kit request signature.
 *
 * Intercom signs the raw JSON body with the app's client secret and sends the
 * hex digest in `X-Body-Signature`. Their docs are ambiguous on the algorithm
 * (the prose says HMAC-SHA256, the worked example is 40 hex chars = HMAC-SHA1),
 * so we verify against whichever algorithm matches the signature length, in
 * constant time. Returns false on any mismatch / missing secret.
 */
export function verifyCanvasSignature(
  rawBody: string,
  signature: string | null | undefined,
): boolean {
  const secret = process.env.INTERCOM_CLIENT_SECRET;
  if (!secret || !signature) return false;
  const algos =
    signature.length === 64
      ? ["sha256"]
      : signature.length === 40
        ? ["sha1"]
        : ["sha256", "sha1"];
  for (const algo of algos) {
    const computed = createHmac(algo, secret).update(rawBody, "utf8").digest("hex");
    if (
      computed.length === signature.length &&
      timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
    ) {
      return true;
    }
  }
  return false;
}

/** Low-level Intercom REST call with the Integration app's access token. */
async function intercomFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  if (!token) throw new Error("INTERCOM_ACCESS_TOKEN not set");
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Intercom-Version": API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
}

/**
 * Send a server-side event to Intercom for the contact identified by our
 * external `user_id` (the same id used in the Messenger boot, so it attaches to
 * the right contact). Powers event-triggered Outbound. Best-effort: never throws.
 */
export async function sendIntercomEvent(
  userId: string,
  eventName: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!process.env.INTERCOM_ACCESS_TOKEN) return;
  try {
    const res = await intercomFetch("/events", {
      method: "POST",
      body: JSON.stringify({
        event_name: eventName,
        created_at: Math.floor(Date.now() / 1000),
        user_id: userId,
        ...(metadata ? { metadata } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[intercom] event failed", eventName, res.status, await res.text());
    }
  } catch (err) {
    console.error("[intercom] event error", eventName, err);
  }
}

/**
 * Upsert a contact's custom attributes by external user_id. Best-effort.
 * Most attributes flow client-side via the Messenger boot; this is the
 * server-side complement (e.g. set `tier=pro` right after a payment, even if
 * the user never re-opens the Messenger).
 */
export async function updateIntercomContact(
  userId: string,
  customAttributes: Record<string, unknown>,
): Promise<void> {
  if (!process.env.INTERCOM_ACCESS_TOKEN) return;
  try {
    const res = await intercomFetch("/contacts", {
      method: "POST",
      body: JSON.stringify({
        role: "user",
        external_id: userId,
        custom_attributes: customAttributes,
      }),
    });
    if (!res.ok && res.status !== 409) {
      console.error("[intercom] contact upsert failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("[intercom] contact error", err);
  }
}
