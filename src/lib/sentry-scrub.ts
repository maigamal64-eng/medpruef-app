/**
 * Sentry scrub for Telegram bot tokens (a-whop-cancel-signal, reviewer P2).
 * The Bot API puts the token in the request path (/bot<id>:<secret>/...), so
 * an outgoing-fetch breadcrumb or span can carry it. Every string in a
 * breadcrumb, event or transaction is rewritten before it leaves the server.
 */
const TOKEN_RE = /bot\d{3,}:[A-Za-z0-9_-]{10,}/g;

export function scrubTelegramToken(text: string): string {
  return text.replace(TOKEN_RE, "bot<redacted>");
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") return scrubTelegramToken(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = walk(value[i], depth + 1);
    return value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = walk(obj[key], depth + 1);
    return obj;
  }
  return value;
}

/** Mutates and returns the Sentry payload with every bot token redacted. */
export function scrubSentryPayload<T>(payload: T): T {
  try {
    return walk(payload, 0) as T;
  } catch {
    return payload;
  }
}
