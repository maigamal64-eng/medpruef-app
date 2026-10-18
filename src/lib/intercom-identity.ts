import { createHmac } from "node:crypto";

export interface IntercomIdentityClaims {
  /** Read from users on the server, never from the browser. */
  email?: string | null;
  name?: string | null;
}

/**
 * Server-only HS256 Messenger identity. Never sign browser-supplied IDs.
 * email and name are signed only when given (a-intercom-contact-sync passes
 * them while MEDPRUF_INTERCOM_SYNC_ENABLED is on); otherwise the payload is
 * exactly user_id, iat, exp as before.
 */
export function signIntercomIdentity(userId: string, secret: string, now = Math.floor(Date.now() / 1000), claims: IntercomIdentityClaims = {}): string {
  if (!userId || !secret) throw new Error("Intercom identity is not configured");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload: Record<string, unknown> = { user_id: userId, iat: now, exp: now + 300 };
  if (claims.email) payload.email = claims.email;
  if (claims.name) payload.name = claims.name;
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

export function intercomApiBase(region: string | undefined): string | null {
  return ({ us: "https://api-iam.intercom.io", eu: "https://api-iam.eu.intercom.io", au: "https://api-iam.au.intercom.io" } as Record<string, string>)[region ?? "us"] ?? null;
}
