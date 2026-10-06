import { createHmac } from "node:crypto";

/** Server-only HS256 Messenger identity. Never sign browser-supplied IDs. */
export function signIntercomIdentity(userId: string, secret: string, now = Math.floor(Date.now() / 1000)): string {
  if (!userId || !secret) throw new Error("Intercom identity is not configured");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ user_id: userId, iat: now, exp: now + 300 })}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

export function intercomApiBase(region: string | undefined): string | null {
  return ({ us: "https://api-iam.intercom.io", eu: "https://api-iam.eu.intercom.io", au: "https://api-iam.au.intercom.io" } as Record<string, string>)[region ?? "us"] ?? null;
}
