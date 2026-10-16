/**
 * Signed one-tap sitting links (a-sitting-one-tap). Server only (node:crypto).
 *
 * A link is bound to one account (its user id), optionally to the address it
 * was mailed to (the reverse-trial email key, a sha256, never the address),
 * carries its issue time and expires (default 21 days, at most 45). Opening
 * it never writes anything: the page lists the sittings and only a form POST
 * that carries the token saves a choice, so a mail scanner changes nothing.
 * A link issued before the account's session_invalidated_at, or whose address
 * key no longer matches the account's address, is refused by the server.
 *
 * Signing key: REMINDER_LINK_SIGNING_SECRET, the one secret for learner mail
 * links (no new env). Domain separated by its own prefix ("sl1") and purpose
 * inside the MAC, so a reminder, calendar or claim token never verifies here
 * and the other way round.
 */
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";

const PREFIX = "sl1";
const PURPOSE = "sitting-link";
const DAY_S = 86_400;
export const SITTING_LINK_DEFAULT_DAYS = 21;
export const SITTING_LINK_MAX_DAYS = 45;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex64 = /^[0-9a-f]{64}$/;

type Env = Record<string, string | undefined>;
export type SittingLinkLang = "de" | "en";
/** Where a link was mailed from (a-day1-sitting-ask). Signed inside the token, so it cannot be forged or dropped; absent = the original mail link. */
export type SittingLinkSource = "day1";
const SOURCES: readonly string[] = ["day1"];

export function sittingLinksConfigured(env: Env = process.env): boolean {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  return !!key && Buffer.byteLength(key) >= 32;
}

function secret(env: Env): string {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new Error("Sitting link signing is not configured");
  return key;
}

function mac(payload: string, env: Env): string {
  return createHmac("sha256", secret(env)).update(`${PREFIX}.${PURPOSE}.${payload}`).digest("base64url");
}

export interface SignSittingArgs {
  userId: string;
  /** trialEmailKey of the address the mail goes to; null for no address binding. */
  emailKey: string | null;
  days?: number;
  /** Optional allowlisted origin; purpose, prefix and expiry rules are unchanged. */
  source?: SittingLinkSource;
  now?: Date;
  env?: Env;
}

export function signSittingToken(args: SignSittingArgs): string {
  const env = args.env ?? process.env;
  if (!uuid.test(args.userId)) throw new Error("Invalid user id");
  if (args.emailKey !== null && !hex64.test(args.emailKey)) throw new Error("Invalid email key");
  if (args.source !== undefined && !SOURCES.includes(args.source)) throw new Error("Invalid link source");
  const days = args.days ?? SITTING_LINK_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > SITTING_LINK_MAX_DAYS) throw new Error("Invalid link lifetime");
  const now = args.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    p: PURPOSE,
    u: args.userId.toLowerCase(),
    ek: args.emailKey,
    iat,
    exp: iat + days * DAY_S,
    ...(args.source ? { s: args.source } : {}),
  })).toString("base64url");
  return `${PREFIX}.${payload}.${mac(payload, env)}`;
}

export type SittingTokenResult =
  | { ok: true; userId: string; emailKey: string | null; issuedAt: Date; expiresAt: Date; source: SittingLinkSource | null }
  | { ok: false; error: "invalid" | "expired" | "unconfigured" };

/** Signature first; "expired" is reported only for a genuine link. */
export function verifySittingToken(value: unknown, now: Date = new Date(), env: Env = process.env): SittingTokenResult {
  if (!sittingLinksConfigured(env)) return { ok: false, error: "unconfigured" };
  if (typeof value !== "string" || value.length > 1024) return { ok: false, error: "invalid" };
  const [prefix, payload, signature, extra] = value.split(".");
  if (prefix !== PREFIX || !payload || !signature || extra !== undefined) return { ok: false, error: "invalid" };
  if (!safeEqual(signature, mac(payload, env))) return { ok: false, error: "invalid" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.v !== 1 || data.p !== PURPOSE || typeof data.u !== "string" || !uuid.test(data.u)) return { ok: false, error: "invalid" };
    if (data.ek !== null && (typeof data.ek !== "string" || !hex64.test(data.ek))) return { ok: false, error: "invalid" };
    if (!Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp) || data.exp <= data.iat) return { ok: false, error: "invalid" };
    if (data.exp - data.iat > SITTING_LINK_MAX_DAYS * DAY_S) return { ok: false, error: "invalid" };
    if (data.s !== undefined && (typeof data.s !== "string" || !SOURCES.includes(data.s))) return { ok: false, error: "invalid" };
    if (data.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, error: "expired" };
    return { ok: true, userId: data.u, emailKey: data.ek, issuedAt: new Date(data.iat * 1000), expiresAt: new Date(data.exp * 1000), source: (data.s as SittingLinkSource | undefined) ?? null };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

/**
 * The mail link. Path for the rulebook allowlist:
 * https://medpruf.com/api/sitting-link?t=<token>&lang=de|en.
 */
export function sittingLinkUrl(token: string, lang: SittingLinkLang, env: Env = process.env): string {
  const base = (env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com").replace(/\/+$/, "");
  return `${base}/api/sitting-link?t=${encodeURIComponent(token)}&lang=${lang}`;
}
