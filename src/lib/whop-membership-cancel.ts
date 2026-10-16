/**
 * Schedule a Whop membership to end at its period end (never an immediate
 * cancel, never a refund): POST /v1/memberships/{id}/cancel
 * {cancel_at_period_end: true}. Shared by the 6-month stop and guard
 * (pricing-v2/half-year-server.ts) and the switch to a longer pass
 * (whop-switch.ts); each caller names its own idempotency key. Status 0 means
 * no key or a network failure.
 */
export async function cancelMembershipAtPeriodEnd(
  membershipId: string,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const apiKey = process.env.WHOP_API_KEY || process.env.WHOP_APP_API_KEY;
  if (!apiKey) return { ok: false, status: 0 };
  try {
    const res = await fetchImpl(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ cancel_at_period_end: true }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
