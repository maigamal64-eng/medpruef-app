export type CheckoutEvent = { event: string; created_at: string; tier?: string | null; checkout_session_id?: string | null; reason?: string | null };

/**
 * A Whop charge can still be settling right after the buyer returns, so a
 * "no payment found" check only counts as verified once this long has passed
 * since the redirect. Earlier checks never release the second-checkout guard.
 */
export const CHECKOUT_SETTLE_MS = 10 * 60_000;

function verifiedAbsentAfter(row: CheckoutEvent, redirect: CheckoutEvent): boolean {
  return row.event === 'checkout_failed' && row.reason === 'verified_payment_not_found' && row.tier === redirect.tier
    && Date.parse(row.created_at) >= Date.parse(redirect.created_at) + CHECKOUT_SETTLE_MS;
}

/** A redirect is a hand-off, never proof of payment. Avoid a second checkout while it resolves. */
export function pendingCheckout(events: readonly CheckoutEvent[], now = Date.now(), windowMs = 30 * 60_000): CheckoutEvent | null {
  const latest = [...events].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const redirect = latest.find(row => row.event === 'checkout_redirected' && now >= Date.parse(row.created_at) && now - Date.parse(row.created_at) < windowMs);
  if (!redirect) return null;
  return latest.some(row => ((row.event === 'grant_succeeded' && Date.parse(row.created_at) >= Date.parse(redirect.created_at)) || verifiedAbsentAfter(row, redirect))) ? null : redirect;
}

/**
 * The verify route records a verified no-payment result at most once per
 * redirect, and only after the settle window, so polling never floods
 * payment_events or releases the guard while a charge is in flight.
 */
export function shouldRecordVerifiedAbsent(events: readonly CheckoutEvent[], tier: string, now = Date.now()): boolean {
  const latest = [...events].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const redirect = latest.find(row => row.event === 'checkout_redirected' && row.tier === tier && now >= Date.parse(row.created_at));
  if (!redirect || now - Date.parse(redirect.created_at) < CHECKOUT_SETTLE_MS) return false;
  return !latest.some(row => verifiedAbsentAfter(row, redirect));
}

/**
 * Issue 7 (user activity 2026-10-12): may the success page say "no payment
 * arrived" as a result rather than "still checking"? Only once the settle
 * window has passed since the latest redirect for this tier, the same moment
 * the verify route records the verified no-payment result that releases the
 * second-checkout guard, so the page and /pricing agree. Without a redirect
 * for the tier there is nothing in flight.
 */
export function noPaymentSettled(events: readonly CheckoutEvent[], tier: string, now = Date.now()): boolean {
  const latest = [...events].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const redirect = latest.find(row => row.event === 'checkout_redirected' && row.tier === tier && now >= Date.parse(row.created_at));
  if (!redirect) return true;
  return now - Date.parse(redirect.created_at) >= CHECKOUT_SETTLE_MS;
}
