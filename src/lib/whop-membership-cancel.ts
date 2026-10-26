import { WHOP_FETCH_TIMEOUT_MS } from "@/lib/whop-timeouts";
import { whopHeaders } from "@/lib/whop-api";

/**
 * Schedule a Whop membership to end at its period end (never an immediate
 * cancel, never a refund): POST /v1/memberships/{id}/cancel
 * {cancellation_mode: "at_period_end"}. Whop v1 rejects the old
 * {cancel_at_period_end: true} body with 400 parameter_invalid (verified live
 * 26 Oct). Shared by the 6-month stop and guard
 * (pricing-v2/half-year-server.ts) and the switch to a longer pass
 * (whop-switch.ts); each caller names its own idempotency key. Status 0 means
 * no key or a network failure. A non-2xx answer is ok:false with Whop's
 * error code (when it sends one), which is also logged.
 */
export const WHOP_CANCEL_AT_PERIOD_END_BODY = { cancellation_mode: "at_period_end" } as const;

export async function cancelMembershipAtPeriodEnd(
  membershipId: string,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = WHOP_FETCH_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; code?: string | null }> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  if (!apiKey) return { ok: false, status: 0 };
  let res: Response;
  try {
    res = await fetchImpl(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}/cancel`, {
      method: "POST",
      headers: whopHeaders(apiKey, { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }),
      body: JSON.stringify(WHOP_CANCEL_AT_PERIOD_END_BODY),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (res.ok) return { ok: true, status: res.status };
  const code = await whopErrorCode(res);
  console.warn(`[whop-cancel] Whop refused the period-end cancel for ${membershipId}: HTTP ${res.status} ${code ?? "no error code"}`);
  return { ok: false, status: res.status, code };
}

/** Whop's error code from a refused call ({error: {type|code}}), or null. Never throws. */
async function whopErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { type?: unknown; code?: unknown } } | null;
    const pick = body?.error?.code ?? body?.error?.type;
    return typeof pick === "string" ? pick.slice(0, 80) : null;
  } catch {
    return null;
  }
}
