export type CheckoutEvent = { event: string; created_at: string; tier?: string | null; checkout_session_id?: string | null; reason?: string | null };
/** A redirect is a hand-off, never proof of payment. Avoid a second checkout while it resolves. */
export function pendingCheckout(events: readonly CheckoutEvent[], now = Date.now(), windowMs = 30 * 60_000): CheckoutEvent | null {
  const latest = [...events].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const redirect = latest.find(row => row.event === 'checkout_redirected' && now >= Date.parse(row.created_at) && now - Date.parse(row.created_at) < windowMs);
  if (!redirect) return null;
  return latest.some(row => (row.event === 'grant_succeeded' || (row.event === 'checkout_failed' && row.reason === 'verified_payment_not_found' && row.tier === redirect.tier)) && Date.parse(row.created_at) >= Date.parse(redirect.created_at)) ? null : redirect;
}
