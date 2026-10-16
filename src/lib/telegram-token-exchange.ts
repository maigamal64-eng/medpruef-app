/**
 * Telegram login-token exchange with honest failure types (UX-ONB-22).
 *
 *  - ok:        the server minted a session for this token.
 *  - rejected:  the server refused the token (invalid, used or expired, or
 *               rate limited). Permanent for this token: the caller scrubs it
 *               and sends the learner to /login?reason=telegram_expired.
 *  - network:   no answer or a 5xx after bounded retries. The token is kept,
 *               nothing claims it expired, and the caller offers a retry.
 *
 * One token, one consumer: callers hold a single in-flight guard so a retry
 * never runs two exchanges at once.
 */
import { captureAttributionFromUrl, getStoredAttribution } from "@/lib/attribution";

export type TokenExchangeResult =
  | { kind: "ok"; data: { user: unknown; gamification: unknown; sessionToken: string } }
  | { kind: "rejected"; status: number; reason: "expired_or_used" | "rate_limited" | "invalid" }
  | { kind: "network" };

type Fetcher = (input: string, init: RequestInit & { timeoutMs?: number; skipAuthRedirect?: boolean }) => Promise<Response>;

export const EXCHANGE_BACKOFF_MS = [0, 1_500, 4_000] as const;

export async function exchangeTelegramToken(
  token: string,
  fetcher: Fetcher,
  opts: { backoffMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TokenExchangeResult> {
  const backoff = opts.backoffMs ?? EXCHANGE_BACKOFF_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // a-first-touch: a tagged bot sign-in link carries its utm triple on this
  // URL; store it as first touch now, whatever order the layout capture runs in.
  captureAttributionFromUrl();
  for (const wait of backoff) {
    if (wait > 0) await sleep(wait);
    let res: Response;
    try {
      res = await fetcher("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // a20 attribution fix: Telegram sign-ins carry the stored campaign tags.
        body: JSON.stringify({ tokenExchange: token, attribution: getStoredAttribution() ?? undefined }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
    } catch {
      continue;
    }
    if (res.ok) {
      try {
        const data = await res.json();
        if (data && typeof data.sessionToken === "string" && data.user) return { kind: "ok", data };
      } catch { /* malformed success: treat as a network failure and retry */ }
      continue;
    }
    if (res.status === 429) return { kind: "rejected", status: 429, reason: "rate_limited" };
    if (res.status >= 400 && res.status < 500) {
      return { kind: "rejected", status: res.status, reason: res.status === 401 ? "expired_or_used" : "invalid" };
    }
    // 5xx: retry.
  }
  return { kind: "network" };
}
