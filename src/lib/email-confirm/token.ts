/**
 * Signed confirmation links for email registrations (a-email-confirm-trial).
 * Server only (node:crypto).
 *
 * A link names one account (users.id) and the address it was mailed to (a
 * sha256 key of the trimmed, lower-cased address, never the address), and it
 * expires. If the account's address changes, older links stop working.
 * Opening a link never confirms anything: the page asks for a button press
 * (a form POST), so mail scanners that prefetch links change nothing.
 *
 * Key: REMINDER_LINK_SIGNING_SECRET. Domain separated from the reminder links
 * ("v1", purposes in reminders/tokens.ts) and the trial claim links ("tc1") by
 * its own prefix "ec1" and purpose inside the MAC input, so no other link can
 * verify as a confirmation link or the other way round.
 */
import { createHash, createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";
import { EMAIL_CONFIRM_LINK_DAYS, emailConfirmLinksConfigured } from "./flag";

const PREFIX = "ec1";
const PURPOSE = "email-confirm";
const DAY_S = 86_400;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex64 = /^[0-9a-f]{64}$/;

type Env = Record<string, string | undefined>;

/** Key of the address the link was mailed to (domain separated from every other address key). */
export function confirmEmailKey(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const normalised = email.trim().toLowerCase();
  if (!normalised.includes("@")) return null;
  return createHash("sha256").update(`${PURPOSE}:${normalised}`).digest("hex");
}

function secret(env: Env): string {
  if (!emailConfirmLinksConfigured(env)) throw new Error("Email confirm link signing is not configured");
  return env.REMINDER_LINK_SIGNING_SECRET as string;
}

function mac(payload: string, env: Env): string {
  return createHmac("sha256", secret(env)).update(`${PREFIX}.${PURPOSE}.${payload}`).digest("base64url");
}

export function signConfirmToken(args: { userId: string; email: string; now?: Date; days?: number; env?: Env }): string {
  const env = args.env ?? process.env;
  if (!uuid.test(args.userId)) throw new Error("Invalid user id");
  const ek = confirmEmailKey(args.email);
  if (!ek) throw new Error("Invalid email");
  const days = args.days ?? EMAIL_CONFIRM_LINK_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > EMAIL_CONFIRM_LINK_DAYS) throw new Error("Invalid link lifetime");
  const now = args.now ?? new Date();
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    p: PURPOSE,
    u: args.userId.toLowerCase(),
    ek,
    exp: Math.floor(now.getTime() / 1000) + days * DAY_S,
  })).toString("base64url");
  return `${PREFIX}.${payload}.${mac(payload, env)}`;
}

export type ConfirmTokenResult =
  | { ok: true; userId: string; emailKey: string }
  | { ok: false; error: "invalid" | "expired" | "unconfigured" };

/** Signature first; "expired" is reported only for a genuine link. */
export function verifyConfirmToken(value: unknown, now: Date = new Date(), env: Env = process.env): ConfirmTokenResult {
  if (!emailConfirmLinksConfigured(env)) return { ok: false, error: "unconfigured" };
  if (typeof value !== "string" || value.length > 1024) return { ok: false, error: "invalid" };
  const [prefix, payload, signature, extra] = value.split(".");
  if (prefix !== PREFIX || !payload || !signature || extra !== undefined) return { ok: false, error: "invalid" };
  if (!safeEqual(signature, mac(payload, env))) return { ok: false, error: "invalid" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.v !== 1 || data.p !== PURPOSE || typeof data.u !== "string" || !uuid.test(data.u)) return { ok: false, error: "invalid" };
    if (typeof data.ek !== "string" || !hex64.test(data.ek)) return { ok: false, error: "invalid" };
    if (!Number.isSafeInteger(data.exp)) return { ok: false, error: "invalid" };
    if (data.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, error: "expired" };
    return { ok: true, userId: data.u, emailKey: data.ek };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

/** The mail link: https://medpruf.com/confirm-email?t=<token>&lang=<de|en>. */
export function confirmLinkUrl(token: string, lang: "de" | "en", env: Env = process.env): string {
  const base = (env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com").replace(/\/+$/, "");
  return `${base}/confirm-email?t=${encodeURIComponent(token)}&lang=${lang}`;
}
