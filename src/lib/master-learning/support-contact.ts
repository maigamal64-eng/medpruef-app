/**
 * Logged-out support form (LX-31-R). Pure validation, honeypot, rate window and
 * mail building. The route (draft in handover) adds the real rate-limit store
 * and sends through the existing zoho.ts helper.
 *
 * The message body is never logged: use logSafe for anything that reaches a log.
 */

export const HONEYPOT_FIELD = "website";
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
export const RATE_MAX_PER_WINDOW = 3;
export const RATE_WINDOW_MS = 10 * 60_000;

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export interface SupportInput {
  email?: unknown;
  message?: unknown;
  page?: unknown;
  accountId?: unknown;
  [HONEYPOT_FIELD]?: unknown;
}

export interface CleanSupport {
  email: string;
  message: string;
  page: string | null;
  accountId: string | null;
}

export type SupportValidation =
  | { ok: true; clean: CleanSupport }
  | { ok: false; reason: "honeypot" | "invalid"; errors: string[] };

function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, max) : "";
}

export function validateSupportInput(input: SupportInput): SupportValidation {
  const trap = input[HONEYPOT_FIELD];
  if (typeof trap === "string" ? trap.trim() !== "" : trap !== undefined && trap !== null && trap !== "") {
    return { ok: false, reason: "honeypot", errors: [] };
  }
  const errors: string[] = [];
  const email = oneLine(input.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.push("email");
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (message.length < MESSAGE_MIN) errors.push("message_too_short");
  if (message.length > MESSAGE_MAX) errors.push("message_too_long");
  if (errors.length) return { ok: false, reason: "invalid", errors };
  const page = oneLine(input.page, 200);
  const accountId = oneLine(input.accountId, 64);
  return { ok: true, clean: { email, message, page: page || null, accountId: accountId || null } };
}

/** Sliding window over prior request timestamps (ms) for one key (e.g. hashed IP). */
export function checkRate(
  priorMs: readonly number[],
  nowMs: number,
  max = RATE_MAX_PER_WINDOW,
  windowMs = RATE_WINDOW_MS,
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const recent = priorMs.filter((t) => nowMs - t < windowMs).sort((a, b) => a - b);
  if (recent.length >= max) {
    const oldest = recent[recent.length - max];
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
  }
  return { allowed: true, remaining: max - recent.length - 1, retryAfterSec: 0 };
}

/** Plain-text mail for the support mailbox. Header fields are single-line by construction. */
export function buildSupportMail(c: CleanSupport): { replyTo: string; subject: string; text: string } {
  const lines = [
    `From: ${c.email}`,
    c.accountId ? `Account: ${c.accountId}` : null,
    c.page ? `Page: ${c.page}` : null,
    "",
    c.message,
  ].filter((l): l is string => l !== null);
  return { replyTo: c.email, subject: "Support request (logged-out form)", text: lines.join("\n") };
}

/** Metadata that is safe to log: never the body, the address or the client-supplied page string. */
export function logSafe(c: CleanSupport): { messageLength: number; hasAccount: boolean } {
  return { messageLength: c.message.length, hasAccount: c.accountId !== null };
}

/** Reply time is stated only when measured (D-LX-10): nothing is promised in code. */
export const REPLY_TIME_PROMISE: string | null = null;
