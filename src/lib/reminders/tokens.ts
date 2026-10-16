import { createHash, createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";

export type LinkPurpose = "exam-unsubscribe" | "study-unsubscribe" | "exam-confirm" | "study-confirm" | "calendar-feed";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const recipientKey = (email: string) => createHash("sha256").update(normalizeEmail(email)).digest("hex");
/** True when confirm and unsubscribe links can be signed (a-d5b render and send guard). Never returns or logs the value. */
export function reminderLinksConfigured(): boolean {
  const key = process.env.REMINDER_LINK_SIGNING_SECRET;
  return !!key && Buffer.byteLength(key) >= 32;
}
function secret(): string {
  const key = process.env.REMINDER_LINK_SIGNING_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new Error("Reminder link signing is not configured");
  return key;
}
export function signReminderToken(purpose: LinkPurpose, token: string, now = new Date()): string {
  if (!uuid.test(token)) throw new Error("Invalid reminder credential");
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose, token, ...(purpose.endsWith("confirm") ? { exp: Math.floor(now.getTime() / 1000) + 86400 } : {}), ...(purpose === "calendar-feed" ? { iat: Math.floor(now.getTime() / 1000) } : {}) })).toString("base64url");
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

/**
 * Personal calendar feed (a-exam-calendar-feed). The token names only the
 * account (users.id) and its issue time; it has no expiry because calendar apps
 * poll for months. Revocation: the feed route rejects a token issued before the
 * account's `session_invalidated_at` ("Sign out everywhere").
 */
export function signCalendarFeedToken(userId: string, now = new Date()): string {
  return signReminderToken("calendar-feed", userId, now);
}
export function readCalendarFeedToken(value: string): { userId: string; issuedAt: number } | null {
  const userId = verifyReminderToken(value, "calendar-feed");
  if (!userId) return null;
  try {
    const iat = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")).iat;
    return Number.isSafeInteger(iat) ? { userId, issuedAt: iat } : null;
  } catch { return null; }
}

/**
 * Partner cohort report link (a-partner-kit). Purpose "partner-report": the
 * payload names one partner code and an expiry, never a person. Same key and
 * MAC as every other link (REMINDER_LINK_SIGNING_SECRET, no new env); the
 * purpose is inside the signed payload, so a link of another purpose (a
 * calendar feed, an unsubscribe) can never open a report and vice versa.
 */
/** Same shape as CAMPAIGN_CODE_RE (mentor/credits/free-credits.ts); kept local so this module stays dependency-free. */
const PARTNER_CODE = /^[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9])){2,23}$/;
export function signPartnerReportToken(code: string, days: number, now = new Date()): string {
  if (!PARTNER_CODE.test(code)) throw new Error("Invalid partner code");
  if (!Number.isFinite(days) || days < 1 || days > 400) throw new Error("Invalid link lifetime");
  const payload = Buffer.from(JSON.stringify({ v: 1, purpose: "partner-report", code, exp: Math.floor(now.getTime() / 1000) + Math.floor(days) * 86400 })).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", secret()).update(`v1.${payload}`).digest("base64url")}`;
}
/** The partner code of a valid, unexpired report link, else null (never throws on a bad link). */
export function readPartnerReportToken(value: string, now = new Date()): string | null {
  if (typeof value !== "string" || value.length > 1024 || !reminderLinksConfigured()) return null;
  const [version, payload, signature, extra] = value.split(".");
  if (version !== "v1" || !payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", secret()).update(`v1.${payload}`).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.v !== 1 || data.purpose !== "partner-report" || typeof data.code !== "string") return null;
    if (!Number.isSafeInteger(data.exp) || data.exp <= Math.floor(now.getTime() / 1000)) return null;
    return PARTNER_CODE.test(data.code) ? data.code : null;
  } catch { return null; }
}
