/**
 * Zoho Mail API wrapper for transactional emails.
 *
 * Mirrors the Python pattern in scripts/zoho_reengagement.py — same
 * OAuth refresh-token → access-token flow, same /api/accounts/<id>/
 * messages send endpoint. Used by the trial-reminder cron, the post-
 * purchase confirmation email (future), and any other server-side
 * email drop.
 *
 * Env vars required:
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_REFRESH_TOKEN
 *   ZOHO_FROM_EMAIL          (e.g. user-b7e46e80@example.com)
 *   ZOHO_ACCOUNT_ID          (numeric Zoho account id; can be looked
 *                             up once via GET /api/accounts and pinned)
 *
 * If any env var is missing, sendZohoEmail returns
 * { ok: false, reason: 'not_configured' } and the caller should record
 * a pending event for manual drain.
 *
 * Access token cache: Zoho tokens are valid 1 hour; we cache for 55 min
 * in-memory across the lambda lifetime.
 *
 * review-2026-04-26-C1.
 */

const ZOHO_OAUTH_URL = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zoho.com/api";
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;

export function clearZohoTokenCache(): void {
  cached = null;
}

async function getZohoAccessToken(): Promise<string | null> {
  if (cached && cached.expiresAtMs > Date.now()) return cached.token;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(ZOHO_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error("[zoho] refresh failed", { status: r.status, code: "oauth_http_error" });
      return null;
    }
    const body = (await r.json()) as { access_token?: string };
    if (!body.access_token) return null;
    cached = {
      token: body.access_token,
      expiresAtMs: Date.now() + ACCESS_TOKEN_TTL_MS,
    };
    return body.access_token;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface SendZohoEmailArgs {
  to: string;
  subject: string;
  htmlBody: string;
  /** Optional CC recipient — [name] by default for transactional copies. */
  cc?: string;
}

export type SendZohoEmailResult =
  | { ok: true; messageId?: string }
  | { ok: false; reason: "not_configured" | "auth_failed" | "send_failed"; status?: number; details?: string };

/**
 * Fire one transactional email through Zoho. Idempotent only at the
 * Zoho side (same to+subject+content within a few seconds may be
 * dedup'd by their server); callers should still gate via a DB stamp
 * (e.g. trial_reminder_sent_at).
 */
export async function sendZohoEmail(args: SendZohoEmailArgs): Promise<SendZohoEmailResult> {
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  const fromEmail = process.env.ZOHO_FROM_EMAIL;
  if (!accountId || !fromEmail) return { ok: false, reason: "not_configured" };

  const token = await getZohoAccessToken();
  if (!token) return { ok: false, reason: "auth_failed" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const payload: Record<string, string> = {
      fromAddress: fromEmail,
      toAddress: args.to,
      subject: args.subject,
      content: args.htmlBody,
      mailFormat: "html",
      askReceipt: "no",
    };
    if (args.cc) payload.ccAddress = args.cc;

    const r = await fetch(`${ZOHO_MAIL_API}/accounts/${accountId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error("[zoho] send failed", { status: r.status, code: "mail_http_error" });
      // Token may have just expired between cache + send; clear so the
      // next call re-authenticates.
      if (r.status === 401) clearZohoTokenCache();
      return {
        ok: false,
        reason: "send_failed",
        status: r.status,
        details: "mail_http_error",
      };
    }
    const body = (await r.json()) as { data?: { messageId?: string } };
    return { ok: true, messageId: body?.data?.messageId };
  } catch {
    return {
      ok: false,
      reason: "send_failed",
      details: "mail_transport_error",
    };
  } finally {
    clearTimeout(timer);
  }
}
