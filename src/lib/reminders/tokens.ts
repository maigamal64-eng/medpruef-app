import { createHash, createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";

export type LinkPurpose = "exam-unsubscribe" | "study-unsubscribe" | "exam-confirm" | "study-confirm";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const recipientKey = (email: string) => createHash("sha256").update(normalizeEmail(email)).digest("hex");
function secret(): string {
  const key = process.env.REMINDER_LINK_SIGNING_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new Error("Reminder link signing is not configured");
  return key;
}
export function signReminderToken(purpose: LinkPurpose, token: string, now = new Date()): string {
  if (!uuid.test(token)) throw new Error("Invalid reminder credential");
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose, token, ...(purpose.endsWith("confirm") ? { exp: Math.floor(now.getTime() / 1000) + 86400 } : {}) })).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", secret()).update(`v1.${payload}`).digest("base64url")}`;
}
export function verifyReminderToken(value: string, purpose: LinkPurpose, now = new Date()): string | null {
  if (value.length > 1024) return null;
  const [version, payload, signature, extra] = value.split(".");
  if (version !== "v1" || !payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", secret()).update(`v1.${payload}`).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.v !== 1 || data.purpose !== purpose || typeof data.token !== "string" || !uuid.test(data.token)) return null;
    if (purpose.endsWith("confirm") && (!Number.isSafeInteger(data.exp) || data.exp <= Math.floor(now.getTime() / 1000))) return null;
    return data.token;
  } catch { return null; }
}
export function unsubscribeCredential(value: string, kind: "exam" | "study"): string | null {
  // Previously delivered UUID credentials remain valid ONLY for opt-out.
  // They never prove consent and cannot be used in a confirmation handler.
  return uuid.test(value) ? value : verifyReminderToken(value, `${kind}-unsubscribe`);
}
