/**
 * Signed bot deep link that binds a Telegram account to the signed-in
 * MedPrüf account (a-trial-phone-gate). Server only (node:crypto).
 *
 * Why signed: the bot's start parameter is the only thing that ties the
 * Telegram that presses Start to an account. A bare user id is not a secret
 * (the old auth_<uuid> path wrote telegram_id from it and allowed an account
 * takeover, closed 13 Oct), so the parameter carries the account id, the
 * issue time and a truncated HMAC. Only the signed-in account's own session
 * can mint one (POST /api/telegram/link), it lives 15 minutes, a token issued
 * before users.session_invalidated_at is refused, and binding only ever
 * fills an empty users.telegram_id, so the first Telegram wins and a leaked
 * link stops working once the owner linked.
 *
 * Shape (Telegram allows 64 characters of A-Z a-z 0-9 _ -):
 *   "lk_" + base64url(16 byte user id | 4 byte issue time | 12 byte MAC)
 * = 46 characters. MAC = HMAC-SHA256(secret, "tl1.telegram-link.<payload>")
 * cut to 12 bytes (96 bits; brute force is bounded by the 15 minutes).
 *
 * Signing key: REMINDER_LINK_SIGNING_SECRET (the one learner link secret,
 * never SESSION_SIGNING_SECRET); domain separated from ec1/tc1/sl1/v1 by its
 * own prefix and purpose.
 */
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";

const PREFIX = "tl1";
const PURPOSE = "telegram-link";
export const TELEGRAM_LINK_TTL_S = 15 * 60;
const SKEW_S = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const startParam = /^lk_[A-Za-z0-9_-]{43}$/;

type Env = Record<string, string | undefined>;

export function telegramLinksConfigured(env: Env = process.env): boolean {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  return !!key && Buffer.byteLength(key) >= 32;
}

function secret(env: Env): string {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new Error("Telegram link signing is not configured");
  return key;
}

function mac(payload: Buffer, env: Env): Buffer {
  return createHmac("sha256", secret(env))
    .update(`${PREFIX}.${PURPOSE}.${payload.toString("base64url")}`)
    .digest()
    .subarray(0, 12);
}

/** True for a start parameter that looks like a link token (the bot routes on it). */
export function isTelegramLinkParam(value: string | null | undefined): boolean {
  return typeof value === "string" && startParam.test(value);
}

export function signTelegramLinkToken(args: { userId: string; now?: Date; env?: Env }): string {
  const env = args.env ?? process.env;
  if (!uuid.test(args.userId)) throw new Error("Invalid user id");
  const id = Buffer.from(args.userId.replace(/-/g, ""), "hex");
  const iat = Buffer.alloc(4);
  iat.writeUInt32BE(Math.floor((args.now ?? new Date()).getTime() / 1000));
  const payload = Buffer.concat([id, iat]);
  return `lk_${Buffer.concat([payload, mac(payload, env)]).toString("base64url")}`;
}

export type TelegramLinkToken =
  | { ok: true; userId: string; issuedAt: Date }
  | { ok: false; error: "invalid" | "expired" | "unconfigured" };

export function verifyTelegramLinkToken(raw: unknown, opts: { now?: Date; env?: Env } = {}): TelegramLinkToken {
  const env = opts.env ?? process.env;
  if (!telegramLinksConfigured(env)) return { ok: false, error: "unconfigured" };
  if (!isTelegramLinkParam(raw as string)) return { ok: false, error: "invalid" };
  const bytes = Buffer.from((raw as string).slice(3), "base64url");
  if (bytes.length !== 32) return { ok: false, error: "invalid" };
  const payload = bytes.subarray(0, 20);
  const given = bytes.subarray(20);
  if (!safeEqual(given.toString("hex"), mac(payload, env).toString("hex"))) return { ok: false, error: "invalid" };
  const hex = payload.subarray(0, 16).toString("hex");
  const userId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const iatS = payload.readUInt32BE(16);
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (iatS > nowS + SKEW_S) return { ok: false, error: "invalid" };
  if (nowS - iatS > TELEGRAM_LINK_TTL_S) return { ok: false, error: "expired" };
  return { ok: true, userId, issuedAt: new Date(iatS * 1000) };
}
