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
 * arrived" as a result rather than "still checking"? Only when the verified
 * no-payment row that releases the /pricing second-checkout guard is
 * present for the tier's latest redirect, so the page and pendingCheckout
 * agree. null when there is no redirect row for the tier (a best-effort
 * write may be missing): the page then waits its own settle window.
 */
export function noPaymentSettled(events: readonly CheckoutEvent[], tier: string): boolean | null {
  const latest = [...events].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const redirect = latest.find(row => row.event === 'checkout_redirected' && row.tier === tier);
  if (!redirect) return null;
  return latest.some(row => verifiedAbsentAfter(row, redirect));
}

/** Billing help mails use an ASCII-only subject: some mobile clients (Yahoo) mangle percent-encoded umlauts. */
export const BILLING_MAIL_SUBJECT = 'MedPruef payment and access';

/**
 * What the pending strip shows. 'absent' only on a final verify answer
 * (verifyAbsentFinal); elapsed time alone never claims that no payment
 * arrived (an unmapped payment logs grant_failed, which status ignores).
 */
export function pendingStripView(pending: { expired?: boolean } | null, absent: boolean): 'none' | 'pending' | 'ceiling' | 'absent' {
  if (absent) return 'absent';
  if (!pending) return 'none';
  return pending.expired ? 'ceiling' : 'pending';
}

/**
 * Is a verify no-payment answer final for the strip? Same rule as the success
 * page: the server's settled flag wins; without one (trial verify) wait the
 * guard window from the first answer. Never before the redirect is old enough
 * (settle window for a purchase, the 30 minute guard window for a trial).
 */
export function verifyAbsentFinal(o: { tier: string; createdAt: string; settled: boolean | null | undefined; firstNoPaymentAt: number | null; now: number; trial: boolean }): boolean {
  const age = o.now - Date.parse(o.createdAt);
  if (age < (o.trial ? 30 * 60_000 : CHECKOUT_SETTLE_MS)) return false;
  if (o.settled === true) return true;
  if (o.settled === false) return false;
  // Trial verify records no release row: the redirect age (30 min guard window) is the anchor.
  if (o.trial) return true;
  return o.firstNoPaymentAt !== null && o.now - o.firstNoPaymentAt >= CHECKOUT_SETTLE_MS;
}
