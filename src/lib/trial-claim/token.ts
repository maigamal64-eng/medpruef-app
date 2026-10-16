/**
 * Signed claim links for the release mail (a-reverse-trial-claim). Server
 * only (node:crypto).
 *
 * A link is bound to one account (its user id) and to the address it was
 * mailed to (the reverse-trial email key, a sha256, never the address), and
 * it expires (default 14 days after signing, at most 30). Opening it never
 * claims anything: the page asks for a button press, which POSTs the token
 * together with the signed-in session, and the session must be the same
 * account.
 *
 * Signing key: REMINDER_LINK_SIGNING_SECRET, the one secret for learner mail
 * links (never SESSION_SIGNING_SECRET). Domain separated from the reminder
 * links by its own version prefix ("tc1") and purpose, so a reminder token
 * can never verify as a claim link or the other way round. Without the
 * secret (unset or under 32 bytes) no link can be signed or accepted; the
 * Home card works without it.
 */
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";

const PREFIX = "tc1";
const PURPOSE = "trial-claim";
const DAY_S = 86_400;
export const CLAIM_LINK_DEFAULT_DAYS = 14;
export const CLAIM_LINK_MAX_DAYS = 30;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex64 = /^[0-9a-f]{64}$/;

type Env = Record<string, string | undefined>;

export function claimLinksConfigured(env: Env = process.env): boolean {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  return !!key && Buffer.byteLength(key) >= 32;
}

function secret(env: Env): string {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new Error("Claim link signing is not configured");
  return key;
}

function mac(payload: string, env: Env): string {
  return createHmac("sha256", secret(env)).update(`${PREFIX}.${PURPOSE}.${payload}`).digest("base64url");
}

export interface SignClaimArgs {
  userId: string;
  /** trialEmailKey of the address the mail goes to; null for no address binding. */
  emailKey: string | null;
  days?: number;
  now?: Date;
  env?: Env;
}

export function signClaimToken(args: SignClaimArgs): string {
  const env = args.env ?? process.env;
  if (!uuid.test(args.userId)) throw new Error("Invalid user id");
  if (args.emailKey !== null && !hex64.test(args.emailKey)) throw new Error("Invalid email key");
  const days = args.days ?? CLAIM_LINK_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > CLAIM_LINK_MAX_DAYS) throw new Error("Invalid link lifetime");
  const now = args.now ?? new Date();
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    p: PURPOSE,
    u: args.userId.toLowerCase(),
    ek: args.emailKey,
    exp: Math.floor(now.getTime() / 1000) + days * DAY_S,
  })).toString("base64url");
  return `${PREFIX}.${payload}.${mac(payload, env)}`;
}

export type ClaimTokenResult =
  | { ok: true; userId: string; emailKey: string | null; expiresAt: string }
  | { ok: false; error: "invalid" | "expired" | "unconfigured" };

/** Signature first; "expired" is reported only for a genuine link. */
export function verifyClaimToken(value: unknown, now: Date = new Date(), env: Env = process.env): ClaimTokenResult {
  if (!claimLinksConfigured(env)) return { ok: false, error: "unconfigured" };
  if (typeof value !== "string" || value.length > 1024) return { ok: false, error: "invalid" };
  const [prefix, payload, signature, extra] = value.split(".");
  if (prefix !== PREFIX || !payload || !signature || extra !== undefined) return { ok: false, error: "invalid" };
  if (!safeEqual(signature, mac(payload, env))) return { ok: false, error: "invalid" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.v !== 1 || data.p !== PURPOSE || typeof data.u !== "string" || !uuid.test(data.u)) return { ok: false, error: "invalid" };
    if (data.ek !== null && (typeof data.ek !== "string" || !hex64.test(data.ek))) return { ok: false, error: "invalid" };
    if (!Number.isSafeInteger(data.exp)) return { ok: false, error: "invalid" };
    if (data.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, error: "expired" };
    return { ok: true, userId: data.u, emailKey: data.ek, expiresAt: new Date(data.exp * 1000).toISOString() };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

/** The mail link. The path is the rulebook allowlist entry: https://medpruf.com/trial/claim?t=<token>. */
export function claimLinkUrl(token: string, env: Env = process.env): string {
  const base = (env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com").replace(/\/+$/, "");
  return `${base}/trial/claim?t=${encodeURIComponent(token)}`;
}
